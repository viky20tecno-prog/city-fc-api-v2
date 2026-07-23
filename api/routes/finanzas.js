const express = require('express');
const db      = require('../services/db');
const router  = express.Router();

// GET /api/finanzas?club_id=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const [manuales, automaticos] = await Promise.all([
      db.getFinanzas(club.id, { desde: req.query.desde, hasta: req.query.hasta }),
      db.getIngresosAutomaticos(club.id),
    ]);

    let data = [...manuales, ...automaticos];
    if (req.query.desde) data = data.filter(m => m.fecha >= req.query.desde);
    if (req.query.hasta) data = data.filter(m => m.fecha <= req.query.hasta);
    data.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    res.json({ success: true, total: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/finanzas
router.post('/', async (req, res) => {
  try {
    const { tipo, categoria, descripcion, monto, fecha, comprobante_url } = req.body;

    if (!tipo || !['ingreso', 'gasto'].includes(tipo))
      return res.status(400).json({ success: false, error: 'tipo debe ser ingreso o gasto' });
    if (!categoria || !monto || !fecha)
      return res.status(400).json({ success: false, error: 'categoria, monto y fecha son requeridos' });
    if (Number(monto) <= 0)
      return res.status(400).json({ success: false, error: 'monto debe ser mayor a 0' });

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const record = await db.createFinanza({
      club_id:         club.id,
      tipo,
      categoria,
      descripcion:     descripcion || '',
      monto:           Number(monto),
      fecha,
      comprobante_url: comprobante_url || null,
    });

    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/finanzas/:id
router.delete('/:id', async (req, res) => {
  try {
    if (String(req.params.id).startsWith('auto-')) {
      return res.status(400).json({ success: false, error: 'Este movimiento se calcula automáticamente y no se puede borrar — se actualiza solo cuando cambian los cobros de origen.' });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    await db.deleteFinanza(req.params.id, club.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
