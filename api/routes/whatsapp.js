const express = require('express');
const db = require('../services/db');
const router = express.Router();

const MESES = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};

// Validar webhook secret enviado por Make.com
router.use((req, res, next) => {
  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (!process.env.WHATSAPP_WEBHOOK_SECRET || secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  next();
});

// POST /api/whatsapp/pago-comprobante
// Make.com llama este endpoint con los datos ya extraídos por GPT-4o Vision
// Body: { celular?, cedula?, monto, banco, referencia?, concepto?, url_comprobante? }
// Response: { success, mensaje_whatsapp } — Make.com reenvía mensaje_whatsapp al jugador
router.post('/pago-comprobante', async (req, res) => {
  try {
    const {
      celular, cedula,
      monto, banco,
      referencia = '',
      concepto = 'mensualidad',
      url_comprobante = '',
    } = req.body;

    if (!monto || !banco) {
      return res.status(400).json({
        success: false,
        error: 'Faltan campos requeridos: monto, banco',
        mensaje_whatsapp: 'No pude procesar el comprobante. Por favor envíalo nuevamente con el banco y monto visibles.',
      });
    }

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    // Buscar jugador por cédula o celular
    let player = null;
    if (cedula) {
      player = await db.getPlayerByCedula(club.id, cedula);
    } else if (celular) {
      player = await db.getPlayerByCelular(club.id, celular);
    }

    if (!player) {
      return res.status(404).json({
        success: false,
        error: 'Jugador no encontrado',
        mensaje_whatsapp: 'No encontramos un jugador registrado con tu número. Comunícate con el administrador.',
      });
    }

    const montoNum = parseInt(monto);

    const pago = await db.createPago({
      club_id: club.id,
      player_id: player.id,
      cedula: player.cedula,
      monto: montoNum,
      banco,
      concepto,
      referencia,
      url_comprobante,
    });

    // Actualizar estado de mensualidad si aplica
    let mensualidadActualizada = null;
    if (concepto === 'mensualidad') {
      mensualidadActualizada = await actualizarMensualidad(club.id, player.cedula, montoNum);
    }

    // Construir mensaje de confirmación para el jugador
    let mensajeWhatsapp = `✅ *Pago registrado*\n\nHola ${player.nombre}, recibimos tu comprobante:\n• Monto: $${montoNum.toLocaleString('es-CO')}\n• Banco: ${banco}`;
    if (referencia) mensajeWhatsapp += `\n• Referencia: ${referencia}`;
    if (mensualidadActualizada) {
      mensajeWhatsapp += `\n• Mes actualizado: ${mensualidadActualizada.mes} → *${mensualidadActualizada.estado}*`;
    }
    mensajeWhatsapp += '\n\n¡Gracias! 🙌';

    res.json({
      success: true,
      jugador: {
        cedula: player.cedula,
        nombre: `${player.nombre} ${player.apellidos}`.trim(),
        celular: player.celular,
      },
      pago_id: pago.id,
      mensaje_whatsapp: mensajeWhatsapp,
    });
  } catch (error) {
    console.error('Error en POST /whatsapp/pago-comprobante:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      mensaje_whatsapp: 'Ocurrió un error al procesar el pago. Por favor intenta de nuevo o comunícate con el administrador.',
    });
  }
});

// GET /api/whatsapp/recordatorios-pendientes
// Make.com consulta este endpoint para saber a quién notificar y con qué urgencia
// Response: { data: { pre_vencimiento, gracia, mora_mes_actual, mora_acumulada } }
router.get('/recordatorios-pendientes', async (req, res) => {
  try {
    const { anio = new Date().getFullYear() } = req.query;
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const diaDelMes = currentDate.getDate();
    const pastGracePeriod = diaDelMes > 7;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const [jugadores, allInvoices, suspensiones] = await Promise.all([
      db.getPlayers(club.id),
      db.getMensualidades(club.id),
      db.getSuspensiones(club.id),
    ]);

    const playersMap = {};
    jugadores.forEach(p => { playersMap[p.cedula] = p; });

    const isSuspendido = (cedula, mesNum) =>
      suspensiones.some(s =>
        s.cedula === String(cedula) &&
        parseInt(s.anio) === parseInt(anio) &&
        s.mes_inicio <= mesNum &&
        mesNum <= s.mes_fin
      );

    const invoicesAnio = allInvoices.filter(inv => String(inv.anio) === String(anio));

    const resultado = {
      pre_vencimiento: [],  // días 1-5: recordatorio amigable
      gracia: [],           // días 6-7: aviso de vencimiento próximo
      mora_mes_actual: [],  // día 8+: notificación de mora
      mora_acumulada: [],   // meses anteriores pendientes
    };

    const moraAcumuladaMap = {};

    invoicesAnio.forEach(inv => {
      const mesNum = parseInt(inv.numero_mes);
      const player = playersMap[inv.cedula];
      if (!player || !player.celular) return;
      if (isSuspendido(inv.cedula, mesNum)) return;
      if (inv.estado === 'AL_DIA') return;

      const saldo = parseFloat(inv.saldo_pendiente) || 0;
      if (saldo <= 0) return;

      // Meses anteriores → mora acumulada
      if (mesNum < currentMonth) {
        if (!moraAcumuladaMap[inv.cedula]) {
          moraAcumuladaMap[inv.cedula] = {
            cedula: inv.cedula,
            nombre: `${player.nombre} ${player.apellidos}`.trim(),
            celular: player.celular,
            total_deuda: 0,
            meses: [],
          };
        }
        moraAcumuladaMap[inv.cedula].total_deuda += saldo;
        moraAcumuladaMap[inv.cedula].meses.push(MESES[mesNum] || inv.mes);
        return;
      }

      // Mes actual: PARCIAL no se notifica
      if (mesNum !== currentMonth) return;
      if (inv.estado === 'PARCIAL') return;

      const entrada = {
        cedula: inv.cedula,
        nombre: `${player.nombre} ${player.apellidos}`.trim(),
        celular: player.celular,
        saldo_pendiente: saldo,
        mes: MESES[currentMonth],
      };

      if (pastGracePeriod) {
        resultado.mora_mes_actual.push(entrada);
      } else if (diaDelMes >= 6) {
        resultado.gracia.push(entrada);
      } else {
        resultado.pre_vencimiento.push(entrada);
      }
    });

    resultado.mora_acumulada = Object.values(moraAcumuladaMap);

    res.json({
      success: true,
      club_id: req.club_id,
      fecha: currentDate.toISOString().split('T')[0],
      dia_del_mes: diaDelMes,
      anio,
      resumen: {
        pre_vencimiento: resultado.pre_vencimiento.length,
        gracia: resultado.gracia.length,
        mora_mes_actual: resultado.mora_mes_actual.length,
        mora_acumulada: resultado.mora_acumulada.length,
      },
      data: resultado,
    });
  } catch (error) {
    console.error('Error en GET /whatsapp/recordatorios-pendientes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function actualizarMensualidad(club_id, cedula, monto) {
  try {
    const pendientes = await db.getMensualidadesPendientes(club_id, cedula);
    if (pendientes.length === 0) return null;

    const target = pendientes[0];
    const nuevoPagado = (parseFloat(target.valor_pagado) || 0) + monto;
    const oficial = parseFloat(target.valor_oficial) || 0;
    const nuevoSaldo = Math.max(0, oficial - nuevoPagado);
    const nuevoEstado = nuevoPagado >= oficial ? 'AL_DIA' : 'PARCIAL';

    return await db.updateMensualidad(target.id, {
      valor_pagado: nuevoPagado,
      saldo_pendiente: nuevoSaldo,
      estado: nuevoEstado,
    });
  } catch (err) {
    console.error('Error actualizarMensualidad whatsapp:', err.message);
    return null;
  }
}

module.exports = router;
