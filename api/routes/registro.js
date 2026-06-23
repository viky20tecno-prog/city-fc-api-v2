const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { sendWelcomeClub } = require('../services/email');

// Cliente con service role — creado una vez al arrancar el servidor
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const registroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos de registro. Intenta de nuevo en 1 hora.' },
});

router.use(registroLimiter);

function generarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

router.post('/', async (req, res) => {
  const { nombre_club, ciudad, email, password, nombre_admin, celular_admin, color, codigo_pais, deporte, deportes } = req.body || {};

  // Normalizar deportes: acepta array nuevo o string legacy
  const deportesArray = Array.isArray(deportes) && deportes.length > 0
    ? deportes
    : (deporte ? [deporte] : ['futbol']);

  if (!nombre_club?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ success: false, error: 'Nombre del club, email y contraseña son requeridos.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'La contraseña debe tener mínimo 8 caracteres.' });
  }

  const slug = generarSlug(nombre_club.trim());

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
  const emailNorm = email.trim().toLowerCase();

  // Crear club + sign-in en paralelo (ambos dependen de userId pero no entre sí)
  const [{ data: clubData, error: clubError }, signInResult] = await Promise.all([
    supabase.from('clubs').insert({
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
        codigo_pais:       codigo_pais || '57',
        plan:              'trial',
        trial_ends_at:     new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        deporte:           deportesArray[0],
        deportes:          deportesArray,
        modulos: {
          dashboard:    true,
          jugadores:    true,
          uniformes:    true,
          arbitraje:    deportesArray.includes('futbol'),
          cobro:        true,
          whatsapp:     true,
          conciliacion: true,
        },
      },
    }).select('id').single(),
    supabase.auth.signInWithPassword({ email: emailNorm, password }),
  ]);

  if (clubError) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return res.status(500).json({ success: false, error: 'Error creando el club: ' + clubError.message });
  }

  // Verificar slug duplicado tras insert (unique constraint)
  if (clubError?.code === '23505') {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return res.status(400).json({ success: false, error: `Ya existe un club con el nombre "${nombre_club}". Intenta con un nombre diferente.` });
  }

  // Vincular usuario al club (no bloquea la respuesta)
  supabase.from('club_members').insert({ user_id: userId, club_id: clubData.id }).catch(() => {});

  const signIn = signInResult;

  // Enviar email de bienvenida (sin bloquear la respuesta)
  sendWelcomeClub({
    nombre_club: nombre_club.trim(),
    nombre_admin: nombre_admin || '',
    email: email.trim().toLowerCase(),
    club_slug: slug,
  }).catch(err => console.error('[registro] Error enviando email bienvenida:', err));

  return res.status(201).json({
    success:       true,
    club_slug:     slug,
    access_token:  signIn?.session?.access_token  || null,
    refresh_token: signIn?.session?.refresh_token || null,
  });
});

module.exports = router;
