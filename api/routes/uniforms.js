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

    if (!cedula || !nombre || !talla || !numero) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, cedula);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Jugador no encontrado' });
    }

    // Verificar pedido duplicado
    const pedidos = await db.getPedidoUniformes(club.id);
    const pedidoExistente = pedidos.find(p => p.cedula === String(cedula));
    if (pedidoExistente) {
      return res.status(409).json({ success: false, error: 'Este jugador ya tiene un pedido de uniforme registrado' });
    }

    // Verificar número duplicado
    const numeroRepetido = pedidos.some(p => p.numero_estampar === String(numero));
    if (numeroRepetido) {
      return res.status(409).json({ success: false, error: `El número ${numero} ya está asignado a otro jugador` });
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
      numero_estampar: String(numero),
      prendas:         prendas || '',
      total:           total ? Number(total) : 0,
      estado:          'PENDIENTE',
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
    const { prendas, talla, numero, nombre_estampar, total } = req.body;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    // Verificar que el pedido pertenece a este club
    const pedidos = await db.getPedidoUniformes(club.id);
    const pedido = pedidos.find(p => String(p.id) === String(id));
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

    // Si el número cambió, verificar que no esté ocupado
    if (numero && numero !== pedido.numero_estampar) {
      const ocupado = pedidos.some(p => String(p.id) !== String(id) && p.numero_estampar === String(numero));
      if (ocupado) return res.status(409).json({ success: false, error: `El número ${numero} ya está asignado a otro jugador` });
    }

    const updated = await db.updatePedidoUniforme(id, {
      ...(prendas        !== undefined && { prendas }),
      ...(talla          !== undefined && { talla }),
      ...(numero         !== undefined && { numero_estampar: String(numero) }),
      ...(nombre_estampar !== undefined && { nombre_estampar }),
      ...(total          !== undefined && { total: Number(total) }),
    });

    res.json({ success: true, message: 'Pedido actualizado', data: updated });
  } catch (error) {
    console.error('Error in PUT /uniforms/:id:', error);
    res.status(500).json({ success: false, error: 'Error actualizando pedido', message: error.message });
  }
});

module.exports = router;
