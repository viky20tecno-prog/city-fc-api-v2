const express = require('express');
const db = require('../services/db');
const router = express.Router();

// GET /api/payments?club_id=city-fc
router.get('/', async (req, res) => {
  try {
    const { limit = 50, cedula } = req.query;
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pagos = await db.getPagos(club.id, {
      cedula,
      limit: Math.min(parseInt(limit) || 50, 500),
    });

    res.json({
      success: true,
      club_id: req.club_id,
      total_registros: pagos.length,
      data: pagos,
    });
  } catch (error) {
    console.error('Error in GET /payments:', error);
    res.status(500).json({ success: false, error: 'Error fetching payments', message: error.message });
  }
});

// POST /api/payments
router.post('/', async (req, res) => {
  try {
    const {
      cedula, nombre_detectado, monto, fecha_comprobante,
      banco, referencia, conceptos = [], url_comprobante = '', observacion = '',
    } = req.body;

    if (!cedula || !monto || !banco) {
      return res.status(400).json({ success: false, error: 'Missing required fields: cedula, monto, banco' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Player not found', cedula });

    const hoy          = new Date().toISOString().split('T')[0];
    const montoNum     = parseInt(monto);
    const conceptoTipo = conceptos[0]?.tipo || 'otro';

    // Registrar el pago
    const pago = await db.createPago({
      club_id:        club.id,
      player_id:      player.id,
      cedula:         String(cedula),
      monto:          montoNum,
      banco,
      concepto:       conceptoTipo,
      referencia:     referencia || '',
      estado_revision: 'aprobado_manual',
      url_comprobante,
    });

    // Actualizar estado según concepto
    if (conceptoTipo === 'mensualidad') {
      await actualizarMensualidad(club.id, cedula, montoNum);
    } else if (conceptoTipo === 'uniforme') {
      await actualizarUniforme(club.id, cedula, montoNum);
    } else if (conceptoTipo === 'torneo') {
      const conceptoDesc = conceptos[0]?.descripcion || '';
      await actualizarTorneo(club.id, cedula, montoNum, conceptoDesc);
    }

    res.json({
      success: true,
      club_id: req.club_id,
      id_transaccion: pago.id,
      mensaje: 'Pago registrado exitosamente',
      pago: {
        id: pago.id,
        cedula,
        monto: montoNum,
        banco,
        referencia,
        estado: 'aprobado_manual',
        fecha_proceso: hoy,
      },
    });
  } catch (error) {
    console.error('Error in POST /payments:', error);
    res.status(500).json({ success: false, error: 'Error registering payment', message: error.message });
  }
});

async function actualizarMensualidad(club_id, cedula, monto) {
  try {
    const pendientes = await db.getMensualidadesPendientes(club_id, cedula);
    if (pendientes.length === 0) return;

    const target      = pendientes[0];
    const nuevoPagado = (parseFloat(target.valor_pagado) || 0) + monto;
    const oficial     = parseFloat(target.valor_oficial) || 0;
    const nuevoSaldo  = Math.max(0, oficial - nuevoPagado);
    const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

    await db.updateMensualidad(target.id, {
      valor_pagado:    nuevoPagado,
      saldo_pendiente: nuevoSaldo,
      estado:          nuevoEstado,
    });
  } catch (err) {
    console.error('Error actualizarMensualidad:', err.message);
  }
}

async function actualizarUniforme(club_id, cedula, monto) {
  try {
    const pendientes = await db.getUniformesPendientes(club_id, cedula);
    if (pendientes.length === 0) return;

    const target      = pendientes[0];
    const nuevoPagado = (parseFloat(target.valor_pagado) || 0) + monto;
    const oficial     = parseFloat(target.valor_oficial) || 0;
    const nuevoSaldo  = Math.max(0, oficial - nuevoPagado);
    const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

    await db.updateUniforme(target.id, {
      valor_pagado:    nuevoPagado,
      saldo_pendiente: nuevoSaldo,
      estado:          nuevoEstado,
    });
  } catch (err) {
    console.error('Error actualizarUniforme:', err.message);
  }
}

async function actualizarTorneo(club_id, cedula, monto, filtroTorneo) {
  try {
    let pendientes = await db.getTorneosPendientes(club_id, cedula);
    if (filtroTorneo) {
      pendientes = pendientes.filter(t =>
        t.nombre_torneo.toLowerCase().includes(filtroTorneo.toLowerCase())
      );
    }
    if (pendientes.length === 0) return;

    const target      = pendientes[0];
    const nuevoPagado = (parseFloat(target.valor_pagado) || 0) + monto;
    const oficial     = parseFloat(target.valor_oficial) || 0;
    const nuevoSaldo  = Math.max(0, oficial - nuevoPagado);
    const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

    await db.updateTorneo(target.id, {
      valor_pagado:    nuevoPagado,
      saldo_pendiente: nuevoSaldo,
      estado:          nuevoEstado,
    });
  } catch (err) {
    console.error('Error actualizarTorneo:', err.message);
  }
}

module.exports = router;
