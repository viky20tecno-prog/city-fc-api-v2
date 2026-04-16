const express = require('express');
const db = require('../services/db');
const router = express.Router();

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MOTIVOS_VALIDOS = ['LESION', 'VIAJE', 'RETIRO_TEMPORAL', 'OTRO'];

// GET /api/suspensiones?club_id=city-fc[&cedula=123]
router.get('/', async (req, res) => {
  try {
    const { cedula } = req.query;
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const data = cedula
      ? await db.getSuspensionesJugador(club.id, cedula)
      : await db.getSuspensiones(club.id);

    res.json({ success: true, total: data.length, data });
  } catch (error) {
    console.error('Error in GET /suspensiones:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo suspensiones', message: error.message });
  }
});

// POST /api/suspensiones
router.post('/', async (req, res) => {
  try {
    const { cedula, motivo, detalle, mes_inicio, mes_fin, anio = 2026 } = req.body;

    if (!cedula || !motivo || !mes_inicio || !mes_fin) {
      return res.status(400).json({ success: false, error: 'Faltan campos: cedula, motivo, mes_inicio, mes_fin' });
    }
    if (!MOTIVOS_VALIDOS.includes(motivo)) {
      return res.status(400).json({ success: false, error: `Motivo inválido. Opciones: ${MOTIVOS_VALIDOS.join(', ')}` });
    }
    if (mes_inicio < 1 || mes_inicio > 12 || mes_fin < 1 || mes_fin > 12) {
      return res.status(400).json({ success: false, error: 'mes_inicio y mes_fin deben estar entre 1 y 12' });
    }
    if (mes_inicio > mes_fin) {
      return res.status(400).json({ success: false, error: 'mes_inicio no puede ser mayor que mes_fin' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Jugador no encontrado' });

    const suspension = await db.createSuspension({
      club_id: club.id,
      cedula: String(cedula),
      motivo,
      detalle: detalle || '',
      mes_inicio: parseInt(mes_inicio),
      mes_fin: parseInt(mes_fin),
      anio: parseInt(anio),
      activa: true,
    });

    const mesesTexto = Array.from(
      { length: mes_fin - mes_inicio + 1 },
      (_, i) => MESES[mes_inicio + i - 1]
    ).join(', ');

    res.json({
      success: true,
      message: `Suspensión registrada: ${mesesTexto}`,
      data: suspension,
    });
  } catch (error) {
    console.error('Error in POST /suspensiones:', error);
    res.status(500).json({ success: false, error: 'Error registrando suspensión', message: error.message });
  }
});

// DELETE /api/suspensiones/:id  → desactiva (no borra)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const suspension = await db.deactivateSuspension(id, club.id);
    res.json({ success: true, message: 'Suspensión cancelada', data: suspension });
  } catch (error) {
    console.error('Error in DELETE /suspensiones/:id:', error);
    res.status(500).json({ success: false, error: 'Error cancelando suspensión', message: error.message });
  }
});

module.exports = router;
