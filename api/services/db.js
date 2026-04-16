const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Faltan variables de entorno: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Obtener todos los jugadores activos de un club
 */
async function getPlayers(club_id) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('club_id', club_id)
    .eq('activo', true);

  if (error) throw error;
  return data;
}

/**
 * Buscar un jugador por cédula dentro de un club
 */
async function getPlayerByCedula(club_id, cedula) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('club_id', club_id)
    .eq('cedula', String(cedula))
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Obtener el club_id por su slug (ej: 'city-fc')
 */
async function getClubBySlug(slug) {
  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Obtener mensualidades de un club (todas o filtradas por cédula)
 */
async function getMensualidades(club_id, cedula = null) {
  let query = supabase
    .from('mensualidades')
    .select('*')
    .eq('club_id', club_id);

  if (cedula) query = query.eq('cedula', String(cedula));

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Actualizar una mensualidad por su id
 */
async function updateMensualidad(id, updates) {
  const { data, error } = await supabase
    .from('mensualidades')
    .update({ ...updates, fecha_ultima_actualizacion: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Obtener uniformes de un club
 */
async function getUniformes(club_id, cedula = null) {
  let query = supabase
    .from('uniformes')
    .select('*')
    .eq('club_id', club_id);

  if (cedula) query = query.eq('cedula', String(cedula));

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Obtener torneos de un club
 */
async function getTorneos(club_id, cedula = null) {
  let query = supabase
    .from('torneos')
    .select('*')
    .eq('club_id', club_id);

  if (cedula) query = query.eq('cedula', String(cedula));

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Registrar un pago
 */
async function createPago(pagoData) {
  const { data, error } = await supabase
    .from('pagos')
    .insert([pagoData])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Obtener pagos de un club
 */
async function getPagos(club_id, { cedula, limit = 50 } = {}) {
  let query = supabase
    .from('pagos')
    .select('*')
    .eq('club_id', club_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cedula) query = query.eq('cedula', String(cedula));

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Insertar un jugador nuevo
 */
async function createPlayer(playerData) {
  const { data, error } = await supabase
    .from('players')
    .insert([playerData])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Insertar múltiples filas en una tabla
 */
async function bulkInsert(table, rows) {
  const { data, error } = await supabase
    .from(table)
    .insert(rows)
    .select();

  if (error) throw error;
  return data;
}

/**
 * Obtener partidos de un club
 */
async function getPartidos(club_id) {
  const { data, error } = await supabase
    .from('partidos')
    .select('*')
    .eq('club_id', club_id)
    .order('fecha', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Crear un partido
 */
async function createPartido(partidoData) {
  const { data, error } = await supabase
    .from('partidos')
    .insert([partidoData])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Obtener pagos de arbitraje por partido
 */
async function getArbitrajePagos(club_id, partido_id) {
  const { data, error } = await supabase
    .from('arbitraje_pagos')
    .select('*')
    .eq('club_id', club_id)
    .eq('partido_id', partido_id);

  if (error) throw error;
  return data;
}

/**
 * Registrar pago de arbitraje
 */
async function createArbitrajePago(pagoData) {
  const { data, error } = await supabase
    .from('arbitraje_pagos')
    .insert([pagoData])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Mensualidades pendientes de un jugador (para procesar pagos)
 */
async function getMensualidadesPendientes(club_id, cedula) {
  const { data, error } = await supabase
    .from('mensualidades')
    .select('*')
    .eq('club_id', club_id)
    .eq('cedula', String(cedula))
    .in('estado', ['PENDIENTE', 'PARCIAL', 'MORA'])
    .order('numero_mes', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Uniformes pendientes de un jugador
 */
async function getUniformesPendientes(club_id, cedula) {
  const { data, error } = await supabase
    .from('uniformes')
    .select('*')
    .eq('club_id', club_id)
    .eq('cedula', String(cedula))
    .neq('estado', 'AL_DIA');
  if (error) throw error;
  return data;
}

async function updateUniforme(id, updates) {
  const { data, error } = await supabase
    .from('uniformes')
    .update({ ...updates, fecha_ultima_actualizacion: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Torneos pendientes de un jugador
 */
async function getTorneosPendientes(club_id, cedula) {
  const { data, error } = await supabase
    .from('torneos')
    .select('*')
    .eq('club_id', club_id)
    .eq('cedula', String(cedula))
    .neq('estado', 'AL_DIA');
  if (error) throw error;
  return data;
}

async function updateTorneo(id, updates) {
  const { data, error } = await supabase
    .from('torneos')
    .update({ ...updates, fecha_ultima_actualizacion: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Pedidos de uniformes
 */
async function getPedidoUniformes(club_id) {
  const { data, error } = await supabase
    .from('pedido_uniformes')
    .select('*')
    .eq('club_id', club_id);
  if (error) throw error;
  return data;
}

async function createPedidoUniforme(pedidoData) {
  const { data, error } = await supabase
    .from('pedido_uniformes')
    .insert([pedidoData])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Suspensiones de mensualidades
 */
async function getSuspensiones(club_id) {
  const { data, error } = await supabase
    .from('suspensiones')
    .select('*')
    .eq('club_id', club_id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getSuspensionesJugador(club_id, cedula) {
  const { data, error } = await supabase
    .from('suspensiones')
    .select('*')
    .eq('club_id', club_id)
    .eq('cedula', String(cedula))
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createSuspension(suspensionData) {
  const { data, error } = await supabase
    .from('suspensiones')
    .insert([suspensionData])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deactivateSuspension(id, club_id) {
  const { data, error } = await supabase
    .from('suspensiones')
    .update({ activa: false })
    .eq('id', id)
    .eq('club_id', club_id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Actualizar pago de arbitraje por id
 */
async function updateArbitrajePago(id, updates) {
  const { data, error } = await supabase
    .from('arbitraje_pagos')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  supabase,
  getClubBySlug,
  getPlayers,
  getPlayerByCedula,
  getMensualidades,
  getMensualidadesPendientes,
  updateMensualidad,
  getUniformes,
  getUniformesPendientes,
  updateUniforme,
  getTorneos,
  getTorneosPendientes,
  updateTorneo,
  createPago,
  getPagos,
  createPlayer,
  bulkInsert,
  getPartidos,
  createPartido,
  getArbitrajePagos,
  createArbitrajePago,
  updateArbitrajePago,
  getPedidoUniformes,
  createPedidoUniforme,
  getSuspensiones,
  getSuspensionesJugador,
  createSuspension,
  deactivateSuspension,
};
