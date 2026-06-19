const express = require('express');
const db = require('../services/db');
const router = express.Router();

// GET /api/torneos — todos los enrollments del club
router.get('/', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getTorneos(club.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/torneos — inscribir jugadores en un torneo
router.post('/', async (req, res) => {
  try {
    const { cedulas, nombre_torneo, valor_oficial, valor_inscrito } = req.body;
    if (!cedulas || !nombre_torneo) {
      return res.status(400).json({ success: false, error: 'cedulas y nombre_torneo son requeridos' });
    }
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const cedulasArr = Array.isArray(cedulas) ? cedulas : [cedulas];
    const rows = [];
    for (const cedula of cedulasArr) {
      const player = await db.getPlayerByCedula(club.id, String(cedula));
      if (!player) continue;
      rows.push({
        club_id:         club.id,
        player_id:       player.id,
        cedula:          String(cedula),
        nombre_torneo,
        valor_oficial:   parseFloat(valor_oficial)  || 0,
        valor_inscrito:  parseFloat(valor_inscrito) || parseFloat(valor_oficial) || 0,
        valor_pagado:    0,
        saldo_pendiente: parseFloat(valor_inscrito) || parseFloat(valor_oficial) || 0,
        estado:          'PENDIENTE',
      });
    }
    if (rows.length > 0) await db.createTorneosInscripcion(rows);
    res.json({ success: true, enrolled: rows.length, skipped: cedulasArr.length - rows.length });
  } catch (error) {
    console.error('Error en POST /torneos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/torneos/:id — actualizar pago y/o descuento
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { valor_pagado, descuento, concepto_descuento } = req.body;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const todos = await db.getTorneos(club.id);
    const torneo = todos.find(t => String(t.id) === String(id));
    if (!torneo) return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });

    // Mantener valor anterior si no se envió el campo
    const nuevoDesc   = descuento    !== undefined ? parseFloat(descuento)    : parseFloat(torneo.descuento)    || 0;
    const nuevoPagado = valor_pagado !== undefined ? parseFloat(valor_pagado) : parseFloat(torneo.valor_pagado) || 0;

    const baseInscrito = parseFloat(torneo.valor_inscrito) || parseFloat(torneo.valor_oficial) || 0;
    const valorNeto    = Math.max(0, baseInscrito - nuevoDesc);
    const saldo        = Math.max(0, valorNeto - nuevoPagado);
    const estado    = saldo === 0 ? 'AL_DIA' : nuevoPagado > 0 ? 'ABONO' : 'PENDIENTE';

    const updates = { valor_pagado: nuevoPagado, descuento: nuevoDesc, saldo_pendiente: saldo, estado };
    if (concepto_descuento !== undefined) updates.concepto_descuento = concepto_descuento;

    const updated = await db.updateTorneo(id, updates);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error en PUT /torneos/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/torneos/:id — eliminar inscripción
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const todos = await db.getTorneos(club.id);
    const torneo = todos.find(t => String(t.id) === String(id));
    if (!torneo) return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });

    await db.deleteTorneo(id, club.id);
    res.json({ success: true, message: 'Inscripción eliminada' });
  } catch (error) {
    console.error('Error en DELETE /torneos/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
