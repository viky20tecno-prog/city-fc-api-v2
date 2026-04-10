const express = require('express');
const SheetsClient = require('../services/sheets');

const router = express.Router();
const sheetsClient = new SheetsClient();

/**
 * GET /api/invoices?club_id=city-fc&status=PENDIENTE
 * Lista estado de mensualidades con filtros opcionales
 * Query params:
 *   - status: AL_DIA | PENDIENTE | PARCIAL | MORA (opcional)
 *   - mes: número del mes (opcional, 1-12)
 *   - anio: año (opcional, default 2026)
 */
router.get('/', async (req, res) => {
  try {
    const club_id = req.club_id || 'city-fc';
    const { status, mes, anio = 2026 } = req.query;
    
    // Obtener todas las mensualidades
    let invoices = await sheetsClient.getAllRows('ESTADO_MENSUALIDADES');
    
    // Filtrar por año (si aplica)
    invoices = invoices.filter(inv => String(inv.anio) === String(anio));
    
    // Filtrar por mes (si aplica)
    if (mes) {
      invoices = invoices.filter(inv => String(inv.numero_mes) === String(mes));
    }
    
    // Filtrar por estado (si aplica)
    if (status) {
      invoices = invoices.filter(inv => inv.estado === status);
    }
    
    // Mapear a formato API
    const mapped = invoices.map(inv => ({
      cedula: inv.cedula,
      anio: inv.anio,
      mes: inv.mes,
      numero_mes: inv.numero_mes,
      valor_oficial: parseFloat(inv.valor_oficial) || 0,
      valor_pagado: parseFloat(inv.valor_pagado) || 0,
      saldo_pendiente: parseFloat(inv.saldo_pendiente) || 0,
      estado: inv.estado,
      fecha_ultima_actualizacion: inv.fecha_ultima_actualizacion || '',
    }));
    
    // Calcular estadísticas
    const stats = {
      total_invoices: mapped.length,
      total_oficial: mapped.reduce((sum, inv) => sum + inv.valor_oficial, 0),
      total_pagado: mapped.reduce((sum, inv) => sum + inv.valor_pagado, 0),
      total_pendiente: mapped.reduce((sum, inv) => sum + inv.saldo_pendiente, 0),
      por_estado: {
        AL_DIA: mapped.filter(inv => inv.estado === 'AL_DIA').length,
        PENDIENTE: mapped.filter(inv => inv.estado === 'PENDIENTE').length,
        PARCIAL: mapped.filter(inv => inv.estado === 'PARCIAL').length,
        MORA: mapped.filter(inv => inv.estado === 'MORA').length,
      }
    };
    
    res.json({
      success: true,
      club_id,
      stats,
      filters: { status: status || 'TODOS', mes: mes || 'TODOS', anio },
      data: mapped,
    });
  } catch (error) {
    console.error('Error in GET /invoices:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching invoices',
      message: error.message,
    });
  }
});

/**
 * GET /api/invoices/player/:cedula?club_id=city-fc
 * Obtener todas las mensualidades de un jugador específico
 * Con desglose completo y estado financiero
 */
router.get('/player/:cedula', async (req, res) => {
  try {
    const { cedula } = req.params;
    const club_id = req.club_id || 'city-fc';
    
    // Obtener jugador
    const player = await sheetsClient.searchRow('JUGADORES', 'cedula', cedula);
    
    if (!player) {
      return res.status(404).json({
        success: false,
        error: 'Player not found',
        cedula,
      });
    }
    
    // Obtener todas las mensualidades del jugador
    const invoices = await sheetsClient.searchRows('ESTADO_MENSUALIDADES', 'cedula', cedula);
    
    // Agrupar por año
    const invoicesByYear = {};
    invoices.forEach(inv => {
      const year = inv.anio;
      if (!invoicesByYear[year]) {
        invoicesByYear[year] = [];
      }
      invoicesByYear[year].push({
        mes: inv.mes,
        numero_mes: inv.numero_mes,
        valor_oficial: parseFloat(inv.valor_oficial) || 0,
        valor_pagado: parseFloat(inv.valor_pagado) || 0,
        saldo_pendiente: parseFloat(inv.saldo_pendiente) || 0,
        estado: inv.estado,
        fecha_ultima_actualizacion: inv.fecha_ultima_actualizacion || '',
      });
    });
    
    // Ordenar meses dentro de cada año
    Object.keys(invoicesByYear).forEach(year => {
      invoicesByYear[year].sort((a, b) => a.numero_mes - b.numero_mes);
    });
    
    // Calcular resumen financiero
    const totalInvoices = invoices.length;
    const totalOficial = invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_oficial) || 0), 0);
    const totalPagado = invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_pagado) || 0), 0);
    const totalPendiente = invoices.reduce((sum, inv) => sum + (parseFloat(inv.saldo_pendiente) || 0), 0);
    
    // Contar estados
    const estadoCount = {
      AL_DIA: invoices.filter(inv => inv.estado === 'AL_DIA').length,
      PENDIENTE: invoices.filter(inv => inv.estado === 'PENDIENTE').length,
      PARCIAL: invoices.filter(inv => inv.estado === 'PARCIAL').length,
      MORA: invoices.filter(inv => inv.estado === 'MORA').length,
    };
    
    res.json({
      success: true,
      club_id,
      player: {
        cedula: player.cedula,
        nombre_completo: `${player['nombre(s)'] || ''} ${player['apellido(s)'] || ''}`.trim(),
        tipo_descuento: player.tipo_descuento || 'NA',
        mensualidad_oficial: parseFloat(player.mensualidad_2026) || 0,
      },
      summary: {
        total_meses: totalInvoices,
        total_oficial: totalOficial,
        total_pagado: totalPagado,
        total_pendiente: totalPendiente,
        porcentaje_pagado: totalOficial > 0 ? Math.round((totalPagado / totalOficial) * 100) : 0,
        estado_predominante: estadoCount.AL_DIA > 0 ? 'AL_DIA' : (estadoCount.PARCIAL > 0 ? 'PARCIAL' : 'PENDIENTE'),
        por_estado: estadoCount,
      },
      invoices_by_year: invoicesByYear,
    });
  } catch (error) {
    console.error('Error in GET /invoices/player/:cedula:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching player invoices',
      message: error.message,
    });
  }
});

module.exports = router;
