const express = require('express');
const db = require('../services/db');

const router = express.Router();

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const TORNEOS = [
  { nombre: 'Punto y Coma', valor: 80000 },
  { nombre: 'JBC (Fútbol 7)', valor: 50000 },
  { nombre: 'INDESA 2026 I', valor: 120000 },
  { nombre: 'INDER Envigado', valor: 100000 },
];
const CUOTA = 65000;

// POST /api/inscripcion
router.post('/', async (req, res) => {
  try {
    const {
      cedula, nombre, apellidos, tipo_id,
      celular, correo_electronico, instagram,
      lugar_de_nacimiento, fecha_nacimiento, tipo_sangre, eps,
      estatura, peso, direccion, municipio, barrio,
      familiar_emergencia, celular_contacto,
      tipo_descuento = 'NA',
    } = req.body;

    if (!cedula || !nombre || !apellidos || !celular || !municipio || !familiar_emergencia || !celular_contacto) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
    }

    // Obtener club
    const club = await db.getClubBySlug('city-fc');
    if (!club) return res.status(500).json({ success: false, error: 'Club no configurado' });

    // Verificar duplicado por cédula
    const existente = await db.getPlayerByCedula(club.id, cedula);
    if (existente) {
      return res.status(409).json({ success: false, error: 'Ya existe un jugador con esa cédula' });
    }

    const anioActual  = new Date().getFullYear();
    const mesActual   = new Date().getMonth() + 1;
    const nombreCompleto = `${nombre} ${apellidos}`.trim();

    // Crear jugador
    const player = await db.createPlayer({
      club_id:    club.id,
      cedula:     String(cedula),
      nombre,
      apellidos,
      celular:    String(celular),
      municipio,
      activo:     true,
    });

    // Crear 12 mensualidades
    const mensualidades = [];
    for (let mes = 1; mes <= 12; mes++) {
      const esPasado = mes < mesActual;
      const valor    = esPasado ? 0 : CUOTA;
      mensualidades.push({
        club_id:         club.id,
        player_id:       player.id,
        cedula:          String(cedula),
        anio:            anioActual,
        mes:             MESES[mes],
        numero_mes:      mes,
        valor_oficial:   valor,
        valor_pagado:    0,
        saldo_pendiente: valor,
        estado:          esPasado ? 'AL_DIA' : 'PENDIENTE',
      });
    }
    await db.bulkInsert('mensualidades', mensualidades);

    // Crear uniforme
    await db.bulkInsert('uniformes', [{
      club_id:         club.id,
      player_id:       player.id,
      cedula:          String(cedula),
      tipo_uniforme:   'General',
      valor_oficial:   90000,
      valor_pagado:    0,
      saldo_pendiente: 90000,
      estado:          'PENDIENTE',
    }]);

    // Crear torneos
    const torneos = TORNEOS.map(t => ({
      club_id:         club.id,
      player_id:       player.id,
      cedula:          String(cedula),
      nombre_torneo:   t.nombre,
      valor_oficial:   t.valor,
      valor_pagado:    0,
      saldo_pendiente: t.valor,
      estado:          'PENDIENTE',
    }));
    await db.bulkInsert('torneos', torneos);

    res.json({
      success: true,
      message: '¡Bienvenido a City FC! ⚽',
      data: { cedula, nombre: nombreCompleto, club_id: 'city-fc' },
    });

  } catch (error) {
    console.error('Error in POST /inscripcion:', error);
    res.status(500).json({ success: false, error: 'Error al inscribir jugador', message: error.message });
  }
});

// GET /api/inscripcion/verificar?cedula=XXX
router.get('/verificar', async (req, res) => {
  try {
    const { cedula } = req.query;
    if (!cedula) return res.status(400).json({ success: false, error: 'cedula requerida' });

    const club = await db.getClubBySlug('city-fc');
    if (!club) return res.status(500).json({ success: false, error: 'Club no configurado' });

    const jugador = await db.getPlayerByCedula(club.id, cedula);
    res.json({ success: true, existe: !!jugador });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
