const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { recalcularMensualidadesPorDescuento } = require('../services/descuentos');

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
      valor_mensualidad: club.config?.valor_mensualidad ?? 0,
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
      dias_gracia_mora:           club.config?.dias_gracia_mora           ?? 0,
      penalidad_mora:             club.config?.penalidad_mora             ?? 0,
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
 *
 * Excluye jugadores con beca/descuento activo (tipo_descuento != 'NA') — su valor
 * se resuelve aparte vía POST /aplicar-descuentos-masivo, para no pisar su %.
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

    const nuevoValor = parseFloat(club.config?.valor_mensualidad ?? 0);

    const ahora    = new Date();
    const anioAct  = ahora.getFullYear();
    const mesAct   = ahora.getMonth() + 1;
    const filtroDesdeMesActual = `anio.gt.${anioAct},and(anio.eq.${anioAct},numero_mes.gte.${mesAct})`;

    const { data: becados } = await supabase
      .from('players').select('cedula').eq('club_id', club.id).neq('tipo_descuento', 'NA');
    const cedulasBecados = (becados || []).map(b => b.cedula);

    let query = supabase
      .from('mensualidades')
      .update({ valor_oficial: nuevoValor })
      .eq('club_id', club.id)
      .in('estado', ['PENDIENTE', 'PARCIAL', 'MORA'])
      .or(filtroDesdeMesActual);

    if (cedulasBecados.length > 0) {
      const lista = cedulasBecados.map(c => `"${String(c).replace(/"/g, '\\"')}"`).join(',');
      query = query.not('cedula', 'in', `(${lista})`);
    }

    const { data, error } = await query.select('id');

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true, nuevo_valor: nuevoValor, actualizadas: data?.length || 0 });
  } catch (err) {
    console.error('Error in POST /config/aplicar-mensualidad-pendientes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/config/jugadores-con-descuento-afectados?club_id=city-fc&nuevo_valor=250000
 * Lista los jugadores con beca/descuento activo que tienen mensualidades abiertas
 * (PENDIENTE/PARCIAL/MORA) del mes en curso en adelante, junto con el valor que les
 * correspondería si se preserva su % actual contra el nuevo valor base propuesto.
 * Se usa para precargar el modal de confirmación antes de aplicar un cambio de valor
 * de mensualidad del club — el admin revisa/edita antes de que se toque nada.
 */
router.get('/jugadores-con-descuento-afectados', async (req, res) => {
  try {
    const club_id   = req.club_id || req.query.club_id;
    const nuevoValor = parseFloat(req.query.nuevo_valor ?? 0);
    if (!club_id) return res.status(400).json({ success: false, error: 'club_id requerido' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: club, error: fetchErr } = await supabase
      .from('clubs').select('id').eq('slug', club_id).single();
    if (fetchErr || !club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const { data: becados, error: becErr } = await supabase
      .from('players')
      .select('cedula, nombre, apellidos, tipo_descuento, descuento_pct')
      .eq('club_id', club.id)
      .neq('tipo_descuento', 'NA');
    if (becErr) return res.status(500).json({ success: false, error: becErr.message });
    if (!becados || becados.length === 0) return res.json({ success: true, data: [] });

    const ahora   = new Date();
    const anioAct = ahora.getFullYear();
    const mesAct  = ahora.getMonth() + 1;
    const cedulas = becados.map(b => b.cedula);

    const { data: mensAbiertas, error: mensErr } = await supabase
      .from('mensualidades')
      .select('cedula, valor_oficial')
      .eq('club_id', club.id)
      .in('cedula', cedulas)
      .in('estado', ['PENDIENTE', 'PARCIAL', 'MORA'])
      .eq('anio', anioAct)
      .gte('numero_mes', mesAct);
    if (mensErr) return res.status(500).json({ success: false, error: mensErr.message });

    const valorActualPorCedula = {};
    for (const m of (mensAbiertas || [])) {
      if (!(m.cedula in valorActualPorCedula)) valorActualPorCedula[m.cedula] = Number(m.valor_oficial) || 0;
    }

    const resultado = becados
      .filter(b => b.cedula in valorActualPorCedula)
      .map(b => {
        const pct = Number(b.descuento_pct) || 0;
        return {
          cedula:         b.cedula,
          nombre:         `${b.nombre || ''} ${b.apellidos || ''}`.trim(),
          tipo_descuento: b.tipo_descuento,
          descuento_pct:  pct,
          valor_actual:   valorActualPorCedula[b.cedula],
          valor_sugerido: Math.round(nuevoValor * (1 - pct / 100)),
        };
      });

    return res.json({ success: true, data: resultado });
  } catch (err) {
    console.error('Error in GET /config/jugadores-con-descuento-afectados:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/config/aplicar-descuentos-masivo?club_id=city-fc
 * body: { valores: [{ cedula, valor_oficial }] }
 * Aplica, jugador por jugador, el valor mensual final elegido por el admin en el modal
 * de confirmación — recalcula el descuento_pct correspondiente contra el valor base
 * actual del club y lo propaga a los meses abiertos del año (misma lógica que
 * PATCH /players/:cedula al editar la beca desde Hoja de vida).
 */
router.post('/aplicar-descuentos-masivo', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    if (!club_id) return res.status(400).json({ success: false, error: 'club_id requerido' });

    const valores = Array.isArray(req.body?.valores) ? req.body.valores : [];
    if (valores.length === 0) return res.status(400).json({ success: false, error: 'valores requerido' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: club, error: fetchErr } = await supabase
      .from('clubs').select('id, config').eq('slug', club_id).single();
    if (fetchErr || !club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const valorMensual = parseFloat(club.config?.valor_mensualidad ?? 0);
    let actualizados = 0;

    for (const item of valores) {
      const cedula = item?.cedula;
      if (!cedula) continue;
      const valorFijo = Math.max(0, Number(item.valor_oficial) || 0);
      const pct = valorMensual > 0 ? Math.max(0, Math.min(100, (1 - valorFijo / valorMensual) * 100)) : 0;
      const pctRedondeado = Math.round(pct * 10000) / 10000;

      await supabase.from('players')
        .update({ descuento_pct: pctRedondeado })
        .eq('club_id', club.id).eq('cedula', cedula);

      await recalcularMensualidadesPorDescuento({
        supabase, clubId: club.id, cedula, valorMensual, nuevoPct: pctRedondeado,
      });
      actualizados++;
    }

    return res.json({ success: true, actualizados });
  } catch (err) {
    console.error('Error in POST /config/aplicar-descuentos-masivo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
