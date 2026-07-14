const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const db = require('../services/db');
const {
  sendWelcomeClub,
  sendTrialExpiring,
  sendTrialExpired,
  sendOnboardingDay3,
  sendOnboardingDay7,
  sendWahaSessionAlert,
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

// GET /api/cron/warmup — llamado por Vercel Cron cada pocos minutos para evitar
// cold starts en funciones poco usadas (ej. /api/registro, que casi no recibe
// tráfico porque el registro real pasa por consultor de WhatsApp). Hace un query
// mínimo real para mantener también viva la conexión a Supabase, no solo el
// contenedor de Vercel.
router.all('/warmup', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    await db.getAllActiveClubs();
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
        const diasGracia = club.config?.dias_gracia_mora ?? 0;
        vencidosTotal += await db.marcarMensualidadesVencidas(club.id, diasGracia);
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

  const wahaUrl    = process.env.WAHA_URL;
  const defaultSession = process.env.WAHA_SESSION || 'default';
  const apiKey     = process.env.WAHA_API_KEY;
  if (!wahaUrl) return res.status(500).json({ success: false, error: 'WAHA_URL no configurado' });

  // Responder inmediatamente para no agotar el timeout del cron externo
  res.json({ success: true, status: 'processing' });

  // Procesar en background — la respuesta ya fue enviada
  setImmediate(async () => {
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

  const DIAS_ES   = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
  const fmtH      = d => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;

  const waHeaders = { 'Content-Type': 'application/json' };
  if (apiKey) waHeaders['X-Api-Key'] = apiKey;

  function chatId(cel) {
    const n = String(cel).replace(/\D/g, '');
    return `${n.startsWith('57') ? n : '57' + n}@c.us`;
  }
  async function enviarTexto(cel, texto, session) {
    await fetch(`${wahaUrl}/api/sendText`, {
      method: 'POST', headers: waHeaders,
      body: JSON.stringify({ chatId: chatId(cel), text: texto, session }),
    });
  }
  async function enviarImagen(cel, url, session) {
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

      const config      = club.config || {};
      const clubNombre  = config.nombre || club.name || club.slug;
      const qrUrl       = config.qr_pago_url || null;
      const llavePago   = config.llave_pago   || '';
      const clubSession = config.waha_session;
      if (!clubSession) { resultados.omitidos++; continue; } // sin número propio → no enviar

      // Solo queda el tipo 'evento' — 'cobro' (recordatorio masivo de mensualidades) se quitó
      // por completo, era el mismo patrón de ráfaga por WAHA que causaba baneos del número.
      // Cualquier plantilla vieja que haya quedado con tipo_plantilla='cobro' en la base se
      // omite acá y nunca envía nada.
      if ((plantilla.tipo_plantilla || 'evento') !== 'evento') { resultados.omitidos++; continue; }

      try {
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
          const varsBase = {
            '{dia}':         DIAS_ES[d.getDay()],
            '{lugar}':       evento.lugar || '',
            '{hora_inicio}': fmtH(d),
            '{hora_fin}':    df ? fmtH(df) : '',
            '{club_nombre}': clubNombre,
            '{llave_pago}':  llavePago,
          };
          for (const j of jugadores) {
            if (!j.celular) continue;
            const texto = render(plantilla.mensaje, { ...varsBase, '{nombre}': j.nombre || '' });
            try {
              if (plantilla.incluir_qr && qrUrl) await enviarImagen(j.celular, qrUrl, clubSession);
              await enviarTexto(j.celular, texto, clubSession);
              resultados.enviados++;
            } catch (e) { resultados.errores.push(`${j.celular}: ${e.message}`); }
            await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
          }
        }

        await sb.from('plantillas_mensajes')
          .update({ ultimo_envio: new Date().toISOString() })
          .eq('id', plantilla.id);

      } catch (e) {
        resultados.errores.push(`plantilla ${plantilla.id}: ${e.message}`);
      }
    }

    console.log(`[cron/plantillas] ${horaCol} — enviados:${resultados.enviados} omitidos:${resultados.omitidos} errores:${resultados.errores.length}`);
  } catch (e) {
    console.error('[cron/plantillas] Error fatal:', e.message);
  }
  }); // fin setImmediate
});

// POST /api/cron/cleanup-sessions — elimina sesiones WA inactivas > 20 min
router.all('/cleanup-sessions', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const corte = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data: deleted, error } = await supabaseAdmin
      .from('wa_sessions')
      .delete()
      .lt('updated_at', corte)
      .select('phone');
    if (error) throw error;
    console.log(`[cron] cleanup-sessions: ${deleted?.length || 0} sesiones eliminadas`);
    res.json({ success: true, eliminadas: deleted?.length || 0 });
  } catch (err) {
    console.error('[cron] cleanup-sessions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/cron/waha-health — revisa la sesión 'default' y las sesiones propias de cada
// club, y avisa por correo si alguna deja de estar WORKING. Pensado para correr cada 10-15 min.
router.all('/waha-health', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  const wahaUrl = process.env.WAHA_URL;
  const apiKey  = process.env.WAHA_API_KEY;
  if (!wahaUrl) return res.status(500).json({ success: false, error: 'WAHA_URL no configurado' });

  const waHeaders = { 'Content-Type': 'application/json' };
  if (apiKey) waHeaders['X-Api-Key'] = apiKey;

  async function estadoSesion(name) {
    try {
      const r = await fetch(`${wahaUrl}/api/sessions/${name}`, { headers: waHeaders });
      if (r.status === 404) return 'STOPPED';
      if (!r.ok) return 'UNKNOWN';
      const data = await r.json();
      return data.status || 'UNKNOWN';
    } catch (_) {
      return 'UNKNOWN';
    }
  }

  const resultados = { revisadas: [], alertas: [] };

  try {
    // 'default' — sin persistencia de "ya alertado": si sigue caído, se avisa en cada corrida
    // a propósito (es la sesión más crítica, mejor recordatorio repetido que silencio).
    const statusDefault = await estadoSesion('default');
    resultados.revisadas.push({ session: 'default', status: statusDefault });
    if (statusDefault !== 'WORKING' && statusDefault !== 'UNKNOWN') {
      await sendWahaSessionAlert({ sessionName: 'default', status: statusDefault });
      resultados.alertas.push('default');
    }

    // Clubes con WhatsApp propio — sí llevamos el último estado en config para no repetir alertas
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: clubes } = await sb
      .from('clubs')
      .select('id, slug, config')
      .not('config->>waha_session', 'is', null);

    for (const club of (clubes || [])) {
      const sessionName = club.config.waha_session;
      const status = await estadoSesion(sessionName);
      resultados.revisadas.push({ session: sessionName, status });
      if (status === 'UNKNOWN') continue; // no se pudo verificar, no tocar nada

      const wahaHealth  = club.config?.waha_health || {};
      const yaAlertado  = wahaHealth.alertado === true;

      if (status !== 'WORKING' && !yaAlertado) {
        await sendWahaSessionAlert({ sessionName, status });
        resultados.alertas.push(sessionName);
        await sb.from('clubs').update({
          config: { ...club.config, waha_health: { ultimo_estado: status, alertado: true } },
        }).eq('id', club.id);
      } else if (status === 'WORKING' && yaAlertado) {
        await sendWahaSessionAlert({ sessionName, status, recuperada: true });
        await sb.from('clubs').update({
          config: { ...club.config, waha_health: { ultimo_estado: status, alertado: false } },
        }).eq('id', club.id);
      } else if (status !== wahaHealth.ultimo_estado) {
        await sb.from('clubs').update({
          config: { ...club.config, waha_health: { ultimo_estado: status, alertado: yaAlertado } },
        }).eq('id', club.id);
      }
    }

    res.json({ success: true, ...resultados });
  } catch (err) {
    console.error('[cron/waha-health] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
