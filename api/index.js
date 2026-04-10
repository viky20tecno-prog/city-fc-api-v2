const express = require('express');
const cors = require('cors');
require('dotenv').config();

const playersRouter = require('./routes/players');
const invoicesRouter = require('./routes/invoices');
const paymentsRouter = require('./routes/payments');
const configRouter = require('./routes/config');
const reportsRouter = require('./routes/reports');
const uniformsRouter = require('./routes/uniforms');
const debugRouter = require('./routes/debug');
const inscripcionRouter = require('./routes/inscripcion');

const app = express();

// 🔥 CORS BIEN CONFIGURADO (CLAVE)
const allowedOrigins = [
  'https://city-fc-dashboard-pi.vercel.app',
  'http://localhost:5173'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
  });
});

// Auth middleware
app.use('/api', (req, res, next) => {
  if (
    req.path === '/health' ||
    req.path.startsWith('/debug') ||
    req.path.startsWith('/inscripcion')
  ) {
    return next();
  }

  const club_id = req.query.club_id || req.body.club_id;

  if (!club_id) {
    return res.status(400).json({
      success: false,
      error: 'club_id requerido',
    });
  }

  req.club_id = club_id;
  next();
});

// Routes
app.use('/api/players', playersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/config', configRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/uniforms', uniformsRouter);
app.use('/api/debug', debugRouter);
app.use('/api/inscripcion', inscripcionRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// Local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`✅ API running on http://localhost:${PORT}`);
  });
}

module.exports = app;
