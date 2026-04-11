const { google } = require('googleapis');

class SheetsClient {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    this.sheets = null;
  }

  async initializeAuth() {
    if (this.sheets) return;

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_KEY');
    }

    try {
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

      let keyData;

      if (raw.trim().startsWith('{')) {
        keyData = JSON.parse(raw);
      } else {
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
      console.error('❌ ERROR GOOGLE AUTH:', error);
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

    if (!rows.length) return [];

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
