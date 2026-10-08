-- Punto de retorno de migracion_storage_solo_su_club.sql: deja Storage como estaba.
drop policy if exists "auth_solo_su_club" on storage.objects;
drop function if exists public.storage_club_permitido(text);
