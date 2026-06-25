const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// GET /api/documents — lista documentos del club
router.get('/', async (req, res) => {
  try {
    const { data, error } = await sb()
      .from('club_documents')
      .select('*')
      .eq('club_id', req.club_uuid)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) {
    console.error('[documents] GET:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/documents — crear documento
router.post('/', async (req, res) => {
  try {
    const { nombre, url, descripcion, enviar_al_inscribirse = false, orden = 0 } = req.body;
    if (!nombre || !url) {
      return res.status(400).json({ success: false, error: 'nombre y url son obligatorios' });
    }

    // Validar que la URL sea un string razonable (no ejecutar código)
    if (typeof url !== 'string' || url.length > 2000) {
      return res.status(400).json({ success: false, error: 'URL inválida' });
    }

    const { data, error } = await sb()
      .from('club_documents')
      .insert({
        club_id: req.club_uuid,
        nombre: String(nombre).slice(0, 200),
        url: url.trim(),
        descripcion: descripcion ? String(descripcion).slice(0, 500) : null,
        enviar_al_inscribirse: Boolean(enviar_al_inscribirse),
        activo: true,
        orden: Number(orden) || 0,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (e) {
    console.error('[documents] POST:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/documents/:id — actualizar documento
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['nombre', 'url', 'descripcion', 'enviar_al_inscribirse', 'activo', 'orden'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.nombre) updates.nombre = String(updates.nombre).slice(0, 200);
    if (updates.url)    updates.url    = String(updates.url).trim().slice(0, 2000);
    if (updates.descripcion) updates.descripcion = String(updates.descripcion).slice(0, 500);

    const { data, error } = await sb()
      .from('club_documents')
      .update(updates)
      .eq('id', id)
      .eq('club_id', req.club_uuid)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Documento no encontrado' });
    res.json({ success: true, data });
  } catch (e) {
    console.error('[documents] PATCH:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/documents/:id — eliminar documento
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await sb()
      .from('club_documents')
      .delete()
      .eq('id', id)
      .eq('club_id', req.club_uuid);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error('[documents] DELETE:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
