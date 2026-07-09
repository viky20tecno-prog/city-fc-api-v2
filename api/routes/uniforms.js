const express = require('express');
const db = require('../services/db');
const router = express.Router();

// GET /api/uniforms
router.get('/', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pedidos = await db.getPedidoUniformes(club.id);
    res.json({ success: true, total: pedidos.length, data: pedidos });
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
    const { cedula, nombre, tipo, campeon, nombre_estampar, talla, numero, prendas, total } = req.body;

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
      data: pedido,
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
    const { prendas, talla, numero, nombre_estampar, total, estado, valor_pagado } = req.body;

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

    const fields = {
      ...(prendas         !== undefined && { prendas }),
      ...(talla           !== undefined && { talla }),
      ...(numero          !== undefined && { numero_estampar: String(numero) }),
      ...(nombre_estampar !== undefined && { nombre_estampar }),
      ...(total           !== undefined && { total: Number(total) }),
      ...(valor_pagado    !== undefined && { valor_pagado: Number(valor_pagado) }),
      ...(estado          !== undefined && { estado }),
    };

    // Si se actualiza el abono sin fijar un estado explícito, derivarlo del saldo
    if (valor_pagado !== undefined && estado === undefined && pedido.estado !== 'ENTREGADO') {
      const totalRef = fields.total !== undefined ? fields.total : (Number(pedido.total) || 0);
      const pagado    = Number(valor_pagado);
      fields.estado = pagado <= 0 ? 'PENDIENTE' : pagado >= totalRef ? 'PAGADO' : 'ABONO';
    }

    const updated = await db.updatePedidoUniforme(id, fields);

    db.logClubActivity({
      club_id: club.id, club_slug: req.club_id,
      user_id: req.user?.id, user_email: req.user?.email, user_role: req.userRole, user_name: req.memberName,
      action: valor_pagado !== undefined ? 'UNIFORME_ABONO' : 'UNIFORME_ACTUALIZADO', entity_type: 'uniforme', entity_id: id,
      entity_label: `${pedido.nombre} #${pedido.numero_estampar}`,
      details: { ...(fields.estado && { estado: fields.estado }), ...(valor_pagado !== undefined && { valor_pagado }), ...(talla && { talla }), ...(numero && { numero }) },
    });

    res.json({ success: true, message: 'Pedido actualizado', data: updated });
  } catch (error) {
    console.error('Error in PUT /uniforms/:id:', error);
    res.status(500).json({ success: false, error: 'Error actualizando pedido', message: error.message });
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
