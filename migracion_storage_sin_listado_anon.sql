-- Cierra el listado de archivos con la clave pública (anon) en Storage.
-- Hallazgo del barrido de salud del 6 oct 2026: con la clave publicable, que va
-- dentro del navegador, se podía listar y descargar todo lo de comprobantes,
-- club-assets (comprobantes de WhatsApp, logos) y player-photos.
--
-- Qué hace: agrega UNA política RESTRICTIVA de lectura para el rol anon. No borra
-- ni cambia ninguna política existente.
--   · Los enlaces públicos que ya usan la plataforma (/object/public/...) siguen
--     funcionando: los buckets públicos no pasan por estas políticas.
--   · La inscripción pública (/inscripcion) sigue pudiendo subir la foto: Supabase
--     necesita "ver" el archivo recién subido, por eso se permite ver solo fotos de
--     player-photos creadas en los últimos 2 minutos (no el histórico).
--   · Usuarios con sesión (admins de club) no cambian.
--
-- Ejecutar en Supabase → SQL Editor.
-- PARA DESHACER: ejecutar api/rollback_storage_sin_listado_anon.sql

create policy "anon_no_lista_archivos"
  on storage.objects
  as restrictive
  for select
  to anon
  using (
    bucket_id not in ('comprobantes', 'club-assets', 'player-photos')
    or (bucket_id = 'player-photos' and created_at > now() - interval '2 minutes')
  );

-- Verificación: debe aparecer la política nueva
select policyname, permissive, roles, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname = 'anon_no_lista_archivos';
