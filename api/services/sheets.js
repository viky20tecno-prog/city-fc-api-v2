const { google } = require('googleapis');

class SheetsClient {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    this.auth = null;
    this.sheets = null;

    try {
      this.initializeAuth();
    } catch (error) {
      console.error('Error al inicializar SheetsClient:', error.message);
    }
  }

  initializeAuth() {
  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_KEY');
    }

    let keyData;
    try {
      // Intentar como base64
      const decoded = Buffer.from(
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64'
      ).toString('utf-8');
      keyData = JSON.parse(decoded);
    } catch {
      // Si falla, intentar como JSON directo
      keyData = JSON.parse(
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n')
      );
    }

    this.auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    console.log('Google Sheets client initialized');
  } catch (error) {
    console.error('Error initializing Google Sheets:', error.message);
    throw error;
  }
}


  async getRange(sheetName, range = 'A:Z') {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!${range}`,
      });
      return response.data.values || [];
    } catch (error) {
      console.error(`Error reading ${sheetName}:`, error.message);
      throw error;
    }
  }

  async getAllRows(sheetName) {
    const rows = await this.getRange(sheetName);
    return this.parseRows(rows);
  }

  async searchRow(sheetName, filterColumn, filterValue) {
    try {
      const rows = await this.getAllRows(sheetName);
      return rows.find(row => row[filterColumn] === String(filterValue)) || null;
    } catch (error) {
      console.error(`Error searching ${sheetName}:`, error.message);
      return null;
    }
  }

  async searchRows(sheetName, filterColumn, filterValue) {
    try {
      const rows = await this.getAllRows(sheetName);
      return rows.filter(row => row[filterColumn] === String(filterValue));
    } catch (error) {
      console.error(`Error searching rows in ${sheetName}:`, error.message);
      return [];
    }
  }

  async searchRowsMultiple(sheetName, filters) {
    try {
      const rows = await this.getAllRows(sheetName);
      return rows.filter(row =>
        Object.entries(filters).every(([col, val]) => row[col] === String(val))
      );
    } catch (error) {
      console.error(`Error searching rows in ${sheetName}:`, error.message);
      return [];
    }
  }

  async updateRow(sheetName, rowNumber, values) {
    try {
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [values] },
      });
      return response.data;
    } catch (error) {
      console.error(`Error updating row in ${sheetName}:`, error.message);
      throw error;
    }
  }

  async appendRow(sheetName, values) {
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [values] },
      });
      return response.data;
    } catch (error) {
      console.error(`Error appending row to ${sheetName}:`, error.message);
      throw error;
    }
  }

  async getHeaders(sheetName) {
    try {
      const rows = await this.getRange(sheetName, 'A1:Z1');
      return rows[0] || [];
    } catch (error) {
      console.error(`Error getting headers from ${sheetName}:`, error.message);
      return [];
    }
  }

  async filterRows(sheetName, filters) {
    try {
      const rows = await this.getAllRows(sheetName);
      return rows.filter(row =>
        Object.entries(filters).every(([col, val]) =>
          Array.isArray(val) ? val.includes(String(row[col])) : row[col] === String(val)
        )
      );
    } catch (error) {
      console.error(`Error filtering rows in ${sheetName}:`, error.message);
      return [];
    }
  }

  parseRows(rows) {
    if (!rows || rows.length === 0) return [];
    const [headers, ...dataRows] = rows;
    return dataRows.map(row => {
      const obj = {};
      headers.forEach((header, idx) => { obj[header] = row[idx] || ''; });
      return obj;
    });
  }
}

module.exports = SheetsClient;
