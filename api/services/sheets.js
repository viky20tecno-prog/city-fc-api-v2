const { google } = require('googleapis');

class SheetsClient {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    this.sheets = null;
  }

  async initializeAuth() {
    if (this.sheets) return;

    try {
      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_KEY');
      }

      let keyData;

      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

      // 🔥 DETECCIÓN INTELIGENTE (ARREGLA TODO)
      if (raw.trim().startsWith('{')) {
        // JSON directo
        keyData = JSON.parse(raw);
      } else {
        // Base64
        const decoded = Buffer.from(raw, 'base64').toString('utf-8');
        keyData = JSON.parse(decoded);
      }

      const auth = new google.auth.GoogleAuth({
        credentials: keyData,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheets = google.sheets({
        version: 'v4',
        auth,
      });

      console.log('✅ Sheets listo');
    } catch (error) {
      console.error('❌ Error init sheets:', error);
      throw error;
    }
  }

  async getRange(sheetName, range = 'A:Z') {
    await this.initializeAuth();

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${range}`,
    });

    return response.data.values || [];
  }

  async getAllRows(sheetName) {
    const rows = await this.getRange(sheetName);
    return this.parseRows(rows);
  }

  async searchRow(sheetName, column, value) {
    const rows = await this.getAllRows(sheetName);
    return rows.find(r => r[column] === String(value)) || null;
  }

  async searchRows(sheetName, column, value) {
    const rows = await this.getAllRows(sheetName);
    return rows.filter(r => r[column] === String(value));
  }

  parseRows(rows) {
    if (!rows || rows.length === 0) return [];

    const [headers, ...data] = rows;

    return data.map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
  }
}

module.exports = SheetsClient;
