const express = require('express');
const db = require('../services/db');
const router = express.Router();

// GET /api/invoices?club_id=city-fc&status=PENDIENTE&mes=4&anio=2026
router.get('/', async (req, res) => {
  try {
    const { status, mes, anio = 2026 } = req.query;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    let invoices = await db.getMensualidades(club.id);
    invoices = invoices.filter(inv => String(inv.anio) === String(anio));
    if (mes) invoices = invoices.filter(inv => String(inv.numero_mes) === String(mes));
    if (status) invoices = invoices.filter(inv => inv.estado === status);

    const stats = {
      total_invoices: invoices.length,
      total_oficial: invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_oficial) || 0), 0),
      total_pagado: invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_pagado) || 0), 0),
      total_pendiente: invoices.reduce((sum, inv) => sum + (parseFloat(inv.saldo_pendiente) || 0), 0),
      por_estado: {
        AL_DIA:    invoices.filter(inv => inv.estado === 'AL_DIA').length,
        PENDIENTE: invoices.filter(inv => inv.estado === 'PENDIENTE').length,
        PARCIAL:   invoices.filter(inv => inv.estado === 'PARCIAL').length,
        MORA:      invoices.filter(inv => inv.estado === 'MORA').length,
      }
    };

    res.json({
      success: true,
      club_id: req.club_id,
      stats,
      filters: { status: status || 'TODOS', mes: mes || 'TODOS', anio },
      data: invoices,
    });
  } catch (error) {
    console.error('Error in GET /invoices:', error);
    res.status(500).json({ success: false, error: 'Error fetching invoices', message: error.message });
  }
});

// GET /api/invoices/uniformes
router.get('/uniformes', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getUniformes(club.id);
    res.json({ success: true, total: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error fetching uniform status', message: error.message });
  }
});

// GET /api/invoices/torneos
router.get('/torneos', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getTorneos(club.id);
    res.json({ success: true, total: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error fetching tournament status', message: error.message });
  }
});

// GET /api/invoices/player/:cedula
router.get('/player/:cedula', async (req, res) => {
  try {
    const { cedula } = req.params;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Player not found', cedula });

    const invoices = await db.getMensualidades(club.id, cedula);

    const invoicesByYear = {};
    invoices.forEach(inv => {
      if (!invoicesByYear[inv.anio]) invoicesByYear[inv.anio] = [];
      invoicesByYear[inv.anio].push({
        mes: inv.mes,
        numero_mes: inv.numero_mes,
        valor_oficial: parseFloat(inv.valor_oficial) || 0,
        valor_pagado: parseFloat(inv.valor_pagado) || 0,
        saldo_pendiente: parseFloat(inv.saldo_pendiente) || 0,
        estado: inv.estado,
        fecha_ultima_actualizacion: inv.fecha_ultima_actualizacion || '',
      });
    });
    Object.keys(invoicesByYear).forEach(year => {
      invoicesByYear[year].sort((a, b) => a.numero_mes - b.numero_mes);
    });

    const totalOficial   = invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_oficial) || 0), 0);
    const totalPagado    = invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_pagado) || 0), 0);
    const totalPendiente = invoices.reduce((sum, inv) => sum + (parseFloat(inv.saldo_pendiente) || 0), 0);

    res.json({
      success: true,
      club_id: req.club_id,
      player: {
        cedula: player.cedula,
        nombre_completo: `${player.nombre || ''} ${player.apellidos || ''}`.trim(),
      },
      summary: {
        total_meses: invoices.length,
        total_oficial: totalOficial,
        total_pagado: totalPagado,
        total_pendiente: totalPendiente,
        porcentaje_pagado: totalOficial > 0 ? Math.round((totalPagado / totalOficial) * 100) : 0,
      },
      invoices_by_year: invoicesByYear,
    });
  } catch (error) {
    console.error('Error in GET /invoices/player/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error fetching player invoices', message: error.message });
  }
});

module.exports = router;
