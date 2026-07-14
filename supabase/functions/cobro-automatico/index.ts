import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const DEFAULT_PENALIDAD_MORA    = 10_000;
const DEFAULT_VALOR_MENSUALIDAD = 65_000;

// El envío de WhatsApp se sacó de este ciclo (el bulk-send diario contribuía al baneo del
// número — ver historial de commits de este archivo). Esta función ahora SOLO hace lo
// financiero: generar la mensualidad del mes y aplicar mora + penalidad en la fecha que
// corresponda. El aviso al jugador quedó a cargo del admin, manual y uno a uno, desde la
// pantalla de Estado de cuenta (api/routes/players.js: estado-cuenta-lista).
// Por eso también se quitó el guard de "club sin waha_session → se omite" — generar la
// mensualidad y aplicar mora ya no depende de si el club tiene WhatsApp conectado.

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
  const valorMensual = Number(club.config?.valor_mensualidad ?? DEFAULT_VALOR_MENSUALIDAD);
  const penalidad    = Number(club.config?.penalidad_mora    ?? DEFAULT_PENALIDAD_MORA);
  const stats         = { mensualidades_creadas: 0, mora_aplicada: 0 };

  const diaCobro   = Math.min(25, Math.max(1, Number(club.config?.dia_cobro       ?? 1)));
  const diasGracia = Math.max(1,              Number(club.config?.dias_gracia_mora ?? 7));
  const diaMora    = diaCobro + diasGracia;

  // Jugadores activos (test_cedula restringe a uno solo en pruebas)
  let query = supabase
    .from('players')
    .select('id, cedula, nombre, apellidos, descuento_pct')
    .eq('club_id', club.id)
    .eq('activo', true);
  if (testCedula) query = query.eq('cedula', testCedula);
  const { data: jugadores } = await query;

  if (!jugadores?.length) return stats;

  // ── DÍA diaCobro — Generar la mensualidad del mes si no existe ───────────
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

      if (existente) continue;

      const descuento     = Number(j.descuento_pct ?? 0);
      const valorJugador  = Math.round(valorMensual * (1 - descuento / 100));
      const estadoInicial = valorJugador === 0 ? 'AL_DIA' : 'PENDIENTE';

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
  }

  // ── DÍA diaMora — Aplicar mora + penalidad (guard anti-duplicado) ────────
  if (dia === diaMora) {
    const pendientes = await jugadoresConDeuda(supabase, club.id, jugadores, mes, anio);

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
      if (penActual > 0) continue; // ya se le aplicó la mora de este mes

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
