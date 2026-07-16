const express   = require('express');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const db        = require('../services/db');
const router    = express.Router();

const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas consultas. Intenta de nuevo en un minuto.' },
});

router.use('/atleta', portalLimiter);

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mapEstado(estado) {
  switch (estado) {
    case 'AL_DIA':      return 'pagado';
    case 'EXENTO':      return 'exento';
    case 'MORA':        return 'vencido';
    case 'PARCIAL':     return 'parcial';
    case 'POR_VALIDAR': return 'por_validar';
    case 'PENDIENTE':   return 'pendiente';
    default:            return 'pendiente';
  }
}

function calcSaldo(m) {
  const oficial  = parseFloat(m.valor_oficial) || 0;
  const pagado   = parseFloat(m.valor_pagado)  || 0;
  if (m.estado === 'AL_DIA' || m.estado === 'EXENTO') return 0;
  if (m.estado === 'PARCIAL' || m.estado === 'POR_VALIDAR') return Math.max(0, oficial - pagado);
  return oficial;
}

// Busca un jugador por celular con múltiples variantes de formato (con/sin
// indicativo de país, con/sin +). Usado por el acceso al portal por celular.
async function buscarJugadorPorCelular(club_id, phone) {
  const digits = String(phone).replace(/\D/g, '');
  const local  = digits.slice(-10); // últimos 10 dígitos
  const { data, error } = await db.supabase
    .from('players')
    .select('*')
    .eq('club_id', club_id)
    .or(`celular.eq.${digits},celular.eq.${local},celular.eq.57${local},celular.eq.+57${local}`)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// Arma la respuesta completa del portal del atleta (estado de cuenta, torneos,
// uniformes) dado un jugador ya resuelto. Compartido entre el acceso directo
// por cédula (link de Estado de cuenta) y el acceso por celular (portal sin
// link directo) — antes esto estaba duplicado entre /atleta/:cedula y el ya
// eliminado /otp/verificar.
async function construirRespuestaPortal(club, clubSlug, jugador) {
    const cedula = jugador.cedula;
    const anioActual = new Date().getFullYear();
    // Buscar mensualidades por cedula Y por player_id por separado, luego combinar
    // (algunos registros solo tienen uno de los dos campos)
    const [byCedula, byPlayerId, suspensiones, torneosJugador, uniformesJugador] = await Promise.all([
      db.supabase.from('mensualidades').select('*').eq('club_id', club.id).eq('cedula', String(cedula)),
      db.supabase.from('mensualidades').select('*').eq('club_id', club.id).eq('player_id', jugador.id),
      db.getSuspensionesJugador(club.id, cedula),
      db.getTorneos(club.id, String(cedula)),
      db.getPedidoUniformesByCedula(club.id, String(cedula)),
    ]);
    const prendasUniforme = await db.getPrendasPedidos((uniformesJugador || []).map(u => u.id));
    const prendasPorPedido = {};
    prendasUniforme.forEach(pr => {
      if (!prendasPorPedido[pr.pedido_id]) prendasPorPedido[pr.pedido_id] = [];
      prendasPorPedido[pr.pedido_id].push(pr);
    });
    // Deduplicar por id
    const mensMap = {};
    [...(byCedula.data || []), ...(byPlayerId.data || [])].forEach(m => { mensMap[m.id] = m; });
    const mensualidades = Object.values(mensMap);

    // Cuota efectiva del jugador (cuota club − descuento individual)
    const cuotaBase    = parseFloat(club.config?.valor_mensualidad) || 0;
    const descuentoPct = parseFloat(jugador.descuento_pct) || 0;
    const cuota        = Math.max(0, cuotaBase * (1 - descuentoPct / 100));
    const esExento     = descuentoPct >= 100;

    // Suspensiones activas del año actual
    const suspActivas = (suspensiones || []).filter(s =>
      s.activa && (s.anio == null || parseInt(s.anio) === anioActual)
    );
    const esSuspendido = (numMes) =>
      suspActivas.some(s => s.mes_inicio <= numMes && numMes <= s.mes_fin);
    const getSusp = (numMes) =>
      suspActivas.find(s => s.mes_inicio <= numMes && numMes <= s.mes_fin) || null;

    // Índice de registros del año actual por numero_mes
    const porMes = {};
    mensualidades
      .filter(m => parseInt(m.anio) === anioActual)
      .forEach(m => { porMes[parseInt(m.numero_mes)] = m; });

    // Construir los 12 meses completos
    const resumen = MESES.map((nombreMes, i) => {
      const numMes = i + 1;
      const m      = porMes[numMes];

      // Jugador EXENTO: no debe nada, todos los meses AL_DIA con $0
      if (esExento) {
        return {
          mes:           nombreMes,
          numero_mes:    numMes,
          anio:          anioActual,
          estado:        'exento',
          valor_oficial: 0,
          valor_pagado:  0,
          saldo:         0,
          fecha_pago:    m?.fecha_pago || null,
        };
      }

      // Mes suspendido: no genera deuda
      if (esSuspendido(numMes)) {
        const susp = getSusp(numMes);
        return {
          mes:           nombreMes,
          numero_mes:    numMes,
          anio:          anioActual,
          estado:        'suspendido',
          valor_oficial: parseFloat(m?.valor_oficial) || cuota,
          valor_pagado:  parseFloat(m?.valor_pagado) || 0,
          saldo:         0,
          fecha_pago:    m?.fecha_pago || null,
          suspension:    { motivo: susp?.motivo || null, detalle: susp?.detalle || null },
        };
      }

      if (m) {
        const estadoM = mapEstado(m.estado);

        // Mes exento individualmente: saldo $0, sin fallback a cuota del club
        if (estadoM === 'exento') {
          return {
            mes:           nombreMes,
            numero_mes:    numMes,
            anio:          anioActual,
            estado:        'exento',
            valor_oficial: 0,
            valor_pagado:  parseFloat(m.valor_pagado) || 0,
            saldo:         0,
            fecha_pago:    m.fecha_pago || null,
          };
        }

        // Registro existente: usar cuota como valor_oficial cuando está en $0
        const oficial = parseFloat(m.valor_oficial) > 0
          ? parseFloat(m.valor_oficial)
          : cuota;
        const pagado  = parseFloat(m.valor_pagado) || 0;
        const saldo   = estadoM === 'pagado'
          ? 0
          : (estadoM === 'parcial' || estadoM === 'por_validar')
            ? Math.max(0, oficial - pagado)
            : oficial;
        return {
          mes:           nombreMes,
          numero_mes:    numMes,
          anio:          anioActual,
          estado:        estadoM,
          valor_oficial: oficial,
          valor_pagado:  pagado,
          saldo,
          fecha_pago:    m.fecha_pago || null,
        };
      }

      // Mes sin registro → pendiente con cuota del club
      return {
        mes:           nombreMes,
        numero_mes:    numMes,
        anio:          anioActual,
        estado:        'pendiente',
        valor_oficial: cuota,
        valor_pagado:  0,
        saldo:         cuota,
        fecha_pago:    null,
      };
    });

    const mesActual       = new Date().getMonth() + 1;
    const pendientes      = resumen.filter(m => !['pagado','exento','suspendido'].includes(m.estado) && m.numero_mes <= mesActual);
    const saldo_pendiente = esExento ? 0 : pendientes.reduce((s, m) => s + m.saldo, 0);
    const total_pagado    = esExento ? 0 : resumen.reduce((s, m) => s + m.valor_pagado, 0);

    return {
      success: true,
      esExento,
      club: {
        nombre:    club.config?.nombre || clubSlug,
        subtitulo: club.config?.subtitulo || '',
        color:     club.config?.color || '#00AAFF',
        logo_url:  club.config?.logo_url || null,
        slug:      clubSlug,
      },
      atleta: {
        nombre:    jugador.nombre,
        apellidos: jugador.apellidos || '',
        cedula:    jugador.cedula,
        categoria: jugador.categoria || '',
        equipo:    jugador.equipo || '',
        posicion:  jugador.posicion || '',
        numero:    jugador.numero || '',
        foto_url:  jugador.foto_url || null,
        activo:    jugador.activo,
      },
      mensualidades:    resumen,
      torneos:          (torneosJugador || []).map(t => ({
        id:              t.id,
        nombre_torneo:   t.nombre_torneo,
        estado:          t.estado,
        valor_inscrito:  parseFloat(t.valor_inscrito) || parseFloat(t.valor_oficial) || 0,
        valor_pagado:    parseFloat(t.valor_pagado)   || 0,
        saldo_pendiente: parseFloat(t.saldo_pendiente) || 0,
      })),
      uniformes:        (uniformesJugador || []).map(u => ({
        id:              u.id,
        tipo:            u.tipo || 'Jugador',
        descripcion:     u.prendas || u.descripcion || u.tipo || 'Uniforme',
        estado:          u.estado,
        talla:           u.talla || '',
        numero:          u.numero_estampar || u.numero || '',
        nombre_estampar: u.nombre_estampar || '',
        valor_oficial:   parseFloat(u.total) || parseFloat(u.valor_oficial) || 0,
        valor_pagado:    parseFloat(u.valor_pagado) || 0,
        saldo_pendiente: u.estado === 'PAGADO' || u.estado === 'ENTREGADO'
          ? 0
          : (parseFloat(u.total) || 0) - (parseFloat(u.valor_pagado) || 0),
        abono_legacy:    parseFloat(u.abono_legacy) || 0,
        prendas_detalle: (prendasPorPedido[u.id] || []).map(pr => ({
          id:              pr.id,
          nombre:          pr.nombre,
          cantidad:        pr.cantidad,
          precio_unitario: parseFloat(pr.precio_unitario) || 0,
          valor:           (parseFloat(pr.precio_unitario) || 0) * (pr.cantidad || 1),
          valor_pagado:    parseFloat(pr.valor_pagado) || 0,
          saldo:           Math.max(0, (parseFloat(pr.precio_unitario) || 0) * (pr.cantidad || 1) - (parseFloat(pr.valor_pagado) || 0)),
          estado:          pr.estado,
        })),
      })),
      saldo_pendiente,
      total_pagado,
      meses_pendientes: pendientes.length,
    };
}

// GET /api/publico/atleta/:clubSlug/:cedula — acceso directo (link de Estado de cuenta)
router.get('/atleta/:clubSlug/:cedula', async (req, res) => {
  try {
    const { clubSlug, cedula } = req.params;

    const club = await db.getClubBySlug(clubSlug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const jugador = await db.getPlayerByCedula(club.id, cedula);
    if (!jugador) return res.status(404).json({ success: false, error: 'Atleta no encontrado' });

    res.json(await construirRespuestaPortal(club, clubSlug, jugador));
  } catch (error) {
    console.error('Error en GET /publico/atleta:', error);
    res.status(500).json({ success: false, error: 'Error al consultar datos del atleta' });
  }
});

// POST /api/publico/atleta-por-celular — acceso al portal escribiendo el celular, sin
// código de confirmación por WhatsApp (se quitó: WAHA no es confiable ahora mismo, y el
// código no agregaba una barrera real ya que este mismo endpoint solo pide club+celular).
router.post('/atleta-por-celular', portalLimiter, async (req, res) => {
  try {
    const { club_slug, celular } = req.body;
    if (!club_slug || !celular) return res.status(400).json({ success: false, error: 'Faltan campos' });

    const club = await db.getClubBySlug(club_slug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const jugador = await buscarJugadorPorCelular(club.id, celular);
    if (!jugador) return res.status(404).json({ success: false, error: 'No encontramos ese celular en el club. Contacta al administrador.' });

    res.json(await construirRespuestaPortal(club, club_slug, jugador));
  } catch (error) {
    console.error('Error en POST /publico/atleta-por-celular:', error);
    res.status(500).json({ success: false, error: 'Error al consultar datos del atleta' });
  }
});

// ── PDF de morosos vía WhatsApp ──────────────────────────────────────────────
const PDF_HMAC_SECRET = process.env.PDF_HMAC_SECRET || 'zs-pdf-2026-x9k';

function validarTokenMorosos(clubId, token) {
  const dia = Math.floor(Date.now() / 86400000);
  const ok = (d) => crypto.createHmac('sha256', PDF_HMAC_SECRET).update(`pdf:${clubId}:${d}`).digest('hex');
  for (let i = 0; i < 7; i++) {
    if (token === ok(dia - i)) return true;
  }
  return false;
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatCOP(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(parseInt(n) || 0);
}

// GET /api/publico/morosos-pdf/:clubId[/:mes]?token=xxx
// El mes va en el path para que WhatsApp no rompa el link en el &
async function handleMorososPdf(req, res) {
  try {
    const { clubId } = req.params;
    const { token } = req.query;
    const mesParam = req.params.mes ? String(parseInt(req.params.mes) || '') : '';

    if (!token || !validarTokenMorosos(clubId, token)) {
      console.error('[morosos-pdf] 403 — clubId:', clubId?.slice(0, 8), '| tok:', token?.slice(0, 8) || '(vacío)');
      return res.status(403).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:48px;text-align:center">
        <h2 style="color:#c0392b">Enlace no válido</h2>
        <p style="color:#666">Este enlace ha expirado o no es válido. Solicita uno nuevo desde el bot de WhatsApp.</p>
      </body></html>`);
    }

    // Obtener club
    const { data: club } = await db.supabase
      .from('clubs')
      .select('id, name, config')
      .eq('id', clubId)
      .single();

    if (!club) return res.status(404).send('<h2>Club no encontrado</h2>');

    const clubNombre = club.config?.nombre || club.name || 'Mi Club';
    const color = (club.config?.color && club.config.color.startsWith('#')) ? club.config.color : '#E14924';
    const logoUrl = club.config?.logo_url || '';

    const anio = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const pastGracePeriod = new Date().getDate() > 7;
    const filtroMes = mesParam ? parseInt(mesParam) : null; // null = todos

    const [jugadores, allInvoices, suspensiones] = await Promise.all([
      db.getPlayers(club.id),
      db.getMensualidades(club.id),
      db.getSuspensiones(club.id),
    ]);

    const isSuspendido = (cedula, mesNum) =>
      (suspensiones || []).some(s =>
        s.activa &&
        s.cedula === String(cedula) &&
        parseInt(s.anio) === anio &&
        s.mes_inicio <= mesNum &&
        mesNum <= s.mes_fin
      );

    const playersMap = {};
    (jugadores || []).forEach(p => { playersMap[p.cedula] = p; });

    const MESES_N = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    const defaultersMap = {};
    (allInvoices || []).forEach(inv => {
      if (String(inv.anio) !== String(anio)) return;
      if (inv.estado === 'AL_DIA') return;
      const mesNum = parseInt(inv.numero_mes);
      if (isSuspendido(inv.cedula, mesNum)) return;

      let incluir = false;
      if (filtroMes !== null) {
        // Filtro por mes específico: incluir si hay saldo pendiente en ese mes
        incluir = (mesNum === filtroMes) && (parseFloat(inv.saldo_pendiente) || 0) > 0;
      } else {
        // Año completo: solo meses ya vencidos con mora real
        if (inv.estado === 'PARCIAL' && mesNum === currentMonth) return;
        incluir = (mesNum < currentMonth) || (mesNum === currentMonth && pastGracePeriod);
        if (!(parseFloat(inv.saldo_pendiente) || 0 > 0)) incluir = false;
      }

      if (incluir) {
        if (!defaultersMap[inv.cedula]) {
          const p = playersMap[inv.cedula] || {};
          defaultersMap[inv.cedula] = {
            cedula: inv.cedula,
            nombre: `${p.nombre || ''} ${p.apellidos || ''}`.trim() || inv.cedula,
            celular: p.celular || '',
            saldo_total: 0,
            meses_mora: 0,
            meses_arr: [],
          };
        }
        const saldo = parseFloat(inv.saldo_pendiente) || 0;
        if (saldo > 0) {
          defaultersMap[inv.cedula].saldo_total += saldo;
          defaultersMap[inv.cedula].meses_mora += 1;
          defaultersMap[inv.cedula].meses_arr.push(MESES_N[mesNum] || inv.mes);
        }
      }
    });

    const morosos = Object.values(defaultersMap).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const totalSaldo = morosos.reduce((s, m) => s + m.saldo_total, 0);

    const fecha = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    const periodoLabel = filtroMes
      ? `${MESES_N[filtroMes]} ${anio}`
      : `Año ${anio}`;

    const logoHtml = logoUrl
      ? `<img src="${esc(logoUrl)}" alt="" style="height:44px;width:44px;object-fit:contain;border-radius:8px;margin-right:14px;flex-shrink:0" />`
      : '';

    const filas = morosos.map((m, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'}">
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${i + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111">${esc(m.nombre)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${esc(m.cedula)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${esc(m.celular) || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">
          <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600">
            ${m.meses_mora} mes${m.meses_mora !== 1 ? 'es' : ''}
          </span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#dc2626">
          ${m.meses_arr.map(mes => `<span style="display:inline-block;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:1px 6px;margin:1px 2px;font-size:11px">${esc(mes)}</span>`).join('')}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#dc2626;text-align:right">${formatCOP(m.saldo_total)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Morosos — ${esc(clubNombre)}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial,sans-serif; color:#111; background:#fff; }
    .header { background:${color}; padding:16px 20px; display:flex; flex-direction:column; gap:10px; }
    .header-top { display:flex; align-items:center; gap:10px; }
    .header-bottom { text-align:left; }
    .kpis { display:flex; gap:10px; margin-bottom:20px; }
    .kpi { flex:1; border:1px solid #e5e7eb; border-radius:10px; padding:12px 8px; text-align:center; }
    .kpi-label { font-size:10px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
    .kpi-value { font-size:22px; font-weight:800; }
    .tabla-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
    table { width:100%; border-collapse:collapse; min-width:480px; }
    th, td { padding:9px 10px; font-size:12px; border-bottom:1px solid #e5e7eb; }
    thead tr { background:#f3f4f6; }
    th { color:${color}; font-weight:700; font-size:11px; }
    .footer { margin-top:16px; padding-top:10px; border-top:1px solid #e5e7eb; display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px; }
    .footer p { font-size:10px; color:#9ca3af; }
    .btn-print { display:block; width:100%; padding:14px; background:${color}; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; margin-top:20px; }
    @media print { .no-print { display:none !important; } }
    @media (min-width:600px) {
      .header { flex-direction:row; align-items:center; justify-content:space-between; padding:18px 32px; }
      .header-bottom { text-align:right; }
      .kpi-label { font-size:11px; }
      .kpi-value { font-size:26px; }
      th, td { padding:10px 12px; font-size:13px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      ${logoHtml}
      <div>
        <p style="font-size:16px;font-weight:800;color:#fff">${esc(clubNombre)}</p>
        <p style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">ZenSports — Gestión deportiva</p>
      </div>
    </div>
    <div class="header-bottom">
      <p style="font-size:13px;font-weight:700;color:#fff">Reporte de Morosos</p>
      <p style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">${periodoLabel} · ${fecha}</p>
    </div>
  </div>

  <div style="padding:20px 16px">
    <div class="kpis">
      <div class="kpi" style="border-top:3px solid #dc2626">
        <p class="kpi-label">En mora</p>
        <p class="kpi-value" style="color:#dc2626">${morosos.length}</p>
      </div>
      <div class="kpi" style="border-top:3px solid ${color}">
        <p class="kpi-label">Total</p>
        <p class="kpi-value" style="color:${color};font-size:16px">${formatCOP(totalSaldo)}</p>
      </div>
      <div class="kpi" style="border-top:3px solid #16a34a">
        <p class="kpi-label">Promedio</p>
        <p class="kpi-value" style="color:#16a34a;font-size:16px">${formatCOP(morosos.length ? Math.round(totalSaldo / morosos.length) : 0)}</p>
      </div>
    </div>

    ${morosos.length === 0
      ? `<p style="text-align:center;padding:40px;color:#6b7280;font-size:15px">✅ ¡Sin morosos este período!</p>`
      : `<div class="tabla-wrap">
          <table>
            <thead><tr>
              <th style="text-align:left">#</th>
              <th style="text-align:left">Jugador</th>
              <th style="text-align:left">Cédula</th>
              <th style="text-align:left">Celular</th>
              <th style="text-align:center">Meses</th>
              <th style="text-align:right">Saldo</th>
            </tr></thead>
            <tbody>${morosos.map((m, i) => `
              <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'}">
                <td style="color:#6b7280">${i + 1}</td>
                <td style="font-weight:600">${esc(m.nombre)}</td>
                <td style="color:#6b7280">${esc(m.cedula)}</td>
                <td style="color:#6b7280">${esc(m.celular) || '—'}</td>
                <td style="text-align:center">
                  <span style="background:#fee2e2;color:#dc2626;padding:2px 7px;border-radius:9999px;font-size:11px;font-weight:600;white-space:nowrap">
                    ${m.meses_mora} mes${m.meses_mora !== 1 ? 'es' : ''}
                  </span>
                </td>
                <td style="font-weight:700;color:#dc2626;text-align:right;white-space:nowrap">${formatCOP(m.saldo_total)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr style="background:#f9fafb">
              <td colspan="5" style="padding:11px 10px;font-size:13px;font-weight:700;text-align:right;border-top:2px solid #e5e7eb;color:#374151">Total a cobrar</td>
              <td style="padding:11px 10px;font-size:14px;font-weight:800;color:#dc2626;text-align:right;border-top:2px solid #e5e7eb;white-space:nowrap">${formatCOP(totalSaldo)}</td>
            </tfoot>
          </table>
        </div>`}

    <div class="footer">
      <p>${esc(clubNombre)} · Documento confidencial</p>
      <p>zensports.zenpra.ai</p>
    </div>

    <div class="no-print">
      <button class="btn-print" onclick="window.print()">Imprimir / Guardar PDF</button>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error en GET /publico/morosos-pdf:', error);
    res.status(500).send('<h2>Error generando el reporte</h2>');
  }
}

router.get('/morosos-pdf/:clubId', handleMorososPdf);
router.get('/morosos-pdf/:clubId/:mes', handleMorososPdf);

// GET /api/publico/stats — métricas públicas para la landing
router.get('/stats', async (req, res) => {
  try {
    const { supabase } = require('../services/db');
    const [{ count: totalJugadores }, { count: totalClubs }] = await Promise.all([
      supabase.from('jugadores').select('*', { count: 'exact', head: true }),
      supabase.from('clubs').select('*', { count: 'exact', head: true }).neq('estado', 'expired'),
    ]);
    res.json({
      jugadores: totalJugadores || 0,
      clubs: totalClubs || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Stats unavailable' });
  }
});

// ── Asistencia pública (link desde WhatsApp) ─────────────────────────────────

const ASIST_SECRET = process.env.ASISTENCIA_HMAC_SECRET || 'zs-asist-2026-k7p';

// Ventanas de 3h: el token es válido en la ventana actual y la anterior → máximo ~6h de validez
function generarTokenAsistencia(slug, eventoId) {
  const ventana = Math.floor(Date.now() / (3 * 3600000));
  return crypto.createHmac('sha256', ASIST_SECRET)
    .update(`asist:${slug}:${eventoId}:${ventana}`)
    .digest('hex')
    .slice(0, 20);
}

function validarTokenAsistencia(slug, eventoId, token) {
  const ventana = Math.floor(Date.now() / (3 * 3600000));
  for (let i = 0; i < 2; i++) {
    const expected = crypto.createHmac('sha256', ASIST_SECRET)
      .update(`asist:${slug}:${eventoId}:${ventana - i}`)
      .digest('hex')
      .slice(0, 20);
    if (token === expected) return true;
  }
  return false;
}

// GET /api/publico/asistencia/:slug/:eventoId
// Devuelve info del evento + lista de jugadores con estado actual (sin token — lectura pública)
router.get('/asistencia/:slug/:eventoId', async (req, res) => {
  try {
    const { slug, eventoId } = req.params;
    const club = await db.getClubBySlug(slug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    // Evento
    const { data: evento, error: evErr } = await db.supabase
      .from('calendario')
      .select('id, titulo, tipo, fecha_inicio, lugar, equipo')
      .eq('id', eventoId)
      .eq('club_id', slug)
      .single();
    if (evErr || !evento) return res.status(404).json({ success: false, error: 'Evento no encontrado' });

    // Jugadores + asistencia actual
    const lista = await db.getAsistencia(club.id, eventoId);

    // Fecha/hora en Colombia UTC-5
    const fechaUTC = new Date(evento.fecha_inicio);
    const fechaCol = new Date(fechaUTC.getTime() - 5 * 3600000);

    res.json({
      success: true,
      club: {
        nombre: club.config?.nombre || slug,
        color:  club.config?.color  || '#6A00FF',
        logo:   club.config?.logo_url || null,
        slug,
      },
      evento: {
        id:     evento.id,
        titulo: evento.titulo || evento.tipo,
        tipo:   evento.tipo,
        lugar:  evento.lugar || null,
        equipo: evento.equipo || null,
        fecha:  fechaCol.toISOString().split('T')[0],
        hora:   fechaCol.toISOString().split('T')[1].slice(0, 5),
      },
      jugadores: lista.map((j, i) => ({
        numero:   i + 1,
        cedula:   j.cedula,
        nombre:   `${j.nombre} ${j.apellidos || ''}`.trim(),
        equipo:   j.equipo || null,
        categoria: j.categoria || null,
        estado:   j.estado || 'PENDIENTE',
      })),
    });
  } catch (err) {
    console.error('[publico/asistencia GET]', err.message);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// POST /api/publico/asistencia/:slug/:eventoId?token=xxx
// Guarda asistencia en lote: { jugadores: [{ cedula, estado }] }
router.post('/asistencia/:slug/:eventoId', async (req, res) => {
  try {
    const { slug, eventoId } = req.params;
    const { token } = req.query;

    if (!token || !validarTokenAsistencia(slug, eventoId, token)) {
      return res.status(403).json({ success: false, error: 'Token inválido o expirado. Solicita un nuevo link desde WhatsApp.' });
    }

    const club = await db.getClubBySlug(slug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { jugadores } = req.body;
    if (!Array.isArray(jugadores) || jugadores.length === 0) {
      return res.status(400).json({ success: false, error: 'Se requiere el array jugadores' });
    }

    const upserts = jugadores.map(j =>
      db.upsertAsistencia({
        club_id:  club.id,
        evento_id: eventoId,
        cedula:   String(j.cedula),
        estado:   j.estado || 'PENDIENTE',
        nota:     null,
        registrado_por: null,
      })
    );
    await Promise.all(upserts);

    const presentes = jugadores.filter(j => j.estado === 'PRESENTE').length;
    res.json({ success: true, presentes, total: jugadores.length });
  } catch (err) {
    console.error('[publico/asistencia POST]', err.message);
    res.status(500).json({ success: false, error: 'Error interno' });
  }
});

// GET /api/publico/asistencia-token/:slug/:eventoId
// Genera el token para el link de asistencia (solo para uso interno del wa-agent)
router.get('/asistencia-token/:slug/:eventoId', async (req, res) => {
  const { slug, eventoId } = req.params;
  const secret = req.headers['x-internal-secret'];
  if (secret !== (process.env.INTERNAL_SECRET || 'zs-internal-2026')) {
    return res.status(403).json({ success: false });
  }
  res.json({ success: true, token: generarTokenAsistencia(slug, eventoId) });
});

module.exports = router;
module.exports.generarTokenAsistencia = generarTokenAsistencia;
