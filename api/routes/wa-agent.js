const express = require('express');
const crypto = require('crypto');
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

const PDF_HMAC_SECRET = process.env.PDF_HMAC_SECRET || 'zs-pdf-2026-x9k';

function generarTokenMorosos(clubId) {
  const dia = Math.floor(Date.now() / 86400000);
  return crypto.createHmac('sha256', PDF_HMAC_SECRET).update(`pdf:${clubId}:${dia}`).digest('hex');
}

const API_BASE = 'https://api.zensports.zenpra.ai';

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const TEMPLATE_RECORDATORIO_DEFAULT = '⚽ *{club_nombre}*\n\nHola {nombre}, tienes *{meses} mensualidad(es)* pendiente(s) por un total de *{deuda}*.\n\nPor favor ponte al día para seguir disfrutando del club. ¡Gracias! 🙏';

function aplicarTemplate(template, vars) {
  return template
    .replace(/{nombre}/g, vars.nombre || '')
    .replace(/{deuda}/g, vars.deuda != null ? `$${Math.round(vars.deuda).toLocaleString('es-CO')}` : '')
    .replace(/{meses}/g, String(vars.meses || ''))
    .replace(/{club_nombre}/g, vars.club_nombre || '');
}

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

// buscar_jugador: SOLO admins — jugadores/visitantes no pueden ver datos de otras personas
const TOOL_BUSCAR_JUGADOR = {
  name: 'buscar_jugador',
  description: 'SOLO ADMIN. Busca un jugador del club. Puede buscar por celular, cédula o nombre. Pasa UNO de los tres parámetros.',
  input_schema: {
    type: 'object',
    properties: {
      celular: { type: 'string', description: 'Número de celular, ej: 3001234567' },
      cedula:  { type: 'string', description: 'Número de cédula del jugador' },
      nombre:  { type: 'string', description: 'Nombre o apellido (puede devolver varios resultados)' },
    },
  },
};

const TOOLS_BASE = [
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
    description: 'SOLO ADMIN. Lista de jugadores con pagos pendientes. Si se pasa "mes" (número 1-12), filtra solo ese mes; si no, muestra todos los morosos del año. Devuelve total_morosos, morosos[] y total_deuda.',
    input_schema: {
      type: 'object',
      properties: {
        club_id: { type: 'string' },
        mes: { type: 'number', description: 'Número del mes (1=Enero...12=Diciembre). Omitir para ver todos los morosos del año.' },
      },
      required: ['club_id'],
    },
  },
  {
    name: 'enviar_recordatorio_pago',
    description: 'SOLO ADMIN. Envía un mensaje de WhatsApp a todos los jugadores con deuda pendiente. Puedes personalizar el texto con las variables {nombre}, {deuda} y {meses}.',
    input_schema: {
      type: 'object',
      properties: {
        club_id:               { type: 'string' },
        club_nombre:           { type: 'string' },
        mensaje_personalizado: { type: 'string', description: 'Mensaje personalizado. Variables disponibles: {nombre}, {deuda}, {meses}. Si no se envía, usa el mensaje estándar.' },
      },
      required: ['club_id', 'club_nombre'],
    },
  },
  {
    name: 'consultar_metricas_wa',
    description: 'SOLO ADMIN. Muestra métricas del bot de WhatsApp del club: último recordatorio masivo enviado.',
    input_schema: { type: 'object', properties: {} },
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
    description: 'Guarda los datos de un club interesado en ZenSports y genera el link de registro prellenado. El celular se toma automáticamente del número de WhatsApp del visitante.',
    input_schema: {
      type: 'object',
      properties: {
        nombre_club:   { type: 'string' },
        deporte:       { type: 'string' },
        ciudad:        { type: 'string' },
        num_jugadores: { type: 'string' },
        nombre_admin:  { type: 'string' },
        email:         { type: 'string' },
      },
      required: ['nombre_admin'],
    },
  },
  {
    name: 'info_zensports',
    description: 'Retorna información sobre ZenSports: qué es, planes, precios y cómo registrarse.',
    input_schema: { type: 'object', properties: {} },
  },
];

// obtener_carnet: SOLO jugadores — genera el link del carnet digital
const TOOL_OBTENER_CARNET = {
  name: 'obtener_carnet',
  description: 'Genera el link del carnet digital del jugador autenticado. Retorna la URL de verificación y la foto si existe.',
  input_schema: { type: 'object', properties: {} },
};

// enviar_mensaje_jugador: SOLO admins — envía WA individual a un jugador del club
const TOOL_ENVIAR_MENSAJE_JUGADOR = {
  name: 'enviar_mensaje_jugador',
  description: 'SOLO ADMIN/ENTRENADOR. Envía un mensaje de WhatsApp personalizado a un jugador específico del club. Busca por cédula (exacto) o nombre (parcial).',
  input_schema: {
    type: 'object',
    properties: {
      cedula:  { type: 'string', description: 'Cédula del jugador (recomendado para exactitud)' },
      nombre:  { type: 'string', description: 'Nombre o apellido si no tienes la cédula' },
      mensaje: { type: 'string', description: 'Texto del mensaje a enviar' },
    },
    required: ['mensaje'],
  },
};

// Herramientas de asistencia — admin y entrenador
const TOOL_LISTAR_EVENTOS_HOY = {
  name: 'listar_eventos_hoy',
  description: 'Lista los eventos del club programados para hoy (excluye suspendidos). Usar para iniciar el flujo de registro de asistencia.',
  input_schema: { type: 'object', properties: {} },
};

const TOOL_VER_LISTA_ASISTENCIA = {
  name: 'ver_lista_asistencia',
  description: 'Obtiene la lista numerada de jugadores para un evento específico con su estado actual de asistencia. Usar para preparar el registro de asistencia por lote.',
  input_schema: {
    type: 'object',
    properties: {
      evento_id: { type: 'string', description: 'ID del evento (viene de listar_eventos_hoy)' },
    },
    required: ['evento_id'],
  },
};

const TOOL_REGISTRAR_ASISTENCIA_LOTE = {
  name: 'registrar_asistencia_lote',
  description: 'Registra asistencia masiva para un evento. Pasa las cédulas de los jugadores PRESENTES. Los demás quedan como PENDIENTE (no asistió). Usa marcar_todos_presentes=true para marcar a todos.',
  input_schema: {
    type: 'object',
    properties: {
      evento_id:              { type: 'string', description: 'ID del evento' },
      cedulas_presentes:      { type: 'array',  items: { type: 'string' }, description: 'Cédulas de jugadores que SÍ asistieron' },
      marcar_todos_presentes: { type: 'boolean', description: 'true para marcar TODOS como PRESENTE (ignora cedulas_presentes)' },
    },
    required: ['evento_id'],
  },
};

// Herramientas por rol — jugadores y visitantes NO pueden buscar datos de otras personas
const TOOLS_ADMIN       = [TOOL_BUSCAR_JUGADOR, TOOL_ENVIAR_MENSAJE_JUGADOR, TOOL_LISTAR_EVENTOS_HOY, TOOL_VER_LISTA_ASISTENCIA, TOOL_REGISTRAR_ASISTENCIA_LOTE, ...TOOLS_BASE];
const TOOLS_ENTRENADOR  = [TOOL_BUSCAR_JUGADOR, TOOL_ENVIAR_MENSAJE_JUGADOR, TOOL_LISTAR_EVENTOS_HOY, TOOL_VER_LISTA_ASISTENCIA, TOOL_REGISTRAR_ASISTENCIA_LOTE, ...TOOLS_BASE.filter(t => ['consultar_calendario', 'consultar_asistencia_hoy'].includes(t.name))];
const TOOLS_JUGADOR     = [TOOL_OBTENER_CARNET, ...TOOLS_BASE.filter(t => !['registrar_lead', 'consultar_pagos_club', 'consultar_morosos', 'enviar_recordatorio_pago', 'consultar_asistencia_hoy'].includes(t.name))];
const TOOLS_VISITANTE   = TOOLS_BASE.filter(t => ['registrar_lead', 'info_zensports'].includes(t.name));

// ── Ejecutar herramienta ─────────────────────────────────────────────────────
async function runTool(name, input, contexto = {}) {
  try {
    if (name === 'buscar_jugador') {
      if (input.cedula) {
        const jugador = await db.getPlayerByCedula(contexto.club_id, input.cedula);
        if (!jugador) return { encontrado: false };
        return { encontrado: true, nombre: `${jugador.nombre} ${jugador.apellidos}`.trim(),
          cedula: jugador.cedula, categoria: jugador.categoria, equipo: jugador.equipo,
          posicion: jugador.posicion, celular: jugador.celular };
      }
      if (input.nombre) {
        const resultados = await db.searchPlayersByQuery(contexto.club_id, input.nombre);
        if (!resultados.length) return { encontrado: false, resultados: [] };
        return { encontrado: true, resultados: resultados.map(j => ({
          nombre: `${j.nombre} ${j.apellidos}`.trim(), cedula: j.cedula,
          categoria: j.categoria, equipo: j.equipo, celular: j.celular,
        })) };
      }
      // buscar por celular (comportamiento original)
      const jugador = await db.getPlayerByCelular(contexto.club_id, input.celular);
      if (!jugador) return { encontrado: false };
      return { encontrado: true, nombre: `${jugador.nombre} ${jugador.apellidos}`.trim(),
        cedula: jugador.cedula, categoria: jugador.categoria, equipo: jugador.equipo,
        posicion: jugador.posicion, celular: jugador.celular };
    }

    if (name === 'consultar_pagos') {
      // Validación server-side: jugador solo puede consultar su propia cédula
      if (contexto.rol === 'jugador' && input.cedula !== String(contexto.cedula)) {
        return { error: 'No autorizado. Solo puedes consultar tu propio estado de cuenta.' };
      }
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
      const portal_url = (contexto.club_slug && contexto.cedula)
        ? `https://zensports.zenpra.ai/p/${contexto.club_slug}/${contexto.cedula}`
        : null;
      return { anio, al_dia: al_dia.length, pendientes: pendientes.length, total_deuda,
               qr_pago_url, llave_pago, cuenta_bancaria, portal_url,
               detalle: del_anio.map(m => ({ mes: m.mes, estado: m.estado, saldo: m.saldo_pendiente })) };
    }

    if (name === 'consultar_calendario') {
      const club = await db.getClubBySlug(input.club_slug);
      if (!club) return { eventos: [] };
      const hoy   = new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0]; // UTC-5 Colombia
      const hasta = new Date(Date.now() - 5 * 3600000 + 30 * 86400000).toISOString().split('T')[0];
      const eventos = await db.getCalendario(club.slug, hoy, hasta);
      const filtrados = input.equipo
        ? eventos.filter(e => !e.equipo || e.equipo.toUpperCase().includes(input.equipo.toUpperCase()))
        : eventos;
      return { eventos: filtrados.slice(0, 8).map(e => {
        // Convertir UTC → Colombia (UTC-5) para mostrar fecha/hora correctas
        const d = e.fecha_inicio ? new Date(new Date(e.fecha_inicio).getTime() - 5 * 3600000) : null;
        return {
          tipo:   e.tipo,
          titulo: e.titulo,
          fecha:  d ? d.toISOString().split('T')[0] : null,
          hora:   d ? d.toISOString().split('T')[1]?.slice(0, 5) : null,
          lugar:  e.lugar,
          equipo: e.equipo,
        };
      }) };
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
      // Validación server-side: jugador solo puede consultar su propia asistencia
      if (contexto.rol === 'jugador' && input.cedula !== String(contexto.cedula)) {
        return { error: 'No autorizado. Solo puedes consultar tu propia asistencia.' };
      }
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
      // Siempre usar el club_id del contexto autenticado, no el que pasa el LLM
      const clubId = contexto.club_id;
      if (!clubId) return { error: 'No se encontró el club en el contexto' };
      const mesNum = input.mes ? parseInt(input.mes) : null;
      const supabase = db.supabase;
      const { data: players } = await supabase
        .from('players')
        .select('cedula, nombre, apellidos, celular, equipo')
        .eq('club_id', clubId)
        .eq('activo', true);
      if (!players?.length) return { morosos: [], total_deuda: 0, pdf_url: null };

      const morosos = [];
      for (const p of players) {
        const mens = await db.getMensualidades(clubId, p.cedula);
        const pend = mens.filter(m => {
          if (String(m.anio) !== String(anio)) return false;
          if (m.estado === 'AL_DIA') return false;
          if (mesNum !== null) return parseInt(m.numero_mes) === mesNum;
          return true;
        });
        if (pend.length > 0) {
          const deuda = pend.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
          morosos.push({ nombre: `${p.nombre} ${p.apellidos}`.trim(), celular: p.celular, equipo: p.equipo, meses_pendientes: pend.length, deuda });
        }
      }
      morosos.sort((a, b) => b.deuda - a.deuda);
      const total_deuda = morosos.reduce((s, m) => s + m.deuda, 0);
      const mesParam = mesNum ? String(mesNum) : '';
      const token = generarTokenMorosos(clubId);
      const pdf_url = mesParam
        ? `${API_BASE}/api/publico/morosos-pdf/${clubId}/${mesParam}?token=${token}`
        : `${API_BASE}/api/publico/morosos-pdf/${clubId}?token=${token}`;
      return { total_morosos: morosos.length, morosos: morosos.slice(0, 5), total_deuda, pdf_url };
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

      if (!process.env.WAHA_URL) return { error: 'WAHA no configurado' };

      const template = input.mensaje_personalizado || TEMPLATE_RECORDATORIO_DEFAULT;
      let enviados = 0;

      for (const p of players) {
        const mens = await db.getMensualidades(input.club_id, p.cedula);
        const pend = mens.filter(m => String(m.anio) === String(anio) && m.estado !== 'AL_DIA');
        if (!pend.length) continue;
        const deuda = pend.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
        const msg = aplicarTemplate(template, { nombre: p.nombre, deuda, meses: pend.length, club_nombre: input.club_nombre });
        try {
          await sendWAHA(p.celular, msg);
          enviados++;
        } catch (e) { /* continuar con el siguiente */ }
      }

      // Guardar métricas en clubs.config
      try {
        const { data: clubData } = await supabase.from('clubs').select('config').eq('id', input.club_id).single();
        const waMetrics = clubData?.config?.wa_metrics || {};
        waMetrics.ultimo_recordatorio = { fecha: new Date().toISOString(), enviados };
        waMetrics.total_recordatorios = (waMetrics.total_recordatorios || 0) + 1;
        await supabase.from('clubs').update({ config: { ...(clubData?.config || {}), wa_metrics: waMetrics } }).eq('id', input.club_id);
      } catch (e) { /* no crítico */ }

      return { enviados, mensaje: `Recordatorio enviado a ${enviados} jugador(es) con deuda pendiente.` };
    }

    if (name === 'consultar_asistencia_hoy') {
      const supabase = db.supabase;
      // Colombia es UTC-5: medianoche local = 05:00 UTC; 23:59:59 local = 04:59:59 UTC del día siguiente
      const nowCol    = new Date(Date.now() - 5 * 3600000);
      const hoyCol    = nowCol.toISOString().split('T')[0];
      const mananaCol = new Date(nowCol.getTime() + 86400000).toISOString().split('T')[0];
      const inicioUTC = `${hoyCol}T05:00:00Z`;
      const finUTC    = `${mananaCol}T04:59:59Z`;
      const { data: eventos } = await supabase
        .from('calendario')
        .select('id, titulo, tipo, equipo')
        .eq('club_id', contexto.club_slug)
        .gte('fecha_inicio', inicioUTC)
        .lte('fecha_inicio', finUTC);
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
      const phone = contexto.from || from;
      const leadData = {
        nombre_club: input.nombre_club  || null,
        nombre:      input.nombre_admin || null,
        whatsapp:    phone,
        email:       input.email        || null,
        ciudad:      input.ciudad       || null,
        fuente:      'whatsapp',
      };
      const { error: leadErr } = await supabase.from('leads').upsert(leadData, { onConflict: 'whatsapp' });
      if (leadErr) console.error('[registrar_lead] error:', leadErr.message);
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
        descripcion: 'ZenSports es el sistema operativo para clubes deportivos. Gestión de jugadores, cobros automáticos por WhatsApp, calendario, arbitraje, carnet digital y más.',
        trial: '5 días de prueba completa, sin tarjeta de crédito, sin permanencia. Acceso a todas las funciones desde el primer día.',
        planes: [
          { nombre: 'Starter', precio: '$149.000/mes', jugadores: 'hasta 120', features: 'Jugadores + cobros automáticos WA + carnet digital + inscripciones digitales' },
          { nombre: 'Pro',     precio: '$399.000/mes', jugadores: 'hasta 350', features: 'Todo Starter + torneos + arbitraje + finanzas avanzadas + agente IA' },
          { nombre: 'Scale',   precio: '$799.000/mes', jugadores: 'hasta 1.000', features: 'Todo incluido + múltiples admins + soporte prioritario + conciliación' },
        ],
        roi: 'La mayoría de clubes recuperan la inversión en el primer mes al reducir la mora en más del 80%.',
        registro: 'Regístrate en zensports.zenpra.ai — 5 días gratis, sin tarjeta.',
        contacto: 'WhatsApp Zenpra: +57 3204409015',
      };
    }

    if (name === 'obtener_carnet') {
      const { cedula, club_slug, club_nombre, nombre, foto_url } = contexto;
      if (!cedula || !club_slug) return { error: 'No se encontraron tus datos completos para generar el carnet.' };
      const fecha = new Date().toISOString().split('T')[0];
      const url = `https://zensports.zenpra.ai/verificar/${club_slug}/${cedula}?fecha=${fecha}`;
      return { url, foto_url: foto_url || null, nombre, club_nombre, fecha,
               instruccion: 'El carnet muestra la fecha de hoy en verde — solo es válido el día que se solicita.' };
    }

    if (name === 'enviar_mensaje_jugador') {
      const clubId = contexto.club_id;
      let jugador = null;

      if (input.cedula) {
        jugador = await db.getPlayerByCedula(clubId, input.cedula);
      } else if (input.nombre) {
        const resultados = await db.searchPlayersByQuery(clubId, input.nombre);
        if (resultados.length > 1) {
          return {
            ambiguo: true,
            mensaje: 'Encontré varios jugadores con ese nombre. Dame la cédula para ser exacto.',
            resultados: resultados.map(j => ({ nombre: `${j.nombre} ${j.apellidos}`.trim(), cedula: j.cedula })),
          };
        }
        jugador = resultados[0] || null;
      }

      if (!jugador) return { error: 'Jugador no encontrado en el club.' };
      if (!jugador.celular) return { error: `${jugador.nombre} no tiene celular registrado.` };

      await sendWAHA(jugador.celular, input.mensaje);
      return { enviado: true, destinatario: `${jugador.nombre} ${jugador.apellidos}`.trim(), celular: jugador.celular };
    }

    if (name === 'listar_eventos_hoy') {
      const supabase = db.supabase;
      // Colombia es UTC-5: medianoche local = 05:00 UTC; 23:59:59 local = 04:59:59 UTC del día siguiente
      const nowCol    = new Date(Date.now() - 5 * 3600000);
      const hoyCol    = nowCol.toISOString().split('T')[0];
      const mananaCol = new Date(nowCol.getTime() + 86400000).toISOString().split('T')[0];
      const inicioUTC = `${hoyCol}T05:00:00Z`;
      const finUTC    = `${mananaCol}T04:59:59Z`;
      const { data: eventos } = await supabase
        .from('calendario')
        .select('id, titulo, tipo, equipo, fecha_inicio')
        .eq('club_id', contexto.club_slug)
        .gte('fecha_inicio', inicioUTC)
        .lte('fecha_inicio', finUTC)
        .or('suspendido.eq.false,suspendido.is.null')
        .order('fecha_inicio');
      if (!eventos?.length) return { mensaje: 'No hay eventos programados para hoy.' };
      return {
        eventos: eventos.map((e, i) => {
          const d = e.fecha_inicio ? new Date(new Date(e.fecha_inicio).getTime() - 5 * 3600000) : null;
          return {
            numero: i + 1,
            id:     e.id,
            titulo: e.titulo || (e.tipo === 'ENTRENAMIENTO' ? 'Entrenamiento' : e.tipo),
            tipo:   e.tipo,
            equipo: e.equipo || 'Todos',
            hora:   d ? d.toISOString().split('T')[1]?.slice(0, 5) : null,
          };
        }),
      };
    }

    if (name === 'ver_lista_asistencia') {
      const lista = await db.getAsistencia(contexto.club_id, input.evento_id);
      if (!lista?.length) return { mensaje: 'No hay jugadores registrados en este evento.', jugadores: [] };
      return {
        total: lista.length,
        jugadores: lista.map((j, i) => ({
          numero:   i + 1,
          cedula:   j.cedula,
          nombre:   `${j.nombre} ${j.apellidos}`.trim(),
          estado:   j.estado || 'PENDIENTE',
          equipo:   j.equipo,
        })),
      };
    }

    if (name === 'registrar_asistencia_lote') {
      const lista = await db.getAsistencia(contexto.club_id, input.evento_id);
      if (!lista?.length) return { error: 'No se encontraron jugadores para este evento.' };
      const cedulasPresentes = new Set(
        input.marcar_todos_presentes
          ? lista.map(j => String(j.cedula))
          : (input.cedulas_presentes || []).map(String)
      );
      await Promise.all(lista.map(j => db.upsertAsistencia({
        club_id:        contexto.club_id,
        evento_id:      input.evento_id,
        cedula:         j.cedula,
        estado:         cedulasPresentes.has(String(j.cedula)) ? 'PRESENTE' : 'PENDIENTE',
        nota:           null,
        registrado_por: null,
      })));
      const presentes = cedulasPresentes.size;
      const ausentes  = lista.length - presentes;
      return { exitoso: true, presentes, ausentes, total: lista.length };
    }

    if (name === 'consultar_metricas_wa') {
      const supabase = db.supabase;
      const [{ data: clubData }, { data: sessions }] = await Promise.all([
        supabase.from('clubs').select('config').eq('id', contexto.club_id).single(),
        supabase.from('wa_sessions').select('phone, rol, updated_at, messages').eq('contexto->>club_id', contexto.club_id),
      ]);
      const waMetrics = clubData?.config?.wa_metrics || {};
      const ultimo = waMetrics.ultimo_recordatorio;
      const sesiones = sessions || [];
      const hace24h = new Date(Date.now() - 86400000).toISOString();
      const hace7d  = new Date(Date.now() - 7 * 86400000).toISOString();
      const admins     = sesiones.filter(s => s.rol === 'admin').length;
      const jugadores  = sesiones.filter(s => s.rol === 'jugador').length;
      const activos24h = sesiones.filter(s => s.updated_at >= hace24h).length;
      const activos7d  = sesiones.filter(s => s.updated_at >= hace7d).length;
      const totalMensajes = sesiones.reduce((sum, s) => sum + (Array.isArray(s.messages) ? s.messages.length : 0), 0);
      return {
        sesiones_total: sesiones.length,
        admins,
        jugadores,
        mensajes_totales: totalMensajes,
        activos_hoy: activos24h,
        activos_semana: activos7d,
        recordatorios_enviados_total: waMetrics.total_recordatorios || 0,
        ultimo_recordatorio: ultimo
          ? {
              fecha: new Date(ultimo.fecha).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
              enviados: ultimo.enviados,
            }
          : null,
      };
    }

    return { error: 'Herramienta no encontrada' };
  } catch (err) {
    console.error(`[wa-agent] tool ${name} error:`, err.message);
    return { error: err.message };
  }
}

// ── Sistema prompt ───────────────────────────────────────────────────────────
const SYSTEM_BASE = `Eres *Zen* ⚽, el asistente virtual de *ZenSports* — la plataforma de gestión deportiva con IA para clubes de Latinoamérica.

PERSONALIDAD: Eres cercano, directo y útil — como un asistente del club de confianza. Hablas el idioma deportivo colombiano. No eres un robot corporativo. Cuando el CONTEXTO tenga el nombre del usuario, úsalo naturalmente en el saludo y de vez en cuando en la conversación para generar cercanía (no en cada mensaje, solo donde fluya natural).

REGLAS OBLIGATORIAS:
- Responde SIEMPRE en español colombiano natural
- Usa emojis con moderación (1-2 por mensaje) para calidez, no en exceso
- Respuestas cortas y directas — máximo 3-4 líneas por punto. Si tienes mucha info, usa listas
- NUNCA inventes datos, números, nombres ni fechas — solo usa lo que retornan las herramientas
- NUNCA construyas ni supongas URLs — si una herramienta no te la da, no la menciones
- Si no tienes un dato: "No tengo esa información en este momento, pero puedes verificar en el panel del club"
- Precios siempre con puntos: $150.000 (no $150000 ni $150,000)
- Fechas en formato legible: "Sábado 15 de junio" (no "2026-06-15")
- No repitas información que el usuario ya sabe — ve directo al dato
- Cuando haya deuda, sé empático con el jugador pero claro con el admin`;

const SYSTEM_JUGADOR = `${SYSTEM_BASE}

ROL: Estás atendiendo a un JUGADOR o PADRE DE FAMILIA registrado en un club.
El usuario ya fue identificado — sus datos están en el CONTEXTO.

PRIVACIDAD — REGLA ABSOLUTA:
- NUNCA busques ni entregues información de OTROS jugadores
- Si alguien pide datos de otra persona (por nombre, cédula o teléfono), responde: "Por privacidad no puedo compartir información de otros jugadores."
- Solo puedes consultar los datos del usuario identificado en el CONTEXTO

MENÚ DE BIENVENIDA (usar cuando digan "hola", "menu", "inicio" o sea primera vez):
PERSONALIZACIÓN OBLIGATORIA: usa el campo "nombre" del CONTEXTO para saludar por nombre y el campo "club_nombre" como nombre del club. Ejemplo real: si nombre="Juan Diego" y club_nombre="City FC", el saludo es "👋 ¡Hola, Juan Diego! Soy *Zen*, el asistente de *City FC*."
---
👋 ¡Hola, [nombre del CONTEXTO]! Soy *Zen*, el asistente de *[club_nombre del CONTEXTO]* ⚽

¿En qué te puedo ayudar hoy?

1️⃣ Ver mis pagos y estado de cuenta
2️⃣ Ver calendario de entrenamientos
3️⃣ Ver próximos partidos
4️⃣ Ver mi asistencia
5️⃣ Mi carnet digital
6️⃣ Hablar con el administrador del club

Escribe el número o cuéntame directamente 😊
---

FLUJO:
- Para pagos → usa consultar_pagos con club_id y cedula del contexto
- Para calendario → usa consultar_calendario con club_slug del contexto
- Para partidos → usa consultar_partidos con club_id del contexto
- Para asistencia → usa consultar_asistencia con club_id y cedula del contexto
- Para carnet / opción 5 → usa obtener_carnet, luego envía exactamente:
  "🪪 *Tu carnet digital — válido hoy:*\n{url}\n\n📌 Muéstralo en tiendas aliadas y patrocinadores. La fecha verde al pie confirma que es de hoy — un carnet de otro día no es válido."
- "Hablar con el admin" / opción 6 → da el número contacto_admin del contexto

FORMATO DE RESPUESTA — ESTADO DE CUENTA (opción 1 / consultar_pagos):
Usa este esquema exacto. Cada bloque separado por una línea en blanco.

Si tiene deuda pendiente:
---
📊 *Tu estado de cuenta*

✅ Al día: X meses  ·  ⚠️ Pendientes: X meses
💰 Deuda total: *$X.XXX*

Para ponerte al día tienes estas opciones 👇

[MEDIOS DE PAGO — ver reglas abajo]

🔗 *Tu portal:* https://zensports.zenpra.ai/p/CLUB_SLUG/CEDULA
---

Si está al día:
---
🎉 ¡Todo al día, [nombre]! No tienes ninguna cuota pendiente ✅

📊 *Tu estado de cuenta*
✅ Meses al día: X  ·  Deuda: $0

🔗 *Tu portal:* https://zensports.zenpra.ai/p/CLUB_SLUG/CEDULA
---

REGLAS DE MEDIOS DE PAGO — SEPARACIÓN OBLIGATORIA:
Cada medio de pago va en su propio bloque separado por línea en blanco. NUNCA en la misma línea.

Si existe qr_pago_url:
📷 *QR de pago:*
<url>

Si existe llave_pago (línea en blanco antes):
🔑 *Nequi / Daviplata:*
<valor de llave_pago>

Si existe cuenta_bancaria (línea en blanco antes):
🏦 *Transferencia bancaria:*
Banco: <banco>
Tipo: <tipo>
Cuenta: <numero>
(omite los campos null de cuenta_bancaria)

Si no hay ningún medio configurado: "Para pagar comunícate con el administrador del club 🙏"

PORTAL DEL ATLETA — OBLIGATORIO:
La ÚLTIMA línea de la respuesta a consultar_pagos SIEMPRE es:
🔗 *Tu portal:* https://zensports.zenpra.ai/p/CLUB_SLUG/CEDULA
Reemplaza CLUB_SLUG con club_slug del CONTEXTO y CEDULA con cedula del CONTEXTO. Es mandatoria.`;

const SYSTEM_ADMIN = `${SYSTEM_BASE}

ROL: Estás atendiendo al ADMINISTRADOR del club. Sus datos de club están en el CONTEXTO.

REGLA CRÍTICA: Cuando el usuario envíe un número del 1 al 6, SIEMPRE interpreta que está seleccionando esa opción del menú. Ignora cualquier pregunta tuya anterior que esté pendiente y ejecuta la acción del número recibido.

MENÚ DE ADMIN (usar cuando digan "hola", "menu" o sea primera vez):
PERSONALIZACIÓN OBLIGATORIA: usa el campo "club_nombre" del CONTEXTO en el saludo. Ejemplo: si club_nombre="City FC", el saludo es "👋 ¡Hola! Soy *Zen*, el asistente de administración de *City FC*."
---
👋 ¡Hola! Soy *Zen*, el asistente de administración de *[club_nombre del CONTEXTO]* 💼

¿Qué necesitas hoy?

1️⃣ Ver pagos pendientes del club
2️⃣ Ver jugadores morosos
3️⃣ Enviar recordatorio de pago masivo
4️⃣ Resumen financiero rápido
5️⃣ Ver próximos eventos del club
6️⃣ Enviar mensaje a un jugador
7️⃣ Pasar asistencia de un evento

Escribe el número o dime directamente 💼
---

FLUJO:
- "pagos pendientes" / opción 1 → usa consultar_pagos_club; muestra el resultado detallado con al día, pendientes y deuda
- "morosos" / opción 2 → usa consultar_morosos
- "recordatorio" / opción 3 → usa enviar_recordatorio_pago; si el admin quiere personalizar el mensaje pregúntale el texto antes de llamarla
- "resumen" / opción 4 → usa consultar_pagos_club; presenta así: "📊 *Resumen financiero — [mes actual]*\n• Jugadores totales: X\n• Al día: X ✅\n• Pendientes: X ⚠️\n• Deuda total: $X\n• Tasa de mora: X%"
- "eventos" o "calendario" / opción 5 → usa consultar_calendario con club_slug del contexto
- "enviar mensaje a [nombre/cédula]" / opción 6 → usa enviar_mensaje_jugador con la cédula o nombre y el texto
- "asistencia" / opción 7 → flujo de asistencia: ver FLUJO DE ASISTENCIA abajo

FLUJO DE ASISTENCIA (opción 7 o cuando el admin mencione "asistencia" o "pasar lista"):
Paso 1 — llama listar_eventos_hoy. Muestra la lista numerada de eventos de hoy.
  Si no hay eventos: "No hay eventos programados para hoy."
Paso 2 — Pregunta: "¿De cuál evento quieres pasar la asistencia?" (el admin responde con el número o nombre del evento)
Paso 3 — llama ver_lista_asistencia con el evento_id seleccionado. Muestra la lista numerada de jugadores con su estado actual.
  Formato de lista: "1. Juan Pérez ✅ / 2. Carlos López ⬜ / ..."  (✅ = PRESENTE, ⬜ = PENDIENTE/sin marcar)
  Luego pregunta: "Dime quiénes asistieron. Puedes decir:
  • *todos* para marcar a todos como presentes
  • *todos menos 5, 8* para excluir ciertos números
  • *1, 3, 7, 12* para indicar solo los que sí asistieron"
Paso 4 — Interpreta la respuesta y construye la lista de cédulas presentes a partir de los números indicados. Llama registrar_asistencia_lote con las cédulas correspondientes.
  Confirma con: "✅ Asistencia guardada — X presentes, Y sin marcar."
REGLA: NUNCA inventes cédulas ni números. Usa SOLO los datos que retornó ver_lista_asistencia.

RECORDATORIO PERSONALIZADO:
- Si el admin dice "envía recordatorio con mensaje: [texto]", usa ese texto como mensaje_personalizado
- Variables disponibles que el admin puede usar: {nombre} = nombre del jugador, {deuda} = monto, {meses} = meses pendientes
- Ejemplo: "Hola {nombre}, tu cuota de ${'{deuda}'} está vencida. Comunícate con nosotros."

REPORTE PDF DE MOROSOS:
- La tool consultar_morosos devuelve un JSON con: total_morosos (número real de morosos), morosos[] (muestra parcial) y total_deuda.
- Cuando el admin pide morosos o el reporte PDF, primero pregúntale:
  "¿Quieres el reporte completo del año o de un mes en particular?
  📅 Escribe *año* para el reporte completo, o el nombre del mes (ej: *junio*)"
- Si dice "año" o "completo": llama consultar_morosos sin parámetro mes.
- Si dice un mes: llama consultar_morosos con mes=número (Enero=1, Feb=2, ... Dic=12).
- Tu respuesta debe ser UNA SOLA LÍNEA: "📋 Reporte listo — X morosos · Total: $Y" (X = total_morosos del tool result)
- NO escribas ninguna URL en tu respuesta. El enlace se envía automáticamente por separado.
- NO listes jugadores. NO agregues explicaciones. SOLO esa línea.

REGLA DE ORO — RESPUESTAS CONCISAS:
- Al finalizar CUALQUIER respuesta, NO sugieras ni propongas otras acciones del menú.
- NO digas "¿quieres enviar un recordatorio?", "¿te gustaría ver algo más?", ni frases similares.
- Responde exactamente lo que se pidió y termina. El admin sabe qué necesita.`;

const SYSTEM_ENTRENADOR = `${SYSTEM_BASE}

ROL: Estás atendiendo a un ENTRENADOR / STAFF del club. Sus datos de club están en el CONTEXTO.

REGLA CRÍTICA: Cuando el usuario envíe un número del 1 al 5, SIEMPRE interpreta que está seleccionando esa opción del menú. Ignora cualquier pregunta tuya anterior que esté pendiente y ejecuta la acción del número recibido.

MENÚ DE ENTRENADOR (usar cuando digan "hola", "menu" o sea primera vez):
PERSONALIZACIÓN OBLIGATORIA: usa el campo "club_nombre" del CONTEXTO en el saludo. Ejemplo: si club_nombre="City FC", el saludo es "👋 ¡Hola! Soy *Zen*, el asistente de *City FC*."
---
👋 ¡Hola! Soy *Zen*, el asistente de *[club_nombre del CONTEXTO]* 🏋️

¿Qué necesitas hoy?

1️⃣ Ver próximos eventos y entrenamientos
2️⃣ Resumen de asistencia del día
3️⃣ Pasar asistencia de un evento
4️⃣ Buscar jugador
5️⃣ Enviar mensaje a un jugador

Escribe el número o dime directamente 🏋️
---

FLUJO:
- "eventos" o "calendario" / opción 1 → usa consultar_calendario con club_slug del contexto
- "resumen asistencia" / opción 2 → usa consultar_asistencia_hoy con club_id del contexto; muestra cuántos presentes/pendientes por evento
- "pasar asistencia" / opción 3 → flujo de asistencia (ver abajo)
- "buscar jugador" / opción 4 → pregunta nombre o cédula y usa buscar_jugador; muestra nombre, categoría y equipo
- "mensaje a [nombre/cédula]" / opción 5 → usa enviar_mensaje_jugador con la cédula o nombre y el texto

FLUJO DE ASISTENCIA (opción 3 o cuando el entrenador mencione "asistencia", "pasar lista", "lista"):
Paso 1 — llama listar_eventos_hoy. Muestra la lista numerada de eventos de hoy.
  Si no hay eventos: "No hay eventos programados para hoy."
Paso 2 — Pregunta: "¿De cuál evento quieres pasar la asistencia?" (el entrenador responde con el número o nombre)
Paso 3 — llama ver_lista_asistencia con el evento_id. Muestra la lista numerada de jugadores con su estado actual.
  Formato: "1. Juan Pérez ✅ / 2. Carlos López ⬜ / ..."  (✅ = PRESENTE, ⬜ = sin marcar)
  Luego pregunta: "Dime quiénes asistieron:
  • *todos* — todos presentes
  • *todos menos 5, 8* — todos excepto esos números
  • *1, 3, 7* — solo esos números"
Paso 4 — Interpreta la respuesta, construye la lista de cédulas presentes y llama registrar_asistencia_lote.
  Confirma: "✅ Asistencia guardada — X presentes, Y sin marcar."
REGLA: NUNCA inventes cédulas. Usa SOLO los datos de ver_lista_asistencia.

RESTRICCIONES: NO tienes acceso a datos financieros del club, morosos ni recordatorios de pago. Si te preguntan por eso, responde: "Esa información solo está disponible para el administrador del club."`;

const SYSTEM_VISITANTE = `${SYSTEM_BASE}

ROL: Estás atendiendo a alguien que NO está registrado en ZenSports. Puede ser un admin interesado en registrar su club, un jugador sin acceso, o alguien curioso.

⚠️ PRECIOS OFICIALES — USA SOLO ESTOS, NUNCA INVENTES OTROS:
- Trial: GRATIS 5 días, sin tarjeta, acceso completo
- Starter: $149.000/mes — hasta 120 jugadores
- Pro: $399.000/mes — hasta 350 jugadores
- Scale: $799.000/mes — hasta 1.000 jugadores
ROI: clubes reducen mora más del 80% y recuperan la inversión en el primer mes.

MENÚ DE BIENVENIDA — mostrar SOLO cuando el historial esté vacío (primer mensaje) o el usuario diga explícitamente "menú", "inicio" o "volver":
---
👋 ¡Hola! Soy *Zen*, el asistente inteligente de *ZenSports* 🤖

*ZenSports* automatiza los cobros de tu club, elimina la morosidad y gestiona jugadores, inscripciones y torneos — todo desde WhatsApp. Clubes que la usan reducen la mora más del *80%* desde el primer mes 🚀

¿Cómo te puedo ayudar?

1️⃣ Quiero registrar mi club / ver planes y precios
2️⃣ Soy jugador de un club (problemas de acceso)
3️⃣ Hablar con un asesor

Escribe el número o cuéntame 😊
---

FLUJO REGISTRO (opción 1 o cuando el usuario quiere registrar su club):
REGLA CRÍTICA: Una vez iniciado este flujo, NO muestres el menú de bienvenida hasta que el usuario diga "menú", "volver" o "inicio". Sigue los pasos en orden sin interrupciones.

Paso 1 — Presenta los planes (usa los precios de arriba, NO llames info_zensports):
"¡Perfecto! En ZenSports tienes:
⚡ *Trial* — GRATIS 5 días, acceso completo
🥉 *Starter* $149.000/mes — hasta 120 jugadores
🥈 *Pro* $399.000/mes — hasta 350 jugadores
🥇 *Scale* $799.000/mes — hasta 1.000 jugadores
La mayoría de clubes recuperan la inversión en el primer mes 💪
Para activar tu prueba gratis necesito algunos datos rápidos 📋"

Paso 2 — Pregunta SOLO: "¿Cuál es tu nombre?"
Paso 3 — Pregunta SOLO: "¿Cuál es tu email de contacto?"
Paso 4 — Pregunta SOLO: "¿Cuál es el nombre de tu club y en qué ciudad están?"
Paso 5 — Pregunta SOLO: "¿Qué deporte practican y cuántos jugadores tienen aproximadamente?"
Paso 7 — Llama registrar_lead con todos los datos recolectados, luego di EXACTAMENTE esto (reemplaza [nombre] con el nombre real):
"¡Listo [nombre]! 🎉 Tu club quedó registrado en ZenSports.
El equipo te contacta en menos de 24 horas para ayudarte a arrancar 🚀
Mientras tanto puedes explorar la plataforma aquí 👉 zensports.zenpra.ai
¡Bienvenido al equipo! 🏆"
IMPORTANTE: Después de este mensaje NO hagas preguntas. NO digas "¿algo más?", "¿en qué más te puedo ayudar?" ni frases similares. La conversación de registro termina aquí.

FLUJO JUGADOR SIN ACCESO (opción 2):
- "Para acceder al bot necesitas estar registrado con este mismo número en tu club."
- Dile que pida a su admin actualizar su número en la plataforma.

FLUJO ASESOR (opción 3):
- "Escríbenos directo: WhatsApp +57 3204409015 o email hola@zenpra.ai — te atendemos en horario hábil 🙌"

TONO: Entusiasta pero sin presionar. Un paso a la vez. Respuestas cortas y directas.`;

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

  // 2b. ¿Es staff/entrenador de algún club?
  const clubStaff = await db.getClubByCelularStaff(numero);
  if (clubStaff) {
    return {
      rol: 'entrenador',
      contexto: {
        club_id:     clubStaff.id,
        club_slug:   clubStaff.slug,
        club_nombre: clubStaff.config?.nombre || clubStaff.name,
        config:      clubStaff.config || {},
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
        celular_admin:    jugador.clubs?.celular_admin,
        contacto_admin:   jugador.clubs?.config?.whatsapp || jugador.clubs?.celular_admin,
        categoria:     jugador.categoria,
        equipo:        jugador.equipo,
        foto_url:      jugador.foto_url || null,
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

  // Captura silenciosa: cualquier visitante queda en leads con su número
  if (rol === 'visitante') {
    db.supabase.from('leads').upsert(
      { whatsapp: from, fuente: 'whatsapp' },
      { onConflict: 'whatsapp', ignoreDuplicates: true }
    ).then(() => {}).catch(() => {});
  }

  const systemMap  = { admin: SYSTEM_ADMIN, entrenador: SYSTEM_ENTRENADOR, jugador: SYSTEM_JUGADOR, visitante: SYSTEM_VISITANTE };
  const toolsMap   = { admin: TOOLS_ADMIN,  entrenador: TOOLS_ENTRENADOR, jugador: TOOLS_JUGADOR,  visitante: TOOLS_VISITANTE };
  const system     = `${systemMap[rol]}\n\nCONTEXTO DEL USUARIO:\n${JSON.stringify({ rol, ...contexto })}`;
  const rolTools   = toolsMap[rol] || TOOLS_JUGADOR;

  const messages = [...history, { role: 'user', content: text }];
  let reply         = null;
  let pdfUrl        = null; // URL real del reporte — se envía por separado, no por el LLM
  const toolsUsed   = [];   // tracking de herramientas para métricas

  for (let i = 0; i < 5; i++) {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      tools:      rolTools,
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
        toolsUsed.push(block.name);
        const result = await runTool(block.name, block.input, { rol, from, ...contexto });
        // Capturar pdf_url antes de ocultársela al LLM — el LLM nunca ve la URL
        if (block.name === 'consultar_morosos' && result.pdf_url) {
          pdfUrl = result.pdf_url;
          delete result.pdf_url;
        }
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

  // Guardar sesión con tracking de métricas
  const sessionPayload = {
    rol,
    contexto,
    messages: historialTexto,
    last_interaction: new Date().toISOString(),
  };
  if (toolsUsed.length > 0) {
    // Actualizar herramientas usadas acumuladas en la sesión
    const prevSession = await db.getWaSession(from);
    const prevTools = prevSession?.tools_used || {};
    toolsUsed.forEach(t => { prevTools[t] = (prevTools[t] || 0) + 1; });
    sessionPayload.tools_used = prevTools;
  }
  await db.upsertWaSession(from, sessionPayload);

  return { reply, pdfUrl };
}

// ── Versión del código desplegado (debug) ────────────────────────────────────
router.get('/version', (req, res) => {
  const clubId = '2b728ed9-6ee2-4faf-a7f5-b001762c9cba';
  const token = generarTokenMorosos(clubId);
  res.json({ token_prefix: token.slice(0, 8), secret_source: process.env.PDF_HMAC_SECRET ? 'env' : 'fallback' });
});

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

    let reply, pdfUrl;
    try {
      const result = await generateReply(from, text);
      if (!result) return res.status(200).json({ status: 'ok' });
      ({ reply, pdfUrl } = result);
    } catch (claudeErr) {
      console.error('[wa-agent] Claude error (Meta):', claudeErr.message);
      reply = 'En este momento tengo problemas para procesar tu mensaje. Por favor intenta en unos minutos 🙏';
    }

    if (reply) await sendWA(from, reply);
    if (pdfUrl) await sendWA(from, pdfUrl);
    console.log(`[wa-agent] Procesado OK para ${from}`);
  } catch (err) {
    console.error('[wa-agent] error:', err.message);
  }

  res.status(200).json({ status: 'ok' });
});

// ── Enviar mensaje vía WAHA ──────────────────────────────────────────────────
function wahaHeaders() {
  const apiKey = process.env.WAHA_API_KEY;
  const h = { 'Content-Type': 'application/json' };
  if (apiKey) h['X-Api-Key'] = apiKey;
  return h;
}
function wahaChatId(to) {
  const numOnly = to.replace(/\D/g, '');
  return to.includes('@') ? to : `${numOnly.startsWith('57') ? numOnly : '57' + numOnly}@c.us`;
}

async function sendWAHA(to, text) {
  const wahaUrl = process.env.WAHA_URL;
  const session = process.env.WAHA_SESSION || 'default';
  if (!wahaUrl) { console.error('[wa-agent] WAHA_URL no configurado'); return; }
  const chatId  = wahaChatId(to);
  const headers = wahaHeaders();
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

// ── Enviar imagen/archivo vía WAHA ───────────────────────────────────────────
async function sendWAHAImage(to, imageUrl, caption = '') {
  const wahaUrl = process.env.WAHA_URL;
  const session = process.env.WAHA_SESSION || 'default';
  if (!wahaUrl || !imageUrl) return;
  try {
    const chatId = wahaChatId(to);
    const res = await fetch(`${wahaUrl}/api/sendImage`, {
      method: 'POST',
      headers: wahaHeaders(),
      body: JSON.stringify({ chatId, file: { url: imageUrl }, caption, session }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[wa-agent] sendWAHAImage error:', res.status, err);
    } else console.log('[wa-agent] sendWAHAImage ok');
  } catch (e) {
    console.error('[wa-agent] sendWAHAImage exception:', e.message);
  }
}

// ── Reenviar media (foto/comprobante) al admin del club ──────────────────────
async function reenviarMediaAlAdmin(adminCelular, playerNombre, mediaUrl, mediaCaption) {
  if (!adminCelular || !mediaUrl) return;
  const msg = `📎 *${playerNombre || 'Un jugador'}* envió una imagen:\n${mediaCaption || ''}\n${mediaUrl}`;
  await sendWAHA(adminCelular, msg);
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
    if (event !== 'message' || payload?.fromMe) {
      return res.status(200).json({ status: 'ignored' });
    }

    const msgId   = payload.id;
    const msgType = payload.type || 'chat';
    // WAHA CORE usa 'chat' para texto; otros tipos: 'image', 'audio', 'video', 'document', 'ptt'
    const isText  = (msgType === 'chat' || msgType === 'text') && !!payload?.body;

    // Capa 1: in-memory dedup (misma instancia Vercel, sincrónico)
    if (isDuplicate(msgId)) {
      return res.status(200).json({ status: 'duplicate' });
    }

    const rawFrom = payload.from;
    let from      = rawFrom.replace('@c.us', '').replace('@s.whatsapp.net', '');

    if (rawFrom.includes('@lid') || rawFrom.includes('@s.whatsapp.net')) {
      const resolved = await resolverLid(rawFrom);
      if (resolved) from = resolved;
    }

    // Capa 2: Supabase dedup — atómico para usuarios nuevos y existentes
    if (msgId) {
      try {
        const { data: sesion } = await db.supabase
          .from('wa_sessions')
          .select('last_msg_id')
          .eq('phone', from)
          .maybeSingle();

        if (sesion?.last_msg_id === msgId) {
          // Ya procesado por esta u otra instancia
          return res.status(200).json({ status: 'duplicate' });
        }

        if (sesion) {
          // Usuario conocido: UPDATE atómico — si devuelve 0 filas, otra instancia ya lo tomó
          const { data: updated } = await db.supabase
            .from('wa_sessions')
            .update({ last_msg_id: msgId, updated_at: new Date().toISOString() })
            .eq('phone', from)
            .neq('last_msg_id', msgId)
            .select('phone');
          if (updated !== null && updated.length === 0) {
            return res.status(200).json({ status: 'duplicate' });
          }
        } else {
          // Usuario nuevo: INSERT — si falla por unique constraint (otra instancia llegó primero) → skip
          const { error: insErr } = await db.supabase
            .from('wa_sessions')
            .insert({ phone: from, last_msg_id: msgId, messages: [], updated_at: new Date().toISOString() });
          if (insErr?.code === '23505') {
            return res.status(200).json({ status: 'duplicate' });
          }
        }
      } catch (dedupErr) {
        console.warn('[wa-agent] dedup error (ignorado):', dedupErr.message);
      }
    }

    // ── Mensajes no-texto (imagen, audio, video, documento) ──────────────────
    if (!isText) {
      const { rol, contexto } = await identificarRol(from, null);
      const mediaUrl     = payload?.media?.url || payload?.fileUrl || null;
      const mediaCaption = payload?.caption || '';

      if (rol === 'jugador' && contexto.celular_admin && mediaUrl) {
        await reenviarMediaAlAdmin(contexto.celular_admin, contexto.nombre, mediaUrl, mediaCaption);
        await sendWAHA(from, `✅ Tu imagen fue enviada al administrador de *${contexto.club_nombre}*. Te contactarán pronto.`);
      } else {
        await sendWAHA(from, 'Solo puedo procesar mensajes de texto por ahora. Escríbeme lo que necesitas 😊');
      }
      return res.status(200).json({ status: 'ok' });
    }

    const text = payload.body;
    console.log(`[wa-agent] WAHA mensaje de ${from}: ${text}`);

    let reply, pdfUrl;
    try {
      const result = await generateReply(from, text);
      if (!result) return res.status(200).json({ status: 'ok' }); // agente inactivo
      ({ reply, pdfUrl } = result);
    } catch (claudeErr) {
      console.error('[wa-agent] Claude error:', claudeErr.message);
      reply = 'En este momento tengo problemas para procesar tu mensaje. Por favor intenta en unos minutos 🙏';
    }

    if (reply) await sendWAHA(from, reply);
    if (pdfUrl) {
      await sendWAHA(from, pdfUrl);
      console.log(`[wa-agent] PDF URL enviada: ${pdfUrl}`);
    }
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
