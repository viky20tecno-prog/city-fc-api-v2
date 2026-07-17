/**
 * Actualiza estados de mensualidades de City FC desde el CSV del cliente.
 * Formato CSV: NOMBRE | ENERO | FEB | ... | JUN  (estados: YA PAGO / DEBE / EXENTO)
 *
 * Mapeo de estados:
 *   YA PAGO → AL_DIA   (valor_pagado = valor_oficial existente)
 *   DEBE    → PENDIENTE (sin tocar montos)
 *   EXENTO  → AL_DIA   (valor_oficial=0, valor_pagado=0, saldo_pendiente=0)
 *
 * Uso:
 *   node actualizar_mensualidades.js          → modo DRY RUN (solo muestra)
 *   node actualizar_mensualidades.js --apply  → aplica cambios reales
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno (.env)');
  process.exit(1);
}
const CLUB_SLUG    = 'city-fc';
const ANIO         = 2026;
const APPLY        = process.argv.includes('--apply');

const MESES_NOMBRES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ── CSV del cliente (nombres con encoding roto como llegaron) ──────────────
// columnas: nombre, enero, feb, mar, abr, may, jun  (meses 1-6 de 2026)
const CSV_DATOS = [
  ['AdriÃ¡n Danilo Lora Aguirre',              'YA PAGO','YA PAGO','YA PAGO','EXENTO','DEBE','DEBE'],
  ['Alejandro Arredonco Cano',                 'EXENTO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE'],
  ['Alejandro GarcÃ­a Garcia',                 'DEBE','DEBE','DEBE','DEBE','DEBE','DEBE'],
  ['Alejandro Montoya Argaez',                 'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Alejandro Tabares Sepulveda',              'YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Alexander Arroyave Ruiz (Costello)',       'EXENTO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Alexis Hurtado Castro',                    'YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE'],
  ['Alvaro Andres Monsalve Arango',            'YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE'],
  ['Aurelio Manuel Vasquez Montalvo (Fausto)', 'EXENTO','DEBE','DEBE','DEBE','DEBE','DEBE'],
  ['Brandon Cardona Cano',                     'YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO'],
  ['Bryan Ferney Barrera Gomez',               'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Carlos Harley Puchana',                    'EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE'],
  ['Christian Stiven cuartas cÃ©spedes',       'YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO'],
  ['Cristian Camilo Arango Soto',              'EXENTO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE'],
  ['Cristian LondoÃ±o Gomez',                  'EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE'],
  ['Daniel Esteban Usuga Restrepo',            'YA PAGO','YA PAGO','DEBE','EXENTO','DEBE','DEBE'],
  ['David Alejandro Ospina Molina',            'YA PAGO','YA PAGO','EXENTO','YA PAGO','YA PAGO','DEBE'],
  ['David Ochoa Hernandez',                    'YA PAGO','YA PAGO','EXENTO','DEBE','DEBE','DEBE'],
  ['David Soto Gomez',                         'EXENTO','EXENTO','EXENTO','DEBE','DEBE','DEBE'],
  ['Diego Alberto Herrera Molina',             'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Diego Alveniz Escobar',                    'EXENTO','EXENTO','YA PAGO','YA PAGO','YA PAGO','DEBE'],
  ['Diego AndrÃ©s JimÃ©nez Zapata',            'YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Duvan Esneider CastaÃ±eda Garcia',          'EXENTO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE'],
  ['Duvan Posada',                             'EXENTO','DEBE','EXENTO','EXENTO','DEBE','DEBE'],
  ['Edwin Enrique Tarazona',                   'EXENTO','YA PAGO','YA PAGO','EXENTO','EXENTO','EXENTO'],
  ['Elkin Blandon Mosquera',                   'YA PAGO','YA PAGO','EXENTO','EXENTO','DEBE','DEBE'],
  ['Geimer EspaÃ±a Mendez',                    'YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Harrison Arley Mira',                      'EXENTO','EXENTO','EXENTO','YA PAGO','YA PAGO','DEBE'],
  ['Hector Hurtado CastaÃ±eda',                'EXENTO','EXENTO','EXENTO','EXENTO','YA PAGO','DEBE'],
  ['Jhon Alejandro Medina Hincapie',           'YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO'],
  ['Jhon Anderson Gallardo Camacho',           'EXENTO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE'],
  ['Joan Camilo Lopez Acevedo',                'EXENTO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE'],
  ['John Wilmar Garcia Tabares',               'EXENTO','DEBE','DEBE','DEBE','DEBE','DEBE'],
  ['Jonathan Martinez',                        'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Jonathan Raul PatiÃ±o',                    'EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE'],
  ['Jose Julian Carvajal Zapata',              'EXENTO','YA PAGO','YA PAGO','EXENTO','DEBE','DEBE'],
  ['Jose Manuel Restrepo Campillo',            'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Juan Andres Henao Hoyos',                  'EXENTO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Juan Camilo BermÃºdez Montoya',             'EXENTO','EXENTO','YA PAGO','YA PAGO','YA PAGO','DEBE'],
  ['Juan Camilo Sanchez Molina',               'YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE'],
  ['Juan Diego Calle Gomez',                   'YA PAGO','YA PAGO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Juan Diego Jimenez Vargas',                'EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE'],
  ['Juan Esteban Alzate Mira',                 'YA PAGO','DEBE','DEBE','DEBE','DEBE','DEBE'],
  ['Juan Esteban Saldarriaga Castro',          'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Juan Felipe Acosta Flores',                'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Juan Fernando Arredondo',                  'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Juan Fernando Zapata Perez',               'YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO','YA PAGO'],
  ['Juan Guillermo polo RoldÃ¡n',              'EXENTO','EXENTO','EXENTO','EXENTO','DEBE','DEBE'],
  ['Juan Guillermo Rangel alvernia',           'YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE'],
  ['Juan Jairo Henao CastaÃ±eda',              'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','YA PAGO'],
  ['Juan Jose Ceballos',                       'EXENTO','EXENTO','EXENTO','YA PAGO','DEBE','DEBE'],
  ['Juan Pablo Gil Gonzalez',                  'EXENTO','DEBE','DEBE','DEBE','DEBE','DEBE'],
  ['Juan Sebastian Soto Giraldo',              'YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE'],
  ['Julian Augusto Vanegas',                   'EXENTO','EXENTO','DEBE','EXENTO','EXENTO','EXENTO'],
  ['Julian Rincon MuÃ±eton',                   'EXENTO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Julio Manuel Hernandez Usuga',             'EXENTO','EXENTO','YA PAGO','DEBE','DEBE','DEBE'],
  ['Maicol Ferney Mazo DÃ­az',                 'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Mario Esteban Parra MuÃ±oz',               'YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Mateo Villa Mazuera',                      'EXENTO','DEBE','EXENTO','EXENTO','DEBE','DEBE'],
  ['Mauricio Mejia Echeverry',                 'YA PAGO','DEBE','DEBE','YA PAGO','DEBE','DEBE'],
  ['Michael Muriel Villan',                    'YA PAGO','YA PAGO','DEBE','EXENTO','EXENTO','EXENTO'],
  ['Miguel Andres Urrego Blandon',             'EXENTO','YA PAGO','YA PAGO','DEBE','DEBE','DEBE'],
  ['RubÃ©n Dario Llanos Moreno',               'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Santiago Acosta Flores',                   'EXENTO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Santiago Alejandro MontaÃ±a SÃ¡nchez',     'YA PAGO','YA PAGO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Santiago Correa Posada',                   'EXENTO','EXENTO','YA PAGO','YA PAGO','DEBE','DEBE'],
  ['Santiago Florez Lopez',                    'EXENTO','EXENTO','EXENTO','DEBE','DEBE','DEBE'],
  ['Santiago Florez Rojo',                     'EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE'],
  ['Santiago Gomez Arcila',                    'EXENTO','EXENTO','EXENTO','DEBE','DEBE','DEBE'],
  ['Santiago Herrera Molina',                  'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Sebastian Barrera Alzate',                 'EXENTO','EXENTO','DEBE','DEBE','DEBE','DEBE'],
  ['Sebastian Giraldo Ocampo',                 'EXENTO','DEBE','DEBE','DEBE','DEBE','DEBE'],
  ['SebastiÃ¡n Monsalve EchavarrÃ­a',          'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Sebastian Ocampo Cuervo',                  'EXENTO','EXENTO','EXENTO','DEBE','DEBE','DEBE'],
  ['Sebastian Raigosa Hidalgo',                'EXENTO','YA PAGO','YA PAGO','EXENTO','DEBE','DEBE'],
  ['Victor Barrientos Ochoa',                  'EXENTO','EXENTO','EXENTO','EXENTO','EXENTO','EXENTO'],
  ['Juan Jose Arboleda Tapias',                'EXENTO','EXENTO','EXENTO','EXENTO','YA PAGO','YA PAGO'],
  ['Horacio Grisales NoreÃ±a',                 'EXENTO','EXENTO','EXENTO','EXENTO','DEBE','DEBE'],
  ['Juan Camilo Jimenez Ochoa',                'EXENTO','EXENTO','EXENTO','EXENTO','DEBE','DEBE'],
  ['Andres Felipe Gonzalez',                   null, null, null, null, null, null],
];

// ── Overrides: nombres del CSV → cédula real en BD ───────────────────────
// Para casos donde el nombre no coincide exactamente por typos o truncamientos
const CEDULA_OVERRIDES = {
  'alejandro arredonco cano':           '1216718371', // ALEJANDRO ARREDONDO CANO
  'alejandro tabares sepulveda':        '1000416363', // ALEJANDRO TABARES
  'carlos harley puchana':              '1085294731', // CARLOS ARLEY PUCHANA VILLAFAÑEZ
  'diego alveniz escobar':              '1032401947', // DIEGO ALVENIZ ESCOBAR FIGUEROA
  'diego andres jimenez zapata':        '1036679861', // DIEGO JIMÉNEZ
  'edwin enrique tarazona':             '5191715',    // EDWIN TARAZONA
  'elkin blandon mosquera':             '1039453710', // ELKIN BLANDÓN
  'harrison arley mira':                '1036671690', // HARRISON ARLEY MIRA MUÑOZ
  'hector hurtado castaneda':           '1017203699', // HÉCTOR FERNANDO HURTADO CASTAÑEDA
  'jonathan martinez':                  '1128447176', // JOHNATAN MARTINEZ VASQUEZ
  'jonathan raul patino':               '1017277274', // JONATHAN RAUL MARVAL PATIÑO
  'juan esteban saldarriaga castro':    '1001468894', // JUAN ESTEBAN SALDARRRIAGA CASTRO
  'juan felipe acosta flores':          '1036686446', // JUAN FELIPE ACOSTA FLÓREZ
  'julian augusto vanegas':             '1094916334', // JULIAN AUGUSTO VANEGAS GÓMEZ
  'mauricio mejia echeverry':           '1000393554', // WILFER MAURICIO MEJIA ECHEVERRI
  'santiago acosta flores':             '1007243087', // SANTIAGO ACOSTA FLOREZ
  'sebastian ocampo cuervo':            '1001525036', // SEBASTIÁN OCAMPO
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fixEncoding(str) {
  // Repara mojibake UTF-8 → Latin-1 común en nombres españoles
  return (str || '')
    .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ')
    .replace(/Ã‰/g, 'É').replace(/Ã"/g, 'Ó').replace(/Ã/g,  'Á')
    .replace(/â€™/g, "'");
}

function normalize(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar diacríticos
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Quita apodos entre paréntesis para matching: "Ruiz (Costello)" → "Ruiz"
function stripNickname(str) {
  return str.replace(/\s*\(.*?\)/g, '').trim();
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Obtener club
  const { data: club, error: clubErr } = await supabase
    .from('clubs').select('*').eq('slug', CLUB_SLUG).single();
  if (clubErr) { console.error('Club no encontrado:', clubErr.message); process.exit(1); }

  const CUOTA = parseFloat(club.config?.valor_mensualidad) || 150000;
  console.log(`\n✅ Club: ${club.name} | CUOTA: $${CUOTA.toLocaleString('es-CO')}`);
  console.log(`   Modo: ${APPLY ? '⚠️  APPLY (escribiendo en BD)' : '🔍 DRY RUN (solo lectura)'}\n`);

  // 2. Obtener jugadores activos
  const { data: players, error: playersErr } = await supabase
    .from('players').select('id, cedula, nombre, apellidos').eq('club_id', club.id).eq('activo', true);
  if (playersErr) { console.error('Error players:', playersErr.message); process.exit(1); }

  // Índice por nombre normalizado (sin apodo)
  const playerIndex = {};
  for (const p of players) {
    const full = normalize(stripNickname(`${p.nombre} ${p.apellidos}`));
    playerIndex[full] = p;
    // también indexar por apellidos primero (algunos CSV vienen así)
    const inv  = normalize(stripNickname(`${p.apellidos} ${p.nombre}`));
    if (!playerIndex[inv]) playerIndex[inv] = p;
  }

  // 3. Obtener mensualidades existentes 2026 (paginado — Supabase max 1000/query)
  const mensualidades = [];
  let from = 0;
  while (true) {
    const { data, error: mErr } = await supabase
      .from('mensualidades').select('*')
      .eq('club_id', club.id).eq('anio', ANIO)
      .range(from, from + 999);
    if (mErr) { console.error('Error mensualidades:', mErr.message); process.exit(1); }
    mensualidades.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const invMap = {};
  for (const m of mensualidades) invMap[`${m.cedula}-${m.numero_mes}`] = m;

  // 4. Procesar CSV
  const resultados = { actualizados: 0, creados: 0, noEncontrados: [], sinDatos: [] };

  for (const fila of CSV_DATOS) {
    const nombreCSV  = fixEncoding(fila[0]);
    const estadosMes = fila.slice(1, 7); // meses 1-6

    // Sin datos → ignorar
    if (estadosMes.every(e => !e)) { resultados.sinDatos.push(nombreCSV); continue; }

    // Buscar jugador (primero override manual, luego índice normalizado)
    const clave        = normalize(stripNickname(nombreCSV));
    const cedulaForced = CEDULA_OVERRIDES[clave];
    const player       = cedulaForced
      ? players.find(p => String(p.cedula) === String(cedulaForced))
      : playerIndex[clave];

    if (!player) {
      resultados.noEncontrados.push(nombreCSV);
      console.log(`  ❌ NO ENCONTRADO: "${nombreCSV}"  (normalizado: "${clave}")`);
      continue;
    }

    console.log(`  👤 ${nombreCSV} → ${player.nombre} ${player.apellidos} (${player.cedula})`);

    for (let i = 0; i < estadosMes.length; i++) {
      const mes    = i + 1;
      const estado = (estadosMes[i] || '').trim().toUpperCase();
      if (!estado) continue;

      const key = `${player.cedula}-${mes}`;
      const inv = invMap[key];
      const descuento  = parseFloat(player.descuento_mensualidad) || 0;
      const valOficial = inv?.valor_oficial ?? Math.max(0, CUOTA - descuento);

      let updates;
      if (estado === 'YA PAGO') {
        updates = {
          estado:           'AL_DIA',
          valor_pagado:     valOficial,
          saldo_pendiente:  0,
        };
      } else if (estado === 'DEBE') {
        updates = {
          estado:           'PENDIENTE',
          valor_pagado:     0,
          saldo_pendiente:  valOficial,
        };
      } else if (estado === 'EXENTO') {
        updates = {
          estado:           'AL_DIA',
          valor_oficial:    0,
          valor_pagado:     0,
          saldo_pendiente:  0,
        };
      } else {
        console.log(`     ⚠️ Estado desconocido en mes ${mes}: "${estado}" — saltando`);
        continue;
      }

      const label = `  Mes ${mes} (${MESES_NOMBRES[mes]}): ${estado} → ${updates.estado}`;

      if (!APPLY) {
        console.log(`${label}  [dry-run]`);
        continue;
      }

      try {
        if (inv) {
          await supabase.from('mensualidades')
            .update({ ...updates, fecha_ultima_actualizacion: new Date().toISOString() })
            .eq('id', inv.id);
          console.log(`${label}  ✅ actualizado`);
          resultados.actualizados++;
        } else {
          await supabase.from('mensualidades').insert([{
            club_id:         club.id,
            player_id:       player.id,
            cedula:          player.cedula,
            anio:            ANIO,
            mes:             MESES_NOMBRES[mes],
            numero_mes:      mes,
            valor_oficial:   updates.valor_oficial ?? valOficial,
            valor_pagado:    updates.valor_pagado,
            saldo_pendiente: updates.saldo_pendiente,
            estado:          updates.estado,
          }]);
          console.log(`${label}  ✅ creado`);
          resultados.creados++;
        }
      } catch (e) {
        console.log(`${label}  ❌ ERROR: ${e.message}`);
      }
    }
  }

  // 5. Resumen
  console.log('\n─────────────────────────────────────────────────');
  if (APPLY) {
    console.log(`✅ Actualizados: ${resultados.actualizados}`);
    console.log(`✅ Creados:      ${resultados.creados}`);
  }
  console.log(`❌ No encontrados (${resultados.noEncontrados.length}):`);
  resultados.noEncontrados.forEach(n => console.log(`   - ${n}`));
  if (resultados.sinDatos.length) {
    console.log(`⚪ Sin datos (${resultados.sinDatos.length}): ${resultados.sinDatos.join(', ')}`);
  }
  if (!APPLY) {
    console.log('\n▶️  Para aplicar los cambios: node actualizar_mensualidades.js --apply');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
