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
  if (!res.ok) console.error('[wa-agent] sendWA error:', JSON.stringify(data));
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

    if (name === 'info_zensports') {
      return {
        descripcion: 'ZenSports es el sistema operativo para clubes deportivos. Gestión de jugadores, cobros automáticos, calendario, arbitraje y más.',
        planes: [
          { nombre: 'FREE',       precio: '$0/mes',       jugadores: 'hasta 20',    features: 'Jugadores, pagos básicos' },
          { nombre: 'Starter',    precio: '$149.000/mes',  jugadores: 'hasta 50',    features: 'Todo FREE + WhatsApp cobros' },
          { nombre: 'Pro',        precio: '$399.000/mes',  jugadores: 'hasta 150',   features: 'Todo Starter + arbitraje + nómina' },
          { nombre: 'Club',       precio: '$799.000/mes',  jugadores: 'ilimitados',  features: 'Todo incluido + soporte prioritario' },
        ],
        registro: 'Regístrate gratis en zensports.vercel.app — 5 días de prueba gratis en plan Pro.',
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
const SYSTEM = `Eres Zen, el asistente virtual de Zenpra. Ayudas a jugadores, padres de familia y clubes deportivos.

Productos de Zenpra:
- ZenSports: plataforma SaaS para gestión de clubes deportivos
- ZCup: plataforma de torneos deportivos (próximamente)

Cuando alguien te escriba:
1. Si pregunta por sus pagos, calendario o partidos → usa buscar_jugador con su número de celular, luego consulta lo que necesite
2. Si pregunta por ZenSports o quiere registrar su club → usa info_zensports
3. Si no se puede identificar → pídele su cédula o número registrado en el club

Reglas:
- Responde SIEMPRE en español
- Sé amigable, conciso y claro
- Usa emojis con moderación
- No inventes información — solo usa lo que retornan las herramientas
- Si no tienes acceso a un dato, dilo honestamente
- No respondas temas fuera del ámbito deportivo y de gestión de clubes`;

const MAX_HISTORY = 10; // mensajes a conservar por sesión

// ── Procesar mensaje con el agente ───────────────────────────────────────────
async function processMessage(from, text) {
  // Cargar sesión previa
  const session  = await db.getWaSession(from);
  const history  = session?.messages || [];
  const jugador  = session?.jugador  || null;

  // Construir system prompt enriquecido con contexto del jugador si ya fue identificado
  let system = SYSTEM;
  if (jugador) {
    system += `\n\nCONTEXTO: El usuario ya fue identificado. Sus datos son:\n${JSON.stringify(jugador)}`;
  }

  // Historial + mensaje nuevo
  const messages = [...history, { role: 'user', content: text }];

  let reply = null;
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
      if (reply) {
        messages.push({ role: 'assistant', content: reply });
      }
      break;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await runTool(block.name, block.input);
        // Si encontramos al jugador, guardarlo en sesión
        if (block.name === 'buscar_jugador' && result.encontrado) {
          nuevoJugador = result;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    break;
  }

  // Enviar respuesta
  if (reply) await sendWA(from, reply);

  // Guardar sesión — solo mensajes texto para no inflar el historial con tool calls
  const historialTexto = messages
    .filter(m => typeof m.content === 'string')
    .slice(-MAX_HISTORY);

  await db.upsertWaSession(from, { jugador: nuevoJugador, messages: historialTexto });
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

// ── Recibir mensajes (POST) ──────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.status(200).json({ status: 'ok' });

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return res.status(200).json({ status: 'ok' });

    const from = message.from;
    const text = message.text.body;
    console.log(`[wa-agent] Mensaje de ${from}: ${text}`);

    await processMessage(from, text);
    console.log(`[wa-agent] Procesado OK para ${from}`);
  } catch (err) {
    console.error('[wa-agent] error:', err.message);
  }

  res.status(200).json({ status: 'ok' });
});

module.exports = router;
