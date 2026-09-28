// Criterio único de "mes causado en mora" — mismo que ya usaban reports.js (dashboard)
// y publico.js (portal del jugador). Nunca cuenta meses futuros del año que aún no se
// causan; el mes actual solo cuenta como mora después de los 7 días de gracia; un abono
// PARCIAL en el mes actual no cuenta como mora todavía; meses SUSPENDIDO no cuentan.
function mesesEnMora(mensualidades, cedula, anio, mesActual, pastGracePeriod, suspensiones = []) {
  const isSuspendido = (mesNum) => (suspensiones || []).some(s =>
    s.activa && String(s.cedula) === String(cedula) && parseInt(s.anio) === anio && s.mes_inicio <= mesNum && mesNum <= s.mes_fin);

  return (mensualidades || []).filter(m => {
    if (String(m.anio) !== String(anio)) return false;
    if (m.estado === 'AL_DIA' || m.estado === 'EXENTO' || m.estado === 'SUSPENDIDO' || m.estado === 'NO_APLICA') return false;
    const mesNum = parseInt(m.numero_mes);
    if (isSuspendido(mesNum)) return false;
    if (m.estado === 'PARCIAL' && mesNum === mesActual) return false;
    if (mesNum < mesActual) return true;
    if (mesNum === mesActual && pastGracePeriod) return true;
    return false;
  });
}

const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const ESTADOS_NO_CAUSADOS = new Set(['EXENTO', 'SUSPENDIDO', 'NO_APLICA']);
const OFFSET_COL_MS = 5 * 3600 * 1000; // Colombia = UTC-5, sin horario de verano

// % de jugadores activos que estaban en mora AL CIERRE de cada mes del año, desde
// enero hasta el mes en curso. Reconstruye la historia cruzando lo causado (valor_oficial
// de los meses ≤ m) contra lo pagado hasta esa fecha (pagos aprobados de mensualidad por
// created_at): un jugador que pagó enero en febrero cuenta como moroso al cierre de enero
// y al día al cierre de febrero. El mes en curso se corta en `hoy` y solo se causa pasados
// los días de gracia.
//
// `confiable` es false cuando la suma de pagos no cuadra con la suma de valor_pagado de las
// mensualidades (±10%) — p.ej. clubes con estados importados de Excel sin filas en pagos:
// ahí la reconstrucción daría una mora falsa, y el dashboard no debe mostrarla.
function evolucionMora({ mensualidades, pagos, jugadores, suspensiones = [], anio, hoy = new Date(), diasGracia = 7 }) {
  const anioNum = parseInt(anio);
  const hoyCol  = new Date(hoy.getTime() - OFFSET_COL_MS);
  const mesActual = hoyCol.getUTCFullYear() > anioNum ? 12
    : hoyCol.getUTCFullYear() < anioNum ? 0
    : hoyCol.getUTCMonth() + 1;
  const pasoGracia = hoyCol.getUTCFullYear() !== anioNum || hoyCol.getUTCDate() > diasGracia;

  const activos = new Set((jugadores || []).map(j => String(j.cedula)));
  const suspendido = (cedula, mesNum) => (suspensiones || []).some(s =>
    s.activa && String(s.cedula) === cedula && parseInt(s.anio) === anioNum && s.mes_inicio <= mesNum && mesNum <= s.mes_fin);

  const causadoPorJugador = {};
  let totalValorPagado = 0;
  (mensualidades || []).forEach(m => {
    if (parseInt(m.anio) !== anioNum) return;
    const cedula = String(m.cedula);
    if (!activos.has(cedula)) return;
    totalValorPagado += parseFloat(m.valor_pagado) || 0;
    const mesNum = parseInt(m.numero_mes);
    const valor  = parseFloat(m.valor_oficial) || 0;
    if (valor <= 0 || ESTADOS_NO_CAUSADOS.has(m.estado) || suspendido(cedula, mesNum)) return;
    (causadoPorJugador[cedula] = causadoPorJugador[cedula] || []).push({ mesNum, valor });
  });

  const pagosPorJugador = {};
  let totalPagos = 0;
  (pagos || []).forEach(p => {
    const cedula = String(p.cedula);
    if (!activos.has(cedula)) return;
    if (p.estado_revision !== 'aprobado_manual') return;
    if (!String(p.concepto || '').startsWith('mensualidad')) return;
    const monto = parseFloat(p.monto) || 0;
    const t = new Date(p.created_at).getTime();
    if (new Date(t - OFFSET_COL_MS).getUTCFullYear() === anioNum) totalPagos += monto;
    (pagosPorJugador[cedula] = pagosPorJugador[cedula] || []).push({ t, monto });
  });

  const meses = [];
  for (let m = 1; m <= mesActual; m++) {
    const esActual = m === mesActual && hoyCol.getUTCFullYear() === anioNum;
    const corte = esActual ? hoy.getTime() : Date.UTC(anioNum, m, 1) + OFFSET_COL_MS;
    const ultimoMesCausado = esActual && !pasoGracia ? m - 1 : m;
    let total = 0, morosos = 0;
    Object.entries(causadoPorJugador).forEach(([cedula, filas]) => {
      const causado = filas.filter(f => f.mesNum <= ultimoMesCausado).reduce((s, f) => s + f.valor, 0);
      if (causado <= 0) return;
      total++;
      const pagado = (pagosPorJugador[cedula] || []).filter(p => p.t < corte).reduce((s, p) => s + p.monto, 0);
      if (causado - pagado > 1) morosos++;
    });
    meses.push({ numero_mes: m, mes: MESES_NOMBRE[m - 1], total, morosos,
      porcentaje: total ? Math.round((morosos / total) * 100) : 0 });
  }

  const confiable = totalValorPagado > 0 && Math.abs(totalPagos - totalValorPagado) <= totalValorPagado * 0.1;
  return { anio: anioNum, confiable, meses };
}

module.exports = { mesesEnMora, evolucionMora };
