import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID        = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_WHATSAPP_FROM      = Deno.env.get('TWILIO_WHATSAPP_FROM') || 'whatsapp:+14155238886';

const PENALIDAD_MORA    = 10_000;
const VALOR_MENSUALIDAD = 65_000; // fallback si el club no tiene config

// ─── Entry point ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const hoy = new Date();
  const body = await req.json().catch(() => ({}));

  // dia_override permite simular cualquier día para pruebas (ej: {"dia_override": 8})
  const dia  = body.dia_override ?? hoy.getDate();
  const mes  = body.mes_override  ?? (hoy.getMonth() + 1);
  const anio = body.anio_override ?? hoy.getFullYear();

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
      clubs.map(club => procesarClub(supabase, club, dia, mes, anio))
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
) {
  const valorMensual = Number(club.config?.valor_mensualidad ?? VALOR_MENSUALIDAD);
  const nombreClub   = String(club.config?.nombre ?? 'City FC');
  const stats        = { mensajes: 0, mora_aplicada: 0, mensualidades_creadas: 0 };

  // Jugadores activos con celular
  const { data: jugadores } = await supabase
    .from('players')
    .select('id, cedula, nombre, apellidos, celular')
    .eq('club_id', club.id)
    .eq('activo', true)
    .not('celular', 'is', null);

  if (!jugadores?.length) return stats;

  // ── DÍA 27 — Preventivo (para el mes SIGUIENTE) ──────────────────────────
  if (dia === 27) {
    const mesDest  = mes === 12 ? 1  : mes + 1;
    const anioDest = mes === 12 ? anio + 1 : anio;
    const nombreM  = mesTexto(mesDest);

    for (const j of jugadores) {
      if (await yaEnviado(supabase, club.id, j.cedula, 'preventivo', mesDest, anioDest)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `🔔 *Recordatorio de pago — ${nombreClub}*\n\n` +
        `Hola ${nombre}, tu cuota de *${nombreM} ${anioDest}* estará activa el 1 de ${nombreM}.\n\n` +
        `Monto: *$${valorMensual.toLocaleString('es-CO')}*\n\n` +
        `¡Prepárate para pagar a tiempo y evitar penalidades! ⚽`,
      );
      await logEnvio(supabase, club.id, j.cedula, 'preventivo', mesDest, anioDest);
      stats.mensajes++;
    }
  }

  // ── DÍA 1 — Cobro activo: generar mensualidades + avisar ─────────────────
  if (dia === 1) {
    const nombreM = mesTexto(mes);

    for (const j of jugadores) {
      // Crear mensualidad solo si no existe aún
      const { data: existente } = await supabase
        .from('mensualidades')
        .select('id')
        .eq('club_id', club.id)
        .eq('cedula', j.cedula)
        .eq('numero_mes', mes)
        .eq('anio', anio)
        .maybeSingle();

      if (!existente) {
        await supabase.from('mensualidades').insert({
          club_id:         club.id,
          cedula:          j.cedula,
          numero_mes:      mes,
          mes:             nombreM,
          anio,
          valor_oficial:   valorMensual,
          valor_pagado:    0,
          saldo_pendiente: valorMensual,
          estado:          'PENDIENTE',
          penalidad:       0,
        });
        stats.mensualidades_creadas++;
      }

      if (await yaEnviado(supabase, club.id, j.cedula, 'activacion', mes, anio)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `⚽ *${nombreClub} — Cuota ${nombreM} ${anio}*\n\n` +
        `Hola ${nombre}, tu cuota mensual ya está activa.\n\n` +
        `Monto: *$${valorMensual.toLocaleString('es-CO')}*\n\n` +
        `Tienes hasta el *día 7* para pagar sin penalidad. ¡Gracias por tu compromiso! 💪`,
      );
      await logEnvio(supabase, club.id, j.cedula, 'activacion', mes, anio);
      stats.mensajes++;
    }
  }

  // ── DÍA 4 — Recordatorio: solo quienes NO han pagado ────────────────────
  if (dia === 4) {
    const pendientes = await jugadoresConDeuda(supabase, club.id, jugadores, mes, anio);
    const nombreM    = mesTexto(mes);

    for (const j of pendientes) {
      if (await yaEnviado(supabase, club.id, j.cedula, 'recordatorio', mes, anio)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `⏰ *Recordatorio — ${nombreClub}*\n\n` +
        `Hola ${nombre}, te quedan *3 días* para pagar tu cuota de *${nombreM}*.\n\n` +
        `Monto: *$${valorMensual.toLocaleString('es-CO')}*\n\n` +
        `Paga antes del día 7 para evitar una penalidad de *$${PENALIDAD_MORA.toLocaleString('es-CO')}*. 🙏`,
      );
      await logEnvio(supabase, club.id, j.cedula, 'recordatorio', mes, anio);
      stats.mensajes++;
    }
  }

  // ── DÍA 7 — Vencimiento: último aviso antes de mora ──────────────────────
  if (dia === 7) {
    const pendientes = await jugadoresConDeuda(supabase, club.id, jugadores, mes, anio);
    const nombreM    = mesTexto(mes);

    for (const j of pendientes) {
      if (await yaEnviado(supabase, club.id, j.cedula, 'vencimiento', mes, anio)) continue;
      const nombre = nombreCompleto(j);
      await enviarWA(j.celular,
        `⚠️ *HOY vence el plazo — ${nombreClub}*\n\n` +
        `Hola ${nombre}, hoy es el último día para pagar tu cuota de *${nombreM}* sin penalidad.\n\n` +
        `Monto: *$${valorMensual.toLocaleString('es-CO')}*\n\n` +
        `A partir de mañana se aplicará una penalidad de *$${PENALIDAD_MORA.toLocaleString('es-CO')}*. ¡No te quedes en mora! 🚨`,
      );
      await logEnvio(supabase, club.id, j.cedula, 'vencimiento', mes, anio);
      stats.mensajes++;
    }
  }

  // ── DÍA 8 — Mora: aplicar penalidad + notificar jugador + alertar admin ──
  if (dia === 8) {
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

      // Aplicar penalidad una sola vez (guard en aplicarMoraConPenalidad)
      const penActual = parseFloat(mens.penalidad) || 0;
      if (penActual === 0) {
        const oficial    = parseFloat(mens.valor_oficial) || 0;
        const yaPageado  = parseFloat(mens.valor_pagado)  || 0;
        const nuevoSaldo = Math.max(0, oficial + PENALIDAD_MORA - yaPageado);
        await supabase.from('mensualidades').update({
          estado:                    'MORA',
          penalidad:                 PENALIDAD_MORA,
          saldo_pendiente:           nuevoSaldo,
          fecha_ultima_actualizacion: new Date().toISOString(),
        }).eq('id', mens.id);
        stats.mora_aplicada++;
      }

      morosos.push(nombreCompleto(j));

      if (await yaEnviado(supabase, club.id, j.cedula, 'mora', mes, anio)) continue;
      const nombre     = nombreCompleto(j);
      const oficial    = parseFloat(mens.valor_oficial) || 0;
      const totalDeuda = (oficial + PENALIDAD_MORA).toLocaleString('es-CO');
      await enviarWA(j.celular,
        `🚨 *Tu cuota está vencida — ${nombreClub}*\n\n` +
        `Hola ${nombre}, tu cuota de *${nombreM} ${anio}* ha entrado en mora.\n\n` +
        `Total a pagar (incluye penalidad $${PENALIDAD_MORA.toLocaleString('es-CO')}): *$${totalDeuda}*\n\n` +
        `Comunícate con el administrador para regularizar tu situación. 📞`,
      );
      await logEnvio(supabase, club.id, j.cedula, 'mora', mes, anio);
      stats.mensajes++;
    }

    // Notificar al admin del club si hay morosos
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
        );
        stats.mensajes++;
      }
    }
  }

  return stats;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function jugadoresConDeuda(
  supabase: ReturnType<typeof createClient>,
  club_id: string,
  jugadores: { cedula: string }[],
  mes: number,
  anio: number,
) {
  const { data: mens } = await supabase
    .from('mensualidades')
    .select('cedula')
    .eq('club_id', club_id)
    .eq('numero_mes', mes)
    .eq('anio', anio)
    .neq('estado', 'AL_DIA');

  const cedulasDeuda = new Set((mens || []).map((m: { cedula: string }) => m.cedula));
  return jugadores.filter(j => cedulasDeuda.has(j.cedula));
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

async function enviarWA(celular: string, body: string) {
  const sid   = TWILIO_ACCOUNT_SID;
  const token = TWILIO_AUTH_TOKEN;
  const from  = TWILIO_WHATSAPP_FROM;
  if (!sid || !token) throw new Error('Twilio no configurado');

  const to  = celular.startsWith('whatsapp:') ? celular : `whatsapp:+57${celular}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio ${res.status}: ${err}`);
  }
  console.log('[cobro-automatico] WA enviado a', to);
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
