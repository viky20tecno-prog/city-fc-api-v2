const express = require('express');
const db      = require('../services/db');

const router = express.Router();

// GET /api/asistencia/:eventoId?club_id=
// Retorna lista de jugadores (filtrada por equipo si el evento es PARTIDO)
// con su estado de asistencia para ese evento.
router.get('/:eventoId', async (req, res) => {
  try {
    const data = await db.getAsistencia(req.club_id, req.params.eventoId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /asistencia:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/asistencia/:eventoId/:cedula?club_id=
// Upsert el estado de asistencia de un jugador en un evento.
router.patch('/:eventoId/:cedula', async (req, res) => {
  try {
    const { estado, nota } = req.body;
    if (!estado) return res.status(400).json({ success: false, error: 'estado requerido' });

    const data = await db.upsertAsistencia({
      club_id:       req.club_id,
      evento_id:     req.params.eventoId,
      cedula:        req.params.cedula,
      estado,
      nota:          nota || null,
      registrado_por: req.user?.id || null,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('PATCH /asistencia:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
