const express = require('express');
const SheetsClient = require('../services/sheets');

const router = express.Router();
const sheetsClient = new SheetsClient();

// CORS permisivo igual que las otras rutas
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// GET /api/arbitrage/partidos?club_id=
router.get('/partidos', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    const rows = await sheetsClient.getAllRows('PARTIDOS');

    const partidos = rows
      .filter(p => p.club_id === club_id)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map(p => ({
        id: p.id,
        titulo: p.titulo,
        fecha: p.fecha,
        hora: p.hora,
        equipoA: p.equipo_a,
        equipoB: p.equipo_b,
        montoTotal: Number(p.monto_total) || 0,
      }));

    res.json({ success: true, data: partidos });
  } catch (err) {
    console.error('Error GET /arbitrage/partidos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/arbitrage/partidos?club_id=
router.post('/partidos', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    const { titulo, fecha, hora, equipoA, equipoB, montoTotal, jugadoresCedulas } = req.body;

    if (!titulo || !fecha || !hora || !equipoA || !equipoB || !montoTotal) {
      return res.status(400).json({ success: false, error: 'Todos los campos son requeridos' });
    }
    if (!jugadoresCedulas || jugadoresCedulas.length === 0) {
      return res.status(400).json({ success: false, error: 'Selecciona al menos un jugador' });
    }

    const partidoId = `partido_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const now = new Date().toISOString();
    const valorPorJugador = Math.round(parseInt(montoTotal) / jugadoresCedulas.length);

    // Guardar partido
    await sheetsClient.appendRow('PARTIDOS', [
      club_id, partidoId, titulo, fecha, hora, equipoA, equipoB, parseInt(montoTotal), now,
    ]);

    // Obtener nombres de jugadores
    const jugadoresRows = await sheetsClient.getAllRows('JUGADORES');
    const jugadoresMap = {};
    jugadoresRows.forEach(j => { jugadoresMap[j.cedula] = j; });

    // Crear un registro de pago por cada jugador seleccionado
    for (const cedula of jugadoresCedulas) {
      const jugador = jugadoresMap[cedula];
      const nombre = jugador
        ? `${jugador['nombre(s)'] || jugador.nombre || ''} ${jugador.apellidos || ''}`.trim()
        : cedula;

      await sheetsClient.appendRow('ARBITRAJE_PAGOS', [
        partidoId, club_id, cedula, nombre, valorPorJugador, 'FALSE', '', now,
      ]);
    }

    res.json({ success: true, data: { id: partidoId } });
  } catch (err) {
    console.error('Error POST /arbitrage/partidos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/arbitrage/pagos/:partidoId?club_id=
router.get('/pagos/:partidoId', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    const { partidoId } = req.params;

    const rows = await sheetsClient.getAllRows('ARBITRAJE_PAGOS');
    const pagos = rows
      .filter(p => p.partido_id === partidoId && p.club_id === club_id)
      .map(p => ({
        id: `${p.partido_id}_${p.cedula}`,
        nombre: p.nombre,
        cedula: p.cedula,
        valor: Number(p.valor) || 0,
        estadoPago: p.estado_pago === 'TRUE',
        metodoPago: p.metodo_pago || '',
      }));

    res.json({ success: true, pagos });
  } catch (err) {
    console.error('Error GET /arbitrage/pagos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/arbitrage/resumen/:partidoId?club_id=
router.get('/resumen/:partidoId', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    const { partidoId } = req.params;

    const [partidosRows, pagosRows] = await Promise.all([
      sheetsClient.getAllRows('PARTIDOS'),
      sheetsClient.getAllRows('ARBITRAJE_PAGOS'),
    ]);

    const partido = partidosRows.find(p => p.id === partidoId && p.club_id === club_id);
    const pagos = pagosRows.filter(p => p.partido_id === partidoId && p.club_id === club_id);

    const montoTotal = partido ? Number(partido.monto_total) : 0;
    const pagados = pagos.filter(p => p.estado_pago === 'TRUE');
    const totalRecaudado = pagados.reduce((sum, p) => sum + Number(p.valor), 0);
    const cantidadPendiente = pagos.length - pagados.length;
    const porcentajePagado = montoTotal > 0 ? Math.round((totalRecaudado / montoTotal) * 100) : 0;

    res.json({
      success: true,
      montoTotal,
      totalRecaudado,
      porcentajePagado,
      faltante: montoTotal - totalRecaudado,
      cantidadPendiente,
      cantidadTotal: pagos.length,
    });
  } catch (err) {
    console.error('Error GET /arbitrage/resumen:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/arbitrage/pagos?club_id= — registrar pago individual
router.post('/pagos', async (req, res) => {
  try {
    const club_id = req.club_id || req.query.club_id;
    const { partidoId, cedula, metodoPago, estadoPago } = req.body;

    if (!partidoId || !cedula || !metodoPago) {
      return res.status(400).json({ success: false, error: 'partidoId, cedula y metodoPago son requeridos' });
    }

    const rows = await sheetsClient.getAllRows('ARBITRAJE_PAGOS');
    const rowsConIdx = rows.map((r, idx) => ({ ...r, _idx: idx }));
    const target = rowsConIdx.find(
      r => r.partido_id === partidoId && r.cedula === String(cedula) && r.club_id === club_id
    );

    if (!target) {
      return res.status(404).json({ success: false, error: 'Registro no encontrado' });
    }

    const rowNumber = target._idx + 2;
    await sheetsClient.updateRow('ARBITRAJE_PAGOS', rowNumber, [
      target.partido_id,
      target.club_id,
      target.cedula,
      target.nombre,
      target.valor,
      estadoPago ? 'TRUE' : 'FALSE',
      metodoPago,
      new Date().toISOString(),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error POST /arbitrage/pagos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
