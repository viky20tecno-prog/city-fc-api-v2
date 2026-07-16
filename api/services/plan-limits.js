// Límites de jugadores/admins/entrenadores por plan — deben coincidir con lo
// que se vende en la tabla de precios del landing (dashboard/src/pages/
// LandingPage.jsx). Antes solo el plan free tenía tope real; Starter/Pro/
// Scale prometían límites en el landing que ningún código hacía cumplir —
// un club en Starter ($149.000/mes) podía cargar 1.000+ jugadores sin
// ninguna restricción, obteniendo capacidad de Scale al precio de Starter.
const PLAN_LIMITS = {
  // entrenadores: 0 a propósito — el comportamiento original de free (antes
  // de este fix) bloqueaba CUALQUIER miembro nuevo sin importar el rol; no
  // se quiso aflojar eso de paso al generalizar el chequeo a los planes pagos.
  free:    { jugadores: 20,        admins: 1,        entrenadores: 0 },
  trial:   { jugadores: Infinity,  admins: Infinity, entrenadores: Infinity },
  starter: { jugadores: 120,       admins: 3,        entrenadores: 5 },
  pro:     { jugadores: 350,       admins: 10,       entrenadores: 20 },
  scale:   { jugadores: 1000,      admins: Infinity, entrenadores: Infinity },
  total:   { jugadores: Infinity,  admins: Infinity, entrenadores: Infinity },
};

function limiteDe(plan, campo) {
  return PLAN_LIMITS[plan]?.[campo] ?? PLAN_LIMITS.trial[campo];
}

module.exports = { PLAN_LIMITS, limiteDe };
