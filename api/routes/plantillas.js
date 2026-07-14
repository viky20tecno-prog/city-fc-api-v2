const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const LIMITE_POR_PLAN = { trial: 0, starter: 0, pro: 8, scale: Infinity };

function supabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// GET /api/plantillas
router.get('/', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const [{ data, error }, { data: club }] = await Promise.all([
      sb.from('plantillas_mensajes').select('*').eq('club_id', req.club_uuid).order('created_at'),
      sb.from('clubs').select('config').eq('id', req.club_uuid).single(),
    ]);
    if (error) throw error;
    const plan   = (club?.config?.plan || 'trial').toLowerCase();
    const limite = LIMITE_POR_PLAN[plan] ?? 1;
    res.json({ success: true, plantillas: data || [], limite, plan });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/plantillas
// Solo tipo 'evento' — el tipo 'cobro' (recordatorio masivo automático de mensualidades) se
// quitó por completo: era el mismo patrón de ráfaga por WAHA que causaba baneos del número.
// El recordatorio de cobro ahora es manual, uno a uno, desde la pantalla de Estado de cuenta.
//
// Estas plantillas ya NO se envían solas — son texto guardado con variables para que el admin
// lo copie y lo pegue en su propio WhatsApp. Ningún club conecta un número acá: el envío
// automático por WAHA (cron + "Enviar ahora"/"Probar") se quitó por completo — se estaba
// baneando el número apenas se conectaba, incluso probándolo una sola vez.
router.post('/', async (req, res) => {
  const { nombre, mensaje, incluir_qr, hora_envio, activa, tipo_evento } = req.body;
  if (!nombre || !mensaje) return res.status(400).json({ success: false, error: 'nombre y mensaje son requeridos' });
  const tipo = 'evento';
  if (!hora_envio) return res.status(400).json({ success: false, error: 'hora_envio es requerido' });

  try {
    const sb = supabaseAdmin();
    const { data: club } = await sb.from('clubs').select('config').eq('id', req.club_uuid).single();
    const plan   = (club?.config?.plan || 'trial').toLowerCase();
    const limite = LIMITE_POR_PLAN[plan] ?? 1;
    const { count } = await sb.from('plantillas_mensajes').select('id', { count: 'exact', head: true }).eq('club_id', req.club_uuid);
    if (count >= limite) {
      return res.status(403).json({
        success: false,
        error: `Tu plan ${plan} permite hasta ${limite} plantilla${limite !== 1 ? 's' : ''}. Mejora tu plan para crear más.`,
        limite, plan,
      });
    }

    const { data, error } = await sb.from('plantillas_mensajes').insert([{
      club_id:        req.club_uuid,
      nombre:         nombre.trim(),
      mensaje:        mensaje.trim(),
      incluir_qr:     !!incluir_qr,
      hora_envio,
      activa:         activa !== false,
      tipo_plantilla: tipo,
      tipo_evento:    tipo_evento || 'ENTRENAMIENTO',
    }]).select().single();
    if (error) throw error;
    res.json({ success: true, plantilla: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/plantillas/:id
router.put('/:id', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const allowed = ['nombre','mensaje','incluir_qr','hora_envio','dia_envio','activa','tipo_plantilla','tipo_evento'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.nombre)  updates.nombre  = updates.nombre.trim();
    if (updates.mensaje) updates.mensaje = updates.mensaje.trim();

    const { data, error } = await sb.from('plantillas_mensajes')
      .update(updates)
      .eq('id', req.params.id)
      .eq('club_id', req.club_uuid)
      .select().single();
    if (error) throw error;
    res.json({ success: true, plantilla: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/plantillas/:id
router.delete('/:id', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from('plantillas_mensajes')
      .delete().eq('id', req.params.id).eq('club_id', req.club_uuid);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
