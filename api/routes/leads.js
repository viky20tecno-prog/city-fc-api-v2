const express   = require('express');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const router    = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
});

// POST /api/leads
router.post('/', limiter, async (req, res) => {
  try {
    const { nombre, whatsapp, nombre_club, ciudad, plan_interes = 'free', fuente = 'landing' } = req.body || {};

    if (!nombre?.trim() || !whatsapp?.trim()) {
      return res.status(400).json({ success: false, error: 'nombre y whatsapp son requeridos' });
    }

    const wa = whatsapp.trim().replace(/\D/g, '');
    if (wa.length < 7) {
      return res.status(400).json({ success: false, error: 'Número de WhatsApp inválido' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase.from('leads').insert({
      nombre:       nombre.trim().slice(0, 120),
      whatsapp:     wa,
      nombre_club:  nombre_club?.trim().slice(0, 120) || null,
      ciudad:       ciudad?.trim().slice(0, 80) || null,
      plan_interes: ['free','starter','pro','scale','enterprise'].includes(plan_interes) ? plan_interes : 'free',
      fuente:       fuente.slice(0, 40),
    }).select('id').single();

    if (error) throw error;

    res.status(201).json({ success: true, id: data.id });
  } catch (err) {
    console.error('[leads] Error:', err.message);
    res.status(500).json({ success: false, error: 'Error al guardar. Intenta de nuevo.' });
  }
});

module.exports = router;
