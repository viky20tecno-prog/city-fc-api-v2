const express = require('express');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const db = require('../services/db');
const { MESES } = require('../services/meses');

const router = express.Router();

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
      categoria, equipo, categorias,
      deporte,
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

    const clubSlug = req.query.club_id || req.body?.club_id;
    if (!clubSlug) return res.status(400).json({ success: false, error: 'club_id requerido' });
    const club = await db.getClubBySlug(clubSlug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const CUOTA = parseFloat(club.config?.valor_mensualidad) || 65000;

    // Deporte: usa el enviado por el form; si no viene, toma el único deporte del club
    const deportesClub = db.getDeportesClub(club);
    const deporteJugador = deporte || (deportesClub.length === 1 ? deportesClub[0] : null);

    // Verificar duplicado por cédula
    const existente = await db.getPlayerByCedula(club.id, cedula);
    if (existente) {
      return res.status(409).json({ success: false, error: 'Ya existe un jugador con esa cédula' });
    }

    // Plan gratis: tope de 20 jugadores
    if (club.config?.plan === 'free') {
      const jugadoresActuales = await db.getPlayers(club.id);
      if (jugadoresActuales.length >= 20) {
        return res.status(403).json({ success: false, error: 'Tu plan gratis permite hasta 20 jugadores. Actualiza tu plan para inscribir más.' });
      }
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
      categoria:           categoria           || null,
      equipo:              equipo              || null,
      categorias:          Array.isArray(categorias) ? categorias
                           : (categoria ? [{ categoria, equipo: equipo || '' }] : []),
      deporte:             deporteJugador,
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
    try {
      await db.bulkInsert('mensualidades', mensualidades);
    } catch (mensError) {
      // No dejar un jugador huérfano sin mensualidades: revertir la creación
      await db.supabase.from('players').delete().eq('id', player.id);
      throw mensError;
    }

    // Enviar documentos de bienvenida por WhatsApp (fire-and-forget)
    const wahaSession = club.config?.waha_session;
    const wahaUrl     = process.env.WAHA_URL;
    if (wahaSession && wahaUrl && celular) {
      enviarDocumentosInscripcion({ club, celular: String(celular), session: wahaSession, wahaUrl }).catch(() => {});
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

    const clubSlug = req.query.club_id;
    if (!clubSlug) return res.status(400).json({ success: false, error: 'club_id requerido' });
    const club = await db.getClubBySlug(clubSlug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const jugador = await db.getPlayerByCedula(club.id, cedula);
    res.json({ success: true, existe: !!jugador });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function enviarDocumentosInscripcion({ club, celular, session, wahaUrl }) {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: docs } = await supabase
      .from('club_documents')
      .select('nombre, url, descripcion')
      .eq('club_id', club.id)
      .eq('enviar_al_inscribirse', true)
      .eq('activo', true)
      .order('orden', { ascending: true });

    if (!docs || docs.length === 0) return;

    const chatId  = `57${celular}@c.us`;
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WAHA_API_KEY) headers['X-Api-Key'] = process.env.WAHA_API_KEY;

    for (const doc of docs) {
      await fetch(`${wahaUrl}/api/sendFile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          chatId,
          file:    { url: doc.url, filename: `${doc.nombre}.pdf` },
          caption: doc.descripcion || doc.nombre,
          session,
        }),
      });
    }
  } catch (e) {
    console.error('[inscripcion] error enviando documentos WA:', e.message);
  }
}

module.exports = router;
