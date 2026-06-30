-- Limpia categoria, equipo y categorias de todos los jugadores del club city-fc
-- Ejecutar en Supabase SQL Editor

UPDATE players
SET
  categoria  = NULL,
  equipo     = NULL,
  categorias = '[]'::jsonb
WHERE club_id = (
  SELECT id FROM clubs WHERE slug = 'city-fc'
);

-- Verificación: debe retornar 0 filas con categoria o equipo
SELECT COUNT(*) AS pendientes
FROM players
WHERE club_id = (SELECT id FROM clubs WHERE slug = 'city-fc')
  AND (categoria IS NOT NULL OR equipo IS NOT NULL);
