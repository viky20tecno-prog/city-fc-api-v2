const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const playersRouter     = require('./routes/players');
const invoicesRouter    = require('./routes/invoices');
const paymentsRouter    = require('./routes/payments');
const configRouter      = require('./routes/config');
const reportsRouter     = require('./routes/reports');
const uniformsRouter    = require('./routes/uniforms');
const inscripcionRouter = require('./routes/inscripcion');
const arbitrageRouter      = require('./routes/arbitrage');
const suspensionesRouter   = require('./routes/suspensiones');
const whatsappRouter       = require('./routes/whatsapp');
const requireAuth          = require('./middleware/auth');

const app = express();

// Supabase admin client (service role) — usado para validación de club
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'https://city-fc-dashboard-theta.vercel.app',
      'https://city-fc-dashboard-pi.vercel.app',
    ];
    if (!origin || allowed.includes(origin) || /^https:\/\/city-fc-dashboard[^.]*\.vercel\.app$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Validación de club_id (requerido en todas las rutas excepto /health e /inscripcion)
app.use('/api', (req, res, next) => {
  if (
    req.path === '/health' ||
    req.path.startsWith('/inscripcion')
  ) {
    return next();
  }
  const club_id = req.query.club_id || req.body?.club_id;
  if (!club_id) {
    return res.status(400).json({
      success: false,
      error: 'club_id requerido',
      example: '?club_id=city-fc'
    });
  }
  req.club_id = club_id;
  next();
});

// Rutas públicas (sin JWT — whatsapp usa su propio webhook secret)
app.use('/api/inscripcion', inscripcionRouter);
app.use('/api/whatsapp',    whatsappRouter);

// Middleware de autenticación JWT para todas las rutas protegidas
app.use('/api', requireAuth);

// Validación de pertenencia al club (post-auth)
// Si el club tiene owner_user_id configurado, valida que el usuario sea el dueño.
// Si owner_user_id es NULL (migración pendiente), permite el acceso (retrocompatible).
app.use('/api', async (req, res, next) => {
  if (!req.user || !req.club_id) return next();

  try {
    const { data: club, error } = await supabaseAdmin
      .from('clubs')
      .select('id, owner_user_id, is_active')
      .eq('slug', req.club_id)
      .single();

    if (error || !club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    if (club.is_active === false) {
      return res.status(403).json({ success: false, error: 'Club inactivo' });
    }

    if (club.owner_user_id && club.owner_user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'No tienes acceso a este club' });
    }

    req.club_uuid = club.id;
    next();
  } catch (err) {
    console.error('Club access validation error:', err.message);
    return res.status(500).json({ success: false, error: 'Error validando acceso al club' });
  }
});

// Rutas protegidas
app.use('/api/players',      playersRouter);
app.use('/api/invoices',     invoicesRouter);
app.use('/api/payments',     paymentsRouter);
app.use('/api/config',       configRouter);
app.use('/api/reports',      reportsRouter);
app.use('/api/uniforms',     uniformsRouter);
app.use('/api/arbitrage',    arbitrageRouter);
app.use('/api/suspensiones', suspensionesRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

module.exports = app;
