const express = require('express');
const db = require('../services/db');
const router = express.Router();

// GET /api/players?club_id=city-fc
router.get('/', async (req, res) => {
  try {
    const club_id = req.club_id;

    // Resolver el UUID del club a partir del slug (ej: 'city-fc')
    const club = await db.getClubBySlug(club_id);
    if (!club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const jugadores = await db.getPlayers(club.id);
    res.json({ success: true, total: jugadores.length, data: jugadores });
  } catch (error) {
    console.error('Error in GET /players:', error);
    res.status(500).json({ success: false, error: 'Error fetching players', message: error.message });
  }
});

// GET /api/players/:cedula?club_id=city-fc
router.get('/:cedula', async (req, res) => {
  try {
    const club_id = req.club_id;

    const club = await db.getClubBySlug(club_id);
    if (!club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const jugador = await db.getPlayerByCedula(club.id, req.params.cedula);
    if (!jugador) {
      return res.status(404).json({ success: false, error: 'Jugador no encontrado' });
    }
    res.json({ success: true, data: jugador });
  } catch (error) {
    console.error('Error in GET /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error fetching player', message: error.message });
  }
});

module.exports = router;
