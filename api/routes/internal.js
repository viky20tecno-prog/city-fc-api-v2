const express = require('express');
const emailService = require('../services/email');

const router = express.Router();

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;

function checkSecret(req, res, next) {
  const secret = req.headers['x-internal-secret'];
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/internal/send-reset-email
router.post('/send-reset-email', checkSecret, async (req, res) => {
  const { to, resetUrl } = req.body;
  if (!to || !resetUrl) return res.status(400).json({ error: 'to y resetUrl requeridos' });

  try {
    await emailService.sendAdminPasswordReset(to, resetUrl);
    res.json({ ok: true });
  } catch (err) {
    console.error('[internal] send-reset-email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
