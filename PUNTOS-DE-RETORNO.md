# Puntos de retorno

Si algo falla después de un cambio, se vuelve al último estado estable.

## Código (los tres repositorios)

- `estable-2026-10-07`: antes de cerrar el listado público de archivos y del informe semanal.
- `estable-2026-10-08`: antes de actualizar librerías y de limitar archivos por club.

Volver a ese estado (repetir en cada repo afectado):

```
git revert --no-edit <etiqueta>..HEAD
git push origin main
```

`revert` crea commits nuevos que deshacen los cambios: no borra historial y Vercel
despliega solo. Para ver qué cambió desde la etiqueta: `git log --oneline <etiqueta>..HEAD`.

## Base de datos (Supabase → SQL Editor)

| Cambio | Aplicar | Deshacer |
|---|---|---|
| Cerrar lectura pública de prospectos | `migracion_rls_leads.sql` | `rollback_rls_leads.sql` |
| Cerrar listado público de archivos | `migracion_storage_sin_listado_anon.sql` | `rollback_storage_sin_listado_anon.sql` |
| Cada admin solo ve/sube archivos de su club | `migracion_storage_solo_su_club.sql` | `rollback_storage_solo_su_club.sql` |

## Verificación

`GET /api/cron/health-report?dry=1` (con el CRON_SECRET) devuelve el estado de
salud en JSON sin enviar correo: disponibilidad, bot, limpieza y accesos públicos.
