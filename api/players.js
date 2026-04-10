module.exports = async (req, res) => {

  // 🔥 CORS FORZADO (CLAVE)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    return res.status(200).json({
      success: true,
      message: 'API funcionando correctamente 🚀',
      data: [
        { nombre: 'Jugador 1' },
        { nombre: 'Jugador 2' }
      ]
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
