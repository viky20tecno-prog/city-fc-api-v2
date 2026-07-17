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
    const all10  = digits.slice(-10);

    // Buscar sesión en caché (wa_sessions) — búsqueda LIKE para encontrar cualquier formato
    const { data: sessionRows } = await sb
      .from('wa_sessions')
      .select('phone, rol, updated_at, last_interaction, contexto')
      .like('phone', `%${all10}%`);
    const session = sessionRows?.[0] || null;
    // Mismo criterio que generateReply en wa-agent.js: comparar contra last_interaction,
    // no updated_at (el dedup del webhook toca updated_at en cada mensaje entrante).
    const SESSION_TIMEOUT_MIN = 5;
    const sessionActiva = session?.last_interaction && (Date.now() - new Date(session.last_interaction).getTime()) < SESSION_TIMEOUT_MIN * 60 * 1000;

    // Lookup real en DB (igual que identificarRol del bot)
    let rol = 'visitante';
    let extra = {};

    const clubAdmin = await db.getClubByCelularAdmin(local);
    if (clubAdmin) {
      rol = 'admin';
      extra = { club_nombre: clubAdmin.config?.nombre || clubAdmin.name, club_slug: clubAdmin.slug };
    } else {
      const clubStaff = await db.getClubByCelularStaff(local);
      if (clubStaff) {
        rol = 'entrenador';
        extra = { club_nombre: clubStaff.config?.nombre || clubStaff.name, club_slug: clubStaff.slug };
      } else {
        // También buscar en clubs inactivos para explicar el caso
        const { data: clubsInactivos } = await sb
          .from('clubs')
          .select('id, slug, name, celular_admin, config, is_active')
          .or(`celular_admin.eq.${local},celular_admin.eq.57${local},celular_admin.eq.+57${local}`);
        const clubInactivo = clubsInactivos?.[0];

        const jugador = await db.getPlayerByCelularGlobal(local);
        if (jugador) {
          rol = 'jugador';
          extra = {
            nombre:      `${jugador.nombre} ${jugador.apellidos}`.trim(),
            cedula:      jugador.cedula,
            club_nombre: jugador.clubs?.config?.nombre || jugador.clubs?.name,
            club_slug:   jugador.clubs?.slug,
          };
        } else if (clubInactivo) {
          rol = 'admin_club_inactivo';
          extra = {
            club_nombre: clubInactivo.config?.nombre || clubInactivo.name,
            club_slug:   clubInactivo.slug,
            is_active:   clubInactivo.is_active,
            nota:        'El club existe pero is_active = false — por eso el bot lo muestra como visitante en consulta fresca',
          };
        }

        // Debug raw: buscar en players sin filtros
        const { data: rawPlayers } = await sb
          .from('players')
          .select('cedula, nombre, apellidos, celular, activo, club_id')
          .or(`celular.eq.${all10},celular.eq.57${all10},celular.eq.+57${all10},celular.eq.${digits}`)
          .limit(5);

        if (rawPlayers?.length) {
          extra._debug_players = rawPlayers.map(p => ({
            nombre: `${p.nombre} ${p.apellidos}`.trim(),
            cedula: p.cedula,
            celular: p.celular,
            activo: p.activo,
            club_id: p.club_id,
          }));
        }
      }
    }

    // Debug raw: buscar en clubs.celular_admin sin filtros (cualquier variante)
    const { data: rawClubs } = await sb
      .from('clubs')
      .select('id, slug, name, celular_admin, is_active, config')
      .or(`celular_admin.eq.${all10},celular_admin.eq.57${all10},celular_admin.eq.+57${all10},celular_admin.eq.${digits},celular_admin.eq.+${digits}`)
      .limit(5);
    if (rawClubs?.length) {
      extra._debug_clubs_admin = rawClubs.map(c => ({
        slug: c.slug,
        nombre: c.config?.nombre || c.name,
        celular_admin: c.celular_admin,
        is_active: c.is_active,
      }));
    }

    return res.json({
      success: true,
      rol,
      celular: phone,
      ...extra,
      sesion_cache: session ? {
        rol_cacheado:   session.rol,
        club_cacheado:  session.contexto?.club_nombre,
        activa:         sessionActiva,
        ultima_actividad: session.updated_at,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/superadmin/reset-session?phone=3203903192
router.delete('/reset-session', requireSuperAdmin, async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ success: false, error: 'phone requerido' });

    const digits = phone.replace(/\D/g, '');
    const last10 = digits.slice(-10);

    // Buscar con LIKE para encontrar cualquier variante del número
    const { data: sessions } = await sb
      .from('wa_sessions')
      .select('phone, rol, updated_at')
      .like('phone', `%${last10}%`);

    if (!sessions?.length) {
      return res.json({ success: true, eliminadas: 0, nota: `No se encontró ninguna sesión que contenga ${last10}`, encontradas: [] });
    }

    const phones = sessions.map(s => s.phone);
    const { data: deleted, error } = await sb
      .from('wa_sessions')
      .delete()
      .in('phone', phones)
      .select('phone');
    if (error) throw error;

    res.json({ success: true, eliminadas: deleted?.length || 0, phones_eliminados: phones, sesiones_encontradas: sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
