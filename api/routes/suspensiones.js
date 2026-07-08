const express = require('express');
const db = require('../services/db');
const router = express.Router();

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MOTIVOS_VALIDOS = ['LESION', 'VIAJE', 'RETIRO_TEMPORAL', 'OTRO'];

// Actualiza mensualidades a SUSPENDIDO para un rango de meses
async function suspenderMensualidades(club_id, cedula, mes_inicio, mes_fin, anio) {
  for (let mes = mes_inicio; mes <= mes_fin; mes++) {
    await db.supabase
      .from('mensualidades')
      .update({ estado: 'SUSPENDIDO', saldo_pendiente: 0 })
      .eq('club_id', club_id)
      .eq('cedula', String(cedula))
      .eq('anio', parseInt(anio))
      .eq('numero_mes', mes);
  }
}

// Restaura mensualidades al estado correcto según pagos reales
async function restaurarMensualidades(club_id, cedula, mes_inicio, mes_fin, anio, cuota) {
  for (let mes = mes_inicio; mes <= mes_fin; mes++) {
    const { data: m } = await db.supabase
      .from('mensualidades')
      .select('id, valor_pagado, penalidad')
      .eq('club_id', club_id)
      .eq('cedula', String(cedula))
      .eq('anio', parseInt(anio))
      .eq('numero_mes', mes)
      .single();

    if (!m) continue;

    const pagado    = parseFloat(m.valor_pagado) || 0;
    const penalidad = parseFloat(m.penalidad)   || 0;
    const total     = cuota + penalidad;
    const saldo     = Math.max(0, total - pagado);
    const estado    = pagado >= total ? 'AL_DIA' : pagado > 0 ? 'PARCIAL' : 'PENDIENTE';

    await db.supabase
      .from('mensualidades')
      .update({ valor_oficial: cuota, saldo_pendiente: saldo, estado })
      .eq('id', m.id);
  }
}

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

// POST /api/suspensiones — crea suspensión y actualiza mensualidades a SUSPENDIDO
router.post('/', async (req, res) => {
  try {
    const { cedula, motivo, detalle, mes_inicio, mes_fin, anio = new Date().getFullYear() } = req.body;

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

    // 1. Crear registro de suspensión
    const suspension = await db.createSuspension({
      club_id:    club.id,
      cedula:     String(cedula),
      motivo,
      detalle:    detalle || '',
      mes_inicio: parseInt(mes_inicio),
      mes_fin:    parseInt(mes_fin),
      anio:       parseInt(anio),
      activa:     true,
    });

    // 2. Sincronizar mensualidades → SUSPENDIDO
    await suspenderMensualidades(club.id, cedula, parseInt(mes_inicio), parseInt(mes_fin), anio);

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

// DELETE /api/suspensiones/:id — desactiva suspensión y restaura mensualidades
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    // 1. Obtener datos de la suspensión antes de desactivar
    const { data: susp, error: fetchErr } = await db.supabase
      .from('suspensiones')
      .select('*')
      .eq('id', id)
      .eq('club_id', club.id)
      .single();

    if (fetchErr || !susp) {
      return res.status(404).json({ success: false, error: 'Suspensión no encontrada' });
    }

    // 2. Desactivar la suspensión
    await db.deactivateSuspension(id, club.id);

    // 3. Restaurar mensualidades al estado calculado según pagos reales
    const cuota = parseFloat(club.config?.valor_mensualidad ?? 0);
    await restaurarMensualidades(club.id, susp.cedula, susp.mes_inicio, susp.mes_fin, susp.anio, cuota);

    res.json({ success: true, message: 'Suspensión cancelada y mensualidades restauradas' });
  } catch (error) {
    console.error('Error in DELETE /suspensiones/:id:', error);
    res.status(500).json({ success: false, error: 'Error cancelando suspensión', message: error.message });
  }
});

module.exports = router;
