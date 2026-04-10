const express = require('express');
const SheetsClient = require('../services/sheets');

const router = express.Router();
const sheetsClient = new SheetsClient();

/**
 * 🟢 CORS GLOBAL PARA ESTE ROUTER
 */
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

/**
 * GET /api/players?club_id=city-fc
 * Lista todos los jugadores activos del club
 */
router.get('/', async (req, res) => {
  try {
    console.log('🔥 /players endpoint hit');
    console.log('club_id:', req.query.club_id);

    const data = await sheetsClient.getAllRows('JUGADORES');

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('❌ PLAYERS ERROR:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/players/:cedula?club_id=city-fc
 * Detalle de un jugador específico
 */
router.get('/:cedula', async (req, res) => {
  try {
    const { cedula } = req.params;
    const club_id = req.query.club_id || 'city-fc';

    const player = await sheetsClient.searchRow('JUGADORES', 'cedula', cedula);

    if (!player) {
      return res.status(404).json({
        success: false,
        error: 'Player not found',
        cedula,
      });
    }

    const invoices = await sheetsClient.searchRows('ESTADO_MENSUALIDADES', 'cedula', cedula);
    const uniforms = await sheetsClient.searchRows('ESTADO_UNIFORMES', 'cedula', cedula);
    const tournaments = await sheetsClient.searchRows('ESTADO_TORNEOS', 'cedula', cedula);

    const nombre = player['nombre(s)'] || player.nombre || player.Nombre || player['Nombre(s)'] || '';
    const apellido = player['apellido(s)'] || player.apellido || player.Apellido || player['Apellido(s)'] || '';

    res.json({
      success: true,
      club_id,
      player: {
        cedula: player.cedula,
        nombre_completo: `${nombre} ${apellido}`.trim(),
        nombre,
        apellido,
        celular: player.celular,
        email: player.email,
        fecha_nacimiento: player.fecha_nacimiento,
        municipio: player.municipio,
        tipo_sangre: player.tipo_sangre || '',
        eps: player.eps || '',
        estatura: player.estatura || '',
        peso: player.peso || '',
        direccion: player.direccion,
        barrio: player.barrio,
        contacto_emergencia: player.contacto_emergencia,
        celular_contacto: player.celular_contacto,
        tipo_descuento: player.tipo_descuento || 'NA',
        mensualidad_2026: player.mensualidad_2026,
        activo: player.activo,
      },
      financial_status: {
        invoices: invoices.length,
        uniforms: uniforms.length,
        tournaments: tournaments.length,
        total_debt: calculateTotalDebt(invoices, uniforms, tournaments),
      },
      invoices: invoices.map(inv => ({
        anio: inv.anio,
        mes: inv.mes,
        valor_oficial: inv.valor_oficial,
        valor_pagado: inv.valor_pagado,
        saldo_pendiente: inv.saldo_pendiente,
        estado: inv.estado,
      })),
      uniforms: uniforms.map(unif => ({
        anio: unif.anio,
        tipo_uniforme: unif.tipo_uniforme,
        valor_oficial: unif.valor_oficial,
        valor_pagado: unif.valor_pagado,
        saldo_pendiente: unif.saldo_pendiente,
        estado: unif.estado,
      })),
      tournaments: tournaments.map(torn => ({
        anio: torn.anio,
        torneo: torn.torneo,
        valor_oficial: torn.valor_oficial,
        valor_pagado: torn.valor_pagado,
        saldo_pendiente: torn.saldo_pendiente,
        estado: torn.estado,
      })),
    });

  } catch (error) {
    console.error('Error in GET /players/:cedula:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching player details',
      message: error.message,
    });
  }
});

// Helper: calcular deuda total
function calculateTotalDebt(invoices, uniforms, tournaments) {
  const debtInvoices = invoices.reduce((sum, inv) => sum + (parseFloat(inv.saldo_pendiente) || 0), 0);
  const debtUniforms = uniforms.reduce((sum, unif) => sum + (parseFloat(unif.saldo_pendiente) || 0), 0);
  const debtTournaments = tournaments.reduce((sum, torn) => sum + (parseFloat(torn.saldo_pendiente) || 0), 0);
  return debtInvoices + debtUniforms + debtTournaments;
}

module.exports = router;
