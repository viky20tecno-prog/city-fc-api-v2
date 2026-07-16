const express = require('express');
const db = require('../services/db');
const router = express.Router();

// GET /api/uniforms
router.get('/', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pedidos = await db.getPedidoUniformes(club.id);
    const prendas = await db.getPrendasPedidos(pedidos.map(p => p.id));
    const prendasPorPedido = {};
    prendas.forEach(pr => {
      if (!prendasPorPedido[pr.pedido_id]) prendasPorPedido[pr.pedido_id] = [];
      prendasPorPedido[pr.pedido_id].push(pr);
    });
    const data = pedidos.map(p => ({ ...p, prendas_detalle: prendasPorPedido[p.id] || [] }));

    res.json({ success: true, total: data.length, data });
  } catch (error) {
    console.error('Error in GET /uniforms:', error);
    res.status(500).json({ success: false, error: 'Error fetching uniforms', message: error.message });
  }
});

// GET /api/uniforms/numeros
router.get('/numeros', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pedidos = await db.getPedidoUniformes(club.id);
    const numerosUsados = pedidos.map(p => p.numero_estampar).filter(Boolean);
    res.json({ success: true, numeros: numerosUsados });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error fetching numbers', message: error.message });
  }
});

// POST /api/uniforms
router.post('/', async (req, res) => {
  try {
    const { cedula, nombre, tipo, campeon, nombre_estampar, talla, numero, prendas, total, items } = req.body;

    if (!cedula || !nombre || !talla) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, cedula);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Jugador no encontrado' });
    }

    // Verificar pedido duplicado: solo bloquear si hay un pedido activo (PENDIENTE o PAGADO)
    // Un pedido ENTREGADO ya está cerrado — se permite registrar uno nuevo
    const pedidos = await db.getPedidoUniformes(club.id);
    const tipoNormalizado = (tipo || 'Jugador').trim();
    if (tipoNormalizado === 'Jugador') {
      const pedidoActivo = pedidos.find(
        p => p.cedula === String(cedula) && p.tipo === 'Jugador' && p.estado !== 'ENTREGADO'
      );
      if (pedidoActivo) {
        return res.status(409).json({ success: false, error: 'Este jugador ya tiene un pedido de uniforme activo (pendiente o pagado)' });
      }
    }

    const pedido = await db.createPedidoUniforme({
      club_id:         club.id,
      player_id:       player.id,
      cedula:          String(cedula),
      nombre,
      tipo:            tipo || 'Jugador',
      campeon:         !!campeon,
      talla,
      nombre_estampar: nombre_estampar || '',
      numero_estampar: numero ? String(numero) : '',
      prendas:         prendas || '',
      total:           total ? Number(total) : 0,
      estado:          'PENDIENTE',
    });

    let prendasDetalle = [];
    if (Array.isArray(items) && items.length > 0) {
      await db.syncPrendasPedido(pedido.id, items);
      prendasDetalle = await db.getPrendasPedido(pedido.id);
    }

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'UNIFORME_PEDIDO', entity_type: 'uniforme', entity_id: pedido.id,
      entity_label: `${nombre} #${numero}`,
      details: { cedula, nombre, talla, numero, prendas, total: total ? Number(total) : 0 },
    });

    res.json({
      success: true,
      message: 'Pedido de uniforme registrado exitosamente',
      data: { ...pedido, prendas_detalle: prendasDetalle },
    });
  } catch (error) {
    console.error('Error in POST /uniforms:', error);
    res.status(500).json({ success: false, error: 'Error registrando pedido', message: error.message });
  }
});

// PUT /api/uniforms/:id
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { prendas, talla, numero, nombre_estampar, total, estado, valor_pagado, items } = req.body;

    const ESTADOS_VALIDOS = ['PENDIENTE', 'ABONO', 'PAGADO', 'ENTREGADO'];
    if (estado !== undefined && !ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ success: false, error: `Estado inválido. Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
    }
    if (valor_pagado !== undefined && (isNaN(Number(valor_pagado)) || Number(valor_pagado) < 0)) {
      return res.status(400).json({ success: false, error: 'El valor pagado debe ser un número mayor o igual a 0' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    // Verificar que el pedido pertenece a este club
    const pedidos = await db.getPedidoUniformes(club.id);
    const pedido = pedidos.find(p => String(p.id) === String(id));
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

    // Reversión de un abono completo (ej. botón "Revertir pago"): además de
    // limpiar el agregado del pedido, hay que limpiar el desglose por prenda
    // y el abono histórico sin discriminar — si no, quedarían desincronizados.
    const esReversion = valor_pagado !== undefined && Number(valor_pagado) === 0;

    const fields = {
      ...(prendas         !== undefined && { prendas }),
      ...(talla           !== undefined && { talla }),
      ...(numero          !== undefined && { numero_estampar: String(numero) }),
      ...(nombre_estampar !== undefined && { nombre_estampar }),
      ...(total           !== undefined && { total: Number(total) }),
      ...(valor_pagado    !== undefined && { valor_pagado: Number(valor_pagado) }),
      ...(estado          !== undefined && { estado }),
      ...(esReversion     && { abono_legacy: 0 }),
    };

    // Si se actualiza el abono sin fijar un estado explícito, derivarlo del saldo
    if (valor_pagado !== undefined && estado === undefined && pedido.estado !== 'ENTREGADO') {
      const totalRef = fields.total !== undefined ? fields.total : (Number(pedido.total) || 0);
      const pagado    = Number(valor_pagado);
      fields.estado = pagado <= 0 ? 'PENDIENTE' : pagado >= totalRef ? 'PAGADO' : 'ABONO';
    }

    // Si el body solo trae `items` (editar prendas sin tocar otro campo del
    // pedido), `fields` queda vacío — un update sin columnas rompe en Supabase.
    let updated = Object.keys(fields).length > 0 ? await db.updatePedidoUniforme(id, fields) : pedido;

    if (esReversion) {
      await db.resetAbonoPrendasPedido(id);
    }

    // Edición de prendas (talla/prendas/total desde el modal "Editar pedido"):
    // sincroniza el desglose por prenda con la lista nueva. Si se quitó una
    // prenda que ya tenía abono, ese monto se repliega a abono_legacy para
    // no perderlo (nunca baja el total pagado del pedido por una edición).
    let prendasDetalle = await db.getPrendasPedido(id);
    if (Array.isArray(items)) {
      const abonoLiberado = await db.syncPrendasPedido(id, items);
      if (abonoLiberado > 0) {
        await db.updatePedidoUniforme(id, { abono_legacy: (Number(updated.abono_legacy) || 0) + abonoLiberado });
      }
      updated = await db.recalcularPedidoUniformeDesdeItems(id);
      prendasDetalle = await db.getPrendasPedido(id);
    }

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: valor_pagado !== undefined ? 'UNIFORME_ABONO' : 'UNIFORME_ACTUALIZADO', entity_type: 'uniforme', entity_id: id,
      entity_label: `${pedido.nombre} #${pedido.numero_estampar}`,
      details: { ...(fields.estado && { estado: fields.estado }), ...(valor_pagado !== undefined && { valor_pagado }), ...(talla && { talla }), ...(numero && { numero }) },
    });

    res.json({ success: true, message: 'Pedido actualizado', data: { ...updated, prendas_detalle: prendasDetalle } });
  } catch (error) {
    console.error('Error in PUT /uniforms/:id:', error);
    res.status(500).json({ success: false, error: 'Error actualizando pedido', message: error.message });
  }
});

// PUT /api/uniforms/:id/abono-prendas — abona uno o varios montos discriminados
// por prenda en un solo paso (ej: reparte un abono de 300.000 en 4 prendas).
router.put('/:id/abono-prendas', async (req, res) => {
  try {
    const { id } = req.params;
    const { abonos } = req.body; // [{ prenda_id, monto }]
    if (!Array.isArray(abonos) || abonos.length === 0) {
      return res.status(400).json({ success: false, error: 'abonos requerido: lista de { prenda_id, monto }' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pedidos = await db.getPedidoUniformes(club.id);
    const pedido = pedidos.find(p => String(p.id) === String(id));
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    if (pedido.estado === 'ENTREGADO') {
      return res.status(400).json({ success: false, error: 'Este pedido ya fue entregado, no se le pueden registrar más abonos' });
    }

    // Tope agregado: la suma de los abonos no puede superar el saldo real del
    // pedido. La validación por prenda (en db.abonarPrendasPedido) no alcanza
    // sola porque el saldo de cada prenda no sabe nada del abono_legacy — si
    // el pedido ya tiene abono histórico sin discriminar, la suma de saldos
    // "por prenda" puede verse mayor al saldo real que le queda al pedido.
    const saldoPedido = (parseFloat(pedido.total) || 0) - (parseFloat(pedido.valor_pagado) || 0);
    const montoTotalSolicitado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
    if (montoTotalSolicitado > saldoPedido) {
      return res.status(400).json({ success: false, error: `El abono total ($${montoTotalSolicitado}) supera el saldo pendiente del pedido ($${saldoPedido})` });
    }

    let prendasActualizadas;
    try {
      prendasActualizadas = await db.abonarPrendasPedido(id, abonos);
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, error: e.message });
    }

    const pedidoActualizado = await db.recalcularPedidoUniformeDesdeItems(id);
    const totalAbonado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'UNIFORME_ABONO', entity_type: 'uniforme', entity_id: id,
      entity_label: `${pedido.nombre} #${pedido.numero_estampar}`,
      details: {
        total_abonado: totalAbonado,
        prendas: prendasActualizadas.map(p => ({ nombre: p.nombre, valor_pagado: p.valor_pagado })),
      },
    });

    const prendasDetalle = await db.getPrendasPedido(id);
    res.json({ success: true, message: 'Abono registrado', data: { ...pedidoActualizado, prendas_detalle: prendasDetalle } });
  } catch (error) {
    console.error('Error in PUT /uniforms/:id/abono-prendas:', error);
    res.status(500).json({ success: false, error: 'Error registrando abono', message: error.message });
  }
});

// DELETE /api/uniforms/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pedidos = await db.getPedidoUniformes(club.id);
    const pedido = pedidos.find(p => String(p.id) === String(id));
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

    await db.deletePedidoUniforme(id);

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: 'UNIFORME_ELIMINADO', entity_type: 'uniforme', entity_id: id,
      entity_label: `${pedido.nombre} #${pedido.numero_estampar}`,
      details: { cedula: pedido.cedula, talla: pedido.talla, prendas: pedido.prendas, total: pedido.total, estado: pedido.estado },
    });

    res.json({ success: true, message: 'Pedido eliminado' });
  } catch (error) {
    console.error('Error in DELETE /uniforms/:id:', error);
    res.status(500).json({ success: false, error: 'Error eliminando pedido', message: error.message });
  }
});

module.exports = router;
