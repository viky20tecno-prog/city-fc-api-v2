/**
 * Agrega los 21 jugadores de City FC no encontrados en la BD durante la
 * actualización de mensualidades de Jun 2026.
 *
 * Usa cédulas temporales PEND_01 … PEND_21 hasta que el club provea los datos reales.
 *
 * Uso:
 *   node agregar_pendientes.js          → dry-run (solo muestra lo que haría)
 *   node agregar_pendientes.js --apply  → inserta jugadores + mensualidades
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://olcevdnhmexaahymfzii.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sY2V2ZG5obWV4YWFoeW1memlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMTgwNiwiZXhwIjoyMDkxODA3ODA2fQ.NVIou6GUZzAR0fOLSSNXkE-7JoTCn1Oaow2LpQnMens';
const CLUB_SLUG = 'city-fc';
const ANIO = 2026;
const APPLY = process.argv.includes('--apply');

const MESES_NOMBRES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Jugadores pendientes con sus estados Ene–Jun 2026
// [cedula_temp, nombre, apellidos, [ene, feb, mar, abr, may, jun]]
const PENDIENTES = [
  ['PEND_01', 'ADRIÁN DANILO',  'LORA AGUIRRE',       ['YA PAGO','YA PAGO','YA PAGO','EXENTO','DEBE','DEBE']],
  ['PEND_02', 'BRYAN FERNEY',   'BARRERA GOMEZ',       ['EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO']],
  ['PEND_03', 'CRISTIAN',       'LONDOÑO GOMEZ',       ['EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE']],
  ['PEND_04', 'DIEGO ALBERTO',  'HERRERA MOLINA',      ['EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO']],
  ['PEND_05', 'DUVAN',          'POSADA',              ['EXENTO','DEBE','EXENTO','EXENTO','DEBE','DEBE']],
  ['PEND_06', 'JHON ALEJANDRO', 'MEDINA HINCAPIE',     ['YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO']],
  ['PEND_07', 'JUAN ANDRES',    'HENAO HOYOS',         ['EXENTO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE']],
  ['PEND_08', 'JUAN ESTEBAN',   'ALZATE MIRA',         ['YA PAGO','DEBE','DEBE','DEBE','DEBE','DEBE']],
  ['PEND_09', 'JUAN FERNANDO',  'ARREDONDO',           ['EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO']],
  ['PEND_10', 'JUAN GUILLERMO', 'RANGEL ALVERNIA',     ['YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE']],
  ['PEND_11', 'JUAN JOSE',      'CEBALLOS',            ['EXENTO','EXENTO','EXENTO','YA PAGO','DEBE','DEBE']],
  ['PEND_12', 'JUAN SEBASTIAN', 'SOTO GIRALDO',        ['YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE']],
  ['PEND_13', 'JULIO MANUEL',   'HERNANDEZ USUGA',     ['EXENTO','EXENTO','YA PAGO','DEBE','DEBE','DEBE']],
  ['PEND_14', 'MATEO',          'VILLA MAZUERA',       ['EXENTO','DEBE','EXENTO','EXENTO','DEBE','DEBE']],
  ['PEND_15', 'RUBÉN DARIO',    'LLANOS MORENO',       ['EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO']],
  ['PEND_16', 'SANTIAGO',       'CORREA POSADA',       ['EXENTO','EXENTO','YA PAGO','YA PAGO','DEBE','DEBE']],
  ['PEND_17', 'SANTIAGO',       'FLOREZ ROJO',         ['EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE']],
  ['PEND_18', 'SANTIAGO',       'HERRERA MOLINA',      ['EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO']],
  ['PEND_19', 'SEBASTIAN',      'GIRALDO OCAMPO',      ['EXENTO','DEBE','DEBE','DEBE','DEBE','DEBE']],
  ['PEND_20', 'VICTOR',         'BARRIENTOS OCHOA',    ['EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO']],
  ['PEND_21', 'JUAN JOSE',      'ARBOLEDA TAPIAS',     ['EXENTO','EXENTO','EXENTO','EXENTO','YA PAGO','YA PAGO']],
];

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: club, error: clubErr } = await supabase
    .from('clubs').select('*').eq('slug', CLUB_SLUG).single();
  if (clubErr) { console.error('Club no encontrado:', clubErr.message); process.exit(1); }

  const CUOTA = parseFloat(club.config?.valor_mensualidad) || 150000;
  console.log(`\n✅ Club: ${club.name} | CUOTA: $${CUOTA.toLocaleString('es-CO')}`);
  console.log(`   Modo: ${APPLY ? '⚠️  APPLY (escribiendo en BD)' : '🔍 DRY RUN (solo lectura)'}\n`);

  // Verificar cuáles PEND_XX ya existen (por si se corre dos veces)
  const { data: existing } = await supabase
    .from('players')
    .select('cedula')
    .eq('club_id', club.id)
    .like('cedula', 'PEND_%');
  const existingCedulas = new Set((existing || []).map(p => p.cedula));

  let insertados = 0;
  let mensualidadesCreadas = 0;

  for (const [cedula, nombre, apellidos, estados] of PENDIENTES) {
    const yaExiste = existingCedulas.has(cedula);
    console.log(`\n👤 ${nombre} ${apellidos} (${cedula})${yaExiste ? ' — ya existe, solo mensualidades' : ''}`);

    if (APPLY && !yaExiste) {
      const { error: insErr } = await supabase.from('players').insert([{
        club_id:    club.id,
        cedula,
        nombre,
        apellidos,
        activo:     true,
        deporte:    'futbol',
        categorias: [],
      }]);
      if (insErr) { console.log(`  ❌ Error insertando jugador: ${insErr.message}`); continue; }
      insertados++;
      console.log(`  ✅ Jugador creado`);
    } else if (!APPLY) {
      console.log(`  [dry-run] Crearía jugador: ${nombre} ${apellidos}`);
    }

    // Obtener player_id recién creado (o existente)
    const { data: player } = await supabase
      .from('players').select('id, cedula').eq('club_id', club.id).eq('cedula', cedula).single();

    if (!player && APPLY) { console.log(`  ❌ No se pudo recuperar el jugador`); continue; }

    for (let i = 0; i < estados.length; i++) {
      const mes    = i + 1;
      const estado = estados[i].trim().toUpperCase();

      let valOficial, valPagado, saldo, estadoBD;
      if (estado === 'YA PAGO') {
        valOficial = CUOTA; valPagado = CUOTA; saldo = 0; estadoBD = 'AL_DIA';
      } else if (estado === 'DEBE') {
        valOficial = CUOTA; valPagado = 0; saldo = CUOTA; estadoBD = 'PENDIENTE';
      } else { // EXENTO
        valOficial = 0; valPagado = 0; saldo = 0; estadoBD = 'AL_DIA';
      }

      console.log(`  Mes ${mes} (${MESES_NOMBRES[mes]}): ${estado} → ${estadoBD}${APPLY ? '' : ' [dry-run]'}`);

      if (!APPLY) continue;

      const { error: mErr } = await supabase.from('mensualidades').insert([{
        club_id:         club.id,
        player_id:       player.id,
        cedula:          player.cedula,
        anio:            ANIO,
        mes:             MESES_NOMBRES[mes],
        numero_mes:      mes,
        valor_oficial:   valOficial,
        valor_pagado:    valPagado,
        saldo_pendiente: saldo,
        estado:          estadoBD,
      }]);

      if (mErr) console.log(`  ❌ Error mensualidad mes ${mes}: ${mErr.message}`);
      else mensualidadesCreadas++;
    }
  }

  console.log('\n─────────────────────────────────────────────────');
  if (APPLY) {
    console.log(`✅ Jugadores insertados:     ${insertados}`);
    console.log(`✅ Mensualidades creadas:    ${mensualidadesCreadas}`);
  }
  console.log(`\n⚠️  Recuerda actualizar las cédulas PEND_XX cuando el club entregue los datos.`);
  if (!APPLY) console.log('\n▶️  Para aplicar: node agregar_pendientes.js --apply');
}

main().catch(e => { console.error(e); process.exit(1); });
