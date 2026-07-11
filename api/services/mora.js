// Criterio único de "mes causado en mora" — mismo que ya usaban reports.js (dashboard)
// y publico.js (portal del jugador). Nunca cuenta meses futuros del año que aún no se
// causan; el mes actual solo cuenta como mora después de los 7 días de gracia; un abono
// PARCIAL en el mes actual no cuenta como mora todavía; meses SUSPENDIDO no cuentan.
function mesesEnMora(mensualidades, cedula, anio, mesActual, pastGracePeriod, suspensiones = []) {
  const isSuspendido = (mesNum) => (suspensiones || []).some(s =>
    String(s.cedula) === String(cedula) && parseInt(s.anio) === anio && s.mes_inicio <= mesNum && mesNum <= s.mes_fin);

  return (mensualidades || []).filter(m => {
    if (String(m.anio) !== String(anio)) return false;
    if (m.estado === 'AL_DIA' || m.estado === 'EXENTO' || m.estado === 'SUSPENDIDO') return false;
    const mesNum = parseInt(m.numero_mes);
    if (isSuspendido(mesNum)) return false;
    if (m.estado === 'PARCIAL' && mesNum === mesActual) return false;
    if (mesNum < mesActual) return true;
    if (mesNum === mesActual && pastGracePeriod) return true;
    return false;
  });
}

module.exports = { mesesEnMora };
