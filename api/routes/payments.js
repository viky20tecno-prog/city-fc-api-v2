const express = require('express');
const SheetsClient = require('../services/sheets');
const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

const sheetsClient = new SheetsClient();
const CLUB_ID = 'city-fc';

router.get('/', async (req, res) => {
  try {
    const club_id = req.club_id || CLUB_ID;
    const { limit = 50, cedula, estado_revision } = req.query;

    let payments = await sheetsClient.getAllRows('REGISTRO_PAGOS');

    if (cedula) {
      // REGISTRO_PAGOS guarda 'telefono', no cedula
      // Se busca el celular del jugador y se filtra por ese campo
      const jugador = await sheetsClient.searchRow('JUGADORES', 'cedula', String(cedula));
      if (jugador && jugador.celular) {
        payments = payments.filter(p => String(p.telefono) === String(jugador.celular));
      } else {
        payments = [];
      }
    }

    if (estado_revision) {
      payments = payments.filter(p => p.estado_revision === estado_revision);
    }

    payments.sort((a, b) =>
      new Date(b.fecha_proceso || 0) - new Date(a.fecha_proceso || 0)
    );

    const limitNum = Math.min(parseInt(limit) || 50, 500);
    payments = payments.slice(0, limitNum);

    const mapped = payments.map(p => ({
      id_transaccion:    p.id_transaccion,
      fecha_proceso:     p.fecha_proceso,
      cedula:            p.cedula || '',
      nombre_detectado:  p.nombre_detectado || '',
      monto:             parseFloat(p.monto_imagen) || 0,
      fecha_comprobante: p.fecha_comprobante,
      banco:             p.banco,
      referencia:        p.referencia,
      concepto:          p.conceptos_json || '',
      suma_conceptos:    parseFloat(p.suma_conceptos) || 0,
      validacion_monto:  p.validacion_monto,
      estado_revision:   p.estado_revision,
      mensaje_alerta:    p.mensaje_alerta || '',
      url_comprobante:   p.url_comprobante || '',
    }));

    res.json({
      success: true,
      club_id,
      total_registros: mapped.length,
      limit: limitNum,
      data: mapped,
    });
  } catch (error) {
    console.error('Error in GET /payments:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching payments',
      message: error.message,
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const club_id = req.club_id || CLUB_ID;
    const {
      cedula, nombre_detectado, monto, fecha_comprobante,
      banco, referencia, conceptos = [], url_comprobante = '', observacion = '',
    } = req.body;

    if (!cedula || !monto || !banco) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: cedula, monto, banco',
      });
    }

    const player = await sheetsClient.searchRow('JUGADORES', 'cedula', String(cedula));
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found', cedula });
    }

    const id_transaccion = `MANUAL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const hoy            = new Date().toISOString().split('T')[0];
    const anioActual     = String(new Date().getFullYear());
    const conceptoTipo   = conceptos[0]?.tipo || 'otro';
    const conceptoDesc   = conceptos[0]?.descripcion || '';
    const sumaConceptos  = conceptos.reduce((sum, c) => sum + (c.valor || 0), 0);
    const montoNum       = parseInt(monto);

    await sheetsClient.appendRow('REGISTRO_PAGOS', [
      club_id,
      id_transaccion,
      hoy,
      String(player.celular || ''),   // telefono — columna real en la hoja
      nombre_detectado || player['nombre(s)'] || '',
      String(montoNum),
      fecha_comprobante || hoy,
      anioActual,
      banco,
      referencia || '',
      JSON.stringify(conceptos),
      String(sumaConceptos),
      montoNum >= sumaConceptos ? 'correcto' : 'discrepancia',
      'aprobado_manual',
      conceptoTipo === 'otro' ? observacion : '',
      url_comprobante,
    ]);

    if (conceptoTipo === 'mensualidad') {
      await actualizarMensualidad(cedula, montoNum, hoy);
    } else if (conceptoTipo === 'uniforme') {
      await actualizarConcepto('ESTADO_UNIFORMES', cedula, montoNum, null, hoy);
    } else if (conceptoTipo === 'torneo') {
      await actualizarConcepto('ESTADO_TORNEOS', cedula, montoNum, conceptoDesc, hoy);
    }

    res.json({
      success: true,
      club_id,
      id_transaccion,
      mensaje: 'Pago registrado exitosamente',
      pago: {
        id_transaccion,
        cedula,
        monto: montoNum,
        banco,
        referencia,
        estado: 'aprobado_manual',
        fecha_proceso: hoy,
      },
    });
  } catch (error) {
    console.error('Error in POST /payments:', error);
    res.status(500).json({
      success: false,
      error: 'Error registering payment',
      message: error.message,
    });
  }
});

async function actualizarMensualidad(cedula, monto, hoy) {
  try {
    const filas = await sheetsClient.getAllRows('ESTADO_MENSUALIDADES');
    const candidatos = filas
      .map((f, idx) => ({ ...f, _idx: idx }))
      .filter(f => {
        const ced    = String(f.cedula || '').trim();
        const estado = String(f.estado || '').toUpperCase();
        return ced === String(cedula).trim() &&
          (estado === 'PENDIENTE' || estado === 'PARCIAL' || estado === 'MORA');
      })
      .sort((a, b) => parseInt(a.numero_mes) - parseInt(b.numero_mes));

    if (candidatos.length === 0) return;

    const target       = candidatos[0];
    const pagadoActual = parseFloat(target.valor_pagado) || 0;
    const oficial      = parseFloat(target.valor_oficial) || 0;
    const nuevoPagado  = pagadoActual + monto;
    const nuevoSaldo   = Math.max(0, oficial - nuevoPagado);
    const nuevoEstado  = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';
    const rowNumber    = target._idx + 2;

    await sheetsClient.updateRow('ESTADO_MENSUALIDADES', rowNumber, [
      target.club_id, target.cedula, target.nombre, target.anio,
      target.mes, target.numero_mes, target.valor_oficial,
      String(nuevoPagado), String(nuevoSaldo), nuevoEstado, hoy,
    ]);
  } catch (err) {
    console.error('Error actualizarMensualidad:', err.message);
  }
}

async function actualizarConcepto(hoja, cedula, monto, filtroTorneo, hoy) {
  try {
    const filas = await sheetsClient.getAllRows(hoja);
    const candidatos = filas
      .map((f, idx) => ({ ...f, _idx: idx }))
      .filter(f => {
        const ced    = String(f.cedula || '').trim();
        const estado = String(f.estado || '').toUpperCase();
        if (ced !== String(cedula).trim()) return false;
        if (estado === 'AL_DIA') return false;
        if (filtroTorneo && f.torneo) {
          return String(f.torneo).toLowerCase().includes(filtroTorneo.toLowerCase());
        }
        return true;
      });

    if (candidatos.length === 0) return;

    const target       = candidatos[0];
    const pagadoActual = parseFloat(target.valor_pagado) || 0;
    const oficial      = parseFloat(target.valor_oficial) || 0;
    const nuevoPagado  = pagadoActual + monto;
    const nuevoSaldo   = Math.max(0, oficial - nuevoPagado);
    const nuevoEstado  = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';
    const rowNumber    = target._idx + 2;

    if (hoja === 'ESTADO_UNIFORMES') {
      await sheetsClient.updateRow(hoja, rowNumber, [
        target.club_id, target.cedula, target.nombre, target.anio,
        target.tipo_uniforme, target.valor_oficial,
        String(nuevoPagado), String(nuevoSaldo), nuevoEstado, hoy,
      ]);
    } else {
      await sheetsClient.updateRow(hoja, rowNumber, [
        target.club_id, target.cedula, target.nombre, target.anio,
        target.torneo, target.valor_oficial,
        String(nuevoPagado), String(nuevoSaldo), nuevoEstado, hoy,
      ]);
    }
  } catch (err) {
    console.error(`Error actualizarConcepto ${hoja}:`, err.message);
  }
}

module.exports = router;
