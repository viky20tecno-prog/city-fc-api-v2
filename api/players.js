export default async function handler(req, res) {
  return res.status(200).json({
    success: true,
    message: "API funcionando correctamente 🚀",
    test: [
      { nombre: "Jugador 1" },
      { nombre: "Jugador 2" }
    ]
  });
}
