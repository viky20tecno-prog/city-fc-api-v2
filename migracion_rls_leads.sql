-- Cierra la lectura pública de la tabla leads (prospectos: nombre, WhatsApp, club).
-- Hallazgo del barrido de salud del 6 oct 2026: con la clave pública (anon), que va
-- dentro del navegador, se podían leer todos los prospectos.
--
-- No rompe nada: la API (registro de leads desde la landing y el bot) y el admin
-- usan la clave service_role, que ignora RLS. Ningún código del navegador lee leads.
--
-- Ejecutar en Supabase → SQL Editor.

-- 1. Ver las políticas actuales (solo lectura, para dejar constancia)
select policyname, roles, cmd from pg_policies where schemaname = 'public' and tablename = 'leads';

-- 2. Quitar todas las políticas de leads y dejar RLS activo sin políticas:
--    nadie con la clave pública puede leer ni escribir; el servidor sigue igual.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'leads' loop
    execute format('drop policy %I on public.leads', p.policyname);
  end loop;
end $$;

alter table public.leads enable row level security;

-- 3. Verificación: debe devolver 0 filas
select policyname from pg_policies where schemaname = 'public' and tablename = 'leads';
