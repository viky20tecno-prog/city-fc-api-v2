-- Etapa 2 del cierre de Storage (8 oct 2026): un usuario con sesión solo puede ver,
-- subir o reemplazar archivos dentro de las carpetas de SU club.
-- Antes: cualquier admin de cualquier club podía listar los comprobantes y fotos de
-- otros clubes y subir o reemplazar archivos en sus carpetas (logo, QR de pago).
--
-- Carpetas de un club: '<slug>/...' o 'clubs/<slug>/...'.
-- Club del usuario: dueño (clubs.owner_user_id) o miembro activo (club_members, club_id = slug).
-- El super admin (diego31escobar@gmail.com) ve todo. La API usa service_role: no cambia.
-- No borra ni cambia ninguna política existente: agrega una función y UNA política restrictiva.
-- PARA DESHACER: rollback_storage_solo_su_club.sql

create or replace function public.storage_club_permitido(objeto text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt() ->> 'email', '') = 'diego31escobar@gmail.com'
    or exists (
      select 1
      from (
        select slug as club from public.clubs where owner_user_id = auth.uid()
        union
        select club_id from public.club_members where user_id = auth.uid() and activo
      ) c
      where c.club = (storage.foldername(objeto))[1]
         or ((storage.foldername(objeto))[1] = 'clubs' and c.club = (storage.foldername(objeto))[2])
    );
$$;

revoke all on function public.storage_club_permitido(text) from public, anon;
grant execute on function public.storage_club_permitido(text) to authenticated;

create policy "auth_solo_su_club"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using (
    bucket_id not in ('comprobantes', 'club-assets', 'player-photos')
    or public.storage_club_permitido(name)
  )
  with check (
    bucket_id not in ('comprobantes', 'club-assets', 'player-photos')
    or public.storage_club_permitido(name)
  );

-- Verificación: debe aparecer la política nueva
select policyname, permissive, roles, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname = 'auth_solo_su_club';
