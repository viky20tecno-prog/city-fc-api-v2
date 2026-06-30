/**
 * Completa los meses faltantes Jul-Dic 2026 para todos los jugadores activos de City FC.
 * Solo inserta filas que NO existan (idempotente).
 *
 * Uso:
 *   node completar_anio.js          → DRY RUN (muestra qué haría)
 *   node completar_anio.js --apply  → aplica los cambios
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://olcevdnhmexaahymfzii.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sY2V2ZG5obWV4YWFoeW1memlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMTgwNiwiZXhwIjoyMDkxODA3ODA2fQ.NVIou6GUZzAR0fOLSSNXkE-7JoTCn1Oaow2LpQnMens';
const CLUB_SLUG = 'city-fc';
const ANIO = 2026;

const MESES = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};

const APPLY = process.argv.includes('--apply');

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Obtener el club
  const { data: club, error: clubErr } = await supabase
    .from('clubs').select('id, config').eq('slug', CLUB_SLUG).single();
  if (clubErr || !club) { console.error('Club no encontrado:', clubErr); process.exit(1); }

  const CUOTA = parseFloat(club.config?.valor_mensualidad) || 65000;
  console.log(`\nClub: ${CLUB_SLUG} | Cuota: $${CUOTA.toLocaleString('es-CO')} | Año: ${ANIO}`);
  console.log(APPLY ? '⚡ MODO REAL — Aplicando cambios' : '🔍 DRY RUN — Solo muestra (usa --apply para aplicar)\n');

  // 2. Obtener todos los jugadores activos
  const { data: players, error: pErr } = await supabase
    .from('players').select('id, cedula, nombre, apellidos, descuento_mensualidad')
    .eq('club_id', club.id).eq('activo', true);
  if (pErr) { console.error('Error obteniendo jugadores:', pErr); process.exit(1); }
  console.log(`Jugadores activos: ${players.length}`);

  // 3. Obtener mensualidades existentes para 2026
  const { data: existentes, error: mErr } = await supabase
    .from('mensualidades').select('cedula, numero_mes')
    .eq('club_id', club.id).eq('anio', ANIO);
  if (mErr) { console.error('Error obteniendo mensualidades:', mErr); process.exit(1); }

  const yaExiste = new Set(existentes.map(m => `${m.cedula}-${m.numero_mes}`));
  console.log(`Mensualidades existentes en ${ANIO}: ${existentes.length}`);
  console.log(`Máximo posible (${players.length} × 12): ${players.length * 12}\n`);

  // 4. Construir lista de faltantes
  const nuevas = [];
  const resumen = {};

  for (const p of players) {
    const descuento = parseFloat(p.descuento_mensualidad) || 0;
    const oficial = Math.max(0, CUOTA - descuento);
    const faltantes = [];

    for (let mes = 1; mes <= 12; mes++) {
      const key = `${p.cedula}-${mes}`;
      if (!yaExiste.has(key)) {
        faltantes.push(mes);
        nuevas.push({
          club_id: club.id,
          player_id: p.id,
          cedula: String(p.cedula),
          anio: ANIO,
          mes: MESES[mes],
          numero_mes: mes,
          valor_oficial: oficial,
          valor_pagado: 0,
          saldo_pendiente: oficial,
          estado: 'PENDIENTE',
        });
      }
    }

    if (faltantes.length > 0) {
      const nombre = `${p.nombre} ${p.apellidos}`.trim();
      resumen[nombre] = faltantes.map(m => MESES[m]);
      if (!APPLY) {
        console.log(`  → ${nombre} (${p.cedula}): faltan ${faltantes.map(m => MESES[m]).join(', ')}`);
      }
    }
  }

  const jugadoresAfectados = Object.keys(resumen).length;
  console.log(`\n─────────────────────────────────────────`);
  console.log(`Jugadores con meses faltantes: ${jugadoresAfectados}`);
  console.log(`Total mensualidades a crear:   ${nuevas.length}`);

  if (nuevas.length === 0) {
    console.log('\n✅ Todos los jugadores ya tienen los 12 meses. Nada que hacer.');
    return;
  }

  if (!APPLY) {
    console.log('\nEjecuta con --apply para insertar en Supabase.');
    return;
  }

  // 5. Insertar en lotes de 100
  const BATCH = 100;
  let insertados = 0;
  for (let i = 0; i < nuevas.length; i += BATCH) {
    const lote = nuevas.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from('mensualidades').insert(lote);
    if (insErr) {
      console.error(`Error insertando lote ${i / BATCH + 1}:`, insErr.message);
      process.exit(1);
    }
    insertados += lote.length;
    process.stdout.write(`\r  Insertando... ${insertados}/${nuevas.length}`);
  }

  console.log(`\n\n✅ Listo. ${insertados} mensualidades creadas para ${jugadoresAfectados} jugadores.`);
  console.log('Los meses nuevos quedan en estado PENDIENTE con la cuota oficial del club.');
  console.log('(Los jugadores EXENTOS con cuota $0 quedarán AL_DIA automáticamente — ajústalos manualmente si es necesario)');
}

main().catch(err => { console.error(err); process.exit(1); });
