const { google } = require('googleapis');

class SheetsClient {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    this.sheets = null;
  }

  async initializeAuth() {
    if (this.sheets) return;

    try {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheets = google.sheets({
        version: 'v4',
        auth,
      });

      console.log('✅ Sheets conectado');

    } catch (error) {
      console.error('❌ ERROR AUTH:', error);
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
