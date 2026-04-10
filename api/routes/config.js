const express = require('express');

const router = express.Router();

/**
 * GET /api/config?club_id=city-fc
 * Obtener configuración del club: conceptos, valores, etc.
 */
router.get('/', (req, res) => {
  try {
    const club_id = req.club_id || 'city-fc';
    
    // Configuración hardcodeada (próximamente desde BD)
    const config = {
      success: true,
      club_id,
      info_general: {
        nombre_club: 'City Futbol Club',
        ciudad: 'Medellín',
        año_fundacion: 2020,
        logo_url: '/assets/city-fc-logo.png',
      },
      conceptos_pago: {
        mensualidad: {
          nombre: 'Mensualidad',
          valores: {
            estandar: 65000,
            descuento: 45000,
            beca: 0,
          },
          descripcion: 'Cuota mensual de entrenamiento',
        },
        uniforme: {
          nombre: 'Uniforme',
          opciones: [
            {
              nombre: 'Campeones General',
              valor: 90000,
              codigo: 'CAMP_GENERAL',
            },
            {
              nombre: 'Campeones Solo EVG/SAB',
              valor: 60000,
              codigo: 'CAMP_EVG_SAB',
            },
            {
              nombre: 'Arqueros Campeones EVG/SAB',
              valor: 120000,
              codigo: 'ARQ_CAMP_EVG_SAB',
            },
            {
              nombre: 'Arqueros General',
              valor: 160000,
              codigo: 'ARQ_GENERAL',
            },
          ],
          default_valor: 90000,
        },
        torneo: {
          nombre: 'Torneo',
          opciones: [
            {
              nombre: 'Punto y Coma',
              valor: 80000,
              codigo: 'PUNTO_COMA',
            },
            {
              nombre: 'JBC (Fútbol 7)',
              valor: 50000,
              codigo: 'JBC',
            },
            {
              nombre: 'INDESA 2026 I',
              valor: 120000,
              codigo: 'INDESA_2026_I',
            },
            {
              nombre: 'INDER Envigado',
              valor: 100000,
              codigo: 'INDER_ENVIGADO',
            },
          ],
        },
      },
      ciclo_cobro: {
        dia_inicio: 1,
        dia_primer_recordatorio: 7,
        dia_segundo_recordatorio: 25,
        dia_vencimiento: 30,
        dias_mora_alerta: 7,
        descripcion: 'Flujo automático de recordatorios vía WhatsApp',
      },
      canales_comunicacion: {
        whatsapp: {
          activo: true,
          proveedor: 'Twilio',
          numero: '+1234567890', // Masked
          sandbox: true,
        },
        email: {
          activo: false,
          proveedor: 'Gmail',
          nota: 'Próximamente',
        },
      },
      integraciones: {
        google_sheets: {
          activo: true,
          spreadsheet_id: '1oyrm3WeCXJbmxMhSWFjhnvpZ2XDr6DK9Dm__rLqO6gA',
        },
        make: {
          activo: true,
          flujo_recordatorios: true,
          flujo_pagos: true,
        },
      },
      limites: {
        max_jugadores: 100,
        max_torneos_simultaneos: 5,
        max_deuda_permitida_para_jugar: 500000,
      },
      estados_validos: {
        jugador: ['SI', 'NO'],
        mensualidad: ['AL_DIA', 'PARCIAL', 'PENDIENTE', 'MORA'],
        uniforme: ['AL_DIA', 'PARCIAL', 'PENDIENTE'],
        torneo: ['AL_DIA', 'PARCIAL', 'PENDIENTE'],
        revision: [
          'aprobado_automaticamente',
          'requiere_discriminacion',
          'concepto_no_especificado',
          'requiere_validacion_humana',
          'rechazado_por_fecha',
          'no_encontrado',
          'inactivo',
          'becado',
        ],
      },
      tipo_descuento: {
        NA: 'Sin descuento',
        DESCUENTO: 'Descuento aplicado',
        BECA: 'Beca completa (sin costo)',
      },
    };
    
    res.json(config);
  } catch (error) {
    console.error('Error in GET /config:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching config',
      message: error.message,
    });
  }
});

module.exports = router;
