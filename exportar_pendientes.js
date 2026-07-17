/**
 * Exporta los jugadores con cédula PEND_XX a CSV mostrando qué datos faltan.
 * Uso: node exportar_pendientes.js
 * Genera: pendientes_city_fc.csv
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno (.env)');
  process.exit(1);
}

const CAMPOS = [
  { key: 'cedula',             label: 'Cédula real' },
  { key: 'celular',            label: 'Celular' },
  { key: 'email',              label: 'Email' },
  { key: 'fecha_nacimiento',   label: 'Fecha nacimiento' },
  { key: 'categoria',          label: 'Categoría' },
  { key: 'posicion',           label: 'Posición' },
  { key: 'celular_contacto',   label: 'Celular contacto (acudiente)' },
  { key: 'nombre_contacto',    label: 'Nombre contacto (acudiente)' },
];

function val(player, key) {
  const v = player[key];
  if (v === null || v === undefined || String(v).trim() === '') return '';
  if (key === 'cedula' && String(v).startsWith('PEND_')) return ''; // la temporal no cuenta
  return String(v).trim();
}

function faltante(player, key) {
  return val(player, key) === '' ? 'FALTA' : '';
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: club } = await supabase.from('clubs').select('id,name').eq('slug', 'city-fc').single();

  const { data: players, error } = await supabase
    .from('players')
    .select('*')
    .eq('club_id', club.id)
    .like('cedula', 'PEND_%')
    .order('cedula');

  if (error) { console.error(error.message); process.exit(1); }

  console.log(`\n✅ ${players.length} jugadores con cédula temporal encontrados\n`);

  // Cabecera CSV
  const headers = ['ID_Temp', 'Nombre', 'Apellidos', ...CAMPOS.map(c => c.label)];
  const rows = [headers];

  for (const p of players) {
    const row = [
      p.cedula,
      p.nombre,
      p.apellidos,
      ...CAMPOS.map(c => val(p, c.key)),
    ];
    rows.push(row);

    const faltantes = CAMPOS.filter(c => faltante(p, c.key) === 'FALTA').map(c => c.label);
    console.log(`${p.cedula} — ${p.nombre} ${p.apellidos}`);
    if (faltantes.length) console.log(`   Falta: ${faltantes.join(', ')}`);
    else console.log(`   ✅ Completo`);
  }

  // Escribir CSV
  const csv = rows.map(r => r.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const outFile = '/root/zenpra/zensports/api/pendientes_city_fc.csv';
  fs.writeFileSync(outFile, '﻿' + csv, 'utf8'); // BOM para que Excel abra bien

  console.log(`\n📄 CSV generado: ${outFile}`);
  console.log(`   ${players.length} filas, ${headers.length} columnas`);
  console.log(`\nEnvía este CSV al club para que completen los datos faltantes.`);
}

main().catch(e => { console.error(e); process.exit(1); });
