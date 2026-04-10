const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class SheetsClient {
 constructor() {
  this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  this.auth = null;
  this.sheets = null;

  try {
    this.initializeAuth();
  } catch (error) {
    console.error('🔥 INIT ERROR:', error);
  }
}
  initializeAuth() {
  try {
    let keyData;

    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        // Intentar como base64
        const decoded = Buffer.from(
          process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
          'base64'
        ).toString('utf-8');

        keyData = JSON.parse(decoded);
      } catch (error) {
        // Si falla, usar JSON directo (con fix de \n)
        keyData = JSON.parse(
          process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n')
        );
      }
    } else if (fs.existsSync(path.join(__dirname, '../service-account.json'))) {
      // Fallback local
      keyData = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '../service-account.json'),
          'utf-8'
        )
      );
    } else {
      throw new Error('No se encontró Google Service Account key');
    }

    this.auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({
      version: 'v4',
      auth: this.auth,
    });

    console.log('✅ Google Sheets client initialized');
  } catch (error) {
    console.error('❌ Error initializing Google Sheets:', error.message);
    throw error;
  }
}
  /**
   * Obtener rango específico de un sheet
   * @param {string} sheetName - Nombre de la hoja (ej: "JUGADORES")
   * @param {string} range - Rango A1 (ej: "A1:Z100")
   * @returns {Promise<Array>} Array de filas
   */
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

  /**
   * Obtener todas las filas de un sheet
   * @param {string} sheetName - Nombre de la hoja
   * @returns {Promise<Array>} Array de filas con headers
   */
  async getAllRows(sheetName) {
    const rows = await this.getRange(sheetName);
    return this.parseRows(rows);
  }

  /**
   * Buscar una fila por columna y valor
   * @param {string} sheetName - Nombre de la hoja
   * @param {string} filterColumn - Nombre de la columna a buscar
   * @param {string} filterValue - Valor a buscar
   * @returns {Promise<Object|null>} Objeto fila o null si no existe
   */
  async searchRow(sheetName, filterColumn, filterValue) {
    try {
      const rows = await this.getAllRows(sheetName);
      const result = rows.find(row => row[filterColumn] === String(filterValue));
      return result || null;
    } catch (error) {
      console.error(`Error searching ${sheetName}:`, error.message);
      return null;
    }
  }

  /**
   * Buscar múltiples filas por filtro
   * @param {string} sheetName - Nombre de la hoja
   * @param {string} filterColumn - Columna a buscar
   * @param {string} filterValue - Valor a buscar
   * @returns {Promise<Array>} Array de filas que coinciden
   */
  async searchRows(sheetName, filterColumn, filterValue) {
    try {
      const rows = await this.getAllRows(sheetName);
      return rows.filter(row => row[filterColumn] === String(filterValue));
    } catch (error) {
      console.error(`Error searching rows in ${sheetName}:`, error.message);
      return [];
    }
  }

  /**
   * Buscar filas por múltiples filtros (AND)
   * @param {string} sheetName - Nombre de la hoja
   * @param {Object} filters - { columna: valor, ... }
   * @returns {Promise<Array>} Array de filas que cumplen todos los filtros
   */
  async searchRowsMultiple(sheetName, filters) {
    try {
      const rows = await this.getAllRows(sheetName);
      return rows.filter(row => {
        return Object.entries(filters).every(([col, val]) => {
          return row[col] === String(val);
        });
      });
    } catch (error) {
      console.error(`Error searching rows in ${sheetName}:`, error.message);
      return [];
    }
  }

  /**
   * Actualizar una fila por número de fila (1-indexed)
   * @param {string} sheetName - Nombre de la hoja
   * @param {number} rowNumber - Número de fila (1-indexed)
   * @param {Array} values - Array de valores a actualizar
   * @returns {Promise<Object>} Response de Google Sheets
   */
  async updateRow(sheetName, rowNumber, values) {
    try {
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [values],
        },
      });
      return response.data;
    } catch (error) {
      console.error(`Error updating row in ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Agregar una fila nueva al final del sheet
   * @param {string} sheetName - Nombre de la hoja
   * @param {Array} values - Array de valores
   * @returns {Promise<Object>} Response de Google Sheets
   */
  async appendRow(sheetName, values) {
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [values],
        },
      });
      return response.data;
    } catch (error) {
      console.error(`Error appending row to ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Convertir filas raw a objetos con headers
   * @param {Array} rows - Array de arrays (raw data)
   * @returns {Array} Array de objetos
   */
  parseRows(rows) {
    if (!rows || rows.length === 0) return [];
    
    const [headers, ...dataRows] = rows;
    return dataRows.map(row => {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = row[idx] || '';
      });
      return obj;
    });
  }

  /**
   * Obtener headers de un sheet
   * @param {string} sheetName - Nombre de la hoja
   * @returns {Promise<Array>} Array de nombres de columnas
   */
  async getHeaders(sheetName) {
    try {
      const rows = await this.getRange(sheetName, 'A1:Z1');
      return rows[0] || [];
    } catch (error) {
      console.error(`Error getting headers from ${sheetName}:`, error.message);
      return [];
    }
  }

  /**
   * Filtrar filas por múltiples criterios complejos
   * @param {string} sheetName - Nombre de la hoja
   * @param {Object} filters - { columna: valor|[valores], ... }
   * @returns {Promise<Array>} Filas filtradas
   */
  async filterRows(sheetName, filters) {
    try {
      const rows = await this.getAllRows(sheetName);
      return rows.filter(row => {
        return Object.entries(filters).every(([col, val]) => {
          if (Array.isArray(val)) {
            return val.includes(String(row[col]));
          }
          return row[col] === String(val);
        });
      });
    } catch (error) {
      console.error(`Error filtering rows in ${sheetName}:`, error.message);
      return [];
    }
  }
}

module.exports = SheetsClient;
