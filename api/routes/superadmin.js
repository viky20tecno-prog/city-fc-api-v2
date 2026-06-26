const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const db = require('../services/db');

const router = express.Router();

const SUPER_ADMIN_EMAILS = ['diego31escobar@gmail.com'];

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function requireSuperAdmin(req, res, next) {
  if (!req.user || !SUPER_ADMIN_EMAILS.includes(req.user.email)) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  next();
}

// GET /api/superadmin/clubs — lista todos los clubs
router.get('/clubs', requireSuperAdmin, async (req, res) => {
  try {
    const { data, error } = await sb
      .from('clubs')
      .select('id, slug, name, config, is_active, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const clubs = (data || []).map(c => ({
      id:         c.id,
      slug:       c.slug,
      name:       c.config?.nombre || c.name,
      is_active:  c.is_active,
      created_at: c.created_at,
    }));
    res.json({ success: true, clubs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/superadmin/lookup-phone?phone=3203903192
router.get('/lookup-phone', requireSuperAdmin, async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ success: false, error: 'phone requerido' });

    const digits = phone.replace(/\D/g, '');
    const local  = digits.startsWith('57') ? digits.slice(2) : digits;

    // 1. ¿Es admin de algún club?
    const clubAdmin = await db.getClubByCelularAdmin(local);
    if (clubAdmin) {
      return res.json({
        success: true,
        rol:        'admin',
        club_nombre: clubAdmin.config?.nombre || clubAdmin.name,
        club_slug:   clubAdmin.slug,
        celular:     phone,
      });
    }

    // 2. ¿Es staff/entrenador?
    const clubStaff = await db.getClubByCelularStaff(local);
    if (clubStaff) {
      return res.json({
        success: true,
        rol:        'entrenador',
        club_nombre: clubStaff.config?.nombre || clubStaff.name,
        club_slug:   clubStaff.slug,
        celular:     phone,
      });
    }

    // 3. ¿Es jugador?
    const jugador = await db.getPlayerByCelularGlobal(local);
    if (jugador) {
      return res.json({
        success: true,
        rol:         'jugador',
        nombre:      `${jugador.nombre} ${jugador.apellidos}`.trim(),
        cedula:      jugador.cedula,
        club_nombre: jugador.clubs?.config?.nombre || jugador.clubs?.name,
        club_slug:   jugador.clubs?.slug,
        celular:     phone,
      });
    }

    return res.json({ success: true, rol: 'visitante', celular: phone });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
