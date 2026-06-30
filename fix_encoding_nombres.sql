-- Corrige mojibake UTF-8→Latin1 en nombres y apellidos de jugadores de city-fc
-- Ejecutar en Supabase SQL Editor

-- 1. Vista previa: muestra los afectados ANTES de modificar
SELECT cedula, nombre, apellidos,
       convert_from(convert(nombre::bytea,    'UTF8', 'LATIN1'), 'UTF8') AS nombre_corregido,
       convert_from(convert(apellidos::bytea, 'UTF8', 'LATIN1'), 'UTF8') AS apellidos_corregido
FROM players
WHERE club_id = (SELECT id FROM clubs WHERE slug = 'city-fc')
  AND (nombre ~ 'Ã' OR apellidos ~ 'Ã')
ORDER BY nombre;

-- 2. Ejecutar este UPDATE solo si la vista previa se ve correcta
/*
UPDATE players
SET
  nombre    = convert_from(convert(nombre::bytea,    'UTF8', 'LATIN1'), 'UTF8'),
  apellidos = convert_from(convert(apellidos::bytea, 'UTF8', 'LATIN1'), 'UTF8')
WHERE club_id = (SELECT id FROM clubs WHERE slug = 'city-fc')
  AND (nombre ~ 'Ã' OR apellidos ~ 'Ã');
*/
