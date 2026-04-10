const express = require('express');
const cors = require('cors');
require('dotenv').config();
const playersRouter = require('./routes/players');
const invoicesRouter = require('./routes/invoices');
const paymentsRouter = require('./routes/payments');
const configRouter = require('./routes/config');
const reportsRouter = require('./routes/reports');
const uniformsRouter = require('./routes/uniforms');
const debugRouter = require('./routes/debug'); // ← DEBUG
const inscripcionRouter = require('./routes/inscripcion');
const app = express();

// Middleware
app.use(cors());

app.options('*', cors());
app.use(express.json());

// Health check (sin validación club_id)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Auth middleware (valida club_id para todas las rutas /api/*)
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/debug') || req.path.startsWith('/inscripcion')) {
    return next();
  }
  
  const club_id = req.query.club_id || req.body.club_id;
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

// Routes
app.use('/api/players', playersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/config', configRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/uniforms', uniformsRouter);
app.use('/api/debug', debugRouter); // ← DEBUG
app.use('/api/inscripcion', inscripcionRouter);
// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Para desarrollo local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`✅ API running on http://localhost:${PORT}`);
  });
}

// Exportar para Vercel
module.exports = app;
