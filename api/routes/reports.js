const express = require('express');
const SheetsClient = require('../services/sheets');

const router = express.Router();
const sheetsClient = new SheetsClient();

/**
 * GET /api/reports/summary?club_id=city-fc&mes=3&anio=2026
 * Resumen ejecutivo del club: recaudación, morosos, al día, etc.
 * Query params:
 *   - mes: número del mes (opcional, default mes actual)
 *   - anio: año (opcional, default 2026)
 */
router.get('/summary', async (req, res) => {
  try {
    const club_id = req.club_id || 'city-fc';
    const { mes, anio = 2026 } = req.query;
    
    // Obtener fecha actual si no especifica mes
    const currentDate = new Date();
    const currentMonth = mes || (currentDate.getMonth() + 1);
    
    // ===== JUGADORES =====
    const players = await sheetsClient.getAllRows('JUGADORES');
    const activePlayers = players.filter(p => p.activo === 'SI');
    const inactivePlayers = players.filter(p => p.activo === 'NO');
    
    // Contar por tipo de descuento
    const playersByDiscount = {
      NA: activePlayers.filter(p => (p.tipo_descuento || 'NA') === 'NA').length,
      DESCUENTO: activePlayers.filter(p => p.tipo_descuento === 'DESCUENTO').length,
      BECA: activePlayers.filter(p => p.tipo_descuento === 'BECA').length,
    };
    
    // ===== MENSUALIDADES (mes específico) =====
    let invoices = await sheetsClient.getAllRows('ESTADO_MENSUALIDADES');
    invoices = invoices.filter(inv => 
      String(inv.anio) === String(anio) && 
      String(inv.numero_mes) === String(currentMonth)
    );
    
    // Estadísticas de mensualidades
    const invoiceStats = {
      total_jugadores: activePlayers.length,
      total_mensualidades: invoices.length,
      valor_oficial_mes: 0,
      valor_pagado_mes: 0,
      valor_pendiente_mes: 0,
      porcentaje_recaudacion: 0,
      por_estado: {
        AL_DIA: 0,
        PARCIAL: 0,
        PENDIENTE: 0,
        MORA: 0,
      },
      morosos_cédulas: [],
    };
    
    invoices.forEach(inv => {
      const oficial = parseFloat(inv.valor_oficial) || 0;
      const pagado = parseFloat(inv.valor_pagado) || 0;
      const pendiente = parseFloat(inv.saldo_pendiente) || 0;
      
      invoiceStats.valor_oficial_mes += oficial;
      invoiceStats.valor_pagado_mes += pagado;
      invoiceStats.valor_pendiente_mes += pendiente;
      
      invoiceStats.por_estado[inv.estado] = (invoiceStats.por_estado[inv.estado] || 0) + 1;
      
      // Agregar a morosos si está en MORA
      if (inv.estado === 'MORA') {
        invoiceStats.morosos_cédulas.push({
          cedula: inv.cedula,
          estado: inv.estado,
          saldo_pendiente: pendiente,
        });
      }
    });
    
    if (invoiceStats.valor_oficial_mes > 0) {
      invoiceStats.porcentaje_recaudacion = Math.round(
        (invoiceStats.valor_pagado_mes / invoiceStats.valor_oficial_mes) * 100
      );
    }
    
    // ===== UNIFORMES (acumulado) =====
    const uniforms = await sheetsClient.getAllRows('ESTADO_UNIFORMES');
    const uniformStats = {
      total_uniformes: uniforms.length,
      valor_oficial: 0,
      valor_pagado: 0,
      valor_pendiente: 0,
      al_dia: 0,
      parcial: 0,
      pendiente: 0,
    };
    
    uniforms.forEach(unif => {
      const oficial = parseFloat(unif.valor_oficial) || 0;
      const pagado = parseFloat(unif.valor_pagado) || 0;
      
      uniformStats.valor_oficial += oficial;
      uniformStats.valor_pagado += pagado;
      uniformStats.valor_pendiente += (oficial - pagado);
      
      if (unif.estado === 'AL_DIA') uniformStats.al_dia++;
      else if (unif.estado === 'PARCIAL') uniformStats.parcial++;
      else if (unif.estado === 'PENDIENTE') uniformStats.pendiente++;
    });
    
    // ===== TORNEOS (acumulado) =====
    const tournaments = await sheetsClient.getAllRows('ESTADO_TORNEOS');
    const tournamentStats = {
      total_inscripciones: tournaments.length,
      valor_oficial: 0,
      valor_pagado: 0,
      valor_pendiente: 0,
      al_dia: 0,
      parcial: 0,
      pendiente: 0,
    };
    
    tournaments.forEach(torn => {
      const oficial = parseFloat(torn.valor_oficial) || 0;
      const pagado = parseFloat(torn.valor_pagado) || 0;
      
      tournamentStats.valor_oficial += oficial;
      tournamentStats.valor_pagado += pagado;
      tournamentStats.valor_pendiente += (oficial - pagado);
      
      if (torn.estado === 'AL_DIA') tournamentStats.al_dia++;
      else if (torn.estado === 'PARCIAL') tournamentStats.parcial++;
      else if (torn.estado === 'PENDIENTE') tournamentStats.pendiente++;
    });
    
    // ===== RESUMEN FINANCIERO TOTAL =====
    const totalStats = {
      valor_oficial_total: invoiceStats.valor_oficial_mes + uniformStats.valor_oficial + tournamentStats.valor_oficial,
      valor_pagado_total: invoiceStats.valor_pagado_mes + uniformStats.valor_pagado + tournamentStats.valor_pagado,
      valor_pendiente_total: invoiceStats.valor_pendiente_mes + uniformStats.valor_pendiente + tournamentStats.valor_pendiente,
      porcentaje_recaudacion_total: 0,
    };
    
    if (totalStats.valor_oficial_total > 0) {
      totalStats.porcentaje_recaudacion_total = Math.round(
        (totalStats.valor_pagado_total / totalStats.valor_oficial_total) * 100
      );
    }
    
    res.json({
      success: true,
      club_id,
      periodo: {
        mes: currentMonth,
        anio: anio,
        mes_nombre: getMesNombre(currentMonth),
      },
      jugadores: {
        total_activos: activePlayers.length,
        total_inactivos: inactivePlayers.length,
        total_general: players.length,
        por_tipo_descuento: playersByDiscount,
      },
      mensualidades: invoiceStats,
      uniformes: uniformStats,
      torneos: tournamentStats,
      resumen_financiero: totalStats,
      indicadores: {
        tasa_mora: invoices.length > 0 
          ? Math.round((invoiceStats.por_estado.MORA / invoices.length) * 100) 
          : 0,
        jugadores_al_dia: invoiceStats.por_estado.AL_DIA,
        jugadores_en_mora: invoiceStats.morosos_cédulas.length,
        salud_general: evaluarSalud(invoiceStats.porcentaje_recaudacion),
      },
    });
  } catch (error) {
    console.error('Error in GET /reports/summary:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching summary',
      message: error.message,
    });
  }
});

/**
 * GET /api/reports/defaulters?club_id=city-fc&anio=2026
 * Lista de jugadores morosos (estado = MORA en mensualidades)
 */
router.get('/defaulters', async (req, res) => {
  try {
    const club_id = req.club_id || 'city-fc';
    const { anio = 2026 } = req.query;
    
    // Obtener jugadores
    const players = await sheetsClient.getAllRows('JUGADORES');
    const playersMap = {};
    players.forEach(p => {
      playersMap[p.cedula] = p;
    });
    
    // Obtener mensualidades en MORA
    let invoices = await sheetsClient.getAllRows('ESTADO_MENSUALIDADES');
    invoices = invoices.filter(inv => 
      String(inv.anio) === String(anio) && 
      inv.estado === 'MORA'
    );
    
    // Agrupar por jugador
    const defaultersMap = {};
    invoices.forEach(inv => {
      if (!defaultersMap[inv.cedula]) {
        defaultersMap[inv.cedula] = {
          cedula: inv.cedula,
          nombre_completo: '',
          celular: '',
          email: '',
          tipo_descuento: '',
          total_deuda: 0,
          meses_en_mora: [],
        };
      }
      
      const player = playersMap[inv.cedula];
      if (player) {
        defaultersMap[inv.cedula].nombre_completo = `${player['nombre(s)'] || ''} ${player['apellido(s)'] || ''}`.trim();
        defaultersMap[inv.cedula].celular = player.celular;
        defaultersMap[inv.cedula].email = player.email;
        defaultersMap[inv.cedula].tipo_descuento = player.tipo_descuento || 'NA';
      }
      
      const deuda = parseFloat(inv.saldo_pendiente) || 0;
      defaultersMap[inv.cedula].total_deuda += deuda;
      defaultersMap[inv.cedula].meses_en_mora.push({
        mes: inv.mes,
        numero_mes: inv.numero_mes,
        deuda: deuda,
      });
    });
    
    // Convertir a array y ordenar por deuda (descendente)
    const defaulters = Object.values(defaultersMap).sort((a, b) => b.total_deuda - a.total_deuda);
    
    res.json({
      success: true,
      club_id,
      anio,
      total_morosos: defaulters.length,
      deuda_total: defaulters.reduce((sum, d) => sum + d.total_deuda, 0),
      deuda_promedio: defaulters.length > 0 
        ? Math.round(defaulters.reduce((sum, d) => sum + d.total_deuda, 0) / defaulters.length)
        : 0,
      data: defaulters,
    });
  } catch (error) {
    console.error('Error in GET /reports/defaulters:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching defaulters',
      message: error.message,
    });
  }
});

/**
 * Helpers
 */
function getMesNombre(numero) {
  const meses = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
    5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
    9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
  };
  return meses[numero] || 'Desconocido';
}

function evaluarSalud(porcentajeRecaudacion) {
  if (porcentajeRecaudacion >= 80) return 'EXCELENTE';
  if (porcentajeRecaudacion >= 60) return 'BUENA';
  if (porcentajeRecaudacion >= 40) return 'REGULAR';
  return 'CRITICA';
}

module.exports = router;
