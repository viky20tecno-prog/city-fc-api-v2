const express = require('express');
const XLSX = require('xlsx');
const db = require('../services/db');
const { MESES } = require('../services/meses');
const router = express.Router();

// GET /api/invoices?club_id=city-fc&status=PENDIENTE&mes=4&anio=2026
router.get('/', async (req, res) => {
  try {
    const { status, mes, anio = 2026 } = req.query;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    // Auto-marcar vencidos antes de devolver datos (fire-and-forget)
    db.marcarMensualidadesVencidas(club.id, club.config?.dias_gracia_mora ?? 0).catch(e => console.error('[invoices] marcarVencidos:', e.message));

    let invoices = await db.getMensualidades(club.id);
    invoices = invoices.filter(inv => String(inv.anio) === String(anio));
    if (mes) invoices = invoices.filter(inv => String(inv.numero_mes) === String(mes));
    if (status) invoices = invoices.filter(inv => inv.estado === status);

    const stats = {
      total_invoices: invoices.length,
      total_oficial: invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_oficial) || 0), 0),
      total_pagado: invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_pagado) || 0), 0),
      total_pendiente: invoices.reduce((sum, inv) => sum + (parseFloat(inv.saldo_pendiente) || 0), 0),
      por_estado: {
        AL_DIA:    invoices.filter(inv => inv.estado === 'AL_DIA').length,
        PENDIENTE: invoices.filter(inv => inv.estado === 'PENDIENTE').length,
        PARCIAL:   invoices.filter(inv => inv.estado === 'PARCIAL').length,
        MORA:      invoices.filter(inv => inv.estado === 'MORA').length,
      }
    };

    res.json({
      success: true,
      club_id: req.club_id,
      stats,
      filters: { status: status || 'TODOS', mes: mes || 'TODOS', anio },
      data: invoices,
    });
  } catch (error) {
    console.error('Error in GET /invoices:', error);
    res.status(500).json({ success: false, error: 'Error fetching invoices', message: error.message });
  }
});

// GET /api/invoices/uniformes
router.get('/uniformes', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getUniformes(club.id);
    res.json({ success: true, total: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error fetching uniform status', message: error.message });
  }
});

// GET /api/invoices/torneos
router.get('/torneos', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });
    const data = await db.getTorneos(club.id);
    res.json({ success: true, total: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error fetching tournament status', message: error.message });
  }
});

// GET /api/invoices/player/:cedula
router.get('/player/:cedula', async (req, res) => {
  try {
    const { cedula } = req.params;

    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const player = await db.getPlayerByCedula(club.id, cedula);
    if (!player) return res.status(404).json({ success: false, error: 'Player not found', cedula });

    const invoices = await db.getMensualidades(club.id, cedula);

    const invoicesByYear = {};
    invoices.forEach(inv => {
      if (!invoicesByYear[inv.anio]) invoicesByYear[inv.anio] = [];
      invoicesByYear[inv.anio].push({
        mes: inv.mes,
        numero_mes: inv.numero_mes,
        valor_oficial: parseFloat(inv.valor_oficial) || 0,
        valor_pagado: parseFloat(inv.valor_pagado) || 0,
        saldo_pendiente: parseFloat(inv.saldo_pendiente) || 0,
        estado: inv.estado,
        fecha_ultima_actualizacion: inv.fecha_ultima_actualizacion || '',
      });
    });
    Object.keys(invoicesByYear).forEach(year => {
      invoicesByYear[year].sort((a, b) => a.numero_mes - b.numero_mes);
    });

    const totalOficial   = invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_oficial) || 0), 0);
    const totalPagado    = invoices.reduce((sum, inv) => sum + (parseFloat(inv.valor_pagado) || 0), 0);
    const totalPendiente = invoices.reduce((sum, inv) => sum + (parseFloat(inv.saldo_pendiente) || 0), 0);

    res.json({
      success: true,
      club_id: req.club_id,
      player: {
        cedula: player.cedula,
        nombre_completo: `${player.nombre || ''} ${player.apellidos || ''}`.trim(),
      },
      summary: {
        total_meses: invoices.length,
        total_oficial: totalOficial,
        total_pagado: totalPagado,
        total_pendiente: totalPendiente,
        porcentaje_pagado: totalOficial > 0 ? Math.round((totalPagado / totalOficial) * 100) : 0,
      },
      invoices_by_year: invoicesByYear,
    });
  } catch (error) {
    console.error('Error in GET /invoices/player/:cedula:', error);
    res.status(500).json({ success: false, error: 'Error fetching player invoices', message: error.message });
  }
});

// PATCH /api/invoices/mensualidad/:id — editar mensualidad manualmente
router.patch('/mensualidad/:id', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { valor_oficial, valor_pagado, estado, penalidad } = req.body;
    const ESTADOS = ['AL_DIA', 'PENDIENTE', 'PARCIAL', 'MORA'];
    if (estado && !ESTADOS.includes(estado))
      return res.status(400).json({ success: false, error: 'estado inválido' });

    const oficial  = valor_oficial !== undefined ? parseFloat(valor_oficial) : undefined;
    const pagado   = valor_pagado  !== undefined ? parseFloat(valor_pagado)  : undefined;
    const penal    = penalidad     !== undefined ? Math.max(0, parseFloat(penalidad) || 0) : undefined;

    const updates = {};
    if (oficial !== undefined) updates.valor_oficial = oficial;
    if (pagado  !== undefined) updates.valor_pagado  = pagado;
    if (penal   !== undefined) updates.penalidad     = penal;
    if (oficial !== undefined || pagado !== undefined || penal !== undefined) {
      const { data: actual } = await db.supabase
        .from('mensualidades').select('valor_oficial,valor_pagado,penalidad').eq('id', req.params.id).single();
      const vOficial = oficial ?? parseFloat(actual?.valor_oficial) ?? 0;
      const vPagado  = pagado  ?? parseFloat(actual?.valor_pagado)  ?? 0;
      updates.saldo_pendiente = Math.max(0, vOficial - vPagado);
      if (!estado) updates.estado = vPagado >= vOficial ? 'AL_DIA' : vPagado > 0 ? 'PARCIAL' : 'PENDIENTE';
    }
    if (estado) updates.estado = estado;

    const updated = await db.updateMensualidad(req.params.id, updates);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('PATCH /invoices/mensualidad/:id', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices/generar-anio
// Crea los registros faltantes de mensualidades para el año indicado.
// Body opcional: { anio: 2027, nueva_cuota: 70000 }
//   - anio:        año a generar (default = año en curso)
//   - nueva_cuota: si se envía, actualiza clubs.config.valor_mensualidad primero
// Solo inserta filas que no existan ya (idempotente).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generar-anio', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { anio: anioParam, nueva_cuota } = req.body || {};
    const anio = anioParam ? parseInt(anioParam) : new Date().getFullYear();

    // Si viene nueva cuota → actualizarla en el config del club antes de generar
    let cuotaFinal = parseFloat(club.config?.valor_mensualidad ?? 0);
    if (nueva_cuota !== undefined && nueva_cuota !== null) {
      cuotaFinal = Math.max(0, parseFloat(nueva_cuota) || 0);
      const nuevoConfig = { ...(club.config || {}), valor_mensualidad: cuotaFinal };
      const { error: cfgErr } = await db.supabase
        .from('clubs').update({ config: nuevoConfig }).eq('id', club.id);
      if (cfgErr) throw cfgErr;
    }

    const players = await db.getPlayers(club.id);
    if (!players.length) return res.json({ success: true, creados: 0, message: 'No hay jugadores activos' });

    // Obtener mensualidades existentes para el año objetivo
    const existentes = await db.getMensualidades(club.id);
    const existentesAnio = existentes.filter(m => String(m.anio) === String(anio));

    // Índice: "cedula-mes"
    const yaExiste = new Set(existentesAnio.map(m => `${m.cedula}-${m.numero_mes}`));

    const nuevas = [];
    for (const p of players) {
      for (let mes = 1; mes <= 12; mes++) {
        const key = `${p.cedula}-${mes}`;
        if (yaExiste.has(key)) continue;

        // Descuento individual del jugador (descuento_pct es porcentaje)
        const descuentoPct = parseFloat(p.descuento_pct) || 0;
        const oficial      = Math.max(0, cuotaFinal * (1 - descuentoPct / 100));

        nuevas.push({
          club_id:         club.id,
          player_id:       p.id,
          cedula:          String(p.cedula),
          anio,
          mes:             MESES[mes],
          numero_mes:      mes,
          valor_oficial:   oficial,
          valor_pagado:    0,
          saldo_pendiente: oficial,
          estado:          'PENDIENTE',
        });
      }
    }

    if (nuevas.length > 0) await db.bulkInsert('mensualidades', nuevas);

    res.json({
      success: true,
      anio,
      jugadores: players.length,
      creados: nuevas.length,
      omitidos: players.length * 12 - nuevas.length,
      cuota_usada: cuotaFinal,
      cuota_actualizada: nueva_cuota !== undefined && nueva_cuota !== null,
      message: `${nuevas.length} mensualidades creadas para ${anio} con cuota $${cuotaFinal.toLocaleString('es-CO')}`,
    });
  } catch (err) {
    console.error('POST /invoices/generar-anio', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/invoices/plantilla-excel
// Descarga un Excel con todos los jugadores y sus estados actuales por mes.
// El presidente lo llena con los valores pagados y lo sube de vuelta.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/plantilla-excel', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const anio    = parseInt(req.query.anio) || new Date().getFullYear();
    const CUOTA   = parseFloat(club.config?.valor_mensualidad ?? 0);
    const players = await db.getPlayers(club.id);
    players.sort((a, b) => {
      const na = `${a.nombre} ${a.apellidos}`.toLowerCase();
      const nb = `${b.nombre} ${b.apellidos}`.toLowerCase();
      return na.localeCompare(nb);
    });

    const existentes = await db.getMensualidades(club.id);
    const porJugadorMes = {};
    existentes.filter(m => String(m.anio) === String(anio)).forEach(m => {
      porJugadorMes[`${m.cedula}-${m.numero_mes}`] = m;
    });

    // Solo meses transcurridos hasta hoy — los futuros los maneja el flujo automático
    const mesActual  = new Date().getMonth() + 1; // 1-12
    const mesesAbrev = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const mesesActivos = mesesAbrev.slice(0, mesActual); // ['Ene','Feb','Mar','Abr','May']

    const headers = ['Cedula', 'Nombre', 'Apellidos', 'Categoria', 'Cuota_Oficial',
      ...mesesActivos.map(m => `${m}_pagado`),
    ];

    // Fila de instrucciones
    const instrucciones = [
      `** Llena solo las columnas *_pagado (${mesesActivos.join(', ')}) con el monto real pagado. Deja 0 si no pagó. **`,
      '', '', '', '',
      ...Array(mesActual).fill(''),
    ];

    const rows = [instrucciones, headers];

    for (const p of players) {
      const descuento = parseFloat(p.descuento_mensualidad) || 0;
      const cuotaReal = Math.max(0, CUOTA - descuento);
      const row = [
        String(p.cedula),
        p.nombre || '',
        p.apellidos || '',
        p.categoria || '',
        cuotaReal,
      ];

      // Solo columnas de meses activos
      for (let mes = 1; mes <= mesActual; mes++) {
        const inv = porJugadorMes[`${p.cedula}-${mes}`];
        row.push(inv ? (parseFloat(inv.valor_pagado) || 0) : 0);
      }

      rows.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Anchos de columna
    ws['!cols'] = [
      { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 14 },
      ...Array(mesActual).fill({ wch: 11 }),
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Mensualidades ${anio}`);

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const nombreClub = (club.config?.nombre || club.slug).replace(/\s+/g, '-').toLowerCase();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="mensualidades-${nombreClub}-${anio}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('GET /invoices/plantilla-excel', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/invoices/importar-estados
// Recibe filas del Excel y actualiza/crea mensualidades en bulk.
// Body: { anio: 2026, filas: [{ cedula, mes_1, mes_2, ..., mes_12 }] }
// Cada mes_N contiene el valor pagado.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/importar-estados', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const { anio = new Date().getFullYear(), filas } = req.body;
    if (!Array.isArray(filas) || filas.length === 0)
      return res.status(400).json({ success: false, error: 'Faltan filas para importar' });

    const CUOTA   = parseFloat(club.config?.valor_mensualidad ?? 0);
    const players = await db.getPlayers(club.id);
    const playerMap = {};
    players.forEach(p => { playerMap[String(p.cedula)] = p; });

    const existentes = await db.getMensualidades(club.id);
    const existentesAnio = existentes.filter(m => String(m.anio) === String(anio));
    const invMap = {};
    existentesAnio.forEach(m => { invMap[`${m.cedula}-${m.numero_mes}`] = m; });

    const resultados = { actualizados: 0, creados: 0, omitidos: 0, errores: [] };

    for (const fila of filas) {
      const cedula = String(fila.cedula || '').trim();
      if (!cedula) { resultados.omitidos++; continue; }

      const player = playerMap[cedula];
      if (!player) {
        resultados.errores.push({ cedula, error: 'Jugador no encontrado' });
        continue;
      }

      const descuentoPct = parseFloat(player.descuento_pct) || 0;
      const oficial      = Math.max(0, CUOTA * (1 - descuentoPct / 100));

      // Solo procesar meses hasta el actual — los futuros los maneja el flujo automático
      const mesActual = new Date().getMonth() + 1;
      for (let mes = 1; mes <= mesActual; mes++) {
        const valorPagado = parseFloat(fila[`mes_${mes}`]) || 0;
        const saldo       = Math.max(0, oficial - valorPagado);
        const estado      = valorPagado >= oficial ? 'AL_DIA' : valorPagado > 0 ? 'PARCIAL' : 'PENDIENTE';

        const key = `${cedula}-${mes}`;
        const inv = invMap[key];

        try {
          if (inv) {
            await db.updateMensualidad(inv.id, {
              valor_oficial:   oficial,
              valor_pagado:    valorPagado,
              saldo_pendiente: saldo,
              estado,
            });
            resultados.actualizados++;
          } else {
            await db.bulkInsert('mensualidades', [{
              club_id:         club.id,
              player_id:       player.id,
              cedula:          cedula,
              anio:            Number(anio),
              mes:             MESES[mes],
              numero_mes:      mes,
              valor_oficial:   oficial,
              valor_pagado:    valorPagado,
              saldo_pendiente: saldo,
              estado,
            }]);
            resultados.creados++;
          }
        } catch (e) {
          resultados.errores.push({ cedula, mes, error: e.message });
        }
      }
    }

    res.json({
      success: true,
      anio,
      ...resultados,
      message: `${resultados.actualizados} actualizados, ${resultados.creados} creados`,
    });
  } catch (err) {
    console.error('POST /invoices/importar-estados', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/invoices/marcar-vencidos
// Convierte a MORA todos los PENDIENTE de meses anteriores al actual
router.post('/marcar-vencidos', async (req, res) => {
  try {
    const club = await db.getClubBySlug(req.club_id);
    if (!club) return res.status(404).json({ success: false, error: 'Club no encontrado' });

    const actualizados = await db.marcarMensualidadesVencidas(club.id, club.config?.dias_gracia_mora ?? 0);
    res.json({ success: true, actualizados, message: `${actualizados} mensualidades marcadas como MORA` });
  } catch (err) {
    console.error('POST /invoices/marcar-vencidos', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
