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

    console.log(`[cron] Ejecutado: ${resultados.enviados.length} enviados, ${resultados.omitidos.length} omitidos, ${resultados.errores.length} errores`);
    res.json({ success: true, timestamp: ahora.toISOString(), ...resultados });

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

module.exports = router;
