const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const db = require('../services/db');

const router = express.Router();

const LIMITE_POR_PLAN = { trial: 0, starter: 0, pro: 8, scale: Infinity };
const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function supabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function wahaChatId(to) {
  const n = String(to).replace(/\D/g, '');
  return `${n.startsWith('57') ? n : '57' + n}@c.us`;
}

function wahaHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.WAHA_API_KEY) h['X-Api-Key'] = process.env.WAHA_API_KEY;
  return h;
}

async function sendWAHA(to, text, session) {
  const wahaUrl = process.env.WAHA_URL;
  const sess    = session || process.env.WAHA_SESSION || 'default';
  if (!wahaUrl) return;
  await fetch(`${wahaUrl}/api/sendText`, {
    method: 'POST', headers: wahaHeaders(),
    body: JSON.stringify({ chatId: wahaChatId(to), text, session: sess }),
  });
}

async function sendWAHAImage(to, imageUrl, session) {
  const wahaUrl = process.env.WAHA_URL;
  const sess    = session || process.env.WAHA_SESSION || 'default';
  if (!wahaUrl || !imageUrl) return;
  await fetch(`${wahaUrl}/api/sendImage`, {
    method: 'POST', headers: wahaHeaders(),
    body: JSON.stringify({ chatId: wahaChatId(to), file: { url: imageUrl }, caption: '', session: sess }),
  });
}

function formatCOP(n) {
  return '$' + Math.round(n).toLocaleString('es-CO');
}

// Rellena variables del template con datos reales
function renderMensaje(plantilla, vars) {
  let texto = plantilla;
  for (const [k, v] of Object.entries(vars)) {
    texto = texto.replaceAll(k, v ?? '');
  }
  return texto;
}

// GET /api/plantillas
router.get('/', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const [{ data, error }, { data: club }] = await Promise.all([
      sb.from('plantillas_mensajes').select('*').eq('club_id', req.club_uuid).order('created_at'),
      sb.from('clubs').select('config').eq('id', req.club_uuid).single(),
    ]);
    if (error) throw error;
    const plan   = (club?.config?.plan || 'trial').toLowerCase();
    const limite = LIMITE_POR_PLAN[plan] ?? 1;
    res.json({ success: true, plantillas: data || [], limite, plan });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/plantillas
router.post('/', async (req, res) => {
  const { nombre, mensaje, incluir_qr, hora_envio, activa, tipo_plantilla, tipo_evento, dia_envio } = req.body;
  if (!nombre || !mensaje) return res.status(400).json({ success: false, error: 'nombre y mensaje son requeridos' });
  const tipo = tipo_plantilla || 'evento';
  if (tipo === 'evento' && !hora_envio) return res.status(400).json({ success: false, error: 'hora_envio es requerido para plantillas de evento' });
  if (tipo === 'cobro'  && !dia_envio)  return res.status(400).json({ success: false, error: 'dia_envio es requerido para plantillas de cobro' });

  try {
    const sb = supabaseAdmin();
    const { data: club } = await sb.from('clubs').select('config').eq('id', req.club_uuid).single();
    const plan   = (club?.config?.plan || 'trial').toLowerCase();
    const limite = LIMITE_POR_PLAN[plan] ?? 1;
    const { count } = await sb.from('plantillas_mensajes').select('id', { count: 'exact', head: true }).eq('club_id', req.club_uuid);
    if (count >= limite) {
      return res.status(403).json({
        success: false,
        error: `Tu plan ${plan} permite hasta ${limite} plantilla${limite !== 1 ? 's' : ''}. Mejora tu plan para crear más.`,
        limite, plan,
      });
    }

    const { data, error } = await sb.from('plantillas_mensajes').insert([{
      club_id:        req.club_uuid,
      nombre:         nombre.trim(),
      mensaje:        mensaje.trim(),
      incluir_qr:     !!incluir_qr,
      hora_envio:     tipo === 'evento' ? hora_envio : null,
      dia_envio:      tipo === 'cobro'  ? Number(dia_envio) : null,
      activa:         activa !== false,
      tipo_plantilla: tipo,
      tipo_evento:    tipo === 'evento' ? (tipo_evento || 'ENTRENAMIENTO') : null,
    }]).select().single();
    if (error) throw error;
    res.json({ success: true, plantilla: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/plantillas/:id
router.put('/:id', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const allowed = ['nombre','mensaje','incluir_qr','hora_envio','dia_envio','activa','tipo_plantilla','tipo_evento'];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.nombre)  updates.nombre  = updates.nombre.trim();
    if (updates.mensaje) updates.mensaje = updates.mensaje.trim();

    const { data, error } = await sb.from('plantillas_mensajes')
      .update(updates)
      .eq('id', req.params.id)
      .eq('club_id', req.club_uuid)
      .select().single();
    if (error) throw error;
    res.json({ success: true, plantilla: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/plantillas/:id
router.delete('/:id', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from('plantillas_mensajes')
      .delete().eq('id', req.params.id).eq('club_id', req.club_uuid);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/plantillas/:id/probar — envía al celular del admin con datos de ejemplo
router.post('/:id/probar', async (req, res) => {
  try {
    const sb = supabaseAdmin();
    const { data: p } = await sb.from('plantillas_mensajes')
      .select('*').eq('id', req.params.id).eq('club_id', req.club_uuid).single();
    if (!p) return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });

    const { data: club } = await sb.from('clubs').select('*').eq('id', req.club_uuid).single();
    const config     = club?.config || {};
    const clubNombre = config.nombre || club?.name || 'Mi Club';
    const qrUrl      = config.qr_pago_url || null;
    const adminTel    = club?.celular_admin;
    if (!adminTel) return res.status(400).json({ success: false, error: 'El club no tiene celular_admin configurado' });
    const clubSession = config.waha_session || process.env.WAHA_SESSION || 'default';

    const tipo = p.tipo_plantilla || 'evento';
    let vars = {};

    if (tipo === 'evento') {
      const DIAS = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
      const hoy  = new Date(Date.now() - 5 * 3600000);
      vars = {
        '{dia}':          DIAS[hoy.getDay()],
        '{lugar}':        'Campo de Prueba',
        '{hora_inicio}':  '9:00 pm',
        '{hora_fin}':     '11:00 pm',
        '{club_nombre}':  clubNombre,
        '{llave_pago}':   config.llave_pago || '000000000',
      };
    } else {
      vars = {
        '{nombre}':        'Jugador Ejemplo',
        '{deuda}':         formatCOP(150000),
        '{meses}':         'enero, febrero',
        '{club_nombre}':   clubNombre,
        '{llave_pago}':    config.llave_pago || '000000000',
      };
    }

    const texto = renderMensaje(p.mensaje, vars);

    if (p.incluir_qr && qrUrl) await sendWAHAImage(adminTel, qrUrl, clubSession);
    await sendWAHA(adminTel, `🧪 *PRUEBA DE PLANTILLA*\n\n${texto}`, clubSession);

    res.json({ success: true, enviado_a: adminTel });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/plantillas/:id/enviar — disparo manual inmediato a todos los jugadores del club
router.post('/:id/enviar', async (req, res) => {
  try {
    const sb = supabaseAdmin();

    const [{ data: p }, { data: club }] = await Promise.all([
      sb.from('plantillas_mensajes').select('*').eq('id', req.params.id).eq('club_id', req.club_uuid).single(),
      sb.from('clubs').select('*').eq('id', req.club_uuid).single(),
    ]);

    if (!p)    return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const config      = club.config || {};
    const clubSession = config.waha_session;
    if (!clubSession) {
      return res.status(400).json({ success: false, error: 'Conecta tu WhatsApp primero desde la sección de Plantillas.' });
    }

    const wahaUrl    = process.env.WAHA_URL;
    const clubNombre = config.nombre || club.name || club.slug;
    const qrUrl      = config.qr_pago_url || null;
    const llavePago  = config.llave_pago  || '';
    const tipo       = p.tipo_plantilla || 'evento';

    // Responder inmediatamente — el envío ocurre en background
    res.json({ success: true, status: 'processing' });

    setImmediate(async () => {
      const ahora   = new Date();
      const nowCol  = new Date(ahora.getTime() - 5 * 3600000);
      const hoyCol  = nowCol.toISOString().split('T')[0];
      const anio    = nowCol.getFullYear();
      const MESES   = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const DIAS_ES = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
      const fmtH    = d => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
      const delay   = ms => new Promise(r => setTimeout(r, ms));

      let enviados = 0, errores = 0;

      try {
        const { data: jugadores } = await sb
          .from('players').select('cedula, nombre, apellidos, celular')
          .eq('club_id', club.id).eq('activo', true);

        if (!jugadores?.length) {
          console.log(`[plantillas/enviar] ${p.id}: sin jugadores activos`);
          return;
        }

        // ── TIPO EVENTO ────────────────────────────────────────────────────
        if (tipo === 'evento') {
          const mananaCol = new Date(nowCol.getTime() + 86400000).toISOString().split('T')[0];
          const inicioUTC = `${hoyCol}T05:00:00Z`;
          const finUTC    = `${mananaCol}T04:59:59Z`;

          let query = sb.from('calendario')
            .select('id, titulo, tipo, lugar, fecha_inicio, fecha_fin')
            .eq('club_id', club.slug)
            .gte('fecha_inicio', inicioUTC)
            .lte('fecha_inicio', finUTC)
            .or('suspendido.eq.false,suspendido.is.null');

          if (p.tipo_evento && p.tipo_evento !== 'todos') {
            query = query.eq('tipo', p.tipo_evento);
          }
          const { data: eventos } = await query.order('fecha_inicio');

          if (!eventos?.length) {
            console.log(`[plantillas/enviar] ${p.id}: sin eventos hoy`);
            return;
          }

          for (const evento of eventos) {
            const d  = new Date(new Date(evento.fecha_inicio).getTime() - 5 * 3600000);
            const df = evento.fecha_fin ? new Date(new Date(evento.fecha_fin).getTime() - 5 * 3600000) : null;
            const varsBase = {
              '{dia}':         DIAS_ES[d.getDay()],
              '{lugar}':       evento.lugar || '',
              '{hora_inicio}': fmtH(d),
              '{hora_fin}':    df ? fmtH(df) : '',
              '{club_nombre}': clubNombre,
              '{llave_pago}':  llavePago,
            };

            for (const j of jugadores) {
              if (!j.celular) continue;
              const texto = renderMensaje(p.mensaje, { ...varsBase, '{nombre}': j.nombre || '' });
              try {
                if (p.incluir_qr && qrUrl) await sendWAHAImage(j.celular, qrUrl, clubSession);
                await sendWAHA(j.celular, texto, clubSession);
                enviados++;
              } catch (e) { errores++; console.error(`[plantillas/enviar] ${j.celular}:`, e.message); }
              await delay(4000 + Math.random() * 4000);
            }
          }

        // ── TIPO COBRO ─────────────────────────────────────────────────────
        } else if (tipo === 'cobro') {
          const mesActual = nowCol.getMonth() + 1;

          const { data: mens } = await sb
            .from('mensualidades')
            .select('cedula, estado, saldo_pendiente, numero_mes')
            .eq('club_id', club.id).eq('anio', anio)
            .in('estado', ['MORA', 'PENDIENTE', 'PARCIAL'])
            .gt('valor_oficial', 0);

          const porCedula = {};
          for (const m of (mens || [])) {
            if (!porCedula[m.cedula]) porCedula[m.cedula] = [];
            porCedula[m.cedula].push(m);
          }

          for (const j of jugadores) {
            const pendientes = porCedula[j.cedula];
            if (!pendientes?.length || !j.celular) continue;

            const deuda = pendientes.reduce((s, m) => s + (parseFloat(m.saldo_pendiente) || 0), 0);
            const meses = pendientes
              .sort((a, b) => a.numero_mes - b.numero_mes)
              .map(m => MESES[(m.numero_mes || 1) - 1])
              .join(', ');

            const texto = renderMensaje(p.mensaje, {
              '{nombre}':      j.nombre || '',
              '{deuda}':       formatCOP(deuda),
              '{meses}':       meses,
              '{club_nombre}': clubNombre,
              '{llave_pago}':  llavePago,
            });

            try {
              if (p.incluir_qr && qrUrl) await sendWAHAImage(j.celular, qrUrl, clubSession);
              await sendWAHA(j.celular, texto, clubSession);
              enviados++;
            } catch (e) { errores++; console.error(`[plantillas/enviar] ${j.celular}:`, e.message); }
            await delay(4000 + Math.random() * 4000);
          }
        }

        // Actualizar ultimo_envio
        await sb.from('plantillas_mensajes')
          .update({ ultimo_envio: ahora.toISOString() })
          .eq('id', p.id);

        console.log(`[plantillas/enviar] ${p.nombre}: enviados=${enviados} errores=${errores}`);
      } catch (e) {
        console.error(`[plantillas/enviar] Error fatal plantilla ${p.id}:`, e.message);
      }
    });

  } catch (e) {
    console.error('[plantillas/enviar]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
