const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../services/db');

const router = express.Router();

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Rate limiting: máx 5 inscripciones por IP en 15 minutos
const inscripcionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Demasiadas solicitudes. Por favor intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
});

// POST /api/inscripcion
router.post('/', inscripcionLimiter, async (req, res) => {
  try {
    const {
      cedula, nombre, apellidos, tipo_id,
      celular, correo_electronico, instagram,
      lugar_de_nacimiento, fecha_nacimiento, tipo_sangre, eps,
      estatura, peso, direccion, municipio, barrio,
      familiar_emergencia, celular_contacto,
      tipo_descuento = 'NA',
      website = '',           // honeypot — bots lo rellenan, humanos no lo ven
    } = req.body;

    // Honeypot anti-spam: si viene relleno, es un bot
    if (website) {
      return res.status(200).json({ success: true, message: '¡Bienvenido a City FC! ⚽' });
    }

    if (!cedula || !nombre || !apellidos || !celular || !municipio || !familiar_emergencia || !celular_contacto) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
    }

    // Validaciones básicas de formato
    if (!/^\d{7,15}$/.test(String(cedula))) {
      return res.status(400).json({ success: false, error: 'Cédula inválida (7-15 dígitos)' });
    }
    if (!/^\d{6,15}$/.test(String(celular))) {
      return res.status(400).json({ success: false, error: 'Celular inválido (6-15 dígitos)' });
    }

    const clubSlug = req.query.club_id || req.body?.club_id || 'city-fc';
    const club = await db.getClubBySlug(clubSlug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const CUOTA   = parseFloat(club.config?.valor_mensualidad) || 65000;
    const TORNEOS = Array.isArray(club.config?.torneos_iniciales) ? club.config.torneos_iniciales : [];

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
      club_id:             club.id,
      cedula:              String(cedula),
      nombre,
      apellidos,
      tipo_id:             tipo_id             || null,
      celular:             String(celular),
      correo_electronico:  correo_electronico  || null,
      instagram:           instagram           || null,
      lugar_de_nacimiento: lugar_de_nacimiento || null,
      fecha_nacimiento:    fecha_nacimiento    || null,
      tipo_sangre:         tipo_sangre         || null,
      eps:                 eps                 || null,
      estatura:            estatura            ? parseFloat(estatura)  : null,
      peso:                peso                ? parseFloat(peso)      : null,
      municipio,
      barrio:              barrio              || null,
      direccion:           direccion           || null,
      familiar_emergencia: familiar_emergencia || null,
      celular_contacto:    celular_contacto    || null,
      activo:              true,
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

    // Crear torneos (solo si el club configuró torneos en el onboarding)
    if (TORNEOS.length > 0) {
      const torneos = TORNEOS.map(t => ({
        club_id:         club.id,
        player_id:       player.id,
        cedula:          String(cedula),
        nombre_torneo:   t.nombre,
        valor_oficial:   parseFloat(t.valor) || 0,
        valor_pagado:    0,
        saldo_pendiente: parseFloat(t.valor) || 0,
        estado:          'PENDIENTE',
      }));
      await db.bulkInsert('torneos', torneos);
    }

    res.json({
      success: true,
      message: `¡Bienvenido a ${club.config?.nombre || club.name}! ⚽`,
      data: { cedula, nombre: nombreCompleto, club_id: clubSlug },
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
