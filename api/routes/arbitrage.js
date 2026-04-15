const express = require('express');
const db = require('../services/db');

const router = express.Router();

// GET /api/arbitrage/partidos?club_id=
router.get('/partidos', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const partidos = await db.getPartidos(club.id);
    res.json({
      success: true,
      data: partidos.map(p => ({
        id:         p.id,
        titulo:     p.titulo,
        fecha:      p.fecha,
        equipoA:    p.equipo_a,
        equipoB:    p.equipo_b,
        montoTotal: parseFloat(p.monto_total) || 0,
      })),
    });
  } catch (err) {
    console.error('Error GET /arbitrage/partidos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/arbitrage/partidos
router.post('/partidos', async (req, res) => {
  try {
    const { titulo, fecha, hora, equipoA, equipoB, montoPorJugador, jugadoresCedulas } = req.body;

    if (!titulo || !fecha || !equipoA || !equipoB || !montoPorJugador) {
      return res.status(400).json({ success: false, error: 'Todos los campos son requeridos' });
    }
    if (!jugadoresCedulas || jugadoresCedulas.length === 0) {
      return res.status(400).json({ success: false, error: 'Selecciona al menos un jugador' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const valorPorJugador = parseInt(montoPorJugador);
    const montoTotal      = valorPorJugador * jugadoresCedulas.length;
    const fechaCompleta   = hora ? `${fecha}T${hora}:00` : fecha;

    const partido = await db.createPartido({
      club_id:          club.id,
      titulo,
      equipo_a:         equipoA,
      equipo_b:         equipoB,
      fecha:            fechaCompleta,
      monto_por_jugador: valorPorJugador,
      monto_total:      montoTotal,
    });

    // Obtener nombres de jugadores
    const jugadores = await db.getPlayers(club.id);
    const jugadoresMap = {};
    jugadores.forEach(j => { jugadoresMap[j.cedula] = j; });

    // Crear registro de pago por cada jugador
    const pagos = jugadoresCedulas.map(cedula => {
      const jugador = jugadoresMap[cedula];
      const nombre  = jugador ? `${jugador.nombre || ''} ${jugador.apellidos || ''}`.trim() : cedula;
      return {
        club_id:    club.id,
        partido_id: partido.id,
        player_id:  jugador ? jugador.id : null,
        cedula:     String(cedula),
        nombre,
        monto:      valorPorJugador,
        estado:     'PENDIENTE',
      };
    });
    await db.bulkInsert('arbitraje_pagos', pagos);

    res.json({ success: true, data: { id: partido.id } });
  } catch (err) {
    console.error('Error POST /arbitrage/partidos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/arbitrage/pagos/:partidoId
router.get('/pagos/:partidoId', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pagos = await db.getArbitrajePagos(club.id, req.params.partidoId);
    res.json({
      success: true,
      pagos: pagos.map(p => ({
        id:          p.id,
        nombre:      p.nombre,
        cedula:      p.cedula,
        valor:       parseFloat(p.monto) || 0,
        estadoPago:  p.estado === 'PAGADO',
        metodoPago:  p.metodo_pago || '',
      })),
    });
  } catch (err) {
    console.error('Error GET /arbitrage/pagos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/arbitrage/resumen/:partidoId
router.get('/resumen/:partidoId', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const partidos = await db.getPartidos(club.id);
    const partido  = partidos.find(p => p.id === req.params.partidoId);
    const pagos    = await db.getArbitrajePagos(club.id, req.params.partidoId);

    const montoTotal      = partido ? parseFloat(partido.monto_total) : 0;
    const pagados         = pagos.filter(p => p.estado === 'PAGADO');
    const totalRecaudado  = pagados.reduce((sum, p) => sum + (parseFloat(p.monto) || 0), 0);
    const porcentajePagado = montoTotal > 0 ? Math.round((totalRecaudado / montoTotal) * 100) : 0;

    res.json({
      success: true,
      titulo:            partido ? partido.titulo : '',
      fecha:             partido ? partido.fecha : '',
      equipoA:           partido ? partido.equipo_a : '',
      equipoB:           partido ? partido.equipo_b : '',
      montoTotal,
      totalRecaudado,
      porcentajePagado,
      faltante:          montoTotal - totalRecaudado,
      cantidadPendiente: pagos.length - pagados.length,
      cantidadTotal:     pagos.length,
    });
  } catch (err) {
    console.error('Error GET /arbitrage/resumen:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/arbitrage/pagos — registrar pago individual
router.post('/pagos', async (req, res) => {
  try {
    const { partidoId, cedula, metodoPago, estadoPago } = req.body;

    if (!partidoId || !cedula || !metodoPago) {
      return res.status(400).json({ success: false, error: 'partidoId, cedula y metodoPago son requeridos' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pagos  = await db.getArbitrajePagos(club.id, partidoId);
    const target = pagos.find(p => p.cedula === String(cedula));
    if (!target) return res.status(404).json({ success: false, error: 'Registro no encontrado' });

    await db.updateArbitrajePago(target.id, {
      estado:      estadoPago ? 'PAGADO' : 'PENDIENTE',
      metodo_pago: metodoPago,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error POST /arbitrage/pagos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
