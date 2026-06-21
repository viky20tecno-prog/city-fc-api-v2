const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const LIMITE_POR_PLAN = { trial: 1, starter: 3, pro: 8, scale: Infinity };

function supabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// GET /api/plantillas — lista plantillas + límite del plan
router.get('/', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from('plantillas_mensajes')
      .select('*')
      .eq('club_id', req.club_uuid)
      .order('created_at');
    if (error) throw error;

    const { data: club } = await sb.from('clubs').select('config').eq('id', req.club_uuid).single();
    const plan  = (club?.config?.plan || 'trial').toLowerCase();
    const limite = LIMITE_POR_PLAN[plan] ?? 1;

    res.json({ success: true, plantillas: data || [], limite, plan });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/plantillas — crear plantilla (respeta límite del plan)
router.post('/', async (req, res) => {
  const { nombre, mensaje, incluir_qr, hora_envio, activa, tipo_evento } = req.body;
  if (!nombre || !mensaje || !hora_envio) {
    return res.status(400).json({ success: false, error: 'nombre, mensaje y hora_envio son requeridos' });
  }
  try {
    const sb = supabaseAdmin();

    // Verificar límite del plan
    const { data: club } = await sb.from('clubs').select('config').eq('id', req.club_uuid).single();
    const plan   = (club?.config?.plan || 'trial').toLowerCase();
    const limite = LIMITE_POR_PLAN[plan] ?? 1;
    const { count } = await sb.from('plantillas_mensajes').select('id', { count: 'exact', head: true }).eq('club_id', req.club_uuid);
    if (count >= limite) {
      return res.status(403).json({
        success: false,
        error: `Tu plan ${plan} permite hasta ${limite} plantilla${limite !== 1 ? 's' : ''}. Mejora tu plan para crear más.`,
        limite,
        plan,
      });
    }

    const { data, error } = await sb
      .from('plantillas_mensajes')
      .insert([{
        club_id:     req.club_uuid,
        nombre:      nombre.trim(),
        mensaje:     mensaje.trim(),
        incluir_qr:  !!incluir_qr,
        hora_envio,
        activa:      activa !== false,
        tipo_evento: tipo_evento || 'ENTRENAMIENTO',
      }])
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, plantilla: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/plantillas/:id — actualizar plantilla
router.put('/:id', async (req, res) => {
  const { nombre, mensaje, incluir_qr, hora_envio, activa, tipo_evento } = req.body;
  try {
    const sb = supabaseAdmin();
    const updates = {};
    if (nombre      !== undefined) updates.nombre      = nombre.trim();
    if (mensaje     !== undefined) updates.mensaje     = mensaje.trim();
    if (incluir_qr  !== undefined) updates.incluir_qr  = !!incluir_qr;
    if (hora_envio  !== undefined) updates.hora_envio  = hora_envio;
    if (activa      !== undefined) updates.activa      = !!activa;
    if (tipo_evento !== undefined) updates.tipo_evento = tipo_evento;

    const { data, error } = await sb
      .from('plantillas_mensajes')
      .update(updates)
      .eq('id', req.params.id)
      .eq('club_id', req.club_uuid)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, plantilla: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/plantillas/:id — eliminar plantilla
router.delete('/:id', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb
      .from('plantillas_mensajes')
      .delete()
      .eq('id', req.params.id)
      .eq('club_id', req.club_uuid);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
