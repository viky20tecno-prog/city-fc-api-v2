const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const PLANES_PERMITIDOS = ['pro', 'scale'];

function supabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function wahaHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.WAHA_API_KEY) h['X-Api-Key'] = process.env.WAHA_API_KEY;
  return h;
}

function wahaFetch(path, opts = {}) {
  const base = (process.env.WAHA_URL || '').replace(/\/$/, '');
  return fetch(`${base}${path}`, { headers: wahaHeaders(), ...opts });
}

// Guarda/quita waha_session en clubs.config
async function setWahaSession(club_uuid, sessionName) {
  const sb = supabaseAdmin();
  const { data: row } = await sb.from('clubs').select('config').eq('id', club_uuid).single();
  const config = row?.config || {};
  if (sessionName) {
    config.waha_session = sessionName;
  } else {
    delete config.waha_session;
  }
  await sb.from('clubs').update({ config }).eq('id', club_uuid);
}

// Verifica plan Pro/Scale
function verificarPlan(req, res) {
  const plan = (req.clubConfig?.plan || req.clubPlan || 'trial').toLowerCase();
  if (!PLANES_PERMITIDOS.includes(plan)) {
    res.status(403).json({
      success: false,
      error: 'Función disponible solo en planes Pro y Scale.',
      plan,
    });
    return false;
  }
  return true;
}

// POST /api/waha/conectar — inicia sesión WAHA con el slug del club
router.post('/conectar', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { data: club } = await sb.from('clubs').select('id, slug, config').eq('id', req.club_uuid).single();
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const plan = (club.config?.plan || 'trial').toLowerCase();
    if (!PLANES_PERMITIDOS.includes(plan)) {
      return res.status(403).json({ success: false, error: 'Función disponible solo en planes Pro y Scale.', plan });
    }

    const sessionName = club.slug;

    // Idempotente: si ya hay una sesión de este club iniciando/conectada, reusarla
    // en vez de crear otra. Sin esto, cada clic en "reintentar" (ej. tras un QR
    // vencido) dejaba una sesión WAHA duplicada con el mismo nombre.
    const rCheck = await wahaFetch(`/api/sessions/${sessionName}`);
    if (rCheck.ok) {
      const dataCheck = await rCheck.json();
      if (['WORKING', 'STARTING', 'SCAN_QR_CODE'].includes(dataCheck.status)) {
        return res.json({ success: true, session: sessionName, status: dataCheck.status });
      }
      // Sesión muerta (FAILED/STOPPED) — borrarla antes de crear una nueva
      try {
        await wahaFetch(`/api/sessions/${sessionName}`, { method: 'DELETE' });
      } catch (_) { /* ok */ }
    }

    // Crear nueva sesión
    const rCreate = await wahaFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: sessionName, config: { webhooks: [] } }),
    });

    if (!rCreate.ok) {
      const err = await rCreate.text();
      // Si ya existe (carrera con otro request concurrente), continuar igual
      if (!err.includes('already exists') && rCreate.status !== 409) {
        return res.status(502).json({ success: false, error: `Error WAHA: ${err}` });
      }
    }

    // Iniciar la sesión (en WAHA v2026 create y start son pasos separados)
    const rStart = await wahaFetch(`/api/sessions/${sessionName}/start`, { method: 'POST' });
    if (!rStart.ok) {
      const errStart = await rStart.text();
      // Si ya está iniciada, no es error
      if (!errStart.includes('already') && rStart.status !== 409) {
        console.warn('[waha/conectar] start warning:', errStart);
      }
    }

    res.json({ success: true, session: sessionName });
  } catch (e) {
    console.error('[waha/conectar]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/waha/qr — devuelve el QR como base64 para mostrar en pantalla
router.get('/qr', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { data: club } = await sb.from('clubs').select('slug, config').eq('id', req.club_uuid).single();
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const plan = (club.config?.plan || 'trial').toLowerCase();
    if (!PLANES_PERMITIDOS.includes(plan)) {
      return res.status(403).json({ success: false, error: 'Función disponible solo en planes Pro y Scale.' });
    }

    const sessionName = club.slug;

    // Intentar primero como imagen PNG
    const rImg = await wahaFetch(`/api/${sessionName}/auth/qr?format=image`);
    if (rImg.ok) {
      const contentType = rImg.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        const buf = await rImg.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        return res.json({ success: true, qr: `data:image/png;base64,${b64}` });
      }
      // Respuesta inesperada como imagen, intentar parsear como JSON
      try {
        const json = await rImg.json();
        if (json.value) return res.json({ success: true, qr: json.value, raw: true });
      } catch (_) {}
    }

    // Fallback: endpoint sin format param (devuelve JSON con value)
    const rJson = await wahaFetch(`/api/${sessionName}/auth/qr`);
    if (rJson.ok) {
      try {
        const json = await rJson.json();
        if (json.value) return res.json({ success: true, qr: json.value, raw: true });
      } catch (_) {}
    }

    return res.status(202).json({ success: false, error: 'QR no disponible aún — espera unos segundos' });
  } catch (e) {
    console.error('[waha/qr]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/waha/estado — devuelve el status de la sesión; si WORKING guarda waha_session
router.get('/estado', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { data: club } = await sb.from('clubs').select('slug, config').eq('id', req.club_uuid).single();
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const plan = (club.config?.plan || 'trial').toLowerCase();
    if (!PLANES_PERMITIDOS.includes(plan)) {
      return res.status(403).json({ success: false, error: 'Función disponible solo en planes Pro y Scale.' });
    }

    const sessionName = club.slug;
    const r = await wahaFetch(`/api/sessions/${sessionName}`);

    if (!r.ok) {
      // Sesión no existe aún
      return res.json({ success: true, status: 'STOPPED', session: sessionName });
    }

    const data = await r.json();
    const status = data.status || 'UNKNOWN'; // STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED

    // Si ya está conectado, guardar la sesión en config del club
    if (status === 'WORKING' && club.config?.waha_session !== sessionName) {
      await setWahaSession(req.club_uuid, sessionName);
    }

    // Si falló o fue desconectado desde fuera, limpiar config
    if ((status === 'FAILED' || status === 'STOPPED') && club.config?.waha_session === sessionName) {
      await setWahaSession(req.club_uuid, null);
    }

    res.json({ success: true, status, session: sessionName, me: data.me || null });
  } catch (e) {
    console.error('[waha/estado]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/waha/desconectar — cierra sesión y limpia config
router.delete('/desconectar', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { data: club } = await sb.from('clubs').select('slug, config').eq('id', req.club_uuid).single();
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const plan = (club.config?.plan || 'trial').toLowerCase();
    if (!PLANES_PERMITIDOS.includes(plan)) {
      return res.status(403).json({ success: false, error: 'Función disponible solo en planes Pro y Scale.' });
    }

    const sessionName = club.slug;

    try {
      await wahaFetch(`/api/sessions/${sessionName}/stop`, { method: 'POST' });
    } catch (_) { /* ok si ya estaba parada */ }

    try {
      await wahaFetch(`/api/sessions/${sessionName}/logout`, { method: 'POST' });
    } catch (_) { /* puede fallar si ya estaba desconectado */ }

    try {
      await wahaFetch(`/api/sessions/${sessionName}`, { method: 'DELETE' });
    } catch (_) { /* ok */ }

    await setWahaSession(req.club_uuid, null);

    res.json({ success: true, message: 'Sesión de WhatsApp desconectada' });
  } catch (e) {
    console.error('[waha/desconectar]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/waha/media-proxy?url=<url de archivo WAHA> — reenvía el archivo con la API key
// puesta del lado del servidor (el navegador no puede mandar headers custom a WAHA directo)
router.get('/media-proxy', async (req, res) => {
  try {
    const url = req.query.url;
    const wahaBase = (process.env.WAHA_URL || '').replace(/\/$/, '');
    if (!url || !wahaBase || !String(url).startsWith(wahaBase)) {
      return res.status(400).json({ success: false, error: 'URL inválida' });
    }

    const r = await fetch(url, { headers: wahaHeaders() });
    if (!r.ok) return res.status(r.status).json({ success: false, error: `WAHA respondió ${r.status}` });

    const contentType = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  } catch (e) {
    console.error('[waha/media-proxy]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
