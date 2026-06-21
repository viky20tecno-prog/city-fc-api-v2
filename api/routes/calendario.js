const express = require('express');
const db      = require('../services/db');

const router = express.Router();

// GET /api/calendario?club_id=&desde=&hasta=
router.get('/', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const events = await db.getCalendario(req.club_id, desde || null, hasta || null);
    res.json({ success: true, data: events });
  } catch (err) {
    console.error('GET /calendario:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/calendario
router.post('/', async (req, res) => {
  try {
    const { tipo, titulo, descripcion, fecha_inicio, fecha_fin, lugar, equipo } = req.body;
    if (!titulo || !fecha_inicio) {
      return res.status(400).json({ success: false, error: 'titulo y fecha_inicio son requeridos' });
    }
    const evento = await db.createCalendarioEvent({
      club_id:     req.club_id,
      tipo:        tipo        || 'ENTRENAMIENTO',
      titulo,
      descripcion: descripcion || null,
      fecha_inicio,
      fecha_fin:   fecha_fin   || null,
      lugar:       lugar       || null,
      equipo:      equipo      || null,
      created_by:  req.user?.id || null,
    });
    res.json({ success: true, data: evento });
  } catch (err) {
    console.error('POST /calendario:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/calendario/:id
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['tipo', 'titulo', 'descripcion', 'fecha_inicio', 'fecha_fin', 'lugar', 'equipo', 'suspendido'];
    const updates = {};
    allowed.forEach(k => { if (k in req.body) updates[k] = req.body[k]; });

    const evento = await db.updateCalendarioEvent(req.params.id, req.club_id, updates);
    res.json({ success: true, data: evento });
  } catch (err) {
    console.error('PATCH /calendario:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/calendario/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.deleteCalendarioEvent(req.params.id, req.club_id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /calendario:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
