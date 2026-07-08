const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

/**
 * GET /api/config?club_id=city-fc
 * Obtener configuración del club desde Supabase (multi-tenant)
 */
router.get('/', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    if (!club_id) return res.status(400).json({ success: false, error: 'club_id requerido' });

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
      valor_mensualidad: club.config?.valor_mensualidad ?? 65000,
      color:             club.config?.color             || '#00AAFF',
      subtitulo:         club.config?.subtitulo         || '',
      logo_url:          club.config?.logo_url          || null,
      codigo_pais:       club.config?.codigo_pais       || '57',
      plan:              club.config?.plan              || 'trial',
      trial_ends_at:     club.config?.trial_ends_at     || null,
      modulos:           club.config?.modulos           || null,
      onboarding_completed: club.config?.onboarding_completed || false,
      prendas_uniforme:  club.config?.prendas_uniforme  || [],
      whatsapp:                   club.config?.whatsapp                   || '',
      dias_gracia_mora:           club.config?.dias_gracia_mora           ?? 7,
      penalidad_mora:             club.config?.penalidad_mora             ?? 5000,
      torneos_iniciales:          club.config?.torneos_iniciales          || [],
      categorias_jugadores:       club.config?.categorias_jugadores       || [],
      categorias_finanzas_ingreso: club.config?.categorias_finanzas_ingreso || [],
      categorias_finanzas_gasto:  club.config?.categorias_finanzas_gasto  || [],
      redes_sociales:             club.config?.redes_sociales             || {},
      llave_pago:                 club.config?.llave_pago                 || '',
      qr_pago_url:                club.config?.qr_pago_url                || '',
      deporte:   club.config?.deporte   || 'futbol',
      deportes:  Array.isArray(club.config?.deportes) && club.config.deportes.length > 0
        ? club.config.deportes
        : [club.config?.deporte || 'futbol'],
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

    // Si se envían prendas_uniforme, preservar precios existentes para nombres que ya tenían precio
    if (req.body.prendas_uniforme) {
      const existing = club.config?.prendas_uniforme || [];
      req.body.prendas_uniforme = req.body.prendas_uniforme.map(p => {
        if (typeof p === 'object' && p.nombre) return p;
        const found = existing.find(e => (typeof e === 'object' ? e.nombre : e) === p);
        return { nombre: String(p), precio: typeof found === 'object' ? (found.precio || 0) : 0 };
      });
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

/**
 * POST /api/config/aplicar-mensualidad-pendientes?club_id=city-fc
 * Aplica el valor_mensualidad actual del club a las mensualidades que todavía
 * están abiertas (PENDIENTE/PARCIAL/MORA) del mes en curso en adelante. No toca
 * PAGADO ni EXENTO (deuda ya saldada o exonerada) ni meses ya pasados (historial).
 * Acción explícita del admin — no se dispara sola al cambiar el config.
 */
router.post('/aplicar-mensualidad-pendientes', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    if (!club_id) return res.status(400).json({ success: false, error: 'club_id requerido' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: club, error: fetchErr } = await supabase
      .from('clubs').select('id, config').eq('slug', club_id).single();
    if (fetchErr || !club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const nuevoValor = parseFloat(club.config?.valor_mensualidad ?? 65000);

    const ahora    = new Date();
    const anioAct  = ahora.getFullYear();
    const mesAct   = ahora.getMonth() + 1;
    const filtroDesdeMesActual = `anio.gt.${anioAct},and(anio.eq.${anioAct},numero_mes.gte.${mesAct})`;

    const { data, error } = await supabase
      .from('mensualidades')
      .update({ valor_oficial: nuevoValor })
      .eq('club_id', club.id)
      .in('estado', ['PENDIENTE', 'PARCIAL', 'MORA'])
      .or(filtroDesdeMesActual)
      .select('id');

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true, nuevo_valor: nuevoValor, actualizadas: data?.length || 0 });
  } catch (err) {
    console.error('Error in POST /config/aplicar-mensualidad-pendientes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
