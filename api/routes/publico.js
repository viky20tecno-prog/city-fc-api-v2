const express = require('express');
const db = require('../services/db');
const router = express.Router();

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mapEstado(estado) {
  switch (estado) {
    case 'AL_DIA':      return 'pagado';
    case 'MORA':        return 'vencido';
    case 'PARCIAL':     return 'parcial';
    case 'POR_VALIDAR': return 'por_validar';
    case 'PENDIENTE':   return 'pendiente';
    default:            return 'pendiente';
  }
}

function calcSaldo(m) {
  const oficial  = parseFloat(m.valor_oficial) || 0;
  const pagado   = parseFloat(m.valor_pagado)  || 0;
  if (m.estado === 'AL_DIA') return 0;
  if (m.estado === 'PARCIAL' || m.estado === 'POR_VALIDAR') return Math.max(0, oficial - pagado);
  return oficial;
}

// GET /api/publico/atleta/:clubSlug/:cedula
router.get('/atleta/:clubSlug/:cedula', async (req, res) => {
  try {
    const { clubSlug, cedula } = req.params;

    const club = await db.getClubBySlug(clubSlug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const jugador = await db.getPlayerByCedula(club.id, cedula);
    if (!jugador) return res.status(404).json({ success: false, error: 'Atleta no encontrado' });

    const anioActual = new Date().getFullYear();
    const mensualidades = await db.getMensualidades(club.id, cedula);

    const resumen = mensualidades
      .filter(m => m.anio >= anioActual - 1)
      .map(m => ({
        mes:           m.mes,
        numero_mes:    parseInt(m.numero_mes) || 0,
        anio:          m.anio,
        estado:        mapEstado(m.estado),
        valor_oficial: parseFloat(m.valor_oficial) || 0,
        valor_pagado:  parseFloat(m.valor_pagado)  || 0,
        saldo:         parseFloat(m.saldo_pendiente) || calcSaldo(m),
        fecha_pago:    m.fecha_pago || null,
      }))
      .sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.numero_mes - b.numero_mes);

    const pendientes      = resumen.filter(m => m.estado !== 'pagado');
    const saldo_pendiente = pendientes.reduce((s, m) => s + m.saldo, 0);
    const total_pagado    = resumen.reduce((s, m) => s + m.valor_pagado, 0);

    res.json({
      success: true,
      club: {
        nombre:    club.config?.nombre || clubSlug,
        subtitulo: club.config?.subtitulo || '',
        color:     club.config?.color || '#00AAFF',
        logo_url:  club.config?.logo_url || null,
        slug:      clubSlug,
      },
      atleta: {
        nombre:    jugador.nombre,
        apellidos: jugador.apellidos || '',
        cedula:    jugador.cedula,
        categoria: jugador.categoria || '',
        equipo:    jugador.equipo || '',
        posicion:  jugador.posicion || '',
        numero:    jugador.numero || '',
      },
      mensualidades:    resumen,
      saldo_pendiente,
      total_pagado,
      meses_pendientes: pendientes.length,
    });
  } catch (error) {
    console.error('Error en GET /publico/atleta:', error);
    res.status(500).json({ success: false, error: 'Error al consultar datos del atleta' });
  }
});

module.exports = router;
