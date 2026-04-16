const express = require('express');
const db = require('../services/db');
const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const { mes, anio = 2026 } = req.query;
    const currentDate     = new Date();
    const currentMonth    = mes ? parseInt(mes) : (currentDate.getMonth() + 1);
    const pastGracePeriod = currentDate.getDate() > 7;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const [jugadores, allInvoices, uniforms, tournaments, suspensiones] = await Promise.all([
      db.getPlayers(club.id),
      db.getMensualidades(club.id),
      db.getUniformes(club.id),
      db.getTorneos(club.id),
      db.getSuspensiones(club.id),
    ]);

    // Suspensiones excluyen meses de mora independientemente de si están activas o canceladas
    // (el jugador no estuvo presente — hecho histórico inmutable)
    const isSuspendido = (cedula, mesNum, anioCheck) =>
      suspensiones.some(s =>
        s.cedula === String(cedula) &&
        parseInt(s.anio) === parseInt(anioCheck) &&
        s.mes_inicio <= mesNum &&
        mesNum <= s.mes_fin
      );

    // Filtrar mensualidades del año
    const invoicesAnio = allInvoices.filter(inv => String(inv.anio) === String(anio));
    const currentMonthInvoices = invoicesAnio.filter(inv => String(inv.numero_mes) === String(currentMonth));

    // Stats mensualidades mes actual
    const invoiceStats = {
      total_jugadores:        jugadores.length,
      total_mensualidades:    currentMonthInvoices.length,
      valor_oficial_mes:      0,
      valor_pagado_mes:       0,
      valor_pendiente_mes:    0,
      porcentaje_recaudacion: 0,
      por_estado: { AL_DIA: 0, PARCIAL: 0, PENDIENTE: 0, MORA: 0 },
      'morosos_cédulas': [],
    };

    currentMonthInvoices.forEach(inv => {
      invoiceStats.valor_oficial_mes   += parseFloat(inv.valor_oficial)   || 0;
      invoiceStats.valor_pagado_mes    += parseFloat(inv.valor_pagado)     || 0;
      invoiceStats.valor_pendiente_mes += parseFloat(inv.saldo_pendiente)  || 0;
      // Si ya pasó el día de gracia, PENDIENTE se cuenta como MORA
      const estadoReal = (inv.estado === 'PENDIENTE' && pastGracePeriod) ? 'MORA' : inv.estado;
      invoiceStats.por_estado[estadoReal] = (invoiceStats.por_estado[estadoReal] || 0) + 1;
    });

    if (invoiceStats.valor_oficial_mes > 0) {
      invoiceStats.porcentaje_recaudacion = Math.round(
        (invoiceStats.valor_pagado_mes / invoiceStats.valor_oficial_mes) * 100
      );
    }

    // Lógica morosos
    const morososMap = {};
    invoicesAnio.forEach(inv => {
      const mesNum = parseInt(inv.numero_mes);
      const saldo  = parseFloat(inv.saldo_pendiente) || 0;
      if (inv.estado === 'AL_DIA' || saldo <= 0) return;
      if (isSuspendido(inv.cedula, mesNum, anio)) return;

      const esMesAnterior = mesNum < currentMonth;
      const esMesActual   = mesNum === currentMonth;
      if (!esMesAnterior && !(esMesActual && pastGracePeriod)) return;

      if (!morososMap[inv.cedula]) {
        morososMap[inv.cedula] = { cedula: inv.cedula, saldo_pendiente: 0, meses_en_mora: [] };
      }
      morososMap[inv.cedula].saldo_pendiente += saldo;
      morososMap[inv.cedula].meses_en_mora.push({ mes: inv.mes, numero_mes: mesNum, estado: inv.estado, saldo });
    });
    invoiceStats['morosos_cédulas'] = Object.values(morososMap);

    // Stats uniformes
    const uniformStats = { total_uniformes: uniforms.length, valor_oficial: 0, valor_pagado: 0, valor_pendiente: 0, al_dia: 0, parcial: 0, pendiente: 0 };
    uniforms.forEach(u => {
      const oficial = parseFloat(u.valor_oficial) || 0;
      const pagado  = parseFloat(u.valor_pagado)  || 0;
      uniformStats.valor_oficial   += oficial;
      uniformStats.valor_pagado    += pagado;
      uniformStats.valor_pendiente += (oficial - pagado);
      if (u.estado === 'AL_DIA')      uniformStats.al_dia++;
      else if (u.estado === 'PARCIAL') uniformStats.parcial++;
      else                             uniformStats.pendiente++;
    });

    // Stats torneos
    const tournamentStats = { total_inscripciones: tournaments.length, valor_oficial: 0, valor_pagado: 0, valor_pendiente: 0, al_dia: 0, parcial: 0, pendiente: 0 };
    tournaments.forEach(t => {
      const oficial = parseFloat(t.valor_oficial) || 0;
      const pagado  = parseFloat(t.valor_pagado)  || 0;
      tournamentStats.valor_oficial   += oficial;
      tournamentStats.valor_pagado    += pagado;
      tournamentStats.valor_pendiente += (oficial - pagado);
      if (t.estado === 'AL_DIA')      tournamentStats.al_dia++;
      else if (t.estado === 'PARCIAL') tournamentStats.parcial++;
      else                             tournamentStats.pendiente++;
    });

    const totalStats = {
      valor_oficial_total:   invoiceStats.valor_oficial_mes + uniformStats.valor_oficial + tournamentStats.valor_oficial,
      valor_pagado_total:    invoiceStats.valor_pagado_mes  + uniformStats.valor_pagado  + tournamentStats.valor_pagado,
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
      club_id: req.club_id,
      periodo: { mes: currentMonth, anio, mes_nombre: getMesNombre(currentMonth) },
      jugadores: {
        total_activos:   jugadores.length,
        total_inactivos: 0,
        total_general:   jugadores.length,
      },
      mensualidades:      invoiceStats,
      uniformes:          uniformStats,
      torneos:            tournamentStats,
      resumen_financiero: totalStats,
      indicadores: {
        tasa_mora:          currentMonthInvoices.length > 0
          ? Math.round((invoiceStats.por_estado.MORA / currentMonthInvoices.length) * 100) : 0,
        jugadores_al_dia:   invoiceStats.por_estado.AL_DIA,
        jugadores_en_mora:  invoiceStats['morosos_cédulas'].length,
        salud_general:      evaluarSalud(invoiceStats.porcentaje_recaudacion),
      },
    });
  } catch (error) {
    console.error('Error in GET /reports/summary:', error);
    res.status(500).json({ success: false, error: 'Error fetching summary', message: error.message });
  }
});

router.get('/defaulters', async (req, res) => {
  try {
    const { anio = 2026 } = req.query;
    const currentDate     = new Date();
    const currentMonth    = currentDate.getMonth() + 1;
    const pastGracePeriod = currentDate.getDate() > 7;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const [jugadores, allInvoices, suspensiones] = await Promise.all([
      db.getPlayers(club.id),
      db.getMensualidades(club.id),
      db.getSuspensiones(club.id),
    ]);

    const isSuspendido = (cedula, mesNum) =>
      suspensiones.some(s =>
        s.cedula === String(cedula) &&
        parseInt(s.anio) === parseInt(anio) &&
        s.mes_inicio <= mesNum &&
        mesNum <= s.mes_fin
      );

    const playersMap = {};
    jugadores.forEach(p => { playersMap[p.cedula] = p; });

    const invoices = allInvoices.filter(inv => {
      if (String(inv.anio) !== String(anio)) return false;
      if (inv.estado === 'AL_DIA') return false;
      const mesNum = parseInt(inv.numero_mes);
      if (isSuspendido(inv.cedula, mesNum)) return false;
      if (mesNum < currentMonth) return true;
      if (mesNum === currentMonth && pastGracePeriod) return true;
      return false;
    });

    const defaultersMap = {};
    invoices.forEach(inv => {
      if (!defaultersMap[inv.cedula]) {
        defaultersMap[inv.cedula] = {
          cedula: inv.cedula, nombre_completo: '', celular: '',
          total_deuda: 0, meses_en_mora: [],
        };
      }
      const player = playersMap[inv.cedula];
      if (player) {
        defaultersMap[inv.cedula].nombre_completo = `${player.nombre || ''} ${player.apellidos || ''}`.trim();
        defaultersMap[inv.cedula].celular = player.celular;
      }
      const deuda = parseFloat(inv.saldo_pendiente) || 0;
      defaultersMap[inv.cedula].total_deuda += deuda;
      defaultersMap[inv.cedula].meses_en_mora.push({ mes: inv.mes, numero_mes: inv.numero_mes, deuda, estado: inv.estado });
    });

    const defaulters = Object.values(defaultersMap).sort((a, b) => b.total_deuda - a.total_deuda);

    res.json({
      success: true,
      club_id: req.club_id,
      anio,
      total_morosos:  defaulters.length,
      deuda_total:    defaulters.reduce((s, d) => s + d.total_deuda, 0),
      deuda_promedio: defaulters.length > 0
        ? Math.round(defaulters.reduce((s, d) => s + d.total_deuda, 0) / defaulters.length) : 0,
      data: defaulters,
    });
  } catch (error) {
    console.error('Error in GET /reports/defaulters:', error);
    res.status(500).json({ success: false, error: 'Error fetching defaulters', message: error.message });
  }
});

function getMesNombre(numero) {
  const meses = { 1:'Enero',2:'Febrero',3:'Marzo',4:'Abril',5:'Mayo',6:'Junio',7:'Julio',8:'Agosto',9:'Septiembre',10:'Octubre',11:'Noviembre',12:'Diciembre' };
  return meses[numero] || 'Desconocido';
}

function evaluarSalud(pct) {
  if (pct >= 80) return 'EXCELENTE';
  if (pct >= 60) return 'BUENA';
  if (pct >= 40) return 'REGULAR';
  return 'CRITICA';
}

module.exports = router;
