const SheetsClient = require('./services/sheets');

module.exports = async (req, res) => {
  try {
    const club_id = req.query.club_id;

    if (!club_id) {
      return res.status(400).json({
        success: false,
        error: 'club_id requerido'
      });
    }

    const sheetsClient = new SheetsClient();

    const data = await sheetsClient.getAllRows('JUGADORES');

    return res.json({
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
