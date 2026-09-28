// Borra COMPLETO el club demo "Zensports FC" (slug zensports-fc): todas sus filas en la BD,
// sus archivos en Storage y las cuentas demo de Auth. No toca ningún otro club.
//
// Uso (desde api/api/):
//   node scripts/borrar_zensports_fc.js           # dry-run: muestra qué borraría
//   node scripts/borrar_zensports_fc.js --apply   # borra

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const SLUG = 'zensports-fc';
const EMAILS_DEMO = ['demo@zenpra.ai', 'demo.futbol@zenpra.ai', 'demo.voleibol@zenpra.ai'];
const TABLAS_POR_UUID = ['mensualidades', 'pagos', 'torneos', 'pedido_uniformes', 'suspensiones', 'finanzas', 'nomina_pagos',
  'nomina_empleados', 'wa_log_envios', 'club_documents', 'plantillas_mensajes', 'club_activity_logs', 'uniformes', 'arbitraje_pagos', 'partidos'];

async function listarArchivos(sb, bucket, carpeta) {
  const rutas = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(carpeta, { limit: 1000, offset });
    if (error || !data?.length) break;
    for (const f of data) {
      const ruta = `${carpeta}/${f.name}`;
      if (f.id) rutas.push(ruta); else rutas.push(...await listarArchivos(sb, bucket, ruta));
    }
    if (data.length < 1000) break;
  }
  return rutas;
}

async function usuariosDemo(sb) {
  const ids = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    data.users.filter(u => EMAILS_DEMO.includes((u.email || '').toLowerCase())).forEach(u => ids.push(u.id));
    if (data.users.length < 200) break;
  }
  return ids;
}

async function borrarClubDemo(sb, { aplicar = true } = {}) {
  const { data: club } = await sb.from('clubs').select('id, slug').eq('slug', SLUG).maybeSingle();
  const archivos = [
    ...(await listarArchivos(sb, 'player-photos', SLUG)).map(r => ['player-photos', r]),
    ...(await listarArchivos(sb, 'player-photos', `clubs/${SLUG}`)).map(r => ['player-photos', r]),
    ...(await listarArchivos(sb, 'club-assets', SLUG)).map(r => ['club-assets', r]),
    ...(await listarArchivos(sb, 'club-assets', `clubs/${SLUG}`)).map(r => ['club-assets', r]),
  ];
  const usuarios = await usuariosDemo(sb);
  console.log(`Club: ${club ? club.id : '(no existe)'} · archivos en Storage: ${archivos.length} · cuentas demo: ${usuarios.length}`);
  if (!aplicar) return;

  if (club) {
    const id = club.id;
    const { data: pedidos } = await sb.from('pedido_uniformes').select('id').eq('club_id', id);
    const pedidoIds = (pedidos || []).map(p => p.id);
    for (let i = 0; i < pedidoIds.length; i += 200) {
      const { error } = await sb.from('pedido_uniforme_prendas').delete().in('pedido_id', pedidoIds.slice(i, i + 200));
      if (error) throw new Error('pedido_uniforme_prendas: ' + error.message);
    }
    const borrar = async (tabla, col, val) => { const { error } = await sb.from(tabla).delete().eq(col, val); if (error) throw new Error(`${tabla}: ${error.message}`); };
    await borrar('asistencia', 'club_id', id);
    await borrar('calendario', 'club_id', SLUG);
    for (const t of TABLAS_POR_UUID) await borrar(t, 'club_id', id);
    await borrar('players', 'club_id', id);
    await borrar('club_members', 'club_id', SLUG);
    await borrar('clubs', 'id', id);
  }
  const porBucket = {};
  archivos.forEach(([b, r]) => { (porBucket[b] ||= []).push(r); });
  for (const [bucket, rutas] of Object.entries(porBucket)) {
    for (let i = 0; i < rutas.length; i += 100) await sb.storage.from(bucket).remove(rutas.slice(i, i + 100));
  }
  for (const uid of usuarios) { const { error } = await sb.auth.admin.deleteUser(uid); if (error) throw new Error('auth: ' + error.message); }
  console.log('✓ Club demo borrado');
}

module.exports = { borrarClubDemo, SLUG, EMAILS_DEMO };

if (require.main === module) {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'); process.exit(1); }
  const aplicar = process.argv.includes('--apply');
  console.log(`Supabase: ${url} — ${aplicar ? 'MODO APLICAR (va a borrar)' : 'dry-run'}`);
  borrarClubDemo(createClient(url, key, { auth: { persistSession: false } }), { aplicar })
    .catch(err => { console.error('✗ ERROR:', err.message); process.exit(1); });
}
