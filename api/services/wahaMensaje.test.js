// Corré con:  node --test services/wahaMensaje.test.js
// Formas de payload reales (anonimizadas) capturadas de WAHA 2026.9.1 con motor NOWEB el
// 29 sep 2026, más la forma que manda WEBJS (tipo en _data.type).

const test = require('node:test');
const assert = require('node:assert/strict');
const { tipoMedia, esTexto, esMensajeVacio } = require('./wahaMensaje');

const noweb = (extra) => ({ id: 'x', from: '100000000000001@lid', fromMe: false, hasMedia: false, body: null, media: null,
  _data: { key: {}, message: {} }, ...extra });

test('NOWEB: texto', () => {
  const p = noweb({ body: 'Hola, quiero saber mi estado de cuenta' });
  assert.equal(esTexto(p), true);
  assert.equal(tipoMedia(p), '');
  assert.equal(esMensajeVacio(p), false);
});

test('NOWEB: foto con descripción es imagen, no texto', () => {
  const p = noweb({ body: 'Mensualidad', hasMedia: true, media: { url: 'http://localhost:8080/api/files/default/A.jpeg', mimetype: 'image/jpeg' } });
  assert.equal(esTexto(p), false);
  assert.equal(tipoMedia(p), 'image');
});

test('NOWEB: foto sin descripción', () => {
  const p = noweb({ hasMedia: true, media: { url: 'http://localhost:8080/api/files/default/B.jpeg', mimetype: 'image/jpeg' } });
  assert.equal(tipoMedia(p), 'image');
  assert.equal(esMensajeVacio(p), false);
});

test('NOWEB: aviso interno sin texto ni archivo se ignora', () => {
  assert.equal(esMensajeVacio(noweb({})), true);
  assert.equal(esTexto(noweb({})), false);
});

test('NOWEB: audio y documento por mimetype', () => {
  assert.equal(tipoMedia(noweb({ hasMedia: true, media: { mimetype: 'audio/ogg; codecs=opus' } })), 'audio');
  assert.equal(tipoMedia(noweb({ hasMedia: true, media: { mimetype: 'application/pdf' } })), 'document');
});

test('WEBJS: el tipo explícito se sigue respetando', () => {
  const texto = { body: 'hola', hasMedia: false, _data: { type: 'chat' } };
  const foto = { body: '', hasMedia: true, media: { mimetype: 'image/jpeg' }, _data: { type: 'image' } };
  const nota = { body: '', hasMedia: true, media: { mimetype: 'audio/ogg' }, _data: { type: 'ptt' } };
  assert.equal(esTexto(texto), true);
  assert.equal(tipoMedia(foto), 'image');
  assert.equal(tipoMedia(nota), 'ptt');
  assert.equal(esMensajeVacio({ body: '', hasMedia: false, _data: { type: 'location' } }), false);
});
