// Recalcula las mensualidades no cerradas (!= AL_DIA) del año en curso de un jugador
// según un nuevo % de descuento. Única fuente de verdad — usado por PATCH /players/:cedula
// (edición individual desde Hoja de vida) y por POST /config/aplicar-descuentos-masivo
// (ajuste en bloque cuando cambia el valor base del club).
async function recalcularMensualidadesPorDescuento({ supabase, clubId, cedula, valorMensual, nuevoPct }) {
  const anioActual   = new Date().getFullYear();
  const pct          = Math.max(0, Math.min(100, Number(nuevoPct ?? 0)));
  const nuevoOficial = Math.round(Number(valorMensual) * (1 - pct / 100));

  const { data: mensualidadesAjustar } = await supabase
    .from('mensualidades')
    .select('id, valor_pagado, penalidad')
    .eq('club_id', clubId)
    .eq('cedula', cedula)
    .eq('anio', anioActual)
    .neq('estado', 'AL_DIA');

  for (const mens of (mensualidadesAjustar || [])) {
    const penalidad  = Number(mens.penalidad   ?? 0);
    const pagado     = Number(mens.valor_pagado ?? 0);
    // 100% de descuento (exento) = no se le cobra nada — cualquier valor_pagado que haya
    // quedado (ej. de un mes corregido a mano antes de marcarlo exento) se limpia también,
    // para que no sume plata que nunca entró en un mes que ahora es $0 oficial.
    const nuevoPagado = nuevoOficial === 0 ? 0 : pagado;
    const nuevoSaldo = Math.max(0, nuevoOficial + penalidad - nuevoPagado);
    const nuevoEstado =
      nuevoOficial === 0 || nuevoPagado >= nuevoOficial + penalidad ? 'AL_DIA'
      : nuevoPagado > 0 ? 'PARCIAL'
      : 'PENDIENTE';

    await supabase.from('mensualidades').update({
      valor_oficial:   nuevoOficial,
      valor_pagado:    nuevoPagado,
      saldo_pendiente: nuevoSaldo,
      estado:          nuevoEstado,
    }).eq('id', mens.id);
  }

  return { pct, nuevoOficial, mesesActualizados: (mensualidadesAjustar || []).length };
}

module.exports = { recalcularMensualidadesPorDescuento };
