const express = require('express');
const { createClient } = require('@supabase/supabase-js');

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
      id:        c.id,
      slug:      c.slug,
      name:      c.config?.nombre || c.name,
      is_active: c.is_active,
      created_at: c.created_at,
    }));
    res.json({ success: true, clubs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
