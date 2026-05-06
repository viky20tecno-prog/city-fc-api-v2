const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

function generarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

router.post('/', async (req, res) => {
  const { nombre_club, ciudad, email, password, nombre_admin, celular_admin, color } = req.body || {};

  if (!nombre_club?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ success: false, error: 'Nombre del club, email y contraseña son requeridos.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'La contraseña debe tener mínimo 8 caracteres.' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const slug = generarSlug(nombre_club.trim());

  // Verificar que el slug no exista
  const { data: existing } = await supabase.from('clubs').select('id').eq('slug', slug).maybeSingle();
  if (existing) {
    return res.status(400).json({ success: false, error: `Ya existe un club con el nombre "${nombre_club}". Intenta con un nombre diferente.` });
  }

  // Crear usuario en Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email:         email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { nombre: nombre_admin || '', club_slug: slug },
  });

  if (authError) {
    const msg = authError.message?.toLowerCase() || '';
    if (msg.includes('already registered') || msg.includes('already exists')) {
      return res.status(400).json({ success: false, error: 'Ya existe una cuenta con ese email.' });
    }
    return res.status(500).json({ success: false, error: 'Error creando la cuenta: ' + authError.message });
  }

  const userId = authData.user.id;

  // Crear el club
  const { error: clubError } = await supabase.from('clubs').insert({
    slug,
    name:          nombre_club.trim(),
    is_active:     true,
    owner_user_id: userId,
    celular_admin: celular_admin || null,
    config: {
      nombre:            nombre_club.trim(),
      ciudad:            ciudad?.trim() || '',
      valor_mensualidad: 65000,
      color:             color || '#00AAFF',
      subtitulo:         '',
      codigo_pais:       '57',
    },
  });

  if (clubError) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return res.status(500).json({ success: false, error: 'Error creando el club: ' + clubError.message });
  }

  // Vincular usuario al club en club_members
  await supabase.from('club_members').insert({ user_id: userId, club_id: slug }).catch(() => {});

  // Obtener JWT para auto-login
  const { data: signIn } = await supabase.auth.signInWithPassword({
    email:    email.trim().toLowerCase(),
    password,
  });

  return res.status(201).json({
    success:       true,
    club_slug:     slug,
    access_token:  signIn?.session?.access_token  || null,
    refresh_token: signIn?.session?.refresh_token || null,
  });
});

module.exports = router;
