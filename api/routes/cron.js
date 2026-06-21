const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const db = require('../services/db');
const {
  sendWelcomeClub,
  sendTrialExpiring,
  sendTrialExpired,
  sendOnboardingDay3,
  sendOnboardingDay7,
} = require('../services/email');

const router = express.Router();

function verifyCronSecret(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({ success: false, error: 'CRON_SECRET no configurado en el servidor' });
    return false;
  }
  const auth  = req.headers['authorization'] || req.headers['x-cron-secret'];
  const token = auth?.replace('Bearer ', '');
  if (token !== secret) {
    res.status(401).json({ success: false, error: 'No autorizado' });
    return false;
  }
  return true;
}

// POST /api/cron/emails — llamado por Vercel Cron diariamente
// También acepta GET para facilitar pruebas manuales desde el admin
router.all('/emails', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const ahora = new Date();
  const resultados = { enviados: [], omitidos: [], errores: [] };

  try {
    const clubs = await db.getAllActiveClubs();

    for (const club of clubs) {
      try {
        const config         = club.config || {};
        const emails_enviados = config.emails_enviados || {};
        const nombre_club    = config.nombre || club.name || club.slug;
        const plan           = config.plan || 'trial';

        // Obtener email y nombre del admin desde Supabase Auth
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(club.owner_user_id);
        const email        = userData?.user?.email;
        const nombre_admin = userData?.user?.user_metadata?.nombre || 'Administrador';

        if (!email) {
          resultados.omitidos.push({ slug: club.slug, razon: 'sin_email' });
          continue;
        }

        // ── Onboarding (basado en días desde creación) ─────────────────────
        const diasDesdeRegistro = Math.floor((ahora - new Date(club.created_at)) / 86400000);

        if (diasDesdeRegistro >= 3 && diasDesdeRegistro < 5 && !emails_enviados.onboarding_3) {
          await sendOnboardingDay3({ nombre_club, nombre_admin, email, club_slug: club.slug });
          await db.marcarEmailEnviado(club.id, 'onboarding_3');
          resultados.enviados.push({ slug: club.slug, tipo: 'onboarding_3' });
        }

        // ── Secuencia Trial (solo para clubs en trial) ──────────────────────
        if (plan !== 'trial' || !config.trial_ends_at) continue;

        const trialFin       = new Date(config.trial_ends_at);
        const diasRestantes  = Math.ceil((trialFin - ahora) / 86400000);

        if (diasRestantes === 3 && !emails_enviados.trial_3) {
          await sendTrialExpiring({ nombre_club, nombre_admin, email, dias_restantes: 3 });
          await db.marcarEmailEnviado(club.id, 'trial_3');
          resultados.enviados.push({ slug: club.slug, tipo: 'trial_3' });
        }

        if (diasRestantes === 1 && !emails_enviados.trial_1) {
          await sendTrialExpiring({ nombre_club, nombre_admin, email, dias_restantes: 1 });
          await db.marcarEmailEnviado(club.id, 'trial_1');
          resultados.enviados.push({ slug: club.slug, tipo: 'trial_1' });
        }

        if (diasRestantes <= 0 && !emails_enviados.trial_expired) {
          await sendTrialExpired({ nombre_club, nombre_admin, email });
          await db.marcarEmailEnviado(club.id, 'trial_expired');
          resultados.enviados.push({ slug: club.slug, tipo: 'trial_expired' });
        }

      } catch (err) {
        console.error(`[cron] Error procesando club ${club.slug}:`, err.message);
        resultados.errores.push({ slug: club.slug, error: err.message });
      }
    }

    // Marcar mensualidades vencidas de todos los clubs
    let vencidosTotal = 0;
    for (const club of clubs) {
      try {
        vencidosTotal += await db.marcarMensualidadesVencidas(club.id);
      } catch (e) {
        console.error(`[cron] marcarVencidos ${club.slug}:`, e.message);
      }
    }

    console.log(`[cron] Ejecutado: ${resultados.enviados.length} enviados, ${resultados.omitidos.length} omitidos, ${resultados.errores.length} errores, ${vencidosTotal} mensualidades marcadas vencidas`);
    res.json({ success: true, timestamp: ahora.toISOString(), vencidos_marcados: vencidosTotal, ...resultados });

  } catch (err) {
    console.error('[cron] Error fatal:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/cron/preview-emails?email=tu@correo.com
// Envía todos los templates de prueba a un correo para revisión visual — requiere CRON_SECRET
router.get('/preview-emails', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Falta ?email=tu@correo.com' });

  const datos = {
    nombre_club:  'City FC Demo',
    nombre_admin: 'Diego',
    email,
    club_slug:    'city-fc',
  };

  const resultados = [];

  const envios = [
    { tipo: 'bienvenida',   fn: () => sendWelcomeClub(datos) },
    { tipo: 'onboarding_3', fn: () => sendOnboardingDay3(datos) },
    { tipo: 'trial_3dias',  fn: () => sendTrialExpiring({ ...datos, dias_restantes: 3 }) },
    { tipo: 'trial_1dia',   fn: () => sendTrialExpiring({ ...datos, dias_restantes: 1 }) },
    { tipo: 'trial_vencido',fn: () => sendTrialExpired(datos) },
  ];

  for (const { tipo, fn } of envios) {
    const r = await fn().catch(e => ({ ok: false, error: e.message }));
    resultados.push({ tipo, ok: r.ok, id: r.id });
    await new Promise(resolve => setTimeout(resolve, 300)); // pausa entre envíos
  }

  res.json({ success: true, enviados_a: email, resultados });
});

// POST /api/cron/cobro — llamado por Vercel Cron diariamente a las 8am Colombia (13:00 UTC)
// Dispara la Supabase Edge Function cobro-automatico que maneja el ciclo completo
// (días 27/1/4/7/8/9) enviando WA directo via Twilio sin pasar por Make.com
router.all('/cobro', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ success: false, error: 'SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados' });
  }

  const funcionUrl = `${supabaseUrl.replace('.supabase.co', '.supabase.co')}/functions/v1/cobro-automatico`;

  try {
    const body = req.body && Object.keys(req.body).length > 0 ? req.body : {};

    const resp = await fetch(funcionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error('[cron/cobro] Error desde cobro-automatico:', resp.status, data);
      return res.status(resp.status).json({ success: false, error: data });
    }

    console.log('[cron/cobro] cobro-automatico ejecutado:', JSON.stringify(data));
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[cron/cobro] Error llamando cobro-automatico:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/cron/plantillas — llamado cada hora por Vercel Cron
// Busca plantillas activas cuya hora_envio coincide con la hora actual en Colombia (UTC-5)
// y hay eventos del tipo indicado hoy. Envía vía WAHA.
router.all('/plantillas', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  const wahaUrl = process.env.WAHA_URL;
  const session = process.env.WAHA_SESSION || 'default';
  const apiKey  = process.env.WAHA_API_KEY;
  if (!wahaUrl) return res.status(500).json({ success: false, error: 'WAHA_URL no configurado' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Hora actual en Colombia (UTC-5)
  const nowCol    = new Date(Date.now() - 5 * 3600000);
  const horaCol   = nowCol.toISOString().split('T')[1].slice(0, 5); // "HH:MM"
  const horaHH    = horaCol.slice(0, 2);                            // "HH" para comparar con TIME
  const hoyCol    = nowCol.toISOString().split('T')[0];
  const mananaCol = new Date(nowCol.getTime() + 86400000).toISOString().split('T')[0];
  const inicioUTC = `${hoyCol}T05:00:00Z`;
  const finUTC    = `${mananaCol}T04:59:59Z`;

  const resultados = { enviados: 0, omitidos: 0, errores: [] };

  const MESES_ES  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DIAS_ES   = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
  const fmtH      = d => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
  const fmtCOP    = n => '$' + Math.round(n).toLocaleString('es-CO');
  const diaCol    = nowCol.getDate();
  const anio      = nowCol.getFullYear();

  const waHeaders = { 'Content-Type': 'application/json' };
  if (apiKey) waHeaders['X-Api-Key'] = apiKey;

  function chatId(cel) {
    const n = String(cel).replace(/\D/g, '');
    return `${n.startsWith('57') ? n : '57' + n}@c.us`;
  }
  async function enviarTexto(cel, texto) {
    await fetch(`${wahaUrl}/api/sendText`, {
      method: 'POST', headers: waHeaders,
      body: JSON.stringify({ chatId: chatId(cel), text: texto, session }),
    });
  }
  async function enviarImagen(cel, url) {
    if (!url) return;
    await fetch(`${wahaUrl}/api/sendImage`, {
      method: 'POST', headers: waHeaders,
      body: JSON.stringify({ chatId: chatId(cel), file: { url }, caption: '', session }),
    });
  }
  function yaEnviadoHoy(p) {
    if (!p.ultimo_envio) return false;
    const fechaCol = new Date(new Date(p.ultimo_envio).getTime() - 5 * 3600000).toISOString().split('T')[0];
    return fechaCol === hoyCol;
  }
  function render(mensaje, vars) {
    let t = mensaje;
    for (const [k, v] of Object.entries(vars)) t = t.replaceAll(k, v ?? '');
    return t;
  }

  try {
    const { data: plantillas } = await sb
      .from('plantillas_mensajes')
      .select('*, clubs(id, slug, name, config, celular_admin)')
      .eq('activa', true);

    for (const plantilla of (plantillas || [])) {
      const club = plantilla.clubs;
      if (!club || yaEnviadoHoy(plantilla)) { resultados.omitidos++; continue; }

      const config     = club.config || {};
      const clubNombre = config.nombre || club.name || club.slug;
      const qrUrl      = config.qr_pago_url || null;
      const llavePago  = config.llave_pago   || '';
      const tipo       = plantilla.tipo_plantilla || 'evento';

      try {
        // ── TIPO EVENTO ──────────────────────────────────────────────────────────
        if (tipo === 'evento') {
          const hPlant = (plantilla.hora_envio || '').slice(0, 2);
          if (hPlant !== horaHH) { resultados.omitidos++; continue; }

          let query = sb.from('calendario')
            .select('id, titulo, tipo, lugar, fecha_inicio, fecha_fin')
            .eq('club_id', club.slug)
            .gte('fecha_inicio', inicioUTC)
            .lte('fecha_inicio', finUTC)
            .or('suspendido.eq.false,suspendido.is.null');
          if (plantilla.tipo_evento && plantilla.tipo_evento !== 'todos') {
            query = query.eq('tipo', plantilla.tipo_evento);
          }
          const { data: eventos } = await query.order('fecha_inicio');
          if (!eventos?.length) { resultados.omitidos++; continue; }

          const { data: jugadores } = await sb
            .from('players').select('cedula, nombre, apellidos, celular')
            .eq('club_id', club.id).eq('activo', true);
          if (!jugadores?.length) { resultados.omitidos++; continue; }

          for (const evento of eventos) {
            const d  = new Date(new Date(evento.fecha_inicio).getTime() - 5 * 3600000);
            const df = evento.fecha_fin ? new Date(new Date(evento.fecha_fin).getTime() - 5 * 3600000) : null;
            const vars = {
              '{dia}':         DIAS_ES[d.getDay()],
              '{lugar}':       evento.lugar || '',
              '{hora_inicio}': fmtH(d),
              '{hora_fin}':    df ? fmtH(df) : '',
              '{club_nombre}': clubNombre,
              '{llave_pago}':  llavePago,
            };
            const texto = render(plantilla.mensaje, vars);
            for (const j of jugadores) {
              if (!j.celular) continue;
              try {
                if (plantilla.incluir_qr && qrUrl) await enviarImagen(j.celular, qrUrl);
                await enviarTexto(j.celular, texto);
                resultados.enviados++;
              } catch (e) { resultados.errores.push(`${j.celular}: ${e.message}`); }
            }
          }

        // ── TIPO COBRO ───────────────────────────────────────────────────────────
        } else if (tipo === 'cobro') {
          if (Number(plantilla.dia_envio) !== diaCol) { resultados.omitidos++; continue; }

          const { data: jugadores } = await sb
            .from('players').select('cedula, nombre, apellidos, celular')
            .eq('club_id', club.id).eq('activo', true);
          if (!jugadores?.length) { resultados.omitidos++; continue; }

          // Traer todas las mensualidades del año de una sola vez
          const { data: todasMens } = await sb
            .from('mensualidades')
            .select('cedula, estado, saldo_pendiente, numero_mes')
            .eq('club_id', club.id)
            .eq('anio', anio)
            .in('estado', ['MORA','PENDIENTE','PARCIAL'])
            .gt('valor_oficial', 0);

          // Agrupar por cédula
          const porCedula = {};
          for (const m of (todasMens || [])) {
            if (!porCedula[m.cedula]) porCedula[m.cedula] = [];
            porCedula[m.cedula].push(m);
          }

          for (const j of jugadores) {
            const pendientes = porCedula[j.cedula];
            if (!pendientes?.length) continue; // jugador al día — no se envía
            const deuda  = pendientes.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
            const meses  = pendientes
              .sort((a, b) => a.numero_mes - b.numero_mes)
              .map(m => MESES_ES[(m.numero_mes || 1) - 1])
              .join(', ');
            const vars = {
              '{nombre}':      j.nombre,
              '{deuda}':       fmtCOP(deuda),
              '{meses}':       meses,
              '{club_nombre}': clubNombre,
              '{llave_pago}':  llavePago,
            };
            const texto = render(plantilla.mensaje, vars);
            try {
              if (plantilla.incluir_qr && qrUrl) await enviarImagen(j.celular, qrUrl);
              await enviarTexto(j.celular, texto);
              resultados.enviados++;
            } catch (e) { resultados.errores.push(`${j.celular}: ${e.message}`); }
          }
        }

        await sb.from('plantillas_mensajes')
          .update({ ultimo_envio: new Date().toISOString() })
          .eq('id', plantilla.id);

      } catch (e) {
        resultados.errores.push(`plantilla ${plantilla.id}: ${e.message}`);
      }
    }

    res.json({ success: true, hora_col: horaCol, ...resultados });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
