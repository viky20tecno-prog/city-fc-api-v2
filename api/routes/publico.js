const express   = require('express');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const db        = require('../services/db');
const router    = express.Router();

const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas consultas. Intenta de nuevo en un minuto.' },
});

router.use('/atleta', portalLimiter);

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mapEstado(estado) {
  switch (estado) {
    case 'AL_DIA':      return 'pagado';
    case 'MORA':        return 'vencido';
    case 'PARCIAL':     return 'parcial';
    case 'POR_VALIDAR': return 'por_validar';
    case 'PENDIENTE':   return 'pendiente';
    default:            return 'pendiente';
  }
}

function calcSaldo(m) {
  const oficial  = parseFloat(m.valor_oficial) || 0;
  const pagado   = parseFloat(m.valor_pagado)  || 0;
  if (m.estado === 'AL_DIA') return 0;
  if (m.estado === 'PARCIAL' || m.estado === 'POR_VALIDAR') return Math.max(0, oficial - pagado);
  return oficial;
}

// GET /api/publico/atleta/:clubSlug/:cedula
router.get('/atleta/:clubSlug/:cedula', async (req, res) => {
  try {
    const { clubSlug, cedula } = req.params;

    const club = await db.getClubBySlug(clubSlug);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const jugador = await db.getPlayerByCedula(club.id, cedula);
    if (!jugador) return res.status(404).json({ success: false, error: 'Atleta no encontrado' });

    const anioActual = new Date().getFullYear();
    const mensualidades = await db.getMensualidades(club.id, cedula);

    const resumen = mensualidades
      .filter(m => m.anio >= anioActual - 1)
      .map(m => ({
        mes:           m.mes,
        numero_mes:    parseInt(m.numero_mes) || 0,
        anio:          m.anio,
        estado:        mapEstado(m.estado),
        valor_oficial: parseFloat(m.valor_oficial) || 0,
        valor_pagado:  parseFloat(m.valor_pagado)  || 0,
        saldo:         parseFloat(m.saldo_pendiente) || calcSaldo(m),
        fecha_pago:    m.fecha_pago || null,
      }))
      .sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.numero_mes - b.numero_mes);

    const pendientes      = resumen.filter(m => m.estado !== 'pagado');
    const saldo_pendiente = pendientes.reduce((s, m) => s + m.saldo, 0);
    const total_pagado    = resumen.reduce((s, m) => s + m.valor_pagado, 0);

    res.json({
      success: true,
      club: {
        nombre:    club.config?.nombre || clubSlug,
        subtitulo: club.config?.subtitulo || '',
        color:     club.config?.color || '#00AAFF',
        logo_url:  club.config?.logo_url || null,
        slug:      clubSlug,
      },
      atleta: {
        nombre:    jugador.nombre,
        apellidos: jugador.apellidos || '',
        cedula:    jugador.cedula,
        categoria: jugador.categoria || '',
        equipo:    jugador.equipo || '',
        posicion:  jugador.posicion || '',
        numero:    jugador.numero || '',
        foto_url:  jugador.foto_url || null,
        activo:    jugador.activo,
      },
      mensualidades:    resumen,
      saldo_pendiente,
      total_pagado,
      meses_pendientes: pendientes.length,
    });
  } catch (error) {
    console.error('Error en GET /publico/atleta:', error);
    res.status(500).json({ success: false, error: 'Error al consultar datos del atleta' });
  }
});

// ── PDF de morosos vía WhatsApp ──────────────────────────────────────────────
// Token HMAC-SHA256 diario — válido 48h (hoy y ayer)
// Usa SUPABASE_SERVICE_ROLE_KEY como secreto — mismo valor que en wa-agent.js
function validarTokenMorosos(clubId, token, mes = '') {
  const secret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 40) || 'zensports';
  const dia = Math.floor(Date.now() / 86400000);
  const ok = (d) => crypto.createHmac('sha256', secret).update(`pdf:${clubId}:${mes}:${d}`).digest('hex').slice(0, 32);
  return token === ok(dia) || token === ok(dia - 1);
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatCOP(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(parseInt(n) || 0);
}

// GET /api/publico/morosos-pdf/:clubId?token=xxx[&mes=N]
router.get('/morosos-pdf/:clubId', async (req, res) => {
  try {
    const { clubId } = req.params;
    const { token, mes } = req.query;
    const mesParam = mes ? String(parseInt(mes) || '') : '';

    if (!token || !validarTokenMorosos(clubId, token, mesParam)) {
      return res.status(403).send('<h2>Enlace inválido o expirado</h2>');
    }

    // Obtener club
    const { data: club } = await db.supabase
      .from('clubs')
      .select('id, name, config')
      .eq('id', clubId)
      .single();

    if (!club) return res.status(404).send('<h2>Club no encontrado</h2>');

    const clubNombre = club.config?.nombre || club.name || 'Mi Club';
    const color = (club.config?.color && club.config.color.startsWith('#')) ? club.config.color : '#E14924';
    const logoUrl = club.config?.logo_url || '';

    const anio = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const pastGracePeriod = new Date().getDate() > 7;
    const filtroMes = mesParam ? parseInt(mesParam) : null; // null = todos

    const [jugadores, allInvoices, suspensiones] = await Promise.all([
      db.getPlayers(club.id),
      db.getMensualidades(club.id),
      db.getSuspensiones(club.id),
    ]);

    const isSuspendido = (cedula, mesNum) =>
      (suspensiones || []).some(s =>
        s.cedula === String(cedula) &&
        parseInt(s.anio) === anio &&
        s.mes_inicio <= mesNum &&
        mesNum <= s.mes_fin
      );

    const playersMap = {};
    (jugadores || []).forEach(p => { playersMap[p.cedula] = p; });

    const MESES_N = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    const defaultersMap = {};
    (allInvoices || []).forEach(inv => {
      if (String(inv.anio) !== String(anio)) return;
      if (inv.estado === 'AL_DIA') return;
      const mesNum = parseInt(inv.numero_mes);
      if (isSuspendido(inv.cedula, mesNum)) return;

      let incluir = false;
      if (filtroMes !== null) {
        // Filtro por mes específico: incluir si hay saldo pendiente en ese mes
        incluir = (mesNum === filtroMes) && (parseFloat(inv.saldo_pendiente) || 0) > 0;
      } else {
        // Año completo: solo meses ya vencidos con mora real
        if (inv.estado === 'PARCIAL' && mesNum === currentMonth) return;
        incluir = (mesNum < currentMonth) || (mesNum === currentMonth && pastGracePeriod);
        if (!(parseFloat(inv.saldo_pendiente) || 0 > 0)) incluir = false;
      }

      if (incluir) {
        if (!defaultersMap[inv.cedula]) {
          const p = playersMap[inv.cedula] || {};
          defaultersMap[inv.cedula] = {
            cedula: inv.cedula,
            nombre: `${p.nombre || ''} ${p.apellidos || ''}`.trim() || inv.cedula,
            celular: p.celular || '',
            saldo_total: 0,
            meses_mora: 0,
            meses_arr: [],
          };
        }
        const saldo = parseFloat(inv.saldo_pendiente) || 0;
        if (saldo > 0) {
          defaultersMap[inv.cedula].saldo_total += saldo;
          defaultersMap[inv.cedula].meses_mora += 1;
          defaultersMap[inv.cedula].meses_arr.push(MESES_N[mesNum] || inv.mes);
        }
      }
    });

    const morosos = Object.values(defaultersMap).sort((a, b) => b.saldo_total - a.saldo_total);
    const totalSaldo = morosos.reduce((s, m) => s + m.saldo_total, 0);

    const fecha = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    const periodoLabel = filtroMes
      ? `${MESES_N[filtroMes]} ${anio}`
      : `Año ${anio}`;

    const logoHtml = logoUrl
      ? `<img src="${esc(logoUrl)}" alt="" style="height:44px;width:44px;object-fit:contain;border-radius:8px;margin-right:14px;flex-shrink:0" />`
      : '';

    const filas = morosos.map((m, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'}">
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${i + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111">${esc(m.nombre)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${esc(m.cedula)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${esc(m.celular) || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center">
          <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600">
            ${m.meses_mora} mes${m.meses_mora !== 1 ? 'es' : ''}
          </span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#dc2626">
          ${m.meses_arr.map(mes => `<span style="display:inline-block;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:1px 6px;margin:1px 2px;font-size:11px">${esc(mes)}</span>`).join('')}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#dc2626;text-align:right">${formatCOP(m.saldo_total)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Morosos — ${esc(clubNombre)}</title>
  <style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family:Arial,sans-serif; color:#111; background:#fff; } @media print { .no-print { display:none !important; } }</style>
</head>
<body>
  <div style="background:${color};padding:18px 32px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center">${logoHtml}<div>
      <p style="font-size:17px;font-weight:800;color:#fff">${esc(clubNombre)}</p>
      <p style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">ZenSports — Gestión deportiva</p>
    </div></div>
    <div style="text-align:right">
      <p style="font-size:13px;font-weight:700;color:#fff">Reporte de Morosos</p>
      <p style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">${periodoLabel} · ${fecha}</p>
    </div>
  </div>
  <div style="padding:28px 32px">
    <div style="display:flex;gap:14px;margin-bottom:24px">
      <div style="flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;border-top:3px solid #dc2626">
        <p style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">En mora</p>
        <p style="font-size:30px;font-weight:800;color:#dc2626">${morosos.length}</p>
      </div>
      <div style="flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;border-top:3px solid ${color}">
        <p style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Total a cobrar</p>
        <p style="font-size:26px;font-weight:800;color:${color}">${formatCOP(totalSaldo)}</p>
      </div>
      <div style="flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;border-top:3px solid #16a34a">
        <p style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Promedio/jugador</p>
        <p style="font-size:26px;font-weight:800;color:#16a34a">${formatCOP(morosos.length ? Math.round(totalSaldo / morosos.length) : 0)}</p>
      </div>
    </div>
    ${morosos.length === 0
      ? `<p style="text-align:center;padding:40px;color:#6b7280;font-size:15px">✅ ¡Sin morosos este mes!</p>`
      : `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:${color};font-weight:700;border-bottom:2px solid #e5e7eb">#</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:${color};font-weight:700;border-bottom:2px solid #e5e7eb">Jugador</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:${color};font-weight:700;border-bottom:2px solid #e5e7eb">Cédula</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:${color};font-weight:700;border-bottom:2px solid #e5e7eb">Celular</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;color:${color};font-weight:700;border-bottom:2px solid #e5e7eb">Meses</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:${color};font-weight:700;border-bottom:2px solid #e5e7eb">Detalle</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;color:${color};font-weight:700;border-bottom:2px solid #e5e7eb">Saldo</th>
          </tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr style="background:#f9fafb">
            <td colspan="6" style="padding:12px;font-size:13px;font-weight:700;text-align:right;border-top:2px solid #e5e7eb;color:#374151">Total a cobrar</td>
            <td style="padding:12px;font-size:14px;font-weight:800;color:#dc2626;text-align:right;border-top:2px solid #e5e7eb">${formatCOP(totalSaldo)}</td>
          </tr></tfoot>
        </table>`}
    <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
      <p style="font-size:10px;color:#9ca3af">${esc(clubNombre)} · Documento confidencial — no compartir públicamente</p>
      <p style="font-size:10px;color:#9ca3af">zensports.zenpra.ai</p>
    </div>
  </div>
  <div class="no-print" style="padding:0 32px 28px;text-align:center">
    <button onclick="window.print()" style="background:${color};color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">
      Imprimir / Guardar PDF
    </button>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('Error en GET /publico/morosos-pdf:', error);
    res.status(500).send('<h2>Error generando el reporte</h2>');
  }
});

module.exports = router;
