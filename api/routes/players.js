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

// PATCH /api/players/:cedula?club_id=city-fc
// Actualiza foto_url, posicion, numero_camiseta
router.patch('/:cedula', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const updated = await db.updatePlayer(club.id, req.params.cedula, req.body);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error in PATCH /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error updating player', message: error.message });
  }
});

// POST /api/players/bulk?club_id=city-fc  — importación masiva desde Excel/CSV
router.post('/bulk', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { jugadores } = req.body;
    if (!Array.isArray(jugadores) || jugadores.length === 0) {
      return res.status(400).json({ success: false, error: 'Se requiere un array de jugadores no vacío' });
    }

    // Cédulas ya existentes en el club (una sola query)
    const { data: existing } = await db.supabase
      .from('players')
      .select('cedula')
      .eq('club_id', club.id);
    const existingSet = new Set((existing || []).map(p => String(p.cedula)));

    const errores = [];
    const filas   = [];

    jugadores.forEach((j, idx) => {
      const cedula    = String(j.cedula    || '').trim();
      const nombre    = String(j.nombre    || '').trim();
      const apellidos = String(j.apellidos || '').trim();
      const fila      = idx + 2;

      if (!cedula)               return errores.push({ fila, cedula: '—', error: 'Cédula requerida' });
      if (!nombre)               return errores.push({ fila, cedula, error: 'Nombre requerido' });
      if (existingSet.has(cedula)) return errores.push({ fila, cedula, nombre: `${nombre} ${apellidos}`.trim(), error: 'Cédula ya registrada' });

      existingSet.add(cedula); // evitar duplicados dentro del mismo lote
      filas.push({
        club_id:              club.id,
        cedula,
        nombre,
        apellidos:            apellidos || nombre,
        celular:              String(j.celular              || '').trim() || null,
        correo_electronico:   String(j.correo_electronico   || '').trim() || null,
        posicion:             String(j.posicion             || '').trim() || null,
        numero_camiseta:      String(j.numero_camiseta      || '').trim() || null,
        activo:               true,
      });
    });

    let insertados = [];
    if (filas.length > 0) insertados = await db.bulkInsert('players', filas);

    res.json({
      success:        true,
      total:          jugadores.length,
      insertados:     insertados.length,
      errores:        errores.length,
      detalle_errores: errores,
    });
  } catch (error) {
    console.error('Error in POST /players/bulk:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/players/:cedula?club_id=city-fc  — desactiva el jugador (soft delete)
router.delete('/:cedula', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, req.params.cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Jugador no encontrado' });

    await db.deletePlayer(club.id, req.params.cedula);
    res.json({ success: true, mensaje: 'Jugador eliminado correctamente' });
  } catch (error) {
    console.error('Error in DELETE /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error eliminando jugador', message: error.message });
  }
});

module.exports = router;
