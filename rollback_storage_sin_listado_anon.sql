-- Punto de retorno de migracion_storage_sin_listado_anon.sql.
-- Quita la única política que agregó esa migración; Storage queda exactamente
-- como estaba antes. Ejecutar en Supabase → SQL Editor.
drop policy if exists "anon_no_lista_archivos" on storage.objects;
