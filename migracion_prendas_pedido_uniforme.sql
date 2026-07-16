-- Desglose por prenda de un pedido de uniforme: permite registrar precio y
-- abono de cada prenda individualmente (antes solo existía un total/abono
-- agregado por pedido, con las prendas guardadas como un string plano sin
-- precio individual).
create table if not exists public.pedido_uniforme_prendas (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedido_uniformes(id) on delete cascade,
  nombre          text not null,
  cantidad        integer not null default 1,
  precio_unitario numeric not null default 0,
  valor_pagado    numeric not null default 0,
  estado          text not null default 'PENDIENTE',
  created_at      timestamptz not null default now()
);

create index if not exists idx_pedido_uniforme_prendas_pedido_id on public.pedido_uniforme_prendas(pedido_id);

-- Congela el abono ya registrado en pedidos existentes ANTES de esta migración
-- como un monto histórico "sin discriminar" — no se reparte automáticamente
-- entre las prendas (evita adivinar un reparto que puede no coincidir con la
-- realidad). Los abonos NUEVOS, de acá en adelante, sí se registran por prenda.
alter table public.pedido_uniformes add column if not exists abono_legacy numeric not null default 0;

-- RLS: mismo criterio que pedido_uniformes — gestionada 100% por el backend
-- vía SUPABASE_SERVICE_ROLE_KEY (bypassa RLS), sin política explícita porque
-- el frontend nunca consulta esta tabla directamente (ver rls_seguridad.sql).
alter table public.pedido_uniforme_prendas enable row level security;
