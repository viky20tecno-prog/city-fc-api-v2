// Informe semanal de salud de ZenSports (lo dispara Vercel Cron, ver vercel.json y
// routes/cron.js → /api/cron/health-report). Solo lectura: no modifica nada.
// Revisa disponibilidad, bot de WhatsApp, tareas programadas, accesos públicos
// abiertos (con la clave anon, que es pública y va en el navegador) y uso de datos.
const { createClient } = require('@supabase/supabase-js');

const URLS = [
  { nombre: 'Landing y dashboard', url: 'https://zensports.zenpra.ai/login' },
  { nombre: 'Panel admin',         url: 'https://admin-zensports.zenpra.ai/login' },
  { nombre: 'API',                 url: 'https://api.zensports.zenpra.ai/api/health' },
];
const BUCKETS = ['comprobantes', 'club-assets', 'player-photos'];
// Clave publicable (anon) de Supabase: es PÚBLICA, va dentro del bundle del
// dashboard. Solo sirve para comprobar qué ve un visitante anónimo.
// Nunca poner aquí la service_role ni una clave sb_secret_.
const ANON_PUBLICA = 'sb_publishable_NAJqpVvv0xpJlxcDz_qBIQ_D-Dg-Tt0';
const LENTO_S = 2;

async function medir(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${url}?salud=${t0}`, { signal: AbortSignal.timeout(15000) });
    return { status: r.status, s: (Date.now() - t0) / 1000 };
  } catch (e) {
    return { status: 0, s: (Date.now() - t0) / 1000, error: e.message };
  }
}

async function tamanoBucket(sb, bucket, prefix = '', prof = 0) {
  let bytes = 0, archivos = 0;
  if (prof > 4) return { bytes, archivos };
  const { data } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
  for (const f of data || []) {
    if (f.id === null) {
      const r = await tamanoBucket(sb, bucket, prefix ? `${prefix}/${f.name}` : f.name, prof + 1);
      bytes += r.bytes; archivos += r.archivos;
    } else {
      bytes += f.metadata?.size || 0; archivos++;
    }
  }
  return { bytes, archivos };
}

async function generarInforme() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = process.env.SUPABASE_ANON_KEY || ANON_PUBLICA;
  const checks = [];
  const add = (area, nombre, estado, detalle) => checks.push({ area, nombre, estado, detalle });

  // 1. Disponibilidad y velocidad
  for (const u of URLS) {
    const m = await medir(u.url);
    const estado = m.status !== 200 ? 'bad' : m.s > LENTO_S ? 'warn' : 'ok';
    add('Disponibilidad', u.nombre, estado, m.status ? `HTTP ${m.status} · ${m.s.toFixed(2)} s` : `Sin respuesta (${m.error})`);
  }

  // 2. Bot de WhatsApp
  try {
    const headers = process.env.WAHA_API_KEY ? { 'X-Api-Key': process.env.WAHA_API_KEY } : {};
    const r = await fetch(`${process.env.WAHA_URL}/api/sessions/default`, { headers, signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    add('Bot de WhatsApp', 'Sesión default (Zen)', j.status === 'WORKING' ? 'ok' : 'bad', j.status || `HTTP ${r.status}`);
  } catch (e) {
    add('Bot de WhatsApp', 'Sesión default (Zen)', 'bad', `No responde: ${e.message}`);
  }

  // 3. Tareas programadas: la limpieza diaria deja wa_sessions sin filas de más de 1 día
  {
    const corte = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    const { count, error } = await sb.from('wa_sessions').select('*', { count: 'exact', head: true }).lt('updated_at', corte);
    add('Tareas programadas', 'Limpieza diaria de conversaciones', error ? 'warn' : count > 0 ? 'warn' : 'ok',
      error ? error.message : count > 0 ? `${count} conversaciones viejas: la limpieza no corrió` : 'Al día');
  }

  // 4. Accesos públicos abiertos (clave anon)
  if (anonKey) {
    const anon = createClient(process.env.SUPABASE_URL, anonKey, { auth: { persistSession: false } });
    for (const t of ['leads', 'players', 'pagos', 'admin_billing', 'wa_sessions', 'audit_logs']) {
      const { data, error } = await anon.from(t).select('*').limit(1);
      const expuesta = !error && data?.length > 0;
      add('Seguridad', `Tabla ${t} con clave pública`, expuesta ? 'bad' : 'ok', expuesta ? 'Se puede leer: revisar RLS' : 'Bloqueada');
    }
    for (const b of BUCKETS) {
      const { data, error } = await anon.storage.from(b).list('', { limit: 1 });
      const listable = !error && data?.length > 0;
      add('Seguridad', `Archivos de ${b} con clave pública`, listable ? 'bad' : 'ok', listable ? 'Se pueden listar y descargar' : 'No se pueden listar');
    }
  } else {
    add('Seguridad', 'Pruebas con clave pública', 'warn', 'Falta SUPABASE_ANON_KEY en el servidor');
  }

  // 5. Uso de datos
  const hace7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const contar = async (t, f) => { let q = sb.from(t).select('*', { count: 'exact', head: true }); if (f) q = f(q); const { count } = await q; return count ?? 0; };
  const { data: clubs } = await sb.from('clubs').select('is_active, config');
  const pagando = (clubs || []).filter(c => c.is_active && !c.config?.sin_cobro && !['free', 'trial'].includes(c.config?.plan)).length;
  const fundadores = (clubs || []).filter(c => c.config?.fundador?.numero).length;
  const uso = {
    clubes: (clubs || []).length,
    clubes_pagando: pagando,
    fundadores,
    jugadores_activos: await contar('players', q => q.eq('activo', true)),
    pagos_7_dias: await contar('pagos', q => q.gte('created_at', hace7)),
    leads_7_dias: await contar('leads', q => q.gte('created_at', hace7)),
    cobros_zensports_pendientes: await contar('admin_billing', q => q.eq('estado', 'pendiente')),
  };
  let storageMB = 0;
  for (const b of BUCKETS) storageMB += (await tamanoBucket(sb, b)).bytes / 1048576;
  uso.almacenamiento_mb = Math.round(storageMB * 10) / 10;
  add('Uso', 'Almacenamiento de archivos', storageMB > 800 ? 'warn' : 'ok', `${uso.almacenamiento_mb} MB de 1.024 MB del plan gratuito`);

  const malos = checks.filter(c => c.estado === 'bad').length;
  const avisos = checks.filter(c => c.estado === 'warn').length;
  return { fecha: new Date().toISOString(), checks, uso, malos, avisos };
}

function htmlInforme({ fecha, checks, uso, malos, avisos }) {
  const color = { ok: '#0F7A4C', warn: '#9A5B00', bad: '#B4232C' };
  const etiqueta = { ok: 'OK', warn: 'Revisar', bad: 'Atender' };
  const filas = checks.map(c => `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #E3E0EE;color:#5E5A70;font-size:12px;">${c.area}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #E3E0EE;font-size:13px;color:#16141F;">${c.nombre}<br><span style="color:#5E5A70;font-size:12px;">${c.detalle}</span></td>
      <td style="padding:7px 10px;border-bottom:1px solid #E3E0EE;font-size:12px;font-weight:700;color:${color[c.estado]};white-space:nowrap;">● ${etiqueta[c.estado]}</td></tr>`).join('');
  const resumen = malos ? `${malos} punto(s) por atender` : avisos ? `${avisos} aviso(s) para revisar` : 'Todo en orden';
  const dia = new Date(fecha).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' });
  const datos = [
    ['Clubes', `${uso.clubes} (${uso.clubes_pagando} pagando · ${uso.fundadores} fundadores)`],
    ['Jugadores activos', uso.jugadores_activos],
    ['Pagos registrados (7 días)', uso.pagos_7_dias],
    ['Prospectos nuevos (7 días)', uso.leads_7_dias],
    ['Cobros de ZenSports pendientes', uso.cobros_zensports_pendientes],
  ].map(([k, v]) => `<tr><td style="padding:5px 0;color:#5E5A70;font-size:13px;">${k}</td><td style="padding:5px 0;text-align:right;font-size:13px;font-weight:600;color:#16141F;">${v}</td></tr>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;background:#F6F5FA;padding:24px 12px;">
  <div style="background:#fff;border:1px solid #E3E0EE;border-radius:14px;padding:28px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6A00FF;font-weight:700;">Informe semanal · ${dia}</div>
    <h1 style="margin:8px 0 4px;font-size:22px;color:#16141F;">Salud de ZenSports: ${resumen}</h1>
    <p style="margin:0 0 20px;color:#5E5A70;font-size:13px;">Revisión automática de solo lectura. ${checks.length} verificaciones.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3E0EE;border-radius:10px;border-collapse:separate;overflow:hidden;">${filas}</table>
    <h2 style="margin:24px 0 6px;font-size:15px;color:#16141F;">Uso</h2>
    <table width="100%" cellpadding="0" cellspacing="0">${datos}</table>
  </div>
  <p style="text-align:center;color:#8A8699;font-size:11px;margin:14px 0 0;">Generado por la API de ZenSports (/api/cron/health-report).</p>
</div>`;
}

module.exports = { generarInforme, htmlInforme };
