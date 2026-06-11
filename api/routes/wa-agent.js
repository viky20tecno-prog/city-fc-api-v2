const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../services/db');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Deduplicación: evita procesar el mismo mensaje dos veces (WAHA CORE dispara doble)
const processedIds = new Set();
function isDuplicate(id) {
  if (!id) return false;
  if (processedIds.has(id)) return true;
  processedIds.add(id);
  if (processedIds.size > 500) {
    const first = processedIds.values().next().value;
    processedIds.delete(first);
  }
  return false;
}

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
    name: 'consultar_pagos_club',
    description: 'SOLO ADMIN. Resumen de pagos del club: total jugadores, cuántos al día, cuántos pendientes y deuda total.',
    input_schema: {
      type: 'object',
      properties: { club_id: { type: 'string' } },
      required: ['club_id'],
    },
  },
  {
    name: 'consultar_morosos',
    description: 'SOLO ADMIN. Lista de jugadores con pagos pendientes, ordenados por deuda mayor.',
    input_schema: {
      type: 'object',
      properties: { club_id: { type: 'string' } },
      required: ['club_id'],
    },
  },
  {
    name: 'enviar_recordatorio_pago',
    description: 'SOLO ADMIN. Envía un mensaje de WhatsApp a todos los jugadores con deuda pendiente.',
    input_schema: {
      type: 'object',
      properties: { club_id: { type: 'string' }, club_nombre: { type: 'string' } },
      required: ['club_id', 'club_nombre'],
    },
  },
  {
    name: 'consultar_asistencia_hoy',
    description: 'SOLO ADMIN. Resumen de asistencia del evento de hoy en el club.',
    input_schema: {
      type: 'object',
      properties: { club_id: { type: 'string' } },
      required: ['club_id'],
    },
  },
  {
    name: 'registrar_lead',
    description: 'Guarda los datos de un club interesado en ZenSports y genera el link de registro prellenado.',
    input_schema: {
      type: 'object',
      properties: {
        nombre_club:  { type: 'string' },
        deporte:      { type: 'string' },
        ciudad:       { type: 'string' },
        num_jugadores: { type: 'string' },
        nombre_admin: { type: 'string' },
        email:        { type: 'string' },
        celular:      { type: 'string' },
      },
      required: ['nombre_club', 'nombre_admin', 'celular'],
    },
  },
  {
    name: 'info_zensports',
    description: 'Retorna información sobre ZenSports: qué es, planes, precios y cómo registrarse.',
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
      const { data: clubData } = await db.supabase.from('clubs').select('config').eq('id', input.club_id).single();
      const qr_pago_url    = clubData?.config?.qr_pago_url    || null;
      const llave_pago     = clubData?.config?.llave_pago     || null;
      const cuenta_bancaria = clubData?.config?.cuenta_bancaria || null;
      return { anio, al_dia: al_dia.length, pendientes: pendientes.length, total_deuda,
               qr_pago_url, llave_pago, cuenta_bancaria,
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

    if (name === 'consultar_pagos_club') {
      const anio = new Date().getFullYear();
      const supabase = db.supabase;
      const { data: players } = await supabase
        .from('players')
        .select('cedula, nombre, apellidos')
        .eq('club_id', input.club_id)
        .eq('activo', true);
      if (!players?.length) return { total: 0, al_dia: 0, pendientes: 0, deuda_total: 0 };

      let alDia = 0, pendientes = 0, deudaTotal = 0;
      for (const p of players) {
        const mens = await db.getMensualidades(input.club_id, p.cedula);
        const delAnio = mens.filter(m => String(m.anio) === String(anio));
        const pend = delAnio.filter(m => m.estado !== 'AL_DIA');
        if (pend.length === 0) alDia++;
        else {
          pendientes++;
          deudaTotal += pend.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
        }
      }
      return { total: players.length, al_dia: alDia, pendientes, deuda_total: deudaTotal };
    }

    if (name === 'consultar_morosos') {
      const anio = new Date().getFullYear();
      const supabase = db.supabase;
      const { data: players } = await supabase
        .from('players')
        .select('cedula, nombre, apellidos, celular, equipo')
        .eq('club_id', input.club_id)
        .eq('activo', true);
      if (!players?.length) return { morosos: [] };

      const morosos = [];
      for (const p of players) {
        const mens = await db.getMensualidades(input.club_id, p.cedula);
        const pend = mens.filter(m => String(m.anio) === String(anio) && m.estado !== 'AL_DIA');
        if (pend.length > 0) {
          const deuda = pend.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
          morosos.push({ nombre: `${p.nombre} ${p.apellidos}`.trim(), celular: p.celular, equipo: p.equipo, meses_pendientes: pend.length, deuda });
        }
      }
      morosos.sort((a, b) => b.deuda - a.deuda);
      return { morosos: morosos.slice(0, 15) };
    }

    if (name === 'enviar_recordatorio_pago') {
      const anio = new Date().getFullYear();
      const supabase = db.supabase;
      const { data: players } = await supabase
        .from('players')
        .select('cedula, nombre, celular')
        .eq('club_id', input.club_id)
        .eq('activo', true)
        .not('celular', 'is', null);
      if (!players?.length) return { enviados: 0 };

      let enviados = 0;
      const wahaUrl = process.env.WAHA_URL;
      const apiKey  = process.env.WAHA_API_KEY;
      const session = process.env.WAHA_SESSION || 'default';
      if (!wahaUrl) return { error: 'WAHA no configurado' };

      for (const p of players) {
        const mens = await db.getMensualidades(input.club_id, p.cedula);
        const pend = mens.filter(m => String(m.anio) === String(anio) && m.estado !== 'AL_DIA');
        if (!pend.length) continue;
        const deuda = pend.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
        const msg = `⚽ *${input.club_nombre}*\n\nHola ${p.nombre}, tienes *${pend.length} mensualidad(es)* pendiente(s) por un total de *$${deuda.toLocaleString('es-CO')}*.\n\nPor favor ponerte al día para seguir disfrutando del club. ¡Gracias! 🙏`;
        const chatId = `57${String(p.celular).replace(/\D/g, '').replace(/^57/, '')}@c.us`;
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (apiKey) headers['X-Api-Key'] = apiKey;
          await fetch(`${wahaUrl}/api/sendText`, { method: 'POST', headers, body: JSON.stringify({ chatId, text: msg, session }) });
          enviados++;
        } catch (e) { /* continuar con el siguiente */ }
      }
      return { enviados, mensaje: `Se enviaron recordatorios a ${enviados} jugadores con deuda pendiente.` };
    }

    if (name === 'consultar_asistencia_hoy') {
      const supabase = db.supabase;
      const hoy = new Date().toISOString().split('T')[0];
      const { data: eventos } = await supabase
        .from('calendario')
        .select('id, titulo, tipo, equipo')
        .eq('club_id', input.club_id)
        .gte('fecha_inicio', `${hoy}T00:00:00`)
        .lte('fecha_inicio', `${hoy}T23:59:59`);
      if (!eventos?.length) return { mensaje: 'No hay eventos programados para hoy.' };

      const resumen = [];
      for (const ev of eventos) {
        const lista = await db.getAsistencia(input.club_id, ev.id);
        const presentes = lista.filter(j => j.estado === 'PRESENTE').length;
        const ausentes  = lista.filter(j => j.estado === 'AUSENTE').length;
        const pendientes = lista.filter(j => j.estado === 'PENDIENTE').length;
        resumen.push({ titulo: ev.titulo, tipo: ev.tipo, equipo: ev.equipo, presentes, ausentes, pendientes, total: lista.length });
      }
      return { eventos: resumen };
    }

    if (name === 'registrar_lead') {
      const supabase = db.supabase;
      const leadData = {
        nombre_club:   input.nombre_club,
        nombre_admin:  input.nombre_admin,
        celular:       input.celular,
        email:         input.email || null,
        ciudad:        input.ciudad || null,
        deporte:       input.deporte || null,
        num_jugadores: input.num_jugadores || null,
        fuente:        'whatsapp',
        created_at:    new Date().toISOString(),
      };
      await supabase.from('leads').upsert(leadData, { onConflict: 'celular' });
      const params = new URLSearchParams();
      if (input.nombre_club) params.set('club', input.nombre_club);
      if (input.nombre_admin) params.set('admin', input.nombre_admin);
      if (input.email) params.set('email', input.email);
      if (input.ciudad) params.set('ciudad', input.ciudad);
      const link = `https://zensports.zenpra.ai/registro?${params.toString()}`;
      return { link, mensaje: `Lead guardado. Link de registro generado para ${input.nombre_club}.` };
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
const SYSTEM_BASE = `Eres *Zen* ⚽, el asistente virtual de ZenSports — la plataforma para gestión de clubes deportivos colombianos.

REGLAS GENERALES:
- Responde SIEMPRE en español
- Sé amigable, cálido y conciso
- Usa emojis con moderación
- Nunca inventes datos — solo usa lo que retornan las herramientas
- Si no tienes un dato, dilo honestamente
- Precios: formato $150.000 (con puntos, sin decimales)
- Fechas: formato legible "Sábado 15 de junio", no "2026-06-15"`;

const SYSTEM_JUGADOR = `${SYSTEM_BASE}

ROL: Estás atendiendo a un JUGADOR o PADRE DE FAMILIA registrado en un club.
El usuario ya fue identificado — sus datos están en el CONTEXTO.

MENÚ DE BIENVENIDA (usar cuando digan "hola", "menu", "inicio" o sea primera vez):
---
👋 ¡Hola! Soy *Zen*, el asistente de ZenSports.

¿En qué te puedo ayudar hoy?

1️⃣ Ver mis pagos y estado de cuenta
2️⃣ Ver calendario de entrenamientos
3️⃣ Ver próximos partidos
4️⃣ Ver mi asistencia
5️⃣ Hablar con el administrador del club

Escribe el número o cuéntame directamente 😊
---

FLUJO:
- Para pagos → usa consultar_pagos con club_id y cedula del contexto
- Para calendario → usa consultar_calendario con club_slug del contexto
- Para partidos → usa consultar_partidos con club_id del contexto
- Para asistencia → usa consultar_asistencia con club_id y cedula del contexto
- "Hablar con el admin" → da el número celular_admin del contexto

MEDIOS DE PAGO (cuando muestres el resultado de consultar_pagos):
- Muestra TODOS los medios configurados, salvo que el jugador pida explícitamente solo uno
- qr_pago_url → "📷 QR de pago: <url>"
- llave_pago → "🔑 Nequi / llave: <valor>"
- cuenta_bancaria → si existe, muestra: "🏦 Transferencia bancaria:\n  Banco: <banco>\n  Tipo: <tipo>\n  Cuenta: <numero>"
- Si un campo de cuenta_bancaria es null, omítelo
- Si ningún medio está configurado, dile al jugador que contacte al administrador`;

const SYSTEM_ADMIN = `${SYSTEM_BASE}

ROL: Estás atendiendo al ADMINISTRADOR del club. Sus datos de club están en el CONTEXTO.

MENÚ DE ADMIN (usar cuando digan "hola", "menu" o sea primera vez):
---
👋 ¡Hola! Soy *Zen*, tu asistente de administración.

¿Qué necesitas hoy?

1️⃣ Ver pagos pendientes del club
2️⃣ Ver jugadores morosos
3️⃣ Enviar recordatorio de pago masivo
4️⃣ Ver asistencia del día
5️⃣ Ver próximos eventos del club

Escribe el número o dime directamente 💼
---

FLUJO:
- "pagos pendientes" / opción 1 → usa consultar_pagos_club
- "morosos" / opción 2 → usa consultar_morosos
- "recordatorio" / opción 3 → usa enviar_recordatorio_pago
- "asistencia" / opción 4 → usa consultar_asistencia_hoy
- "eventos" o "calendario" / opción 5 → usa consultar_calendario con club_slug del contexto`;

const SYSTEM_VISITANTE = `${SYSTEM_BASE}

ROL: Estás atendiendo a alguien que NO está registrado en ningún club de ZenSports.
Puede ser un admin interesado en registrar su club, o un jugador que aún no ha sido ingresado.

FLUJO:
1. Salúdalo y pregunta si quiere información sobre ZenSports o si es jugador de un club
2. Si quiere registrar su club → usa info_zensports y luego registrar_lead para recolectar sus datos
3. Si dice que es jugador → pídele que pregunte a su admin que lo registre, o dile que verifique el número con el que fue inscrito`;

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

// ── Identificar rol del usuario ──────────────────────────────────────────────
async function identificarRol(celular, sessionData) {
  // 1. Si ya lo teníamos en sesión, usar eso
  if (sessionData?.rol && sessionData?.contexto) {
    return { rol: sessionData.rol, contexto: sessionData.contexto };
  }

  const numero = String(celular).replace(/\D/g, '').replace(/^57/, '');

  // 2. ¿Es admin de algún club?
  const club = await db.getClubByCelularAdmin(numero);
  if (club) {
    return {
      rol: 'admin',
      contexto: {
        club_id:       club.id,
        club_slug:     club.slug,
        club_nombre:   club.config?.nombre || club.name,
        celular_admin: club.celular_admin,
        config:        club.config || {},
      },
    };
  }

  // 3. ¿Es jugador registrado?
  const jugador = await db.getPlayerByCelularGlobal(numero);
  if (jugador) {
    return {
      rol: 'jugador',
      contexto: {
        nombre:        `${jugador.nombre} ${jugador.apellidos}`.trim(),
        cedula:        jugador.cedula,
        club_id:       jugador.club_id,
        club_slug:     jugador.clubs?.slug,
        club_nombre:   jugador.clubs?.config?.nombre || jugador.clubs?.name,
        celular_admin: jugador.clubs?.config?.celular_admin,
        categoria:     jugador.categoria,
        equipo:        jugador.equipo,
        config:        jugador.clubs?.config || {},
      },
    };
  }

  // 4. Visitante no registrado
  return { rol: 'visitante', contexto: {} };
}

// ── Verificar si el agente WA está activo para el club ───────────────────────
function agenteActivoParaClub(contexto) {
  if (!contexto?.club_id) return true; // visitante → siempre activo
  const modulos = contexto.config?.modulos || {};
  // Activo por defecto; solo se desactiva si el admin lo apaga explícitamente desde el panel
  if (typeof modulos.whatsapp === 'boolean') return modulos.whatsapp;
  return true;
}

// ── Generar respuesta del agente (compartida entre todos los canales) ─────────
async function generateReply(from, text) {
  const session = await db.getWaSession(from);
  const history = session?.messages || [];

  // Identificar quién es
  const { rol, contexto } = await identificarRol(from, session);

  // Verificar si el agente está habilitado para este club
  if (!agenteActivoParaClub(contexto)) {
    return null; // ignorar silenciosamente — el admin lo desactivó
  }

  const systemMap = { admin: SYSTEM_ADMIN, jugador: SYSTEM_JUGADOR, visitante: SYSTEM_VISITANTE };
  const system    = `${systemMap[rol]}\n\nCONTEXTO DEL USUARIO:\n${JSON.stringify({ rol, ...contexto })}`;

  const messages = [...history, { role: 'user', content: text }];
  let reply      = null;

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
  await db.upsertWaSession(from, { rol, contexto, messages: historialTexto });

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
  // Asegurar prefijo de país Colombia (+57) cuando el número no tiene código
  const numOnly = to.replace(/\D/g, '');
  const chatId  = to.includes('@') ? to : `${numOnly.startsWith('57') ? numOnly : '57' + numOnly}@c.us`;
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

// ── Resolver @lid al número real de teléfono via WAHA ────────────────────────
async function resolverLid(lidId) {
  const wahaUrl = process.env.WAHA_URL;
  const apiKey  = process.env.WAHA_API_KEY;
  const session = process.env.WAHA_SESSION || 'default';
  if (!wahaUrl) return null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;
    const res  = await fetch(`${wahaUrl}/api/contacts?contactId=${encodeURIComponent(lidId)}&session=${session}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.number) return data.number; // número completo con código de país, ej: 573023903192
  } catch { /* ignorar */ }
  return null;
}

// ── Webhook WAHA (POST) ──────────────────────────────────────────────────────
router.post('/waha', async (req, res) => {
  try {
    const { event, payload } = req.body;
    if (event !== 'message' || !payload?.body || payload?.fromMe) {
      return res.status(200).json({ status: 'ignored' });
    }

    const msgId   = payload.id;

    // Capa 1: in-memory (misma instancia Vercel, sincrónico — sin I/O)
    if (isDuplicate(msgId)) {
      return res.status(200).json({ status: 'duplicate' });
    }

    const rawFrom = payload.from;
    let from      = rawFrom.replace('@c.us', '').replace('@s.whatsapp.net', '');

    // Si WAHA envía en formato @lid, resolver al número real
    if (rawFrom.includes('@lid') || rawFrom.includes('@s.whatsapp.net')) {
      const resolved = await resolverLid(rawFrom);
      if (resolved) from = resolved;
    }

    const text = payload.body;

    // Capa 2: Supabase atómico — INSERT, si falla por conflicto en msg_id es duplicado
    if (msgId) {
      try {
        // Intentar update solo si last_msg_id es diferente
        const { data: updated } = await db.supabase
          .from('wa_sessions')
          .update({ last_msg_id: msgId, updated_at: new Date().toISOString() })
          .eq('phone', from)
          .neq('last_msg_id', msgId)
          .select('phone');

        if (updated !== null && updated.length === 0) {
          // El update no aplicó — verificar si ya existe con este msgId (duplicado cross-instancia)
          const { data: existing } = await db.supabase
            .from('wa_sessions')
            .select('last_msg_id')
            .eq('phone', from)
            .single();
          if (existing?.last_msg_id === msgId) {
            console.log(`[wa-agent] WAHA duplicado cross-instancia ignorado: ${msgId}`);
            return res.status(200).json({ status: 'duplicate' });
          }
          // No existe sesión aún → upsert inicial
          await db.supabase
            .from('wa_sessions')
            .upsert({ phone: from, last_msg_id: msgId, updated_at: new Date().toISOString() }, { onConflict: 'phone' });
        }
      } catch (dedupErr) {
        console.warn('[wa-agent] dedup error (ignorado):', dedupErr.message);
      }
    }

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
