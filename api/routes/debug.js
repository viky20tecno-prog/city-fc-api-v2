const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

router.get('/', async (req, res) => {
  const result = {
    spreadsheetId: process.env.GOOGLE_SHEETS_ID ? '✅ Definido' : '❌ No definido',
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? '✅ Definido' : '❌ No definido',
    keyLength: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.length || 0,
    parsedOk: false,
    hasPrivateKey: false,
    hasClientEmail: false,
    authOk: false,
    sheetsOk: false,
    error: null,
  };

  // Intentar parsear el key
  try {
    let keyData;
    try {
      const decoded = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8');
      keyData = JSON.parse(decoded);
    } catch {
      keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'));
    }

    result.parsedOk = true;
    result.hasPrivateKey = !!keyData.private_key;
    result.hasClientEmail = !!keyData.client_email;
    result.clientEmail = keyData.client_email || 'no encontrado';
    result.privateKeyStart = keyData.private_key?.substring(0, 40) || 'no encontrado';

    // Intentar auth
    const auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    result.authOk = true;

    // Intentar llamada real al sheet
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      fields: 'spreadsheetId,properties.title',
    });

    result.sheetsOk = true;
    result.sheetTitle = response.data.properties.title;
    result.sheetId = response.data.spreadsheetId;

  } catch (err) {
    result.error = err.message;
  }

  res.json(result);
});

module.exports = router;
