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
