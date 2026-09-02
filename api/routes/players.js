const express = require('express');
const db = require('../services/db');
const { MESES } = require('../services/meses');
const { mesesEnMora } = require('../services/mora');
const { recalcularMensualidadesPorDescuento } = require('../services/descuentos');
const { limiteDe } = require('../services/plan-limits');
const { generarTokenPortal } = require('./publico');
const router = express.Router();

// ── Helpers para corrección de cédula ───────────────────────────────────────
// La cédula está denormalizada como texto en estas tablas (no por FK). Al
// cambiarla en `players` hay que arrastrarla en todas. `players` primero.
// (No se usa una función SQL porque el PostgREST de este proyecto no expone
//  RPCs — se hace con updates de tabla, que sí funcionan.)
const TABLAS_CEDULA = [
  'players', 'mensualidades', 'pagos', 'suspensiones', 'torneos',
  'asistencia', 'pedido_uniformes', 'wa_log_envios', 'uniformes',
];

// Mueve todas las filas de club+cedOld a cedNew. Devuelve { tabla: filas }.
async function moverCedula(clubUuid, cedOld, cedNew) {
  if (!cedOld || !cedNew || cedOld === cedNew) return {};
  const movidos = {};
  for (const t of TABLAS_CEDULA) {
    const { data, error } = await db.supabase.from(t)
      .update({ cedula: cedNew })
      .eq('club_id', clubUuid).eq('cedula', String(cedOld))
      .select('id');
    if (error) {
      // Tabla legacy (ej. `uniformes`) que puede no existir en este club.
      if (/does not exist|find the table|schema cache/i.test(error.message)) continue;
      throw new Error(`${t}: ${error.message}`);
    }
    if (data && data.length) movidos[t] = data.length;
  }
  return movidos;
}

// Intercambia dos cédulas del mismo club vía sentinela temporal (evita chocar
// con los UNIQUE). No es transaccional: si un paso falla, el jugador queda con
// una cédula 'SWP-...' — el endpoint lo reporta y el pre-check lo detecta.
async function intercambiarCedulas(clubUuid, cedA, cedB) {
  const tmp = `SWP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p1 = await moverCedula(clubUuid, cedA, tmp);
  const p2 = await moverCedula(clubUuid, cedB, cedA);
  const p3 = await moverCedula(clubUuid, tmp, cedB);
  return { pasos: [p1, p2, p3] };
}

// La foto vive en storage con path determinístico player-photos/{slug}/{cedula}.jpg
// (ver TabPerfil.jsx). Al cambiar la cédula hay que mover el archivo. Best-effort:
// si falla, la foto solo hay que re-subirla, los datos ya quedaron correctos.
async function moverFotoJugador(slug, cedOld, cedNew, esSwap) {
  const bucket = db.supabase.storage.from('player-photos');
  const p = (c) => `${slug}/${c}.jpg`;
  try {
    if (esSwap) {
      const tmp = `${slug}/__swap_${Date.now()}.jpg`;
      await bucket.move(p(cedOld), tmp);
      await bucket.move(p(cedNew), p(cedOld));
      await bucket.move(tmp, p(cedNew));
    } else {
      await bucket.move(p(cedOld), p(cedNew));
    }
  } catch (e) {
    console.error('[cedula] no se pudo mover la foto:', e.message);
  }
}

// Si players.foto_url guarda la URL pública con la cédula vieja en el path, la
// reescribe. El jugador ya quedó con la cédula nueva en la BD (cedNew).
async function sincronizarFotoUrl(clubId, jugador, cedOld, cedNew) {
  const url = jugador?.foto_url;
  if (!url || !String(url).includes(`/${cedOld}.jpg`)) return;
  const nueva = String(url).replace(`/${cedOld}.jpg`, `/${cedNew}.jpg`);
  await db.supabase.from('players').update({ foto_url: nueva })
    .eq('club_id', clubId).eq('cedula', cedNew);
}

// GET /api/players?club_id=city-fc
router.get('/', async (req, res) => {
  try {
    const club_id = req.club_id;

    // Resolver el UUID del club a partir del slug (ej: 'city-fc')
    const club = await db.getClubBySlug(club_id);
    if (!club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const incluirArchivados = req.query.incluir_archivados === 'true';
    let jugadores = await db.getPlayers(club.id, { incluirArchivados });
    if (req.query.deporte) {
      jugadores = jugadores.filter(j => j.deporte === req.query.deporte);
    }
    res.json({ success: true, total: jugadores.length, data: jugadores });
  } catch (error) {
    console.error('Error in GET /players:', error);
    res.status(500).json({ success: false, error: 'Error fetching players', message: error.message });
  }
});

// Arma el texto de estado de cuenta de un jugador (mensualidades + torneos + uniformes +
// medios de pago). Sin QR: un link `wa.me` solo puede prellenar texto, no adjuntar imagen —
// el admin comparte el QR por fuera si hace falta.
function construirTextoEstadoCuenta(club, jugador, datos) {
  const { mensByCedula, torneosByCedula, pedidosByCedula, anioAct, mesActualNum, pastGracePeriod, suspensiones } = datos;

  const clubNombre     = club.config?.nombre || club.name;
  const clubSlug       = club.slug;
  const adminDigits    = club.celular_admin ? String(club.celular_admin).replace(/\D/g, '') : null;
  const adminWaLink    = adminDigits ? `wa.me/${adminDigits.startsWith('57') ? adminDigits : '57' + adminDigits}` : null;
  const llavePago      = club.config?.llave_pago   || null;
  const cuentaBancaria = club.config?.cuenta_bancaria || null;
  const razonSocial    = club.config?.razon_social || null;
  const nit            = club.config?.nit || null;

  const fmtCOP    = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  const nowCol    = new Date(Date.now() - 5 * 3600000);
  const MESES_ES  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  const { cedula, nombre, apellidos } = jugador;
  const nombreCompleto = `${nombre || ''} ${apellidos || ''}`.trim();

  // — Mensualidades — solo lo causado hasta hoy, nunca meses futuros del año
  // (mismo criterio que el dashboard y consultar_pagos_club/consultar_morosos del bot)
  const mens     = (mensByCedula[String(cedula)] || []).filter(m => (m.valor_oficial || 0) > 0);
  const pendMens = mesesEnMora(mens, cedula, anioAct, mesActualNum, pastGracePeriod, suspensiones);
  const enMora   = pendMens.some(m => m.estado === 'MORA');
  const saldoMens = pendMens.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);

  let lineaMens;
  if (pendMens.length === 0) {
    lineaMens = '✅ Al día';
  } else {
    lineaMens = `${enMora ? '🔴 En mora' : '⏳ Pendiente'}\nMeses: ${pendMens.length} | Saldo: ${fmtCOP(saldoMens)}`;
  }

  // — Torneos — solo los que ya iniciaron (fecha de inicio <= hoy). Si no se
  // puede determinar la fecha (inscripción vieja sin torneo_id, o torneo sin
  // fecha configurada), se muestra igual para no ocultar una deuda real.
  const hoyStr      = nowCol.toISOString().slice(0, 10);
  const torneosDef  = club.config?.torneos_iniciales || [];
  const fechaTorneo = (torneoId) => torneosDef.find(td => String(td.id) === String(torneoId))?.fecha || null;
  const torneos = (torneosByCedula[String(cedula)] || []).filter(t => {
    const f = fechaTorneo(t.torneo_id);
    return !f || f <= hoyStr;
  });
  let lineaTorneos;
  if (torneos.length === 0) {
    lineaTorneos = 'Sin inscripciones activas';
  } else {
    lineaTorneos = torneos.map(t => {
      const saldoT = parseFloat(t.saldo_pendiente) || 0;
      const valorT = parseFloat(t.valor_inscrito)  || parseFloat(t.valor_oficial) || 0;
      return `* ${t.nombre_torneo}: saldo pendiente ${fmtCOP(saldoT)} (valor total ${fmtCOP(valorT)}).`;
    }).join('\n');
  }

  // — Uniformes (pedidos con saldo: PENDIENTE o ABONO parcial) —
  const pedPend  = (pedidosByCedula[String(cedula)] || []).filter(p => p.estado === 'PENDIENTE' || p.estado === 'ABONO');
  const saldoUnif = pedPend.reduce((s, p) => s + Math.max(0, (parseFloat(p.total) || 0) - (parseFloat(p.valor_pagado) || 0)), 0);
  const lineaUnif = saldoUnif > 0 ? `🔴 Saldo: ${fmtCOP(saldoUnif)}` : '✅ Sin saldo pendiente';

  // — Mensaje —
  const mesActualLower = MESES_ES[nowCol.getMonth()];
  let msg = `Hola *${nombre || nombreCompleto}* 👋\n\n`;
  msg += `Te compartimos tu estado de cuenta con ${clubNombre} hasta ( ${mesActualLower} ) de ${nowCol.getFullYear()}\n`;
  msg += `📅 MENSUALIDADES\n${lineaMens}\n\n`;
  msg += `👕 UNIFORMES\n${lineaUnif}\n\n`;
  msg += `🏆 TORNEOS *(SE PAGA A CUENTA PERSONAL)*\n\n${lineaTorneos}\n\n`;

  let footerEmpresa = '';
  if (razonSocial) footerEmpresa += `🏪 ${razonSocial}\n`;
  if (nit)         footerEmpresa += `NIT: ${nit}\n`;
  if (footerEmpresa) msg += footerEmpresa + '\n';

  let medios = '';
  if (cuentaBancaria && (cuentaBancaria.numero || cuentaBancaria.banco)) {
    medios += `- 🏦 ${[cuentaBancaria.tipo, cuentaBancaria.banco].filter(Boolean).join(' ')}: ${cuentaBancaria.numero || ''}\n`;
  }
  if (llavePago) {
    medios += `- 🔑 Bre-b (llave) : ${llavePago}\n`;
  }
  if (medios) msg += `💳 MEDIOS DE PAGO 💳\n\n${medios}`;

  const portalToken = generarTokenPortal(clubSlug, cedula);
  const portalLink  = portalToken ? `https://zensports.zenpra.ai/p/${clubSlug}/${portalToken}` : `https://zensports.zenpra.ai/p/${clubSlug}`;
  msg += `\nVer tu cuenta completa:\n${portalLink}`;
  if (adminWaLink) {
    msg += `\n\n_Si crees que hay alguna inconsistencia, escríbele directamente al administrador del club:_\n${adminWaLink}`;
  }

  return msg;
}

// GET /api/players/estado-cuenta-lista?club_id=city-fc — jugadores activos con celular,
// cada uno con su link wa.me (texto prellenado, sin adjuntar nada) y si el admin ya lo
// marcó como enviado este mes. Reemplaza el envío masivo automático vía WAHA — ese patrón
// (ráfaga de mensajes casi idénticos a números que no te tienen guardado) fue el que causó
// los baneos del número del club. Ahora el envío real lo hace el admin, un clic a la vez,
// desde su propio WhatsApp.
// Va ANTES de "/:cedula" a propósito: si quedara después, Express matchea "/:cedula" primero
// y esta ruta nunca se alcanza (tratando "estado-cuenta-lista" como si fuera una cédula).
router.get('/estado-cuenta-lista', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const todosJugadores = await db.getPlayers(club.id);
    const conNumero = todosJugadores.filter(j => j.activo && j.celular);

    const anioAct         = new Date().getFullYear();
    const mesActualNum    = new Date().getMonth() + 1;
    const pastGracePeriod = new Date().getDate() > 7;

    const [allMens, allTorneos, allPedidos, suspensiones, enviosMes] = await Promise.all([
      db.getMensualidades(club.id),
      db.getTorneos(club.id),
      db.getPedidoUniformes(club.id),
      db.getSuspensiones(club.id),
      db.supabase
        .from('wa_log_envios')
        .select('cedula')
        .eq('club_id', club.id)
        .eq('tipo_mensaje', 'estado_cuenta')
        .eq('mes', mesActualNum)
        .eq('anio', anioAct),
    ]);

    const enviadosSet = new Set((enviosMes.data || []).map(e => String(e.cedula)));

    const mensByCedula    = {};
    const torneosByCedula = {};
    const pedidosByCedula = {};
    allMens.forEach(m => {
      if (!mensByCedula[m.cedula]) mensByCedula[m.cedula] = [];
      mensByCedula[m.cedula].push(m);
    });
    allTorneos.forEach(t => {
      if (!torneosByCedula[t.cedula]) torneosByCedula[t.cedula] = [];
      torneosByCedula[t.cedula].push(t);
    });
    allPedidos.forEach(p => {
      if (!p.cedula) return;
      if (!pedidosByCedula[p.cedula]) pedidosByCedula[p.cedula] = [];
      pedidosByCedula[p.cedula].push(p);
    });

    const datos = { mensByCedula, torneosByCedula, pedidosByCedula, anioAct, mesActualNum, pastGracePeriod, suspensiones };
    const codigoPais = club.config?.codigo_pais || '57';

    const data = conNumero.map(j => {
      const digitos = String(j.celular).replace(/\D/g, '');
      const numero  = digitos.startsWith(codigoPais) ? digitos : `${codigoPais}${digitos}`;
      const texto   = construirTextoEstadoCuenta(club, j, datos);
      return {
        cedula:     j.cedula,
        nombre:     j.nombre,
        apellidos:  j.apellidos,
        celular:    j.celular,
        // Sin ?text= a propósito: WhatsApp Desktop en Windows corrompe los emojis (caracteres
        // de 4 bytes) al decodificar el parámetro de un link wa.me — el link solo abre el chat
        // correcto, y el texto se copia al portapapeles aparte para pegarlo con Ctrl+V.
        wa_link:    `https://wa.me/${numero}`,
        texto,
        ya_enviado: enviadosSet.has(String(j.cedula)),
      };
    });

    res.json({ success: true, mes: mesActualNum, anio: anioAct, total: data.length, data });
  } catch (err) {
    console.error('GET /players/estado-cuenta-lista:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/players/estado-cuenta-marcar?club_id=city-fc — marca/desmarca que el admin ya
// envió el estado de cuenta del mes a un jugador. Es un registro manual del propio admin,
// no una confirmación real de entrega — el envío ocurre fuera del sistema, dentro de WhatsApp.
router.post('/estado-cuenta-marcar', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { cedula, enviado } = req.body;
    if (!cedula) return res.status(400).json({ success: false, error: 'cedula requerida' });

    const anioAct      = new Date().getFullYear();
    const mesActualNum = new Date().getMonth() + 1;

    if (enviado) {
      await db.supabase.from('wa_log_envios').upsert({
        club_id: club.id, cedula: String(cedula), tipo_mensaje: 'estado_cuenta',
        mes: mesActualNum, anio: anioAct,
      }, { onConflict: 'club_id,cedula,tipo_mensaje,mes,anio' });
    } else {
      await db.supabase.from('wa_log_envios')
        .delete()
        .eq('club_id', club.id).eq('cedula', String(cedula))
        .eq('tipo_mensaje', 'estado_cuenta').eq('mes', mesActualNum).eq('anio', anioAct);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /players/estado-cuenta-marcar:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/players/estado-cuenta-limpiar?club_id=city-fc — quita TODAS las marcas de
// "enviado" del estado de cuenta del mes actual, para reiniciar el ciclo de cobro.
router.post('/estado-cuenta-limpiar', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const anioAct      = new Date().getFullYear();
    const mesActualNum = new Date().getMonth() + 1;

    const { error } = await db.supabase.from('wa_log_envios')
      .delete()
      .eq('club_id', club.id).eq('tipo_mensaje', 'estado_cuenta')
      .eq('mes', mesActualNum).eq('anio', anioAct);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('POST /players/estado-cuenta-limpiar:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/players/:cedula?club_id=city-fc
router.get('/:cedula', async (req, res) => {
  try {
    const club_id = req.club_id;

    const club = await db.getClubBySlug(club_id);
    if (!club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const jugador = await db.getPlayerByCedula(club.id, req.params.cedula);
    if (!jugador) {
      return res.status(404).json({ success: false, error: 'Jugador no encontrado' });
    }
    res.json({ success: true, data: jugador });
  } catch (error) {
    console.error('Error in GET /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error fetching player', message: error.message });
  }
});

// PATCH /api/players/:cedula?club_id=city-fc
router.patch('/:cedula', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const updated = await db.updatePlayer(club.id, req.params.cedula, req.body);

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'JUGADOR_EDITADO', entity_type: 'jugador', entity_id: req.params.cedula,
      entity_label: `${updated?.nombre || ''} ${updated?.apellidos || ''}`.trim(),
      details: { campos: Object.keys(req.body) },
    });

    // Si se modificó el descuento, recalcular los 12 meses del año en curso (convenios/becas
    // aplican a todo el año, no solo desde que se configuran). Los meses ya pagados en su
    // totalidad (AL_DIA) no se tocan, para no reabrir historial ya cerrado.
    if (req.body.descuento_pct !== undefined) {
      const valorMensual = Number(club.config?.valor_mensualidad ?? 0);
      await recalcularMensualidadesPorDescuento({
        supabase: db.supabase, clubId: club.id, cedula: req.params.cedula,
        valorMensual, nuevoPct: req.body.descuento_pct,
      });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error in PATCH /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error updating player', message: error.message });
  }
});

// PATCH /api/players/:cedula/completar?club_id=...
// Actualiza todos los datos del jugador incluyendo la cédula real.
// Hace cascade: mensualidades, suspensiones y torneos pasan a la nueva cédula.
router.patch('/:cedula/completar', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const cedulaAnterior = req.params.cedula;
    const { nueva_cedula, ...otrosCampos } = req.body;

    if (!nueva_cedula || String(nueva_cedula).trim() === '')
      return res.status(400).json({ success: false, error: 'nueva_cedula requerida' });

    const cedulaNueva = String(nueva_cedula).trim();

    // Verificar que la nueva cédula no exista ya en el club
    if (cedulaNueva !== cedulaAnterior) {
      const { data: existe } = await db.supabase
        .from('players').select('id').eq('club_id', club.id).eq('cedula', cedulaNueva).maybeSingle();
      if (existe)
        return res.status(409).json({ success: false, error: `Ya existe un jugador con cédula ${cedulaNueva}` });
    }

    // 1. Actualizar el jugador: cédula + todos los demás campos
    const ALLOWED = [
      'nombre', 'apellidos', 'celular', 'correo_electronico', 'instagram',
      'tipo_id', 'fecha_nacimiento', 'lugar_de_nacimiento', 'tipo_sangre', 'eps',
      'estatura', 'peso', 'municipio', 'barrio', 'direccion',
      'familiar_emergencia', 'celular_contacto', 'notas',
      'categoria', 'equipo', 'categorias', 'posicion', 'numero_camiseta',
      'deporte', 'foto_url',
    ];
    const fields = Object.fromEntries(Object.entries(otrosCampos).filter(([k]) => ALLOWED.includes(k)));
    fields.cedula = cedulaNueva;

    const { data: updatedPlayer, error: ep } = await db.supabase
      .from('players').update(fields)
      .eq('club_id', club.id).eq('cedula', cedulaAnterior)
      .select().single();
    if (ep) throw ep;

    // 2. Cascade completo: pagos, suspensiones, torneos, asistencia, uniformes,
    //    wa_log_envios y la foto en storage. (players.cedula ya se movió arriba;
    //    moverCedula lo detecta como 0 filas.)
    if (cedulaNueva !== cedulaAnterior) {
      await moverCedula(club.id, cedulaAnterior, cedulaNueva);
      await moverFotoJugador(req.club_id, cedulaAnterior, cedulaNueva, false);
      await sincronizarFotoUrl(club.id, updatedPlayer, cedulaAnterior, cedulaNueva);
    }

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'JUGADOR_EDITADO', entity_type: 'jugador', entity_id: cedulaNueva,
      entity_label: `${updatedPlayer?.nombre || ''} ${updatedPlayer?.apellidos || ''}`.trim(),
      details: cedulaNueva !== cedulaAnterior ? { cedula_anterior: cedulaAnterior, cedula_nueva: cedulaNueva } : { campos: Object.keys(fields) },
    });

    res.json({ success: true, data: updatedPlayer, cedula_anterior: cedulaAnterior, cedula_nueva: cedulaNueva });
  } catch (error) {
    console.error('PATCH /players/:cedula/completar', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/players/:cedula/corregir-cedula?club_id=...
// SOLO ADMIN. Corrige una cédula mal ingresada. Dos casos:
//  - La cédula nueva está libre  -> corrección simple (moverCedula).
//  - La cédula nueva es de otro jugador del club -> requiere confirmar_swap:true
//    y hace un intercambio vía sentinela temporal, para el caso típico de dos
//    hermanos cuyas cédulas quedaron cruzadas.
// Arrastra pagos, torneos, asistencia, uniformes y la foto. El carnet impreso y
// el link del portal que ya tenga el jugador quedan obsoletos — hay que reemitir.
router.patch('/:cedula/corregir-cedula', async (req, res) => {
  try {
    if (req.userRole !== 'ADMIN')
      return res.status(403).json({ success: false, error: 'Solo el administrador puede corregir la cédula de un jugador.' });

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const cedulaActual  = String(req.params.cedula);
    const nuevaCedula   = String(req.body?.nueva_cedula || '').trim();
    const confirmarSwap = req.body?.confirmar_swap === true;

    if (!nuevaCedula)
      return res.status(400).json({ success: false, error: 'nueva_cedula requerida' });
    if (nuevaCedula === cedulaActual)
      return res.status(400).json({ success: false, error: 'La cédula nueva es igual a la actual.' });
    if (/^(PEND_|SWP-)/i.test(nuevaCedula) || !/^[A-Za-z0-9.\- ]{3,20}$/.test(nuevaCedula))
      return res.status(400).json({ success: false, error: 'La cédula nueva no tiene un formato válido.' });

    const jugador = await db.getPlayerByCedula(club.id, cedulaActual);
    if (!jugador) return res.status(404).json({ success: false, error: 'Jugador no encontrado' });

    // Pre-check: si hay un jugador con cédula 'SWP-...' quedó un intercambio a
    // medias — no encimar otra corrección encima.
    const { data: swpPend } = await db.supabase
      .from('players').select('nombre, apellidos')
      .eq('club_id', club.id).like('cedula', 'SWP-%').limit(1).maybeSingle();
    if (swpPend)
      return res.status(409).json({ success: false, error: 'Hay una corrección de cédula sin terminar en este club. Contacta a soporte antes de hacer otra.' });

    const otro = await db.getPlayerByCedula(club.id, nuevaCedula);

    // ── Colisión: la cédula nueva ya es de otro jugador del club ──────────────
    if (otro && otro.id !== jugador.id) {
      if (!confirmarSwap) {
        return res.json({
          success: false,
          needs_swap: true,
          otro_jugador: { nombre: otro.nombre, apellidos: otro.apellidos || '', cedula: otro.cedula },
        });
      }

      const movidos = await intercambiarCedulas(club.id, cedulaActual, nuevaCedula);

      await moverFotoJugador(req.club_id, cedulaActual, nuevaCedula, true);
      await sincronizarFotoUrl(club.id, jugador, cedulaActual, nuevaCedula);
      await sincronizarFotoUrl(club.id, otro, nuevaCedula, cedulaActual);

      db.logClubActivity({
        club_id: club.id, club_slug: req.club_id,
        user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
        action: 'JUGADOR_CEDULA_INTERCAMBIADA', entity_type: 'jugador', entity_id: nuevaCedula,
        entity_label: `${jugador.nombre} ${jugador.apellidos || ''}`.trim() + ' ⇄ ' + `${otro.nombre} ${otro.apellidos || ''}`.trim(),
        details: { jugador_a: cedulaActual, jugador_b: nuevaCedula, movidos },
      });

      return res.json({ success: true, swap: true, movidos });
    }

    // ── Sin colisión: corrección simple ─────────────────────────────────────
    const movidos = await moverCedula(club.id, cedulaActual, nuevaCedula);

    await moverFotoJugador(req.club_id, cedulaActual, nuevaCedula, false);
    await sincronizarFotoUrl(club.id, jugador, cedulaActual, nuevaCedula);

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'JUGADOR_CEDULA_CORREGIDA', entity_type: 'jugador', entity_id: nuevaCedula,
      entity_label: `${jugador.nombre} ${jugador.apellidos || ''}`.trim(),
      details: { cedula_anterior: cedulaActual, cedula_nueva: nuevaCedula, movidos },
    });

    const actualizado = await db.getPlayerByCedula(club.id, nuevaCedula);
    res.json({ success: true, swap: false, movidos, jugador: actualizado });
  } catch (error) {
    console.error('PATCH /players/:cedula/corregir-cedula', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/players/:cedula/exento?club_id=city-fc
// Body: { exento: true|false, motivo?: 'BECA'|'SOCIAL'|'DIRECTIVO'|'OTRO' }
// Marca o desmarca al jugador como exento y sincroniza sus mensualidades del año actual.
router.patch('/:cedula/exento', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { exento, motivo, motivoTexto } = req.body;
    if (typeof exento !== 'boolean')
      return res.status(400).json({ success: false, error: 'Campo exento debe ser true o false' });

    // EXENTO = descuento_pct 100 + tipo_descuento null
    // tipo_descuento NO puede ser 'EXENTO' — check constraint solo permite
    // BECA_DEPORTIVA, BECA_SOCIAL, CONDICION_ESPECIAL (valores originales de DB)
    const MOTIVO_LABELS = { BECA: 'Beca deportiva', SOCIAL: 'Caso social', DIRECTIVO: 'Directivo/Staff', OTRO: null };
    const motivoLabel = motivo && MOTIVO_LABELS[motivo] !== undefined
      ? (motivo === 'OTRO' ? (motivoTexto?.trim() || 'Otro motivo') : MOTIVO_LABELS[motivo])
      : null;

    const anio   = new Date().getFullYear();
    const cuota  = parseFloat(club.config?.valor_mensualidad ?? 0);
    const cedula = req.params.cedula;

    // 1. Actualizar el jugador: descuento_pct=100 es la señal de EXENTO
    const updateFields = {
      descuento_pct:  exento ? 100 : 0,
      tipo_descuento: null,           // siempre null al marcar/desmarcar exento
    };
    await db.updatePlayer(club.id, cedula, updateFields);

    // 2. Sincronizar mensualidades del año actual
    if (exento) {
      // Exento: $0 oficial/pendiente/pagado y AL_DIA. valor_pagado también se fuerza a 0 —
      // un exento no debe sumar plata que nunca entró solo porque un mes anterior había
      // quedado con un valor pagado incorrecto (ej. AL_DIA con $0/$0 corregido a mano
      // como si fuera la cuota normal, sin revisar que el jugador era exento).
      await db.supabase.from('mensualidades')
        .update({ valor_oficial: 0, valor_pagado: 0, saldo_pendiente: 0, estado: 'AL_DIA' })
        .eq('club_id', club.id).eq('cedula', String(cedula)).eq('anio', anio);
    } else {
      // Quitar exento: restaurar valor_oficial y recalcular estado según valor_pagado real de cada mes
      const { data: meses } = await db.supabase
        .from('mensualidades')
        .select('id, valor_pagado, penalidad')
        .eq('club_id', club.id).eq('cedula', String(cedula)).eq('anio', anio);

      if (meses && meses.length > 0) {
        await Promise.all(meses.map(mes => {
          const pagado    = parseFloat(mes.valor_pagado) || 0;
          const penalidad = parseFloat(mes.penalidad)   || 0;
          const total     = cuota + penalidad;
          const saldo     = Math.max(0, total - pagado);
          const estado    = pagado >= total ? 'AL_DIA' : pagado > 0 ? 'PARCIAL' : 'PENDIENTE';
          return db.supabase.from('mensualidades')
            .update({ valor_oficial: cuota, saldo_pendiente: saldo, estado })
            .eq('id', mes.id);
        }));
      }
    }

    res.json({ success: true, exento, cedula, motivo_label: motivoLabel });
  } catch (error) {
    console.error('PATCH /players/:cedula/exento', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/players/bulk?club_id=city-fc  — importación masiva desde Excel/CSV
router.post('/bulk', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { jugadores } = req.body;
    if (!Array.isArray(jugadores) || jugadores.length === 0) {
      return res.status(400).json({ success: false, error: 'Se requiere un array de jugadores no vacío' });
    }

    // Deporte por defecto para el bulk import: el único deporte del club, o null si hay varios
    const deportesClub = db.getDeportesClub(club);
    const deporteDefault = deportesClub.length === 1 ? deportesClub[0] : null;

    // Cédulas ya existentes en el club (una sola query)
    const { data: existing } = await db.supabase
      .from('players')
      .select('cedula')
      .eq('club_id', club.id);
    const existingSet = new Set((existing || []).map(p => String(p.cedula)));

    // Tope de jugadores por plan — el import no puede saltárselo. Antes solo
    // el plan free lo hacía cumplir; ver nota en inscripcion.js.
    const planActualImport = club.config?.plan || 'trial';
    const limiteJugadoresImport = limiteDe(planActualImport, 'jugadores');
    let cupoDisponible = Infinity;
    if (Number.isFinite(limiteJugadoresImport)) {
      const jugadoresActuales = await db.getPlayers(club.id);
      cupoDisponible = Math.max(0, limiteJugadoresImport - jugadoresActuales.length);
    }

    const errores = [];
    const filas   = [];

    jugadores.forEach((j, idx) => {
      const cedula    = String(j.cedula    || '').trim();
      const nombre    = String(j.nombre    || '').trim();
      const apellidos = String(j.apellidos || '').trim();
      const fila      = idx + 2;

      if (!cedula)               return errores.push({ fila, cedula: '—', error: 'Cédula requerida' });
      if (!nombre)               return errores.push({ fila, cedula, error: 'Nombre requerido' });
      if (existingSet.has(cedula)) return errores.push({ fila, cedula, nombre: `${nombre} ${apellidos}`.trim(), error: 'Cédula ya registrada' });
      if (filas.length >= cupoDisponible) {
        return errores.push({ fila, cedula, nombre: `${nombre} ${apellidos}`.trim(), error: `Tu plan (${planActualImport}) permite hasta ${limiteJugadoresImport} jugadores` });
      }

      existingSet.add(cedula);
      const str = (v) => String(v || '').trim() || null;
      const up  = (v) => { const s = str(v); return s ? s.toUpperCase() : null; };
      const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
      // Excel guarda fechas como número de serie (días desde 1900-01-00), pero también
      // llegan como texto DD/MM/AAAA (formato colombiano) o AAAA-MM-DD (ISO). Antes de
      // esta corrección, un texto como "1998-06-15" se leía como serial (1998) y
      // producía una fecha errónea (1905), y "15/06/1998" no calzaba con ningún caso
      // válido y se guardaba tal cual, rompiendo la columna `date` de Postgres.
      const excelDate = (v) => {
        if (!v) return null;
        const s = String(v).trim();
        if (!s) return null;

        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        }

        const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dmy) {
          const [, dd, mm, yyyy] = dmy;
          const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
          if (!isNaN(d.getTime()) && d.getUTCMonth() === +mm - 1) return d.toISOString().split('T')[0];
        }

        // Solo tratar como serial de Excel si es puramente numérico (sin separadores de fecha)
        if (/^\d+(\.\d+)?$/.test(s)) {
          const n = parseFloat(s);
          if (n > 1000) {
            const d = new Date(Math.round((n - 25569) * 86400 * 1000));
            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
          }
        }

        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        return null;
      };
      filas.push({
        club_id:              club.id,
        cedula,
        nombre:               nombre.toUpperCase(),
        apellidos:            (apellidos || nombre).toUpperCase(),
        celular:              str(j.celular),
        correo_electronico:   str(j.correo_electronico)?.toLowerCase() || null,
        instagram:            str(j.instagram),
        tipo_id:              str(j.tipo_id),
        fecha_nacimiento:     excelDate(j.fecha_nacimiento),
        lugar_de_nacimiento:  up(j.lugar_de_nacimiento),
        tipo_sangre:          up(j.tipo_sangre),
        eps:                  up(j.eps),
        estatura:             num(j.estatura),
        peso:                 num(j.peso),
        municipio:            up(j.municipio),
        direccion:            up(j.direccion),
        barrio:               up(j.barrio),
        familiar_emergencia:  up(j.familiar_emergencia),
        celular_contacto:     str(j.celular_contacto),
        posicion:             up(j.posicion),
        numero_camiseta:      str(j.numero_camiseta),
        categoria:            up(j.categoria),
        equipo:               up(j.equipo),
        categorias:           j.categoria ? [{ categoria: up(j.categoria), equipo: up(j.equipo) || '' }] : [],
        deporte:              str(j.deporte) || deporteDefault,
        activo:               true,
      });
    });

    let insertados = [];
    if (filas.length > 0) {
      insertados = await db.bulkInsert('players', filas);

      // Crear mensualidades para cada jugador insertado
      const CUOTA      = parseFloat(club.config?.valor_mensualidad ?? 0);
      const anioActual = new Date().getFullYear();
      const mesActual  = new Date().getMonth() + 1;

      const mensualidades = [];

      for (const p of insertados) {
        for (let mes = 1; mes <= 12; mes++) {
          const esPasado = mes < mesActual;
          mensualidades.push({
            club_id:         club.id,
            player_id:       p.id,
            cedula:          String(p.cedula),
            anio:            anioActual,
            mes:             MESES[mes],
            numero_mes:      mes,
            valor_oficial:   esPasado ? 0 : CUOTA,
            valor_pagado:    0,
            saldo_pendiente: esPasado ? 0 : CUOTA,
            estado:          esPasado ? 'NO_APLICA' : 'PENDIENTE',
          });
        }
      }

      if (mensualidades.length > 0) {
        try {
          await db.bulkInsert('mensualidades', mensualidades);
        } catch (mensError) {
          // No dejar jugadores huérfanos sin mensualidades: revertir toda la tanda
          await db.supabase.from('players').delete().in('id', insertados.map(p => p.id));
          throw mensError;
        }
      }
    }

    res.json({
      success:        true,
      total:          jugadores.length,
      insertados:     insertados.length,
      errores:        errores.length,
      detalle_errores: errores,
    });
  } catch (error) {
    console.error('Error in POST /players/bulk:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/players/:cedula?club_id=city-fc  — eliminación definitiva (hard delete)
router.delete('/:cedula', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, req.params.cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Jugador no encontrado' });

    await db.deletePlayer(club.id, req.params.cedula);

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'JUGADOR_ELIMINADO', entity_type: 'jugador', entity_id: req.params.cedula,
      entity_label: `${player.nombre || ''} ${player.apellidos || ''}`.trim(),
    });

    res.json({ success: true, mensaje: 'Jugador eliminado correctamente' });
  } catch (error) {
    console.error('Error in DELETE /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error eliminando jugador', message: error.message });
  }
});

module.exports = router;
