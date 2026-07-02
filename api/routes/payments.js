const express = require('express');
const db = require('../services/db');
const router = express.Router();

// GET /api/payments?club_id=city-fc&estado=pendiente
router.get('/', async (req, res) => {
  try {
    const { limit = 100, cedula, estado } = req.query;
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pagos = await db.getPagos(club.id, {
      cedula,
      estado_revision: estado || undefined,
      limit: Math.min(parseInt(limit) || 100, 500),
    });

    // Adjuntar la nota del jugador (respuesta a "¿a qué aplicar el excedente?")
    // a los pagos que aún no se concilian — se guarda en club_activity_logs para
    // no necesitar una columna nueva en pagos.
    const pendientesIds = pagos
      .filter(p => p.estado_revision === 'pendiente' || p.estado_revision === 'excedente_pendiente')
      .map(p => p.id);
    if (pendientesIds.length > 0) {
      const { data: notas } = await db.supabase
        .from('club_activity_logs')
        .select('entity_id, details, created_at')
        .eq('club_id', club.id)
        .eq('action', 'NOTA_JUGADOR_COMPROBANTE')
        .in('entity_id', pendientesIds)
        .order('created_at', { ascending: false });
      const notaPorPago = {};
      (notas || []).forEach(n => { if (!notaPorPago[n.entity_id]) notaPorPago[n.entity_id] = n.details?.nota; });
      pagos.forEach(p => { if (notaPorPago[p.id]) p.nota_jugador = notaPorPago[p.id]; });
    }

    res.json({
      success: true,
      club_id: req.club_id,
      total_registros: pagos.length,
      data: pagos,
    });
  } catch (error) {
    console.error('Error in GET /payments:', error);
    res.status(500).json({ success: false, error: 'Error fetching payments', message: error.message });
  }
});

// POST /api/payments
router.post('/', async (req, res) => {
  try {
    const {
      cedula, nombre_detectado, monto, fecha_comprobante,
      banco, referencia, conceptos = [], url_comprobante = '', observacion = '',
    } = req.body;

    if (!cedula || !monto || !banco) {
      return res.status(400).json({ success: false, error: 'Missing required fields: cedula, monto, banco' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Player not found', cedula });

    const hoy          = new Date().toISOString().split('T')[0];
    const montoNum     = parseInt(monto);
    const conceptoTipo = conceptos[0]?.tipo || 'otro';

    // Registrar el pago
    const pago = await db.createPago({
      club_id:         club.id,
      player_id:       player.id,
      cedula:          String(cedula),
      monto:           montoNum,
      banco,
      concepto:        conceptoTipo,
      referencia:      referencia || '',
      estado_revision: 'aprobado_manual',
      url_comprobante,
      tipo_origen:     'MANUAL',
    });

    // Actualizar estado según concepto y registrar si se aplicó
    let resultado = { excedente: montoNum };
    if (conceptoTipo === 'mensualidad') {
      resultado = await actualizarMensualidad(club.id, cedula, montoNum);
    } else if (conceptoTipo === 'uniforme') {
      resultado = await actualizarUniforme(club.id, cedula, montoNum);
    } else if (conceptoTipo === 'torneo') {
      const conceptoDesc = conceptos[0]?.descripcion || '';
      resultado = await actualizarTorneo(club.id, cedula, montoNum, conceptoDesc);
    }

    const conceptoAplicado = resultado.excedente < montoNum;

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'PAGO_REGISTRADO', entity_type: 'pago', entity_id: pago.id,
      entity_label: `${player.nombre || ''} ${player.apellidos || ''}`.trim(),
      details: { cedula, monto: montoNum, banco, concepto: conceptoTipo, referencia },
    });

    res.json({
      success: true,
      club_id: req.club_id,
      id_transaccion: pago.id,
      mensaje: conceptoAplicado
        ? 'Pago registrado y aplicado al concepto'
        : 'Pago registrado. No se encontraron conceptos pendientes para este jugador — el pago queda en el historial.',
      concepto_aplicado: conceptoAplicado,
      pago: {
        id: pago.id,
        cedula,
        monto: montoNum,
        banco,
        referencia,
        estado: 'aprobado_manual',
        fecha_proceso: hoy,
      },
    });
  } catch (error) {
    console.error('Error in POST /payments:', error);
    res.status(500).json({ success: false, error: 'Error registering payment', message: error.message });
  }
});

// PUT /api/payments/:id  — editar, aprobar o rechazar un pago
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { accion, monto, banco, referencia, concepto } = req.body;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pago = await db.getPagoById(id);
    if (!pago || pago.club_id !== club.id)
      return res.status(404).json({ success: false, error: 'Pago no encontrado' });

    // ── Solo edición de campos ────────────────────────────────────────────────
    if (!accion) {
      const updated = await db.updatePago(id, {
        ...(monto     !== undefined && { monto: parseInt(monto) }),
        ...(banco     !== undefined && { banco }),
        ...(referencia !== undefined && { referencia }),
        ...(concepto  !== undefined && { concepto }),
      });
      return res.json({ success: true, data: updated });
    }

    // ── Rechazar ──────────────────────────────────────────────────────────────
    if (accion === 'rechazar') {
      const updated = await db.updatePago(id, { estado_revision: 'rechazado' });

      let waEnviado = false;
      try {
        const player = await db.getPlayerByCedula(club.id, pago.cedula);
        if (player?.celular) {
          const nombre = `${player.nombre || ''} ${player.apellidos || ''}`.trim();
          const montoFmt = Number(pago.monto).toLocaleString('es-CO');
          await sendWhatsAppMessage(player.celular,
            `❌ *Pago no verificado*\n\n` +
            `Hola ${nombre}, no pudimos verificar tu comprobante de *$${montoFmt}*.\n\n` +
            `Por favor comunícate con el administrador del club.`,
            club.config?.codigo_pais || '57',
          );
          waEnviado = true;
        }
      } catch (waErr) {
        console.error('[rechazar] WhatsApp no enviado:', waErr.message);
      }

      return res.json({ success: true, data: updated, wa_enviado: waEnviado });
    }

    // ── Aprobar ───────────────────────────────────────────────────────────────
    if (accion === 'aprobar') {
      if (pago.estado_revision === 'aprobado_manual')
        return res.status(400).json({ success: false, error: 'Este pago ya fue aprobado' });

      const montoFinal    = parseInt(monto ?? pago.monto);
      const conceptoFinal = concepto ?? pago.concepto;
      const cedulaFinal   = pago.cedula;

      // Reparto en varios conceptos (ej. mensualidad + uniforme en un solo pago).
      // Si no viene `allocations`, se comporta igual que antes (un solo concepto).
      const allocations = Array.isArray(req.body.allocations) && req.body.allocations.length > 0
        ? req.body.allocations
        : [{ concepto: conceptoFinal, monto: montoFinal }];

      const sumaAsignada = allocations.reduce((s, a) => s + (parseInt(a.monto) || 0), 0);
      if (sumaAsignada > montoFinal) {
        return res.status(400).json({ success: false, error: 'La suma de los conceptos no puede superar el monto pagado' });
      }

      let excedente = montoFinal - sumaAsignada; // lo que no se asignó a ningún concepto
      const conceptosAplicados = [];

      for (const alloc of allocations) {
        const m = parseInt(alloc.monto);
        if (!m || m <= 0) continue;

        let resultado = { excedente: 0 };
        if (alloc.concepto === 'mensualidad' || alloc.concepto === 'mensualidad_wa')
          resultado = await actualizarMensualidad(club.id, cedulaFinal, m);
        else if (alloc.concepto === 'uniforme')  resultado = await actualizarUniforme(club.id, cedulaFinal, m);
        else if (alloc.concepto === 'torneo')    resultado = await actualizarTorneo(club.id, cedulaFinal, m, '');
        else continue;

        excedente += resultado?.excedente || 0;
        conceptosAplicados.push({ concepto: alloc.concepto, monto: m - (resultado?.excedente || 0) });
      }

      const conceptoResumen = conceptosAplicados.length > 1
        ? conceptosAplicados.map(c => c.concepto).join(' + ')
        : conceptoFinal;

      const updated = await db.updatePago(id, {
        estado_revision: 'aprobado_manual',
        ...(conceptosAplicados.length > 1 && { concepto: conceptoResumen }),
      });

      let waEnviado = false;
      const player = await db.getPlayerByCedula(club.id, cedulaFinal);

      if (excedente > 0) {
        await db.createPago({
          club_id:         club.id,
          player_id:       pago.player_id,
          cedula:          cedulaFinal,
          monto:           excedente,
          banco:           'Saldo a Favor',
          concepto:        'otro',
          referencia:      `excedente-de-${id}`,
          url_comprobante: '',
          estado_revision: 'excedente_pendiente',
          tipo_origen:     'TRANSFERENCIA_EXCEDENTE',
        });
      }

      if (player?.celular) {
        try {
          const nombre        = `${player.nombre || ''} ${player.apellidos || ''}`.trim();
          const montoFmt      = montoFinal.toLocaleString('es-CO');
          const excedenteFmt  = excedente.toLocaleString('es-CO');
          const CONCEPTO_LABELS = { uniforme: 'Uniforme', torneo: 'Torneo', mensualidad: 'Mensualidad', mensualidad_wa: 'Mensualidad' };
          const conceptoLabel = conceptosAplicados.length > 1
            ? conceptosAplicados.map(c => CONCEPTO_LABELS[c.concepto] || c.concepto).join(' + ')
            : (CONCEPTO_LABELS[conceptoFinal] || 'Mensualidad');
          const portalUrl = `https://zensports.zenpra.ai/p/${club.slug}/${cedulaFinal}`;

          const mensaje = excedente > 0
            ? `✅ *¡Transacción exitosa!*\n\n` +
              `Hola ${nombre} 🎉 Tu pago de *$${montoFmt}* fue confirmado y aplicado a *${conceptoLabel}*.\n\n` +
              `💰 Tienes un saldo a favor de *$${excedenteFmt}*. ¿A qué concepto lo abonamos?\n` +
              `Responde: *mensualidad*, *uniforme* o *torneo*\n\n` +
              `📲 Revisa tu estado de cuenta actualizado:\n${portalUrl}`
            : `✅ *¡Transacción exitosa!*\n\n` +
              `Hola ${nombre} 🎉 Tu pago de *$${montoFmt}* fue confirmado y aplicado a *${conceptoLabel}*.\n\n` +
              `¡Gracias por mantener tu compromiso con el club! Sigue siendo un campeón 🏆\n\n` +
              `📲 Revisa tu estado de cuenta actualizado:\n${portalUrl}`;

          await sendWhatsAppMessage(player.celular, mensaje, club.config?.codigo_pais || '57');
          waEnviado = true;
        } catch (waErr) {
          console.error('[aprobar] WhatsApp no enviado:', waErr.message);
        }
      }

      return res.json({ success: true, data: updated, excedente, wa_enviado: waEnviado });
    }

    return res.status(400).json({ success: false, error: 'Acción no reconocida' });
  } catch (error) {
    console.error('Error in PUT /payments/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function actualizarMensualidad(club_id, cedula, monto) {
  const pendientes = await db.getMensualidadesPendientes(club_id, cedula);
  if (pendientes.length === 0) return { excedente: monto };

  const target      = pendientes[0];
  const yaPageado   = parseFloat(target.valor_pagado) || 0;
  const oficial     = parseFloat(target.valor_oficial) || 0;
  const penalidad   = parseFloat(target.penalidad)     || 0;
  const totalDeuda  = oficial + penalidad;                            // deuda real con mora
  const porPagar    = Math.max(0, totalDeuda - yaPageado);
  const pagoAplicar = Math.min(monto, porPagar);
  const excedente   = monto - pagoAplicar;
  const nuevoPagado = yaPageado + pagoAplicar;
  const nuevoSaldo  = Math.max(0, totalDeuda - nuevoPagado);
  const nuevoEstado = nuevoPagado >= totalDeuda ? 'AL_DIA' : 'PARCIAL';

  await db.updateMensualidad(target.id, {
    valor_pagado:    nuevoPagado,
    saldo_pendiente: nuevoSaldo,
    estado:          nuevoEstado,
  });
  return { excedente };
}

async function actualizarUniforme(club_id, cedula, monto) {
  const pendientes = await db.getUniformesPendientes(club_id, cedula);
  if (pendientes.length === 0) return { excedente: monto };

  const target      = pendientes[0];
  const yaPageado   = parseFloat(target.valor_pagado) || 0;
  const oficial     = parseFloat(target.valor_oficial) || 0;
  const porPagar    = Math.max(0, oficial - yaPageado);
  const pagoAplicar = Math.min(monto, porPagar);
  const excedente   = monto - pagoAplicar;
  const nuevoPagado = yaPageado + pagoAplicar;
  const nuevoSaldo  = oficial - nuevoPagado;
  const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

  await db.updateUniforme(target.id, {
    valor_pagado:    nuevoPagado,
    saldo_pendiente: nuevoSaldo,
    estado:          nuevoEstado,
  });

  // El pedido de uniforme (prendas/talla/número) es una tabla aparte del cobro —
  // si ya quedó pagado, reflejarlo también ahí para que no siga apareciendo
  // como PENDIENTE en la pantalla de Uniformes.
  if (nuevoEstado === 'AL_DIA') {
    try {
      const pedidos = await db.getPedidoUniformesByCedula(club_id, cedula);
      const pedidoPendiente = pedidos.find(p => p.estado === 'PENDIENTE');
      if (pedidoPendiente) await db.updatePedidoUniforme(pedidoPendiente.id, { estado: 'PAGADO' });
    } catch (e) {
      console.error('[actualizarUniforme] no se pudo marcar el pedido como pagado:', e.message);
    }
  }

  return { excedente };
}

async function actualizarTorneo(club_id, cedula, monto, filtroTorneo) {
  let pendientes = await db.getTorneosPendientes(club_id, cedula);
  if (filtroTorneo) {
    pendientes = pendientes.filter(t =>
      t.nombre_torneo.toLowerCase().includes(filtroTorneo.toLowerCase())
    );
  }
  if (pendientes.length === 0) return { excedente: monto };

  const target      = pendientes[0];
  const yaPageado   = parseFloat(target.valor_pagado) || 0;
  const oficial     = parseFloat(target.valor_oficial) || 0;
  const porPagar    = Math.max(0, oficial - yaPageado);
  const pagoAplicar = Math.min(monto, porPagar);
  const excedente   = monto - pagoAplicar;
  const nuevoPagado = yaPageado + pagoAplicar;
  const nuevoSaldo  = oficial - nuevoPagado;
  const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

  await db.updateTorneo(target.id, {
    valor_pagado:    nuevoPagado,
    saldo_pendiente: nuevoSaldo,
    estado:          nuevoEstado,
  });
  return { excedente };
}

async function sendWhatsAppMessage(celular, body, codigoPais = '57') {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID/AUTH_TOKEN no configurados en Vercel env');
  }
  const to = celular.startsWith('whatsapp:') ? celular : `whatsapp:+${codigoPais}${celular}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio ${res.status}: ${errText}`);
  }
  console.log('[whatsapp] mensaje enviado a', to);
}

module.exports = router;
