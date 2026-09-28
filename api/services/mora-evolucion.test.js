// Corré con:  node --test services/mora-evolucion.test.js
//
// evolucionMora reconstruye "qué % de jugadores estaba en mora al cierre de cada mes"
// cruzando lo causado (mensualidades) contra lo pagado HASTA esa fecha (pagos.created_at).

const test = require('node:test');
const assert = require('node:assert/strict');
const { evolucionMora } = require('./mora');

const mens = (cedula, numero_mes, valor_oficial = 100, estado = 'AL_DIA') =>
  ({ cedula, anio: 2026, numero_mes, mes: String(numero_mes), valor_oficial, estado });
const pago = (cedula, monto, fecha, extra = {}) =>
  ({ cedula, monto, created_at: fecha, concepto: 'mensualidad', estado_revision: 'aprobado_manual', ...extra });

const base = { anio: 2026, hoy: new Date('2026-03-20T12:00:00Z'), diasGracia: 7, suspensiones: [] };

test('pago tardío: en mora al cierre de enero, al día al cierre de febrero', () => {
  const r = evolucionMora({
    ...base,
    jugadores: [{ cedula: 'A' }],
    mensualidades: [mens('A', 1), mens('A', 2), mens('A', 3)],
    pagos: [pago('A', 200, '2026-02-10T15:00:00Z'), pago('A', 100, '2026-03-05T15:00:00Z')],
  });
  assert.deepEqual(r.meses.map(m => m.porcentaje), [100, 0, 0]);
  assert.equal(r.meses.length, 3);
});

test('mes en curso solo se causa pasados los días de gracia', () => {
  const args = {
    ...base,
    jugadores: [{ cedula: 'A' }],
    mensualidades: [mens('A', 3)],
    pagos: [],
  };
  assert.equal(evolucionMora({ ...args, hoy: new Date('2026-03-05T12:00:00Z') }).meses[2].morosos, 0);
  assert.equal(evolucionMora(args).meses[2].morosos, 1);
});

test('NO_APLICA, EXENTO, valor 0 y meses suspendidos no se causan', () => {
  const r = evolucionMora({
    ...base,
    jugadores: [{ cedula: 'A' }, { cedula: 'B' }, { cedula: 'C' }],
    mensualidades: [mens('A', 1, 100, 'NO_APLICA'), mens('B', 1, 0), mens('C', 1, 100, 'MORA')],
    suspensiones: [{ cedula: 'C', anio: 2026, mes_inicio: 1, mes_fin: 2, activa: true }],
    pagos: [],
  });
  assert.equal(r.meses[0].morosos, 0);
  assert.equal(r.meses[0].total, 0);
  assert.equal(r.meses[0].porcentaje, 0);
});

test('solo cuentan pagos aprobados de mensualidad y jugadores activos', () => {
  const r = evolucionMora({
    ...base,
    jugadores: [{ cedula: 'A' }],
    mensualidades: [mens('A', 1), mens('Z', 1)],
    pagos: [
      pago('A', 100, '2026-01-05T15:00:00Z', { estado_revision: 'pendiente' }),
      pago('A', 100, '2026-01-06T15:00:00Z', { concepto: 'uniforme' }),
    ],
  });
  assert.equal(r.meses[0].total, 1);
  assert.equal(r.meses[0].morosos, 1);
});

test('confiable = false cuando los pagos no cuadran con valor_pagado (estados importados)', () => {
  const args = {
    ...base,
    jugadores: [{ cedula: 'A' }],
    mensualidades: [{ ...mens('A', 1), valor_pagado: 100 }],
  };
  assert.equal(evolucionMora({ ...args, pagos: [] }).confiable, false);
  assert.equal(evolucionMora({ ...args, pagos: [pago('A', 100, '2026-01-03T15:00:00Z')] }).confiable, true);
});
