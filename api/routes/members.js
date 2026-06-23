const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const db = require('../services/db');

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

// GET /api/miembros/me — rol del usuario autenticado en este club
router.get('/me', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    if (club.owner_user_id === req.user.id) {
      return res.json({ success: true, role: 'ADMIN', isOwner: true });
    }

    const member = await db.getClubMemberByUserId(req.user.id, req.club_id);
    if (!member || !member.activo) {
      return res.json({ success: true, role: 'ADMIN', isOwner: false });
    }

    res.json({ success: true, role: member.role, nombre: member.nombre, isOwner: false });
  } catch (err) {
    console.error('Error GET /miembros/me:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/miembros — lista todos los miembros del club
router.get('/', async (req, res) => {
  try {
    if (req.userRole === 'ENTRENADOR') {
      return res.status(403).json({ success: false, error: 'Solo el administrador puede ver miembros' });
    }
    const members = await db.getClubMembers(req.club_id);
    res.json({ success: true, data: members });
  } catch (err) {
    console.error('Error GET /miembros:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/miembros — crear nuevo miembro (crea cuenta Supabase + inserta en club_members)
router.post('/', async (req, res) => {
  try {
    if (req.userRole === 'ENTRENADOR') {
      return res.status(403).json({ success: false, error: 'Solo el administrador puede agregar miembros' });
    }

    const { email, nombre, role = 'ENTRENADOR', celular } = req.body;
    if (!email || !nombre) {
      return res.status(400).json({ success: false, error: 'email y nombre son requeridos' });
    }
    if (!['ENTRENADOR', 'ADMIN'].includes(role)) {
      return res.status(400).json({ success: false, error: 'role debe ser ENTRENADOR o ADMIN' });
    }

    const password = generatePassword();

    // Crear cuenta en Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, club_slug: req.club_id },
    });

    if (authError) {
      if (authError.message?.includes('already registered')) {
        return res.status(409).json({ success: false, error: 'Este email ya tiene una cuenta' });
      }
      throw authError;
    }

    const userId = authData.user.id;

    const celularNorm = celular ? String(celular).replace(/\D/g, '') : null;

    // Insertar en club_members
    const member = await db.createClubMember({
      user_id: userId,
      club_id:  req.club_id,
      role,
      nombre,
      activo:   true,
      ...(celularNorm ? { celular: celularNorm } : {}),
    });

    // Si es entrenador con celular, registrar en celulares_staff para el bot WA
    if (celularNorm) {
      await db.addCelularStaff(req.club_id, celularNorm).catch(() => {});
    }

    res.json({ success: true, data: member, email, nombre, role, temp_password: password });
  } catch (err) {
    console.error('Error POST /miembros:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/miembros/:id — cambiar rol o desactivar
router.patch('/:id', async (req, res) => {
  try {
    if (req.userRole === 'ENTRENADOR') {
      return res.status(403).json({ success: false, error: 'Sin permisos' });
    }
    const { role, activo } = req.body;
    if (role !== undefined && !['ENTRENADOR', 'ADMIN'].includes(role)) {
      return res.status(400).json({ success: false, error: 'role inválido' });
    }
    const updates = {};
    if (role !== undefined) updates.role = role;
    if (activo !== undefined) updates.activo = activo;
    const member = await db.updateClubMember(req.params.id, req.club_id, updates);
    res.json({ success: true, data: member });
  } catch (err) {
    console.error('Error PATCH /miembros:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/miembros/:id
router.delete('/:id', async (req, res) => {
  try {
    if (req.userRole === 'ENTRENADOR') {
      return res.status(403).json({ success: false, error: 'Sin permisos' });
    }
    // Obtener celular antes de borrar para sacarlo de celulares_staff
    const members = await db.getClubMembers(req.club_id);
    const target  = members.find(m => String(m.id) === String(req.params.id));
    if (target?.celular) {
      await db.removeCelularStaff(req.club_id, target.celular).catch(() => {});
    }
    await db.deleteClubMember(req.params.id, req.club_id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error DELETE /miembros:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
