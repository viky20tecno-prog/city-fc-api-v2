const SheetsClient = require('../services/sheets');

module.exports = async (req, res) => {

  // CORS (NO TOCAR)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const sheetsClient = new SheetsClient();

    const data = await sheetsClient.getAllRows('JUGADORES');

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error('PLAYERS ERROR:', error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
