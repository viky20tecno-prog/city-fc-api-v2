const express = require('express');
const cors = require('cors');
require('dotenv').config();

const playersRouter    = require('./routes/players');
const invoicesRouter   = require('./routes/invoices');
const paymentsRouter   = require('./routes/payments');
const configRouter     = require('./routes/config');
const reportsRouter    = require('./routes/reports');
const uniformsRouter   = require('./routes/uniforms');
const debugRouter      = require('./routes/debug');
const inscripcionRouter = require('./routes/inscripcion');

const app = express();

app.use(cors({
  origin: 'https://city-fc-dashboard-theta.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/debug') || req.path.startsWith('/inscripcion')) {
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

app.use('/api/players',     playersRouter);
app.use('/api/invoices',    invoicesRouter);
app.use('/api/payments',    paymentsRouter);
app.use('/api/config',      configRouter);
app.use('/api/reports',     reportsRouter);
app.use('/api/uniforms',    uniformsRouter);
app.use('/api/debug',       debugRouter);
app.use('/api/inscripcion', inscripcionRouter);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

module.exports = app;
