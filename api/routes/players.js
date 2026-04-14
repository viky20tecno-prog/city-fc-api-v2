const express = require('express');
const SheetsClient = require('../services/sheets');
const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

const sheetsClient = new SheetsClient();

// GET /api/players?club_id=city-fc
router.get('/', async (req, res) => {
  try {
    const jugadores = await sheetsClient.getAllRows('JUGADORES');
    const activos = jugadores.filter(j => j.activo === 'SI');
    res.json({ success: true, total: activos.length, data: activos });
  } catch (error) {
    console.error('Error in GET /players:', error);
    res.status(500).json({ success: false, error: 'Error fetching players', message: error.message });
  }
});

// GET /api/players/:cedula
router.get('/:cedula', async (req, res) => {
  try {
    const jugador = await sheetsClient.searchRow('JUGADORES', 'cedula', req.params.cedula);
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
