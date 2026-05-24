const express = require('express');
const db = require('../services/db');
const router = express.Router();

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// GET /api/players?club_id=city-fc
router.get('/', async (req, res) => {
  try {
    const club_id = req.club_id;

    // Resolver el UUID del club a partir del slug (ej: 'city-fc')
    const club = await db.getClubBySlug(club_id);
    if (!club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const jugadores = await db.getPlayers(club.id);
    res.json({ success: true, total: jugadores.length, data: jugadores });
  } catch (error) {
    console.error('Error in GET /players:', error);
    res.status(500).json({ success: false, error: 'Error fetching players', message: error.message });
  }
});

// GET /api/players/:cedula?club_id=city-fc
router.get('/:cedula', async (req, res) => {
  try {
    const club_id = req.club_id;

    const club = await db.getClubBySlug(club_id);
    if (!club) {
      return res.status(404).json({ success: false, error: 'Club no encontrado' });
    }

    const jugador = await db.getPlayerByCedula(club.id, req.params.cedula);
    if (!jugador) {
      return res.status(404).json({ success: false, error: 'Jugador no encontrado' });
    }
    res.json({ success: true, data: jugador });
  } catch (error) {
    console.error('Error in GET /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error fetching player', message: error.message });
  }
});

// PATCH /api/players/:cedula?club_id=city-fc
router.patch('/:cedula', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const updated = await db.updatePlayer(club.id, req.params.cedula, req.body);

    // Si se modificó el descuento, recalcular la mensualidad del mes actual (si no está AL_DIA)
    if (req.body.descuento_pct !== undefined) {
      const mesActual  = new Date().getMonth() + 1;
      const anioActual = new Date().getFullYear();
      const valorMensual = Number(club.config?.valor_mensualidad ?? 65000);
      const nuevoPct     = Math.max(0, Math.min(100, Number(req.body.descuento_pct ?? 0)));
      const nuevoOficial = Math.round(valorMensual * (1 - nuevoPct / 100));

      const { data: mens } = await db.supabase
        .from('mensualidades')
        .select('id, valor_pagado, penalidad')
        .eq('club_id', club.id)
        .eq('cedula', req.params.cedula)
        .eq('numero_mes', mesActual)
        .eq('anio', anioActual)
        .neq('estado', 'AL_DIA')
        .maybeSingle();

      if (mens) {
        const penalidad  = Number(mens.penalidad   ?? 0);
        const pagado     = Number(mens.valor_pagado ?? 0);
        const nuevoSaldo = Math.max(0, nuevoOficial + penalidad - pagado);
        const nuevoEstado =
          nuevoOficial === 0 || pagado >= nuevoOficial + penalidad ? 'AL_DIA'
          : pagado > 0 ? 'PARCIAL'
          : 'PENDIENTE';

        await db.supabase.from('mensualidades').update({
          valor_oficial:   nuevoOficial,
          saldo_pendiente: nuevoSaldo,
          estado:          nuevoEstado,
        }).eq('id', mens.id);
      }
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error in PATCH /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error updating player', message: error.message });
  }
});

// POST /api/players/bulk?club_id=city-fc  — importación masiva desde Excel/CSV
router.post('/bulk', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { jugadores } = req.body;
    if (!Array.isArray(jugadores) || jugadores.length === 0) {
      return res.status(400).json({ success: false, error: 'Se requiere un array de jugadores no vacío' });
    }

    // Cédulas ya existentes en el club (una sola query)
    const { data: existing } = await db.supabase
      .from('players')
      .select('cedula')
      .eq('club_id', club.id);
    const existingSet = new Set((existing || []).map(p => String(p.cedula)));

    const errores = [];
    const filas   = [];

    jugadores.forEach((j, idx) => {
      const cedula    = String(j.cedula    || '').trim();
      const nombre    = String(j.nombre    || '').trim();
      const apellidos = String(j.apellidos || '').trim();
      const fila      = idx + 2;

      if (!cedula)               return errores.push({ fila, cedula: '—', error: 'Cédula requerida' });
      if (!nombre)               return errores.push({ fila, cedula, error: 'Nombre requerido' });
      if (existingSet.has(cedula)) return errores.push({ fila, cedula, nombre: `${nombre} ${apellidos}`.trim(), error: 'Cédula ya registrada' });

      existingSet.add(cedula);
      const str = (v) => String(v || '').trim() || null;
      const up  = (v) => { const s = str(v); return s ? s.toUpperCase() : null; };
      const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
      // Excel stores dates as serial numbers (days since 1900-01-00). Convert to ISO date.
      const excelDate = (v) => {
        if (!v) return null;
        const n = parseFloat(v);
        if (!isNaN(n) && n > 1000) {
          const d = new Date(Math.round((n - 25569) * 86400 * 1000));
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        }
        const s = String(v).trim();
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        return s || null;
      };
      filas.push({
        club_id:              club.id,
        cedula,
        nombre:               nombre.toUpperCase(),
        apellidos:            (apellidos || nombre).toUpperCase(),
        celular:              str(j.celular),
        correo_electronico:   str(j.correo_electronico)?.toLowerCase() || null,
        instagram:            str(j.instagram),
        tipo_id:              str(j.tipo_id),
        fecha_nacimiento:     excelDate(j.fecha_nacimiento),
        lugar_de_nacimiento:  up(j.lugar_de_nacimiento),
        tipo_sangre:          up(j.tipo_sangre),
        eps:                  up(j.eps),
        estatura:             num(j.estatura),
        peso:                 num(j.peso),
        municipio:            up(j.municipio),
        direccion:            up(j.direccion),
        barrio:               up(j.barrio),
        familiar_emergencia:  up(j.familiar_emergencia),
        celular_contacto:     str(j.celular_contacto),
        posicion:             up(j.posicion),
        numero_camiseta:      str(j.numero_camiseta),
        categoria:            up(j.categoria),
        equipo:               up(j.equipo),
        categorias:           j.categoria ? [{ categoria: up(j.categoria), equipo: up(j.equipo) || '' }] : [],
        activo:               true,
      });
    });

    let insertados = [];
    if (filas.length > 0) {
      insertados = await db.bulkInsert('players', filas);

      // Crear mensualidades y torneos para cada jugador insertado
      const CUOTA   = parseFloat(club.config?.valor_mensualidad) || 65000;
      const TORNEOS = Array.isArray(club.config?.torneos_iniciales) ? club.config.torneos_iniciales : [];
      const anioActual = new Date().getFullYear();
      const mesActual  = new Date().getMonth() + 1;

      const mensualidades = [];
      const torneos = [];

      for (const p of insertados) {
        for (let mes = 1; mes <= 12; mes++) {
          const esPasado = mes < mesActual;
          mensualidades.push({
            club_id:         club.id,
            player_id:       p.id,
            cedula:          String(p.cedula),
            anio:            anioActual,
            mes:             MESES[mes],
            numero_mes:      mes,
            valor_oficial:   esPasado ? 0 : CUOTA,
            valor_pagado:    0,
            saldo_pendiente: esPasado ? 0 : CUOTA,
            estado:          esPasado ? 'AL_DIA' : 'PENDIENTE',
          });
        }
        for (const t of TORNEOS) {
          torneos.push({
            club_id:         club.id,
            player_id:       p.id,
            cedula:          String(p.cedula),
            nombre_torneo:   t.nombre,
            valor_oficial:   parseFloat(t.valor) || 0,
            valor_pagado:    0,
            saldo_pendiente: parseFloat(t.valor) || 0,
            estado:          'PENDIENTE',
          });
        }
      }

      if (mensualidades.length > 0) await db.bulkInsert('mensualidades', mensualidades);
      if (torneos.length > 0)       await db.bulkInsert('torneos', torneos);
    }

    res.json({
      success:        true,
      total:          jugadores.length,
      insertados:     insertados.length,
      errores:        errores.length,
      detalle_errores: errores,
    });
  } catch (error) {
    console.error('Error in POST /players/bulk:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/players/:cedula?club_id=city-fc  — desactiva el jugador (soft delete)
router.delete('/:cedula', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, req.params.cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Jugador no encontrado' });

    await db.deletePlayer(club.id, req.params.cedula);
    res.json({ success: true, mensaje: 'Jugador eliminado correctamente' });
  } catch (error) {
    console.error('Error in DELETE /players/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error eliminando jugador', message: error.message });
  }
});

module.exports = router;
