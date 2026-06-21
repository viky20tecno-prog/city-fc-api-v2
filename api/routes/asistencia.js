const express = require('express');
const db      = require('../services/db');

const router = express.Router();

// GET /api/asistencia/jugador/:cedula?club_id=
// Retorna historial de asistencia de un jugador (últimos 30 registros).
router.get('/jugador/:cedula', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const { registros, total_eventos } = await db.getAsistenciaJugador(club.id, req.params.cedula, req.club_id);
    res.json({ success: true, data: registros, total_eventos });
  } catch (err) {
    console.error('GET /asistencia/jugador:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/asistencia/stats?club_id=
// Retorna % de asistencia de todos los jugadores del club (para mostrar en la tabla).
router.get('/stats', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getAsistenciaStatsClub(club.id, req.club_id);
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /asistencia/stats:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/asistencia/:eventoId?club_id=
// Retorna lista de jugadores (filtrada por equipo si el evento es PARTIDO)
// con su estado de asistencia para ese evento.
router.get('/:eventoId', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getAsistencia(club.id, req.params.eventoId);
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

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const data = await db.upsertAsistencia({
      club_id:        club.id,
      evento_id:      req.params.eventoId,
      cedula:         req.params.cedula,
      estado,
      nota:           nota || null,
      registrado_por: req.user?.id || null,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('PATCH /asistencia:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
