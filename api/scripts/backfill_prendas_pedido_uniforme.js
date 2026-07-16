// Backfill de src/components/Uniformes.jsx → pedido_uniforme_prendas
//
// Crea el desglose por prenda (nombre, cantidad, precio_unitario) de cada
// pedido_uniformes existente, parseando el string `prendas` ("Camiseta Hombre,
// Pantaloneta x2") y buscando el precio de cada nombre en el catálogo del
// club (clubs.config.prendas_uniforme). El abono ya registrado en el pedido
// (`valor_pagado`) se congela tal cual en `abono_legacy` — NO se reparte
// entre las prendas — así el total/pagado/estado del pedido queda EXACTAMENTE
// igual a como estaba antes de correr esto (recalcularPedidoUniformeDesdeItems
// da abonoItems(0) + abono_legacy(=valor_pagado actual) = mismo valor_pagado).
//
// Uso (desde api/api/, donde están instaladas las dependencias):
//   node scripts/backfill_prendas_pedido_uniforme.js                # dry-run sobre .env.local
//   node scripts/backfill_prendas_pedido_uniforme.js --apply         # escribe sobre .env.local
//   node scripts/backfill_prendas_pedido_uniforme.js --prod          # dry-run sobre .env.prod
//   node scripts/backfill_prendas_pedido_uniforme.js --prod --apply  # escribe sobre .env.prod (producción)
//
// Es idempotente: un pedido que YA tiene filas en pedido_uniforme_prendas se
// salta (no duplica ni pisa nada), así que se puede correr varias veces sin
// riesgo — para volver a intentar un pedido con mismatch hay que borrar sus
// filas hijas primero.

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

function parsePrendas(prendasStr) {
  return String(prendasStr || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(item => {
      const m = item.match(/^(.*?)\s+x(\d+)$/i);
      return m ? { nombre: m[1].trim(), cantidad: parseInt(m[2], 10) } : { nombre: item, cantidad: 1 };
    })
    .filter(p => p.nombre);
}

async function main() {
  console.log(`Entorno: ${envFile}${APLICAR ? ' — MODO APLICAR (va a escribir)' : ' — dry-run (solo reporte, no escribe nada)'}`);
  console.log(`Supabase URL: ${supabaseUrl}\n`);

  const { data: clubs, error: errClubs } = await supabase.from('clubs').select('id, slug, config');
  if (errClubs) throw errClubs;

  const { data: pedidos, error: errPedidos } = await supabase.from('pedido_uniformes').select('*');
  if (errPedidos) throw errPedidos;

  const { data: yaMigrados, error: errItems } = await supabase.from('pedido_uniforme_prendas').select('pedido_id');
  if (errItems) throw errItems;
  const pedidosConItems = new Set((yaMigrados || []).map(i => i.pedido_id));

  let procesados = 0, saltados = 0, sinPrendas = 0, conMismatch = 0;
  const reporteMismatch = [];

  for (const club of clubs) {
    const catalogo = club.config?.prendas_uniforme || [];
    const precioPorNombre = new Map(catalogo.map(p => [String(p.nombre || '').trim().toLowerCase(), Number(p.precio) || 0]));

    const pedidosClub = (pedidos || []).filter(p => p.club_id === club.id);
    for (const pedido of pedidosClub) {
      if (pedidosConItems.has(pedido.id)) { saltados++; continue; }

      const items = parsePrendas(pedido.prendas);
      if (items.length === 0) { sinPrendas++; continue; }

      const itemsConPrecio = items.map(it => {
        const precio = precioPorNombre.get(it.nombre.trim().toLowerCase());
        return { ...it, precio_unitario: precio !== undefined ? precio : 0, encontrado: precio !== undefined };
      });

      const sumaCalculada = itemsConPrecio.reduce((s, it) => s + it.precio_unitario * it.cantidad, 0);
      const totalPedido   = Number(pedido.total) || 0;
      const hayMismatch   = itemsConPrecio.some(it => !it.encontrado) || sumaCalculada !== totalPedido;

      if (hayMismatch) {
        conMismatch++;
        reporteMismatch.push({
          club: club.slug, pedido_id: pedido.id, jugador: pedido.nombre, cedula: pedido.cedula,
          total_pedido: totalPedido, suma_items: sumaCalculada,
          items: itemsConPrecio.map(it => `${it.nombre} x${it.cantidad} (${it.encontrado ? '$' + it.precio_unitario : 'SIN PRECIO EN CATÁLOGO'})`),
        });
      }

      if (APLICAR) {
        const rows = itemsConPrecio.map(it => ({
          pedido_id: pedido.id, nombre: it.nombre, cantidad: it.cantidad,
          precio_unitario: it.precio_unitario, valor_pagado: 0, estado: 'PENDIENTE',
        }));
        const { error: errInsert } = await supabase.from('pedido_uniforme_prendas').insert(rows);
        if (errInsert) { console.error(`Error insertando prendas del pedido ${pedido.id}:`, errInsert.message); continue; }

        const { error: errUpdate } = await supabase
          .from('pedido_uniformes')
          .update({ abono_legacy: Number(pedido.valor_pagado) || 0 })
          .eq('id', pedido.id);
        if (errUpdate) console.error(`Error congelando abono_legacy del pedido ${pedido.id}:`, errUpdate.message);
      }
      procesados++;
    }
  }

  console.log(`Pedidos procesados: ${procesados}`);
  console.log(`Pedidos ya migrados (saltados):  ${saltados}`);
  console.log(`Pedidos sin prendas (saltados):  ${sinPrendas}`);
  console.log(`Pedidos con mismatch de precio/catálogo: ${conMismatch}\n`);

  if (reporteMismatch.length > 0) {
    console.log('── Pedidos a revisar manualmente (precio de catálogo no cuadra con el total guardado) ──');
    reporteMismatch.forEach(r => {
      console.log(`\n[${r.club}] ${r.jugador} (cédula ${r.cedula}) — pedido ${r.pedido_id}`);
      console.log(`  Total guardado: $${r.total_pedido} · Suma según catálogo: $${r.suma_items}`);
      r.items.forEach(i => console.log(`    - ${i}`));
    });
    console.log('\nEstos pedidos igual quedan migrados (o quedarían, en dry-run) con el precio que se pudo encontrar;');
    console.log('el total/abonado/estado del pedido NO cambia — solo el desglose por prenda puede no sumar exacto.');
  }

  if (!APLICAR) {
    console.log('\nDry-run: no se escribió nada. Volvé a correr con --apply para aplicar.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
