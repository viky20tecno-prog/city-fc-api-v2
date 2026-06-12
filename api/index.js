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
const registroRouter       = require('./routes/registro');
const finanzasRouter       = require('./routes/finanzas');
const nominaRouter         = require('./routes/nomina');
const torneosRouter        = require('./routes/torneos');
const membersRouter        = require('./routes/members');
const calendarioRouter     = require('./routes/calendario');
const asistenciaRouter     = require('./routes/asistencia');
const publicoRouter        = require('./routes/publico');
const cronRouter           = require('./routes/cron');
const leadsRouter          = require('./routes/leads');
const waAgentRouter        = require('./routes/wa-agent');
const internalRouter       = require('./routes/internal');
const requireAuth          = require('./middleware/auth');

// Middleware que bloquea acceso a rutas financieras para ENTRENADOR
const requireAdmin = (req, res, next) => {
  if (req.userRole === 'ENTRENADOR') {
    return res.status(403).json({ success: false, error: 'Acceso restringido al administrador' });
  }
  next();
};

const app = express();

// Supabase admin client (service role) — usado para validación de club
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGINS = [
  'https://zensports.vercel.app',
  'https://zensports-admin.vercel.app',
  'https://zensports.zenpra.ai',
  'https://admin-zensports.zenpra.ai',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  const isHtmlReport = /^\/api\/publico\/morosos-pdf(\/|$)/.test(req.path);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', isHtmlReport ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  if (isHtmlReport) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; img-src * data:; script-src 'unsafe-inline'");
  } else {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
    req.path.startsWith('/inscripcion') ||
    req.path.startsWith('/registro') ||
    req.path.startsWith('/whatsapp') ||
    req.path.startsWith('/publico') ||
    req.path.startsWith('/cron') ||
    req.path.startsWith('/leads') ||
    req.path.startsWith('/wa-agent') ||
    req.path.startsWith('/internal')
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

// Rutas públicas (sin JWT)
app.use('/api/inscripcion', inscripcionRouter);
app.use('/api/whatsapp',    whatsappRouter);
app.use('/api/registro',    registroRouter);
app.use('/api/publico',     publicoRouter);
app.use('/api/cron',        cronRouter);
app.use('/api/leads',       leadsRouter);
app.use('/api/wa-agent',    waAgentRouter);
app.use('/api/internal',    internalRouter);

// Middleware de autenticación JWT para todas las rutas protegidas
app.use('/api', requireAuth);

// Validación de pertenencia al club (post-auth)
// Admite dueño del club (owner_user_id) y miembros con rol en club_members.
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

    if (!club.owner_user_id || club.owner_user_id === req.user.id) {
      // Dueño del club o club sin owner (retrocompatible)
      req.club_uuid = club.id;
      req.userRole  = 'ADMIN';
      return next();
    }

    // Verificar si es miembro con rol
    const { data: member } = await supabaseAdmin
      .from('club_members')
      .select('role, activo, nombre')
      .eq('user_id', req.user.id)
      .eq('club_id', req.club_id)
      .single();

    if (!member || !member.activo) {
      return res.status(403).json({ success: false, error: 'No tienes acceso a este club' });
    }

    req.club_uuid  = club.id;
    req.userRole   = member.role;
    req.memberName = member.nombre;
    next();
  } catch (err) {
    console.error('Club access validation error:', err.message);
    return res.status(500).json({ success: false, error: 'Error validando acceso al club' });
  }
});

// Rutas protegidas — acceso universal (ADMIN y ENTRENADOR)
app.use('/api/players',      playersRouter);
app.use('/api/uniforms',     uniformsRouter);
app.use('/api/arbitrage',    arbitrageRouter);
app.use('/api/suspensiones', suspensionesRouter);
app.use('/api/reports',      reportsRouter);
app.use('/api/calendario',   calendarioRouter);
app.use('/api/asistencia',   asistenciaRouter);
app.use('/api/invoices',     invoicesRouter);
app.use('/api/payments',     paymentsRouter);
app.use('/api/config',       configRouter);
app.use('/api/torneos',      torneosRouter);

// Rutas solo ADMIN (bloqueadas para ENTRENADOR)
app.use('/api/finanzas',     requireAdmin, finanzasRouter);
app.use('/api/nomina',       requireAdmin, nominaRouter);
app.use('/api/miembros',     requireAdmin, membersRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

module.exports = app;
