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
async function getPlayers(club_id, { incluirArchivados = false } = {}) {
  let query = supabase.from('players').select('*').eq('club_id', club_id);
  if (!incluirArchivados) query = query.eq('activo', true);
  const { data, error } = await query;
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
 * Buscar jugador por celular en TODOS los clubs (para el agente WA)
 */
async function getPlayerByCelularGlobal(celular) {
  const digits = String(celular).replace(/\D/g, '');
  const local  = digits.slice(-10); // últimos 10 dígitos (número local sin código de país)
  // Intentar todas las variantes: completo, con/sin +, sin código de país, con prefijo Colombia
  const { data, error } = await supabase
    .from('players')
    .select('*, clubs(slug, name, celular_admin, config)')
    .or(`celular.eq.${digits},celular.eq.+${digits},celular.eq.${local},celular.eq.57${local},celular.eq.+57${local}`)
    .eq('activo', true)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Buscar jugadores por nombre, apellidos o cédula (búsqueda parcial) dentro de un club
 */
async function searchPlayersByQuery(club_id, query) {
  const q = String(query).trim();
  const { data, error } = await supabase
    .from('players')
    .select('cedula, nombre, apellidos, celular, equipo, categoria')
    .eq('club_id', club_id)
    .eq('activo', true)
    .or(`nombre.ilike.%${q}%,apellidos.ilike.%${q}%,cedula.eq.${q}`)
    .limit(5);
  if (error) throw error;
  return data || [];
}

/**
 * Buscar club por celular del administrador (para identificar admins en el agente WA)
 */
async function getClubByCelularAdmin(celular) {
  const digits = String(celular).replace(/\D/g, '');
  const local  = digits.slice(-10);
  const { data, error } = await supabase
    .from('clubs')
    .select('id, slug, name, celular_admin, config')
    .or(`celular_admin.eq.${digits},celular_admin.eq.+${digits},celular_admin.eq.${local},celular_admin.eq.57${local},celular_admin.eq.+57${local}`)
    .eq('is_active', true)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getClubByCelularStaff(celular) {
  const digits = String(celular).replace(/\D/g, '');
  const local  = digits.slice(-10);
  const variants = [digits, local, `57${local}`];
  const { data, error } = await supabase
    .from('clubs')
    .select('id, slug, name, celular_admin, config')
    .eq('is_active', true);
  if (error) { console.error('[db] getClubByCelularStaff error:', error.message); return null; }
  return (data || []).find(club => {
    const staff = club.config?.celulares_staff;
    if (!Array.isArray(staff)) return false;
    return staff.some(n => {
      const nd = String(n).replace(/\D/g, '');
      return variants.includes(nd) || variants.includes(nd.slice(-10));
    });
  }) || null;
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
 * Obtener todos los clubs activos con su owner_user_id para secuencias de email
 */
async function getAllActiveClubs() {
  const { data, error } = await supabase
    .from('clubs')
    .select('id, slug, name, owner_user_id, created_at, config')
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

/**
 * Marcar un tipo de email como enviado en config.emails_enviados del club
 */
async function marcarEmailEnviado(club_id, email_key) {
  const { data: club } = await supabase.from('clubs').select('config').eq('id', club_id).single();
  const config = club?.config || {};
  const emails_enviados = { ...(config.emails_enviados || {}), [email_key]: new Date().toISOString() };
  const { error } = await supabase.from('clubs').update({ config: { ...config, emails_enviados } }).eq('id', club_id);
  if (error) throw error;
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
    'categoria', 'equipo', 'categorias',
    'deporte',
    'activo', 'descuento_pct', 'tipo_descuento',
  ];
  const fields = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  if (Object.keys(fields).length === 0) throw new Error('No hay campos válidos para actualizar');
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
 * Actualizar un partido
 */
async function updatePartido(id, club_id, updates) {
  const { data, error } = await supabase
    .from('partidos')
    .update(updates)
    .eq('id', id)
    .eq('club_id', club_id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Eliminar un partido y sus pagos asociados
 */
async function deletePartido(id, club_id) {
  await supabase.from('arbitraje_pagos').delete().eq('partido_id', id);
  const { error } = await supabase.from('partidos').delete().eq('id', id).eq('club_id', club_id);
  if (error) throw error;
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

async function getArbitrajePagosCountByPartido(club_id) {
  const { data, error } = await supabase
    .from('arbitraje_pagos')
    .select('partido_id')
    .eq('club_id', club_id);

  if (error) throw error;
  const countMap = {};
  (data || []).forEach(row => {
    countMap[row.partido_id] = (countMap[row.partido_id] || 0) + 1;
  });
  return Object.entries(countMap).map(([partido_id, count]) => ({ partido_id, count }));
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

async function deleteTorneo(id, club_id) {
  const q = supabase.from('torneos').delete().eq('id', id);
  const { error } = club_id ? await q.eq('club_id', club_id) : await q;
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

async function deleteFinanza(id, club_id) {
  const { error } = await supabase.from('finanzas').delete().eq('id', id).eq('club_id', club_id);
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

async function updateNominaEmpleado(id, club_id, fields) {
  const { data, error } = await supabase.from('nomina_empleados').update(fields).eq('id', id).eq('club_id', club_id).select().single();
  if (error) throw error;
  return data;
}

async function deleteNominaEmpleado(id, club_id) {
  const { error } = await supabase.from('nomina_empleados').delete().eq('id', id).eq('club_id', club_id);
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

async function deleteNominaPago(id, club_id) {
  const { error } = await supabase.from('nomina_pagos').delete().eq('id', id).eq('club_id', club_id);
  if (error) throw error;
}

// ── Club Members (Roles) ────────────────────────────────────────────────────

async function getClubMemberByUserId(user_id, club_slug) {
  const { data, error } = await supabase
    .from('club_members')
    .select('role, nombre, activo')
    .eq('user_id', user_id)
    .eq('club_id', club_slug)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getClubMembers(club_slug) {
  const { data, error } = await supabase
    .from('club_members')
    .select('id, user_id, role, nombre, activo')
    .eq('club_id', club_slug)
    .order('role');
  if (error) throw error;
  return data || [];
}

async function createClubMember(member) {
  const { data, error } = await supabase
    .from('club_members')
    .insert([member])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateClubMember(id, club_slug, updates) {
  const { data, error } = await supabase
    .from('club_members')
    .update(updates)
    .eq('id', id)
    .eq('club_id', club_slug)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteClubMember(id, club_slug) {
  const { error } = await supabase.from('club_members').delete().eq('id', id).eq('club_id', club_slug);
  if (error) throw error;
}

// ── Calendario ──────────────────────────────────────────────────────────────

async function getCalendario(club_id, desde, hasta) {
  let query = supabase
    .from('calendario')
    .select('*')
    .eq('club_id', club_id)
    .order('fecha_inicio', { ascending: true });
  if (desde) query = query.gte('fecha_inicio', desde);
  if (hasta) query = query.lte('fecha_inicio', hasta);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function createCalendarioEvent(evento) {
  const { data, error } = await supabase.from('calendario').insert([evento]).select().single();
  if (error) throw error;
  return data;
}

async function updateCalendarioEvent(id, club_id, updates) {
  const { data, error } = await supabase
    .from('calendario').update(updates).eq('id', id).eq('club_id', club_id).select().single();
  if (error) throw error;
  return data;
}

async function deleteCalendarioEvent(id, club_id) {
  const { error } = await supabase.from('calendario').delete().eq('id', id).eq('club_id', club_id);
  if (error) throw error;
}

// ── Asistencia ──────────────────────────────────────────────────────────────

async function getAsistencia(club_id, evento_id) {
  const { data: evento, error: evErr } = await supabase
    .from('calendario')
    .select('tipo, equipo')
    .eq('id', evento_id)
    .single();
  if (evErr) throw evErr;

  let playersQuery = supabase
    .from('players')
    .select('cedula, nombre, apellidos, equipo, categoria')
    .eq('club_id', club_id)
    .eq('activo', true)
    .order('nombre');

  if (evento.tipo === 'PARTIDO' && evento.equipo) {
    playersQuery = playersQuery.eq('equipo', evento.equipo);
  }

  const { data: players, error: plErr } = await playersQuery;
  if (plErr) throw plErr;

  const { data: registros } = await supabase
    .from('asistencia')
    .select('cedula, estado, nota')
    .eq('evento_id', evento_id);

  const estadoMap = {};
  (registros || []).forEach(r => { estadoMap[r.cedula] = r; });

  return (players || []).map(p => ({
    cedula:    p.cedula,
    nombre:    p.nombre,
    apellidos: p.apellidos,
    equipo:    p.equipo,
    categoria: p.categoria,
    estado:    estadoMap[p.cedula]?.estado || 'PENDIENTE',
    nota:      estadoMap[p.cedula]?.nota   || null,
  }));
}

async function getAsistenciaJugador(club_id, cedula) {
  const { data, error } = await supabase
    .from('asistencia')
    .select('estado, evento_id, calendario(tipo, titulo, fecha_inicio, equipo)')
    .eq('club_id', club_id)
    .eq('cedula', cedula)
    .order('calendario(fecha_inicio)', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data || [];
}

async function upsertAsistencia({ club_id, evento_id, cedula, estado, nota, registrado_por }) {
  const { data, error } = await supabase
    .from('asistencia')
    .upsert(
      { evento_id, club_id, cedula, estado, nota, registrado_por, updated_at: new Date().toISOString() },
      { onConflict: 'evento_id,cedula' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Sesiones WhatsApp ───────────────────────────────────────────────────────

async function getWaSession(phone) {
  const { data } = await supabase
    .from('wa_sessions')
    .select('*')
    .eq('phone', phone)
    .single();
  return data || null;
}

async function upsertWaSession(phone, { rol, contexto, messages, last_interaction, tools_used }) {
  const payload = { phone, rol, contexto, messages, updated_at: new Date().toISOString() };
  if (last_interaction) payload.last_interaction = last_interaction;
  if (tools_used)       payload.tools_used       = tools_used;
  const { error } = await supabase
    .from('wa_sessions')
    .upsert(payload, { onConflict: 'phone' });
  if (error) console.error('[db] upsertWaSession error:', error.message);
}

/**
 * Normaliza el campo de deportes del club: acepta string legacy o array nuevo.
 * Siempre devuelve un array no vacío.
 */
function getDeportesClub(club) {
  const config = club?.config || {};
  if (Array.isArray(config.deportes) && config.deportes.length > 0) return config.deportes;
  if (typeof config.deporte === 'string' && config.deporte) return [config.deporte];
  return ['futbol'];
}

module.exports = {
  supabase,
  supabase,
  getWaSession,
  upsertWaSession,
  getClubBySlug,
  getPlayers,
  getPlayerByCedula,
  getPlayerByCelular,
  getPlayerByCelularGlobal,
  getClubByCelularAdmin,
  getClubByCelularStaff,
  searchPlayersByQuery,
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
  updatePartido,
  deletePartido,
  getArbitrajePagos,
  getArbitrajePagosCountByPartido,
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
  getClubMemberByUserId,
  getClubMembers,
  createClubMember,
  updateClubMember,
  deleteClubMember,
  getCalendario,
  createCalendarioEvent,
  updateCalendarioEvent,
  deleteCalendarioEvent,
  getAsistencia,
  getAsistenciaJugador,
  upsertAsistencia,
  getAllActiveClubs,
  marcarEmailEnviado,
  getDeportesClub,
};
