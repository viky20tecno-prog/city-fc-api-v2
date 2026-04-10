const express = require('express');
const SheetsClient = require('../services/sheets');

const router = express.Router();
const sheetsClient = new SheetsClient();
const CLUB_ID = 'city-fc';

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const TORNEOS = [
  { nombre: 'Punto y Coma', valor: 80000 },
  { nombre: 'JBC (Fútbol 7)', valor: 50000 },
  { nombre: 'INDESA 2026 I', valor: 120000 },
  { nombre: 'INDER Envigado', valor: 100000 },
];
const CUOTA = 65000;

/**
 * POST /api/inscripcion
 */
router.post('/', async (req, res) => {
  try {
    const {
      cedula, nombre, apellidos, tipo_id,
      celular, correo_electronico, instagram,
      lugar_de_nacimiento, fecha_nacimiento, tipo_sangre, eps,
      estatura, peso, direccion, municipio, barrio,
      familiar_emergencia, celular_contacto,
      tipo_descuento = 'NA',
    } = req.body;

    if (!cedula || !nombre || !apellidos || !celular || !municipio || !familiar_emergencia || !celular_contacto) {
      return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
    }

    // Verificar duplicado por cédula
    const existente = await sheetsClient.searchRow('JUGADORES', 'cedula', String(cedula));
    if (existente) {
      return res.status(409).json({ success: false, error: 'Ya existe un jugador con esa cédula' });
    }

    // Verificar duplicado por celular
    const existenteCel = await sheetsClient.searchRow('JUGADORES', 'celular', String(celular));
    if (existenteCel) {
      return res.status(409).json({ success: false, error: 'Ya existe un jugador con ese celular' });
    }

    const hoy = new Date().toISOString().split('T')[0];
    const anioActual = new Date().getFullYear();
    const mesActual = new Date().getMonth() + 1; // 1-12
    const nombreCompleto = `${nombre} ${apellidos}`.trim();

    // ✅ Insertar en JUGADORES — orden exacto de columnas:
    // club_id | cedula | nombre(s) | apellido(s) | tipo_de_documento | celular |
    // correo_electronico | instagram | lugar_de_nacimiento | fecha_nacimiento |
    // tipo_sangre | eps | estatura | peso | direccion_de_residencia | municipio |
    // barrio | contacto_en_caso_de_emergencia | celular_contacto |
    // mensualidad_2026 | tipo_descuento | observacion_descuento | activo
    await sheetsClient.appendRow('JUGADORES', [
      CLUB_ID,
      String(cedula),
      nombre,
      apellidos,
      tipo_id || 'Cédula de Ciudadanía',
      String(celular),
      correo_electronico || '',
      instagram || '',
      lugar_de_nacimiento || '',
      fecha_nacimiento || '',
      tipo_sangre || '',
      eps || '',
      estatura || '',
      peso || '',
      direccion || '',
      municipio,
      barrio || '',
      familiar_emergencia,
      String(celular_contacto),
      String(CUOTA),
      tipo_descuento,
      'Sin descuento',
      'SI',
    ]);

    // ✅ Crear 12 filas en ESTADO_MENSUALIDADES
    // Meses anteriores al actual → AL_DIA con valor 0
    // Mes actual y futuros → PENDIENTE con cuota
    // club_id | cedula | nombre | anio | mes | numero_mes | valor_oficial | valor_pagado | saldo_pendiente | estado | fecha_ultima_actualizacion
    for (let mes = 1; mes <= 12; mes++) {
      const esPasado = mes < mesActual;
      const valor = esPasado ? 0 : CUOTA;
      await sheetsClient.appendRow('ESTADO_MENSUALIDADES', [
        CLUB_ID,
        String(cedula),
        nombreCompleto,
        String(anioActual),
        MESES[mes],
        String(mes),
        String(valor),
        '0',
        String(valor),
        esPasado ? 'AL_DIA' : 'PENDIENTE',
        hoy,
      ]);
    }

    // ✅ Crear fila en ESTADO_UNIFORMES
    // club_id | cedula | nombre | anio | tipo_uniforme | valor_oficial | valor_pagado | saldo_pendiente | estado | fecha_ultima_actualizacion
    await sheetsClient.appendRow('ESTADO_UNIFORMES', [
      CLUB_ID,
      String(cedula),
      nombreCompleto,
      String(anioActual),
      'General',
      '90000',
      '0',
      '90000',
      'PENDIENTE',
      hoy,
    ]);

    // ✅ Crear 4 filas en ESTADO_TORNEOS (uno por torneo)
    // club_id | cedula | nombre | anio | torneo | valor_oficial | valor_pagado | saldo_pendiente | estado | fecha_ultima_actualizacion
    for (const torneo of TORNEOS) {
      await sheetsClient.appendRow('ESTADO_TORNEOS', [
        CLUB_ID,
        String(cedula),
        nombreCompleto,
        String(anioActual),
        torneo.nombre,
        String(torneo.valor),
        '0',
        String(torneo.valor),
        'PENDIENTE',
        hoy,
      ]);
    }

    res.json({
      success: true,
      message: '¡Bienvenido a City FC! ⚽',
      data: { cedula, nombre: nombreCompleto, club_id: CLUB_ID },
    });

  } catch (error) {
    console.error('Error in POST /inscripcion:', error);
    res.status(500).json({
      success: false,
      error: 'Error al inscribir jugador',
      message: error.message,
    });
  }
});

/**
 * GET /api/inscripcion/verificar?cedula=XXX
 */
router.get('/verificar', async (req, res) => {
  try {
    const { cedula } = req.query;
    if (!cedula) return res.status(400).json({ success: false, error: 'cedula requerida' });
    const jugador = await sheetsClient.searchRow('JUGADORES', 'cedula', String(cedula));
    res.json({ success: true, existe: !!jugador });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
