const express = require('express');
const db = require('../services/db');
const router = express.Router();

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

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
        mes: m.mes,
        mes_nombre: MESES[(m.mes || 1) - 1] || '',
        anio: m.anio,
        estado: m.estado,
        valor: m.valor || 0,
        fecha_pago: m.fecha_pago || null,
      }))
      .sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes);

    const pendientes = resumen.filter(m => m.estado !== 'pagado');
    const saldo_pendiente = pendientes.reduce((s, m) => s + (m.valor || 0), 0);

    res.json({
      success: true,
      club: {
        nombre: club.config?.nombre || clubSlug,
        subtitulo: club.config?.subtitulo || '',
        color: club.config?.color || '#00AAFF',
        logo_url: club.config?.logo_url || null,
        slug: clubSlug,
      },
      atleta: {
        nombre: jugador.nombre,
        apellidos: jugador.apellidos || '',
        cedula: jugador.cedula,
        categoria: jugador.categoria || '',
        equipo: jugador.equipo || '',
        posicion: jugador.posicion || '',
        numero: jugador.numero || '',
      },
      mensualidades: resumen,
      saldo_pendiente,
      meses_pendientes: pendientes.length,
    });
  } catch (error) {
    console.error('Error en GET /publico/atleta:', error);
    res.status(500).json({ success: false, error: 'Error al consultar datos del atleta' });
  }
});

module.exports = router;
