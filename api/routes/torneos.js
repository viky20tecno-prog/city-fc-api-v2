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
    const { cedulas, nombre_torneo, torneo_id, valor_oficial, valor_inscrito } = req.body;
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
        torneo_id:       torneo_id || null,
        valor_oficial:   parseFloat(valor_oficial)  || 0,
        valor_inscrito:  parseFloat(valor_inscrito) || parseFloat(valor_oficial) || 0,
        valor_pagado:    0,
        saldo_pendiente: parseFloat(valor_inscrito) || parseFloat(valor_oficial) || 0,
        estado:          'PENDIENTE',
      });
    }
    if (rows.length > 0) await db.createTorneosInscripcion(rows);

    const club2 = club || await db.getClubBySlug(req.club_id);
    db.logClubActivity({
      club_id: club2.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'TORNEO_INSCRIPCION', entity_type: 'torneo', entity_id: nombre_torneo,
      entity_label: nombre_torneo,
      details: { cedulas: cedulasArr, inscritos: rows.length, valor_oficial, valor_inscrito },
    });

    res.json({ success: true, enrolled: rows.length, skipped: cedulasArr.length - rows.length });
  } catch (error) {
    console.error('Error en POST /torneos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/torneos/definicion/:torneo_id — propagar cambios de nombre/precio de la plantilla a todos los ya inscritos
router.put('/definicion/:torneo_id', async (req, res) => {
  try {
    const { torneo_id } = req.params;
    const { nombre_torneo, valor_oficial, valor_inscrito } = req.body;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const todos = await db.getTorneos(club.id);
    const inscritos = todos.filter(t => String(t.torneo_id) === String(torneo_id));
    if (inscritos.length === 0) return res.json({ success: true, actualizados: 0 });

    const actualizados = [];
    for (const t of inscritos) {
      const nuevoOficial  = valor_oficial  !== undefined ? parseFloat(valor_oficial)  : parseFloat(t.valor_oficial)  || 0;
      const nuevoInscrito = valor_inscrito !== undefined ? parseFloat(valor_inscrito) : parseFloat(t.valor_inscrito) || 0;
      const nuevoPagado   = parseFloat(t.valor_pagado) || 0;
      const descuento     = parseFloat(t.descuento)    || 0;
      const baseInscrito  = nuevoInscrito || nuevoOficial || 0;
      const valorNeto     = Math.max(0, baseInscrito - descuento);
      const saldo         = Math.max(0, valorNeto - nuevoPagado);
      const estado        = saldo === 0 ? 'AL_DIA' : nuevoPagado > 0 ? 'ABONO' : 'PENDIENTE';

      const updated = await db.updateTorneo(t.id, {
        ...(nombre_torneo !== undefined && { nombre_torneo }),
        valor_oficial: nuevoOficial, valor_inscrito: nuevoInscrito,
        saldo_pendiente: saldo, estado,
      });
      actualizados.push(updated);
    }

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'TORNEO_DEFINICION_PROPAGADA', entity_type: 'torneo', entity_id: torneo_id,
      entity_label: nombre_torneo || inscritos[0]?.nombre_torneo,
      details: { actualizados: actualizados.length, valor_oficial, valor_inscrito, nombre_torneo },
    });

    res.json({ success: true, actualizados: actualizados.length, data: actualizados });
  } catch (error) {
    console.error('Error en PUT /torneos/definicion/:torneo_id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/torneos/:id — actualizar pago y/o descuento
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { valor_pagado, descuento, concepto_descuento, valor_oficial, valor_inscrito } = req.body;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const todos = await db.getTorneos(club.id);
    const torneo = todos.find(t => String(t.id) === String(id));
    if (!torneo) return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });

    // Mantener valor anterior si no se envió el campo
    const nuevoDesc     = descuento      !== undefined ? parseFloat(descuento)      : parseFloat(torneo.descuento)      || 0;
    const nuevoPagado   = valor_pagado   !== undefined ? parseFloat(valor_pagado)   : parseFloat(torneo.valor_pagado)   || 0;
    const nuevoOficial  = valor_oficial  !== undefined ? parseFloat(valor_oficial)  : parseFloat(torneo.valor_oficial)  || 0;
    const nuevoInscrito = valor_inscrito !== undefined ? parseFloat(valor_inscrito) : parseFloat(torneo.valor_inscrito) || 0;

    const baseInscrito = nuevoInscrito || nuevoOficial || 0;
    const valorNeto    = Math.max(0, baseInscrito - nuevoDesc);
    const saldo        = Math.max(0, valorNeto - nuevoPagado);
    const estado    = saldo === 0 ? 'AL_DIA' : nuevoPagado > 0 ? 'ABONO' : 'PENDIENTE';

    const updates = {
      valor_pagado: nuevoPagado, descuento: nuevoDesc, saldo_pendiente: saldo, estado,
      valor_oficial: nuevoOficial, valor_inscrito: nuevoInscrito,
    };
    if (concepto_descuento !== undefined) updates.concepto_descuento = concepto_descuento;

    const updated = await db.updateTorneo(id, updates);

    const montoCambio = valor_oficial !== undefined || valor_inscrito !== undefined;
    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: montoCambio ? 'TORNEO_MONTO_CORREGIDO' : 'TORNEO_PAGO_ACTUALIZADO', entity_type: 'torneo', entity_id: id,
      entity_label: torneo.nombre_torneo,
      details: { cedula: torneo.cedula, valor_pagado: nuevoPagado, descuento: nuevoDesc, valor_oficial: nuevoOficial, valor_inscrito: nuevoInscrito, estado },
    });

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
