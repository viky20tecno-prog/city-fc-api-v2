const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

/**
 * GET /api/config?club_id=city-fc
 * Obtener configuración del club desde Supabase (multi-tenant)
 */
router.get('/', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id || 'city-fc';

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: club, error } = await supabase
      .from('clubs')
      .select('slug, name, config')
      .eq('slug', club_id)
      .single();

    if (error || !club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    return res.json({
      success:           true,
      club_id:           club.slug,
      nombre:            club.config?.nombre            || club.name,
      ciudad:            club.config?.ciudad            || '',
      valor_mensualidad: club.config?.valor_mensualidad || 65000,
      color:             club.config?.color             || '#00AAFF',
      subtitulo:         club.config?.subtitulo         || '',
      logo_url:          club.config?.logo_url          || null,
      codigo_pais:       club.config?.codigo_pais       || '57',
      plan:              club.config?.plan              || 'trial',
      trial_ends_at:     club.config?.trial_ends_at     || null,
      modulos:           club.config?.modulos           || null,
    });
  } catch (error) {
    console.error('Error in GET /config:', error);
    res.status(500).json({
      success: false,
      error:   'Error fetching config',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/config?club_id=city-fc
 * Actualiza campos del config del club (onboarding, valor_mensualidad, etc.)
 */
router.patch('/', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: club, error: fetchErr } = await supabase
      .from('clubs').select('config').eq('slug', club_id).single();

    if (fetchErr || !club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const updatedConfig = { ...club.config, ...req.body };

    const { error: updateErr } = await supabase
      .from('clubs').update({ config: updatedConfig }).eq('slug', club_id);

    if (updateErr) {
      return res.status(500).json({ success: false, error: updateErr.message });
    }

    return res.json({ success: true, config: updatedConfig });
  } catch (err) {
    console.error('Error in PATCH /config:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
