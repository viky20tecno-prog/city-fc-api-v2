// Backfill de ronda_fecha en pedido_uniformes
//
// Todos los pedidos de uniforme que existían ANTES de introducir el concepto
// de "ronda" (lote enviado al fabricante) en realidad ya son, en la práctica,
// un solo pedido real al proveedor — aunque se hayan cargado al sistema en
// días distintos. Este script les asigna a TODOS los pedidos de un club que
// todavía no tienen ronda_fecha la fecha del pedido más antiguo de ese club,
// agrupándolos en una sola ronda.
//
// Uso (desde api/api/, donde están instaladas las dependencias):
//   node scripts/backfill_ronda_pedido_uniforme.js                # dry-run sobre .env.local
//   node scripts/backfill_ronda_pedido_uniforme.js --apply         # escribe sobre .env.local
//   node scripts/backfill_ronda_pedido_uniforme.js --prod          # dry-run sobre .env.prod
//   node scripts/backfill_ronda_pedido_uniforme.js --prod --apply  # escribe sobre .env.prod (producción)
//
// Es idempotente: un pedido que YA tiene ronda_fecha se salta — correrlo de
// nuevo no pisa asignaciones ya hechas (a mano o por una corrida anterior).

const path = require('path');
const envFile = process.argv.includes('--prod') ? '.env.prod' : '.env.local';
require('dotenv').config({ path: path.join(__dirname, '..', '..', envFile) });

const { createClient } = require('@supabase/supabase-js');

const APLICAR = process.argv.includes('--apply');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error(`Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en ${envFile}`);
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log(`Entorno: ${envFile}${APLICAR ? ' — MODO APLICAR (va a escribir)' : ' — dry-run (solo reporte, no escribe nada)'}`);
  console.log(`Supabase URL: ${supabaseUrl}\n`);

  const { data: clubs, error: errClubs } = await supabase.from('clubs').select('id, slug');
  if (errClubs) throw errClubs;

  const { data: pedidos, error: errPedidos } = await supabase
    .from('pedido_uniformes').select('id, club_id, created_at, ronda_fecha');
  if (errPedidos) throw errPedidos;

  let clubesAfectados = 0, pedidosAsignados = 0, pedidosYaTenian = 0;

  for (const club of clubs) {
    const pedidosClub = (pedidos || []).filter(p => p.club_id === club.id);
    if (pedidosClub.length === 0) continue;

    const sinRonda = pedidosClub.filter(p => !p.ronda_fecha);
    pedidosYaTenian += pedidosClub.length - sinRonda.length;
    if (sinRonda.length === 0) continue;

    const fechaMasAntigua = pedidosClub
      .map(p => p.created_at)
      .filter(Boolean)
      .sort()[0]
      .slice(0, 10); // YYYY-MM-DD

    console.log(`[${club.slug}] ${sinRonda.length} pedido(s) sin ronda → ronda_fecha=${fechaMasAntigua}`);
    clubesAfectados++;
    pedidosAsignados += sinRonda.length;

    if (APLICAR) {
      const { error: errUpdate } = await supabase
        .from('pedido_uniformes')
        .update({ ronda_fecha: fechaMasAntigua })
        .in('id', sinRonda.map(p => p.id));
      if (errUpdate) console.error(`  Error actualizando pedidos de ${club.slug}:`, errUpdate.message);
    }
  }

  console.log(`\nClubes afectados: ${clubesAfectados}`);
  console.log(`Pedidos a asignar: ${pedidosAsignados}`);
  console.log(`Pedidos que ya tenían ronda_fecha (saltados): ${pedidosYaTenian}`);

  if (!APLICAR) {
    console.log('\nDry-run: no se escribió nada. Volvé a correr con --apply para aplicar.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
