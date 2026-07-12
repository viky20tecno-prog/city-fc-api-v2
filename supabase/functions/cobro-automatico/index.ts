import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WAHA_URL                  = Deno.env.get('WAHA_URL') || '';
const WAHA_API_KEY              = Deno.env.get('WAHA_API_KEY') || '';
const WAHA_SESSION              = Deno.env.get('WAHA_SESSION') || 'default';

const DEFAULT_PENALIDAD_MORA    = 10_000;
const DEFAULT_VALOR_MENSUALIDAD = 65_000;

// ─── Entry point ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const hoy = new Date();
  const body = await req.json().catch(() => ({}));

  // dia_override permite simular cualquier día para pruebas (ej: {"dia_override": 8})
  // test_cedula filtra a un solo jugador — solo para pruebas, nunca en producción
  const dia         = body.dia_override  ?? hoy.getDate();
  const mes         = body.mes_override  ?? (hoy.getMonth() + 1);
  const anio        = body.anio_override ?? hoy.getFullYear();
  const testCedula  = body.test_cedula   ?? null;

  try {
    const { data: clubs, error: clubsErr } = await supabase
      .from('clubs')
      .select('id, slug, config')
      .eq('is_active', true);

    if (clubsErr) throw clubsErr;
    if (!clubs?.length) {
      return json({ success: true, mensaje: 'Sin clubes activos' });
    }

    const resultados = await Promise.allSettled(
      clubs.map(club => procesarClub(supabase, club, dia, mes, anio, testCedula))
    );

    const resumen = resultados.map((r, i) => ({
      club: clubs[i].slug,
      ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
    }));

    return json({ success: true, dia, mes, anio, resumen });
  } catch (err) {
    console.error('[cobro-automatico] Error global:', err);
    return json({ success: false, error: err.message }, 500);
  }
});

// ─── Lógica por club ─────────────────────────────────────────────────────────
async function procesarClub(
  supabase: ReturnType<typeof createClient>,
  club: { id: string; slug: string; config?: Record<string, unknown> },
  dia: number,
  mes: number,
  anio: number,
  testCedula: string | null = null,
) {
  const clubSession   = String(club.config?.waha_session ?? '');
  // Sin sesión propia: el club no ha conectado su WhatsApp → no enviar mensajes masivos
  if (!clubSession) {
    console.log(`[cobro-automatico] Club ${club.slug} sin waha_session — mensajes omitidos`);
    return { mensajes: 0, mora_aplicada: 0, mensualidades_creadas: 0 };
  }

  const valorMensual  = Number(club.config?.valor_mensualidad ?? DEFAULT_VALOR_MENSUALIDAD);
  const penalidad     = Number(club.config?.penalidad_mora    ?? DEFAULT_PENALIDAD_MORA);
  const llavePago     = String(club.config?.llave_pago        ?? '');
  const qrPagoUrl     = String(club.config?.qr_pago_url       ?? '');
  const nombreClub    = String(club.config?.nombre            ?? club.slug);
  const stats         = { mensajes: 0, mora_aplicada: 0, mensualidades_creadas: 0 };

  const diaCobro      = Math.min(25, Math.max(1, Number(club.config?.dia_cobro      ?? 1)));
  const diasGracia    = Math.max(1,              Number(club.config?.dias_gracia_mora ?? 7));
  const diaPreventivo = diaCobro > 4 ? diaCobro - 4 : 27;
  const diaRecord     = diaCobro + 3;
  const diaVenc       = diaCobro + diasGracia - 1;
  const diaMora       = diaCobro + diasGracia;
  const diaReenganche = diaCobro + diasGracia + 1;

  // Jugadores activos con celular (test_cedula restringe a uno solo en pruebas)
  let query = supabase
    .from('players')
    .select('id, cedula, nombre, apellidos, celular, descuento_pct')
    .eq('club_id', club.id)
    .eq('activo', true)
    .not('celular', 'is', null);
  if (testCedula) query = query.eq('cedula', testCedula);
  const { data: jugadores } = await query;

  if (!jugadores?.length) return stats;

  // ── DÍA (diaCobro - 4 ó 27) — Preventivo (para el mes SIGUIENTE) ─────────
  if (dia === diaPreventivo) {
    const mesDest  = (diaPreventivo >= diaCobro || diaCobro <= 4) ? (mes === 12 ? 1 : mes + 1) : mes;
    const anioDest = mesDest === 1 && mes === 12 ? anio + 1 : anio;
    const nombreM  = mesTexto(mesDest);

    for (const j of jugadores) {
      if (await yaEnviado(supabase, club.id, j.cedula, 'preventivo', mesDest, anioDest)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `⚽ *${nombreClub} te avisa con tiempo*\n\n` +
        `Hola ${nombre}, tu cuota de *${nombreM} ${anioDest}* se activará el día ${diaCobro}.\n\n` +
        `💰 Valor: *$${valorMensual.toLocaleString('es-CO')}*\n\n` +
        `⏳ Organízate desde ya y evita recargos innecesarios.\n\n` +
        `En ${nombreClub} jugamos en equipo… y estar al día es parte del juego 💙⚽`,
        clubSession, false, qrPagoUrl,
      );
      await logEnvio(supabase, club.id, j.cedula, 'preventivo', mesDest, anioDest);
      stats.mensajes++;
    }
  }

  // ── DÍA diaCobro — Cobro activo: generar mensualidades + avisar ──────────
  if (dia === diaCobro) {
    const nombreM = mesTexto(mes);

    for (const j of jugadores) {
      const { data: existente } = await supabase
        .from('mensualidades')
        .select('id')
        .eq('club_id', club.id)
        .eq('cedula', j.cedula)
        .eq('numero_mes', mes)
        .eq('anio', anio)
        .maybeSingle();

      const descuento    = Number(j.descuento_pct ?? 0);
      const valorJugador = Math.round(valorMensual * (1 - descuento / 100));
      const estadoInicial = valorJugador === 0 ? 'AL_DIA' : 'PENDIENTE';

      if (!existente) {
        await supabase.from('mensualidades').insert({
          club_id:         club.id,
          cedula:          j.cedula,
          numero_mes:      mes,
          mes:             nombreM,
          anio,
          valor_oficial:   valorJugador,
          valor_pagado:    0,
          saldo_pendiente: valorJugador,
          estado:          estadoInicial,
          penalidad:       0,
        });
        stats.mensualidades_creadas++;
      }

      // Jugadores con beca completa no reciben aviso de cobro
      if (estadoInicial === 'AL_DIA') continue;

      if (await yaEnviado(supabase, club.id, j.cedula, 'activacion', mes, anio)) continue;
      const nombre = nombreCompleto(j);
      const textoValor = descuento > 0
        ? `$${valorJugador.toLocaleString('es-CO')} *(beca ${descuento}%)*`
        : `$${valorJugador.toLocaleString('es-CO')}`;
      await enviarWA(j.celular,
        `📢⚽ *${nombreClub} — Cuota activa*\n\n` +
        `Hola ${nombre}, tu cuota de *${nombreM}* ya está activa.\n\n` +
        `💰 Valor: *${textoValor}*\n` +
        `📅 Tienes hasta el *día ${diaVenc}* para pagar sin penalidad\n\n` +
        (llavePago ? `📲 Paga con la llave:\n🔑 ${llavePago}\n\n` : '') +
        `💪 Paga hoy y juega tranquilo todo el mes ⚽🔥`,
        clubSession, !!qrPagoUrl, qrPagoUrl,
      );
      await logEnvio(supabase, club.id, j.cedula, 'activacion', mes, anio);
      stats.mensajes++;
    }
  }

  // ── DÍA diaRecord — Recordatorio: solo quienes NO han pagado ─────────────
  if (dia === diaRecord) {
    const pendientes = await jugadoresConDeuda(supabase, club.id, jugadores, mes, anio);
    const nombreM    = mesTexto(mes);

    for (const j of pendientes) {
      if (await yaEnviado(supabase, club.id, j.cedula, 'recordatorio', mes, anio)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `⏰⚽ *${nombreClub} te recuerda*\n\n` +
        `Hola ${nombre}, te quedan *3 días* para pagar tu cuota de *${nombreM}*.\n\n` +
        `💰 Valor: *$${valorMensual.toLocaleString('es-CO')}*\n` +
        `⚠️ Evita una penalidad de *$${penalidad.toLocaleString('es-CO')}*\n\n` +
        (llavePago ? `📲 Paga con la llave:\n🔑 ${llavePago}\n\n` : '') +
        `🔥 No lo dejes para el último minuto… el equipo cuenta contigo ⚽💪`,
        clubSession, !!qrPagoUrl, qrPagoUrl,
      );
      await logEnvio(supabase, club.id, j.cedula, 'recordatorio', mes, anio);
      stats.mensajes++;
    }
  }

  // ── DÍA diaVenc — Vencimiento: último aviso antes de mora ────────────────
  if (dia === diaVenc) {
    const pendientes = await jugadoresConDeuda(supabase, club.id, jugadores, mes, anio);
    const nombreM    = mesTexto(mes);

    for (const j of pendientes) {
      if (await yaEnviado(supabase, club.id, j.cedula, 'vencimiento', mes, anio)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `🚨⚽ *HOY es el último día — ${nombreClub}*\n\n` +
        `Hola ${nombre}, hoy vence tu cuota de *${nombreM}*.\n\n` +
        `💰 Valor: *$${valorMensual.toLocaleString('es-CO')}*\n` +
        `⚠️ Mañana tendrás penalidad de *$${penalidad.toLocaleString('es-CO')}*\n\n` +
        (llavePago ? `📲 Paga con la llave:\n🔑 ${llavePago}\n\n` : '') +
        `⏳ Estás a una jugada de seguir al día… no pierdas este partido ⚽🔥`,
        clubSession, !!qrPagoUrl, qrPagoUrl,
      );
      await logEnvio(supabase, club.id, j.cedula, 'vencimiento', mes, anio);
      stats.mensajes++;
    }
  }

  // ── DÍA diaMora — Mora: aplicar penalidad + notificar jugador + alertar admin ──
  if (dia === diaMora) {
    const pendientes = await jugadoresConDeuda(supabase, club.id, jugadores, mes, anio);
    const nombreM    = mesTexto(mes);
    const morosos: string[] = [];

    for (const j of pendientes) {
      const { data: mens } = await supabase
        .from('mensualidades')
        .select('id, valor_oficial, valor_pagado, penalidad, estado')
        .eq('club_id', club.id)
        .eq('cedula', j.cedula)
        .eq('numero_mes', mes)
        .eq('anio', anio)
        .maybeSingle();

      if (!mens || mens.estado === 'AL_DIA') continue;

      const penActual = parseFloat(mens.penalidad) || 0;
      if (penActual === 0) {
        const oficial    = parseFloat(mens.valor_oficial) || 0;
        const yaPageado  = parseFloat(mens.valor_pagado)  || 0;
        const nuevoSaldo = Math.max(0, oficial + penalidad - yaPageado);
        await supabase.from('mensualidades').update({
          estado:                     'MORA',
          penalidad:                  penalidad,
          saldo_pendiente:            nuevoSaldo,
          fecha_ultima_actualizacion: new Date().toISOString(),
        }).eq('id', mens.id);
        stats.mora_aplicada++;
      }

      morosos.push(nombreCompleto(j));

      if (await yaEnviado(supabase, club.id, j.cedula, 'mora', mes, anio)) continue;
      const nombre     = nombreCompleto(j);
      const oficial    = parseFloat(mens.valor_oficial) || 0;
      const totalDeuda = (oficial + penalidad).toLocaleString('es-CO');
      await enviarWA(j.celular,
        `🚫⚽ *${nombreClub} — Estado en mora*\n\n` +
        `Hola ${nombre}, tu cuota de *${nombreM} ${anio}* ya está vencida.\n\n` +
        `💰 Total a pagar: *$${totalDeuda}*\n` +
        `(incluye penalidad de $${penalidad.toLocaleString('es-CO')})\n\n` +
        (llavePago ? `📲 Paga con la llave:\n🔑 ${llavePago}\n\n` : '') +
        `🔁 Entre más pronto pagues, más rápido vuelves al juego ⚽`,
        clubSession, !!qrPagoUrl, qrPagoUrl,
      );
      await logEnvio(supabase, club.id, j.cedula, 'mora', mes, anio);
      stats.mensajes++;
    }

    if (morosos.length > 0) {
      const { data: clubData } = await supabase
        .from('clubs')
        .select('celular_admin')
        .eq('id', club.id)
        .maybeSingle();

      if (clubData?.celular_admin) {
        await enviarWA(clubData.celular_admin,
          `📊 *Reporte mora — ${nombreM} ${anio} · ${nombreClub}*\n\n` +
          `*${morosos.length} jugador${morosos.length > 1 ? 'es' : ''}* en mora:\n\n` +
          morosos.map(n => `• ${n}`).join('\n') + '\n\n' +
          `Gestiona los cobros desde el dashboard. 💼`,
          clubSession,
        );
        stats.mensajes++;
      }
    }
  }

  // ── DÍA diaReenganche — Reenganche: 24h después de mora ─────────────────
  if (dia === diaReenganche) {
    const enMora  = await jugadoresEnMora(supabase, club.id, jugadores, mes, anio);
    const nombreM = mesTexto(mes);

    for (const j of enMora) {
      if (await yaEnviado(supabase, club.id, j.cedula, 'reenganche', mes, anio)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `⚽🔥 *${nombre}, vuelve al juego con ${nombreClub}*\n\n` +
        `Eres parte del equipo y te queremos en la cancha 💙\n\n` +
        `No dejes que una cuota te saque del partido.\n\n` +
        (llavePago ? `📲 Paga con la llave:\n🔑 ${llavePago}\n\n` : '') +
        `🚀 Un pago hoy, cero preocupaciones mañana\n\n` +
        `💪 ${nombreClub} sigue contando contigo ⚽🔥💯`,
        clubSession, !!qrPagoUrl, qrPagoUrl,
      );
      await logEnvio(supabase, club.id, j.cedula, 'reenganche', mes, anio);
      stats.mensajes++;
    }
  }

  return stats;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Cédulas con una suspensión ACTIVA (si se cancela, la deuda del mes vuelve a contar —
// criterio unificado con el resto del proyecto) que cubre ese mes/año exacto.
async function cedulasSuspendidasEnMes(
  supabase: ReturnType<typeof createClient>,
  club_id: string,
  mes: number,
  anio: number,
): Promise<Set<string>> {
  const { data: susp } = await supabase
    .from('suspensiones')
    .select('cedula, mes_inicio, mes_fin')
    .eq('club_id', club_id)
    .eq('activa', true)
    .eq('anio', anio);

  return new Set(
    (susp || [])
      .filter((s: { mes_inicio: number; mes_fin: number }) => s.mes_inicio <= mes && mes <= s.mes_fin)
      .map((s: { cedula: string }) => s.cedula)
  );
}

async function jugadoresConDeuda(
  supabase: ReturnType<typeof createClient>,
  club_id: string,
  jugadores: { cedula: string }[],
  mes: number,
  anio: number,
) {
  const [{ data: mens }, suspendidas] = await Promise.all([
    supabase
      .from('mensualidades')
      .select('cedula')
      .eq('club_id', club_id)
      .eq('numero_mes', mes)
      .eq('anio', anio)
      .neq('estado', 'AL_DIA'),
    cedulasSuspendidasEnMes(supabase, club_id, mes, anio),
  ]);

  const cedulasDeuda = new Set(
    (mens || [])
      .map((m: { cedula: string }) => m.cedula)
      .filter((cedula: string) => !suspendidas.has(cedula))
  );
  return jugadores.filter(j => cedulasDeuda.has(j.cedula));
}

async function jugadoresEnMora(
  supabase: ReturnType<typeof createClient>,
  club_id: string,
  jugadores: { cedula: string }[],
  mes: number,
  anio: number,
) {
  const [{ data: mens }, suspendidas] = await Promise.all([
    supabase
      .from('mensualidades')
      .select('cedula')
      .eq('club_id', club_id)
      .eq('numero_mes', mes)
      .eq('anio', anio)
      .eq('estado', 'MORA'),
    cedulasSuspendidasEnMes(supabase, club_id, mes, anio),
  ]);

  const cedulasMora = new Set(
    (mens || [])
      .map((m: { cedula: string }) => m.cedula)
      .filter((cedula: string) => !suspendidas.has(cedula))
  );
  return jugadores.filter(j => cedulasMora.has(j.cedula));
}

async function yaEnviado(
  supabase: ReturnType<typeof createClient>,
  club_id: string,
  cedula: string,
  tipo_mensaje: string,
  mes: number,
  anio: number,
): Promise<boolean> {
  const { data } = await supabase
    .from('wa_log_envios')
    .select('id')
    .eq('club_id', club_id)
    .eq('cedula', cedula)
    .eq('tipo_mensaje', tipo_mensaje)
    .eq('mes', mes)
    .eq('anio', anio)
    .maybeSingle();
  return !!data;
}

async function logEnvio(
  supabase: ReturnType<typeof createClient>,
  club_id: string,
  cedula: string,
  tipo_mensaje: string,
  mes: number,
  anio: number,
) {
  await supabase.from('wa_log_envios').insert({ club_id, cedula, tipo_mensaje, mes, anio });
}

async function enviarWA(celular: string, body: string, session: string, _conQR = false, _qrUrl = '') {
  if (!WAHA_URL) throw new Error('WAHA_URL no configurado');
  const numero = String(celular).replace(/\D/g, '').replace(/^57/, '');
  const chatId = `57${numero}@c.us`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
  const res = await fetch(`${WAHA_URL}/api/sendText`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ chatId, text: body, session }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WAHA ${res.status}: ${err}`);
  }
  console.log('[cobro-automatico] WA enviado a', chatId);
}

function nombreCompleto(j: { nombre?: string; apellidos?: string }) {
  return `${j.nombre || ''} ${j.apellidos || ''}`.trim();
}

function mesTexto(mes: number): string {
  const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return meses[mes] ?? 'Mes';
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
