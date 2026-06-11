const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../services/db');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Enviar mensaje de vuelta al usuario vía Meta API ─────────────────────────
async function sendWA(to, text) {
  const url = `https://graph.facebook.com/v20.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    }),
  });
  const data = await res.json();
  if (!res.ok) console.error('[wa-agent] sendWA error:', res.status, JSON.stringify(data));
  else console.log('[wa-agent] sendWA ok:', JSON.stringify(data));
  return data;
}

// ── Herramientas del agente ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'buscar_jugador',
    description: 'Busca un jugador por su número de celular en todos los clubes. Retorna nombre, cédula, club, categoría y equipo.',
    input_schema: {
      type: 'object',
      properties: {
        celular: { type: 'string', description: 'Número de celular, ej: 3001234567' },
      },
      required: ['celular'],
    },
  },
  {
    name: 'consultar_pagos',
    description: 'Consulta el estado de mensualidades del año actual de un jugador.',
    input_schema: {
      type: 'object',
      properties: {
        club_id: { type: 'string', description: 'UUID del club' },
        cedula:  { type: 'string' },
      },
      required: ['club_id', 'cedula'],
    },
  },
  {
    name: 'consultar_calendario',
    description: 'Obtiene los próximos entrenamientos y eventos del club, opcionalmente filtrados por equipo.',
    input_schema: {
      type: 'object',
      properties: {
        club_slug: { type: 'string' },
        equipo:    { type: 'string', description: 'Nombre del equipo para filtrar (opcional)' },
      },
      required: ['club_slug'],
    },
  },
  {
    name: 'consultar_partidos',
    description: 'Obtiene los próximos partidos del club.',
    input_schema: {
      type: 'object',
      properties: {
        club_id: { type: 'string', description: 'UUID del club' },
      },
      required: ['club_id'],
    },
  },
  {
    name: 'consultar_asistencia',
    description: 'Consulta el historial de asistencia del jugador a entrenamientos y partidos en el club actual.',
    input_schema: {
      type: 'object',
      properties: {
        club_id: { type: 'string', description: 'UUID del club' },
        cedula:  { type: 'string', description: 'Cédula del jugador' },
      },
      required: ['club_id', 'cedula'],
    },
  },
  {
    name: 'info_zensports',
    description: 'Retorna información sobre ZenSports: qué es, planes, precios y cómo registrarse. Usar cuando alguien pregunte por el producto o quiera registrar su club.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ── Ejecutar herramienta ─────────────────────────────────────────────────────
async function runTool(name, input) {
  try {
    if (name === 'buscar_jugador') {
      const jugador = await db.getPlayerByCelularGlobal(input.celular);
      if (!jugador) return { encontrado: false };
      return {
        encontrado:  true,
        nombre:      `${jugador.nombre} ${jugador.apellidos}`.trim(),
        cedula:      jugador.cedula,
        club_id:     jugador.club_id,
        club_slug:   jugador.clubs?.slug,
        club_nombre: jugador.clubs?.name,
        categoria:   jugador.categoria,
        equipo:      jugador.equipo,
        posicion:    jugador.posicion,
      };
    }

    if (name === 'consultar_pagos') {
      const anio = new Date().getFullYear();
      const mensualidades = await db.getMensualidades(input.club_id, input.cedula);
      const del_anio = mensualidades
        .filter(m => String(m.anio) === String(anio))
        .sort((a, b) => (a.numero_mes || 0) - (b.numero_mes || 0));
      const pendientes = del_anio.filter(m => m.estado !== 'AL_DIA');
      const al_dia     = del_anio.filter(m => m.estado === 'AL_DIA');
      const total_deuda = pendientes.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
      return { anio, al_dia: al_dia.length, pendientes: pendientes.length, total_deuda,
               detalle: del_anio.map(m => ({ mes: m.mes, estado: m.estado, saldo: m.saldo_pendiente })) };
    }

    if (name === 'consultar_calendario') {
      const club = await db.getClubBySlug(input.club_slug);
      if (!club) return { eventos: [] };
      const hoy   = new Date().toISOString().split('T')[0];
      const hasta = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
      const eventos = await db.getCalendario(club.id, hoy, hasta);
      const filtrados = input.equipo
        ? eventos.filter(e => !e.equipo || e.equipo.toUpperCase().includes(input.equipo.toUpperCase()))
        : eventos;
      return { eventos: filtrados.slice(0, 8).map(e => ({
        tipo:   e.tipo,
        titulo: e.titulo,
        fecha:  e.fecha_inicio?.split('T')[0],
        hora:   e.fecha_inicio?.split('T')[1]?.slice(0,5),
        lugar:  e.lugar,
        equipo: e.equipo,
      })) };
    }

    if (name === 'consultar_partidos') {
      const partidos = await db.getPartidos(input.club_id);
      const proximos = partidos
        .filter(p => new Date(p.fecha) >= new Date())
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
        .slice(0, 5);
      return { partidos: proximos.map(p => ({
        rival: p.rival, fecha: p.fecha?.split('T')[0],
        hora:  p.fecha?.split('T')[1]?.slice(0,5),
        lugar: p.lugar, categoria: p.categoria,
      })) };
    }

    if (name === 'consultar_asistencia') {
      const registros = await db.getAsistenciaJugador(input.club_id, input.cedula);
      const asistio    = registros.filter(r => r.estado === 'PRESENTE').length;
      const ausente    = registros.filter(r => r.estado === 'AUSENTE').length;
      const total      = registros.length;
      const porcentaje = total > 0 ? Math.round((asistio / total) * 100) : 0;
      return {
        total_eventos: total,
        asistencias:   asistio,
        ausencias:     ausente,
        porcentaje_asistencia: porcentaje,
        ultimos: registros.slice(0, 8).map(r => ({
          tipo:   r.calendario?.tipo,
          titulo: r.calendario?.titulo,
          fecha:  r.calendario?.fecha_inicio?.split('T')[0],
          estado: r.estado,
        })),
      };
    }

    if (name === 'info_zensports') {
      return {
        descripcion: 'ZenSports es el sistema operativo para clubes deportivos. Gestión de jugadores, cobros automáticos, calendario, arbitraje y más.',
        planes: [
          { nombre: 'FREE',       precio: '$0/mes',         jugadores: 'hasta 30',    features: 'Dashboard + jugadores + asistencia' },
          { nombre: 'Starter',    precio: '$149.000/mes',   jugadores: 'hasta 80',    features: 'Todo FREE + cobros WA + carnet digital' },
          { nombre: 'Pro',        precio: '$399.000/mes',   jugadores: 'hasta 200',   features: 'Todo Starter + torneos + arbitraje + finanzas' },
          { nombre: 'Scale',      precio: '$799.000/mes',   jugadores: 'ilimitados',  features: 'Todo incluido + múltiples admins + soporte prioritario' },
        ],
        registro: 'Regístrate gratis en zensports.zenpra.ai — 5 días de prueba completa.',
        contacto: 'WhatsApp Zenpra: +57 3204409015',
      };
    }

    return { error: 'Herramienta no encontrada' };
  } catch (err) {
    console.error(`[wa-agent] tool ${name} error:`, err.message);
    return { error: err.message };
  }
}

// ── Sistema prompt ───────────────────────────────────────────────────────────
const SYSTEM = `Eres Zen ⚽, el asistente virtual de ZenSports. Ayudas a jugadores, padres de familia y administradores de clubes deportivos colombianos.

ZenSports es la plataforma de gestión para clubes deportivos: controla jugadores, cobros, calendario, partidos, asistencia y más.

FLUJO DE ATENCIÓN:
1. Si es la primera vez que escribe o dice "hola"/"menu"/"inicio" → preséntate y muestra el menú de opciones
2. Si pregunta por pagos, asistencia, calendario o partidos → primero usa buscar_jugador con su número de celular para identificarlo, luego consulta lo que necesite
3. Si pregunta qué es ZenSports o quiere registrar su club → usa info_zensports
4. Si no se puede identificar → pídele su cédula o el número de celular con el que se registró en el club

MENÚ DE BIENVENIDA (usar cuando corresponda):
---
👋 ¡Hola! Soy *Zen*, el asistente de ZenSports.

¿En qué te puedo ayudar?

1️⃣ Ver mis pagos
2️⃣ Ver calendario / entrenamientos
3️⃣ Ver próximos partidos
4️⃣ Ver mi asistencia
5️⃣ Información sobre ZenSports

Escribe el número de la opción o cuéntame en qué te puedo ayudar 😊
---

REGLAS:
- Responde SIEMPRE en español
- Sé amigable, cálido y conciso — como un asistente de confianza del club
- Usa emojis con moderación para dar calidez
- Nunca inventes datos — usa solo lo que retornan las herramientas
- Si no tienes acceso a un dato, dilo honestamente y sugiere contactar al administrador del club
- Formatea los números en pesos colombianos: $150.000, no 150000
- Cuando muestres fechas usa formato legible: "Sábado 15 de junio" no "2026-06-15"`;


const MAX_HISTORY = 10;

// ── Enviar mensaje vía Twilio sandbox ────────────────────────────────────────
async function sendTwilio(to, text) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const toWA  = to.startsWith('whatsapp:') ? to : `whatsapp:+${to}`;
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const res   = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: toWA, Body: text }).toString(),
  });
  const data = await res.json();
  if (!res.ok) console.error('[wa-agent] sendTwilio error:', res.status, JSON.stringify(data));
  else console.log('[wa-agent] sendTwilio ok:', data.sid);
  return data;
}

// ── Generar respuesta del agente (compartida entre Meta y Twilio) ─────────────
async function generateReply(from, text) {
  const session    = await db.getWaSession(from);
  const history    = session?.messages || [];
  const jugador    = session?.jugador  || null;

  let system = SYSTEM;
  if (jugador) {
    system += `\n\nCONTEXTO: El usuario ya fue identificado. Sus datos son:\n${JSON.stringify(jugador)}`;
  }

  const messages   = [...history, { role: 'user', content: text }];
  let reply        = null;
  let nuevoJugador = jugador;

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      tools:      TOOLS,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      reply = response.content.find(b => b.type === 'text')?.text;
      if (reply) messages.push({ role: 'assistant', content: reply });
      break;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await runTool(block.name, block.input);
        if (block.name === 'buscar_jugador' && result.encontrado) nuevoJugador = result;
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
    break;
  }

  const historialTexto = messages
    .filter(m => typeof m.content === 'string')
    .slice(-MAX_HISTORY);
  await db.upsertWaSession(from, { jugador: nuevoJugador, messages: historialTexto });

  return reply;
}

// ── Webhook verification (GET) ───────────────────────────────────────────────
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('[wa-agent] Webhook verificado');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

// ── Webhook Meta (POST) ──────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.status(200).json({ status: 'ok' });

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return res.status(200).json({ status: 'ok' });

    const from = message.from;
    const text = message.text.body;
    console.log(`[wa-agent] Meta mensaje de ${from}: ${text}`);

    const reply = await generateReply(from, text);
    if (reply) await sendWA(from, reply);
    console.log(`[wa-agent] Procesado OK para ${from}`);
  } catch (err) {
    console.error('[wa-agent] error:', err.message);
  }

  res.status(200).json({ status: 'ok' });
});

// ── Enviar mensaje vía WAHA ──────────────────────────────────────────────────
async function sendWAHA(to, text) {
  const wahaUrl = process.env.WAHA_URL;
  const session = process.env.WAHA_SESSION || 'default';
  const apiKey  = process.env.WAHA_API_KEY;
  if (!wahaUrl) { console.error('[wa-agent] WAHA_URL no configurado'); return; }
  const chatId = to.includes('@') ? to : `${to}@c.us`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  const res = await fetch(`${wahaUrl}/api/sendText`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ chatId, text, session }),
  });
  const data = await res.json();
  if (!res.ok) console.error('[wa-agent] sendWAHA error:', res.status, JSON.stringify(data));
  else console.log('[wa-agent] sendWAHA ok:', data.id || 'sent');
  return data;
}

// ── Webhook WAHA (POST) ──────────────────────────────────────────────────────
router.post('/waha', async (req, res) => {
  try {
    const { event, payload } = req.body;
    if (event !== 'message' || !payload?.body || payload?.fromMe) {
      return res.status(200).json({ status: 'ignored' });
    }
    const from = payload.from.replace('@c.us', '').replace('@s.whatsapp.net', '');
    const text = payload.body;
    console.log(`[wa-agent] WAHA mensaje de ${from}: ${text}`);

    const reply = await generateReply(from, text);
    if (reply) await sendWAHA(from, reply);
    console.log(`[wa-agent] WAHA procesado OK para ${from}`);
  } catch (err) {
    console.error('[wa-agent] WAHA error:', err.message);
  }
  res.status(200).json({ status: 'ok' });
});

// ── Webhook Twilio sandbox (POST) ────────────────────────────────────────────
router.post('/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const from = req.body.From?.replace('whatsapp:+', '') || '';
    const text = req.body.Body || '';
    console.log(`[wa-agent] Twilio mensaje de ${from}: ${text}`);

    const reply = await generateReply(from, text);
    console.log(`[wa-agent] Twilio procesado OK para ${from}`);

    // Responder con TwiML
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response>${reply ? `<Message>${reply}</Message>` : ''}</Response>`);
  } catch (err) {
    console.error('[wa-agent] Twilio error:', err.message);
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

module.exports = router;
