// Corré con:  node --test api/services/mora.test.js   (Node 18+, sin dependencias)
//
// Verifica api/services/mora.js#mesesEnMora contra los vectores compartidos con el
// dashboard. El MISMO archivo de vectores vive en dashboard/src/test/fixtures/ y ahí
// se corre contra el espejo dashboard/src/lib/estadoCuenta.js. Si el criterio de mora
// se toca en un solo repo, el checksum o algún vector falla acá.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { mesesEnMora } = require('./mora');

const vectorsPath = path.join(__dirname, '__fixtures__', 'mora-vectors.json');
const data = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

test('el archivo de vectores no se editó sin recalcular el checksum', () => {
  const suma = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(data.vectores)).digest('hex');
  assert.equal(suma, data.checksum,
    'mora-vectors.json cambió: recalculá "checksum" y copiá el archivo idéntico al otro repo');
});

for (const v of data.vectores) {
  test(`mesesEnMora — ${v.nombre}`, () => {
    const marcados = mesesEnMora(v.mensualidades, v.cedula, v.anio, v.mesActual, v.pastGracePeriod, v.suspensiones)
      .map(m => parseInt(m.numero_mes))
      .sort((a, b) => a - b);
    assert.deepEqual(marcados, v.esperado);
  });
}
