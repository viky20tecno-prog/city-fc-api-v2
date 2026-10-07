-- Punto de retorno de migracion_rls_leads.sql: vuelve a permitir que la clave
-- pública lea e inserte en leads (estado anterior). Solo usar si algo falla.
-- Ejecutar en Supabase → SQL Editor.
create policy "leads_lectura_publica" on public.leads for select to anon using (true);
create policy "leads_insercion_publica" on public.leads for insert to anon with check (true);
