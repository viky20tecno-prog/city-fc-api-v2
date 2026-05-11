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
 * Buscar un jugador por número de celular (usado por flujo WhatsApp)
 */
async function getPlayerByCelular(club_id, celular) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('club_id', club_id)
    .eq('celular', String(celular))
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
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
 * Obtener pagos de un club (con datos del jugador)
 */
async function getPagos(club_id, { cedula, estado_revision, limit = 100 } = {}) {
  let query = supabase
    .from('pagos')
    .select('*, players(nombre, apellidos, celular)')
    .eq('club_id', club_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cedula)           query = query.eq('cedula', String(cedula));
  if (estado_revision)  query = query.eq('estado_revision', estado_revision);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Obtener un pago por id
 */
async function getPagoById(id) {
  const { data, error } = await supabase
    .from('pagos')
    .select('*, players(nombre, apellidos, celular)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Actualizar un pago
 */
async function updatePago(id, updates) {
  const { data, error } = await supabase
    .from('pagos')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Actualizar campos del perfil de un jugador
 */
async function updatePlayer(club_id, cedula, updates) {
  const allowed = [
    'foto_url', 'posicion', 'numero_camiseta',
    'tipo_id', 'nombre', 'apellidos', 'celular',
    'correo_electronico', 'instagram',
    'lugar_de_nacimiento', 'fecha_nacimiento', 'tipo_sangre', 'eps',
    'estatura', 'peso',
    'municipio', 'barrio', 'direccion',
    'familiar_emergencia', 'celular_contacto', 'notas',
  ];
  const fields = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  const { data, error } = await supabase
    .from('players')
    .update(fields)
    .eq('club_id', club_id)
    .eq('cedula', String(cedula))
    .select()
    .single();
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
    .gt('valor_oficial', 0)
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

async function deleteTorneo(id) {
  const { error } = await supabase.from('torneos').delete().eq('id', id);
  if (error) throw error;
}

async function createTorneosInscripcion(rows) {
  const { data, error } = await supabase
    .from('torneos')
    .insert(rows)
    .select();
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

async function updatePedidoUniforme(id, fields) {
  const { data, error } = await supabase
    .from('pedido_uniformes')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deletePedidoUniforme(id) {
  const { error } = await supabase
    .from('pedido_uniformes')
    .delete()
    .eq('id', id);
  if (error) throw error;
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

async function deletePlayer(club_id, cedula) {
  const { error } = await supabase
    .from('players')
    .update({ activo: false })
    .eq('club_id', club_id)
    .eq('cedula', String(cedula));
  if (error) throw error;
}

/**
 * Marcar mensualidad en MORA y aplicar penalidad (solo una vez por mes)
 */
async function aplicarMoraConPenalidad(mensualidad_id, penalidad = 10000) {
  const { data: mens, error: fetchErr } = await supabase
    .from('mensualidades')
    .select('valor_oficial, valor_pagado, penalidad')
    .eq('id', mensualidad_id)
    .single();
  if (fetchErr) throw fetchErr;

  // Guard: no aplicar penalidad dos veces
  if (parseFloat(mens.penalidad) > 0) return null;

  const oficial    = parseFloat(mens.valor_oficial) || 0;
  const yaPageado  = parseFloat(mens.valor_pagado)  || 0;
  const nuevoSaldo = Math.max(0, oficial + penalidad - yaPageado);

  const { data, error } = await supabase
    .from('mensualidades')
    .update({
      estado:                    'MORA',
      penalidad,
      saldo_pendiente:           nuevoSaldo,
      fecha_ultima_actualizacion: new Date().toISOString(),
    })
    .eq('id', mensualidad_id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ─── Finanzas (ingresos y gastos) ─────────────────────────── */

async function getFinanzas(club_id, { desde, hasta } = {}) {
  let q = supabase.from('finanzas').select('*').eq('club_id', club_id).order('fecha', { ascending: false });
  if (desde) q = q.gte('fecha', desde);
  if (hasta) q = q.lte('fecha', hasta);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function createFinanza(record) {
  const { data, error } = await supabase.from('finanzas').insert([record]).select().single();
  if (error) throw error;
  return data;
}

async function deleteFinanza(id) {
  const { error } = await supabase.from('finanzas').delete().eq('id', id);
  if (error) throw error;
}

/* ─── Nómina — empleados ────────────────────────────────────── */

async function getNominaEmpleados(club_id) {
  const { data, error } = await supabase
    .from('nomina_empleados').select('*').eq('club_id', club_id).order('nombre');
  if (error) throw error;
  return data;
}

async function createNominaEmpleado(record) {
  const { data, error } = await supabase.from('nomina_empleados').insert([record]).select().single();
  if (error) throw error;
  return data;
}

async function updateNominaEmpleado(id, fields) {
  const { data, error } = await supabase.from('nomina_empleados').update(fields).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function deleteNominaEmpleado(id) {
  const { error } = await supabase.from('nomina_empleados').delete().eq('id', id);
  if (error) throw error;
}

/* ─── Nómina — pagos ────────────────────────────────────────── */

async function getNominaPagos(club_id, mes) {
  let q = supabase.from('nomina_pagos').select('*, nomina_empleados(nombre,cargo)').eq('club_id', club_id);
  if (mes) q = q.eq('mes', mes);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createNominaPago(record) {
  const { data, error } = await supabase.from('nomina_pagos').insert([record]).select('*, nomina_empleados(nombre,cargo)').single();
  if (error) throw error;
  return data;
}

async function deleteNominaPago(id) {
  const { error } = await supabase.from('nomina_pagos').delete().eq('id', id);
  if (error) throw error;
}

module.exports = {
  supabase,
  getClubBySlug,
  getPlayers,
  getPlayerByCedula,
  getPlayerByCelular,
  updatePlayer,
  deletePlayer,
  getMensualidades,
  getMensualidadesPendientes,
  updateMensualidad,
  getUniformes,
  getUniformesPendientes,
  updateUniforme,
  getTorneos,
  deleteTorneo,
  createTorneosInscripcion,
  getTorneosPendientes,
  updateTorneo,
  createPago,
  getPagos,
  getPagoById,
  updatePago,
  createPlayer,
  bulkInsert,
  getPartidos,
  createPartido,
  getArbitrajePagos,
  createArbitrajePago,
  updateArbitrajePago,
  getPedidoUniformes,
  createPedidoUniforme,
  updatePedidoUniforme,
  deletePedidoUniforme,
  getSuspensiones,
  getSuspensionesJugador,
  createSuspension,
  deactivateSuspension,
  aplicarMoraConPenalidad,
  getFinanzas,
  createFinanza,
  deleteFinanza,
  getNominaEmpleados,
  createNominaEmpleado,
  updateNominaEmpleado,
  deleteNominaEmpleado,
  getNominaPagos,
  createNominaPago,
  deleteNominaPago,
};
