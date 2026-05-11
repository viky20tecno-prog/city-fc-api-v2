const express = require('express');
const db      = require('../services/db');
const router  = express.Router();

/* ── Empleados ─────────────────────────────────────────── */

// GET /api/nomina/empleados
router.get('/empleados', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getNominaEmpleados(club.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/nomina/empleados
router.post('/empleados', async (req, res) => {
  try {
    const { nombre, cargo, salario_mensual } = req.body;
    if (!nombre) return res.status(400).json({ success: false, error: 'nombre es requerido' });

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const data = await db.createNominaEmpleado({
      club_id:         club.id,
      nombre,
      cargo:           cargo || '',
      salario_mensual: Number(salario_mensual) || 0,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/nomina/empleados/:id
router.put('/empleados/:id', async (req, res) => {
  try {
    const { nombre, cargo, salario_mensual, activo } = req.body;
    const fields = {};
    if (nombre           !== undefined) fields.nombre           = nombre;
    if (cargo            !== undefined) fields.cargo            = cargo;
    if (salario_mensual  !== undefined) fields.salario_mensual  = Number(salario_mensual);
    if (activo           !== undefined) fields.activo           = Boolean(activo);

    const data = await db.updateNominaEmpleado(req.params.id, fields);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/nomina/empleados/:id
router.delete('/empleados/:id', async (req, res) => {
  try {
    await db.deleteNominaEmpleado(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── Pagos de nómina ───────────────────────────────────── */

// GET /api/nomina/pagos?mes=YYYY-MM
router.get('/pagos', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getNominaPagos(club.id, req.query.mes);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/nomina/pagos — registra pago y crea movimiento en finanzas
router.post('/pagos', async (req, res) => {
  try {
    const { empleado_id, mes, monto, fecha_pago, notas } = req.body;
    if (!empleado_id || !mes || !monto)
      return res.status(400).json({ success: false, error: 'empleado_id, mes y monto son requeridos' });

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const pago = await db.createNominaPago({
      club_id:    club.id,
      empleado_id: Number(empleado_id),
      mes,
      monto:      Number(monto),
      fecha_pago: fecha_pago || new Date().toISOString().slice(0, 10),
      notas:      notas || '',
    });

    // Registrar automáticamente como gasto en finanzas
    const empleado = pago.nomina_empleados;
    await db.createFinanza({
      club_id:     club.id,
      tipo:        'gasto',
      categoria:   'Nómina',
      descripcion: `Pago nómina ${mes} — ${empleado?.nombre || ''}${empleado?.cargo ? ' (' + empleado.cargo + ')' : ''}`,
      monto:       Number(monto),
      fecha:       fecha_pago || new Date().toISOString().slice(0, 10),
    });

    res.json({ success: true, data: pago });
  } catch (err) {
    // Error 23505 = unique_violation (ya pagado ese mes)
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Este empleado ya tiene pago registrado para ese mes' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/nomina/pagos/:id
router.delete('/pagos/:id', async (req, res) => {
  try {
    await db.deleteNominaPago(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
