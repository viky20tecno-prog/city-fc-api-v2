const SheetsClient = require('../services/sheets');

module.exports = async (req, res) => {

  // 🔥 CORS (YA FUNCIONA)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const sheetsClient = new SheetsClient();

    const rawData = await sheetsClient.getAllRows('JUGADORES');

    // 🔥 ADAPTADOR A TU ESTRUCTURA REAL DEL SHEET
    const data = rawData.map(row => ({
      club_id: row.club_id,
      cedula: row.cedula,
      "nombre(s)": row["nombre(s)"],
      "apellido(s)": row["apellido(s)"],

      // Ajustes por nombres reales del sheet
      tipo_documento: row.tipo_de_celular,
      celular: row.celular,
      correo_electronico: row.correo_electroni,
      instagram: row.instagram,

      lugar_de_nacimiento: row.lugar_de_naci,
      fecha_nacimiento: row.fecha_nacimien,
      tipo_sangre: row.tipo_s,
      eps: row.eps,

      estatura: row.estatura,
      peso: row.peso,
      direccion: row.direccion_de_re,
      municipio: row.municipio,
      barrio: row.barrio,

      contacto_emergencia: row.contacto_en_ca,
      celular_contacto: row.celular_c,
    }));

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error('❌ PLAYERS ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
