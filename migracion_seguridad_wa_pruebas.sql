-- =================================================================
-- ClubContable — City FC
-- Migración: Seguridad + Jugador de Prueba WA9/WA10/WA11
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Fecha: 2026-04-30
-- =================================================================


-- =================================================================
-- PARTE 1: SEGURIDAD — owner_user_id en tabla clubs (fix SEC2)
-- =================================================================
-- Propósito: vincular cada club a su usuario admin para evitar
-- que cualquier usuario autenticado acceda a datos de otro club.

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);

-- Obtener tu UUID:
--   Supabase Dashboard → Authentication → Users → clic en tu usuario → copiar "User UID"
-- Luego reemplaza 'PEGAR-TU-UUID-AQUI' con el valor real:

UPDATE clubs
SET owner_user_id = 'PEGAR-TU-UUID-AQUI'
WHERE slug = 'city-fc';

-- Verificación: debe mostrar tu UUID en owner_user_id
SELECT id, slug, name, owner_user_id FROM clubs WHERE slug = 'city-fc';


-- =================================================================
-- PARTE 2: JUGADOR DE PRUEBA para WA9 / WA10 / WA11
-- =================================================================
-- Reemplaza los valores marcados con ← CAMBIAR antes de ejecutar.
-- El celular debe ser solo 10 dígitos SIN el +57 (ej: 3001234567).

DO $$
DECLARE
  v_club_id   UUID;
  v_player_id UUID;
  v_mes       INT;
  v_mes_actual INT := EXTRACT(MONTH FROM NOW())::INT;
  v_anio      INT := EXTRACT(YEAR FROM NOW())::INT;
  v_nombres   TEXT[] := ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
BEGIN

  -- Obtener club
  SELECT id INTO v_club_id FROM clubs WHERE slug = 'city-fc';
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Club city-fc no encontrado';
  END IF;

  -- Insertar jugador de prueba
  -- ↓ CAMBIAR: pon el celular real de prueba (10 dígitos, sin +57)
  INSERT INTO players (club_id, cedula, nombre, apellidos, celular, municipio, activo)
  VALUES (
    v_club_id,
    'PRUEBA001',                  -- cédula de prueba (puede ser cualquier texto único)
    'Jugador',                    -- nombre
    'Prueba WhatsApp',            -- apellidos
    '3XXXXXXXXX',                 -- ← CAMBIAR: número de 10 dígitos (sin +57)
    'Medellín',
    true
  )
  RETURNING id INTO v_player_id;

  -- Crear 12 mensualidades (meses pasados valor_oficial=0, actuales/futuros=65000)
  FOR v_mes IN 1..12 LOOP
    INSERT INTO mensualidades (
      club_id, player_id, cedula, anio, mes, numero_mes,
      valor_oficial, valor_pagado, saldo_pendiente, estado
    ) VALUES (
      v_club_id,
      v_player_id,
      'PRUEBA001',
      v_anio,
      v_nombres[v_mes],
      v_mes,
      CASE WHEN v_mes < v_mes_actual THEN 0 ELSE 65000 END,
      0,
      CASE WHEN v_mes < v_mes_actual THEN 0 ELSE 65000 END,
      CASE WHEN v_mes < v_mes_actual THEN 'AL_DIA' ELSE 'PENDIENTE' END
    );
  END LOOP;

  -- Crear registro de uniforme
  INSERT INTO uniformes (club_id, player_id, cedula, tipo_uniforme, valor_oficial, valor_pagado, saldo_pendiente, estado)
  VALUES (v_club_id, v_player_id, 'PRUEBA001', 'General', 90000, 0, 90000, 'PENDIENTE');

  -- Crear torneos
  INSERT INTO torneos (club_id, player_id, cedula, nombre_torneo, valor_oficial, valor_pagado, saldo_pendiente, estado)
  VALUES
    (v_club_id, v_player_id, 'PRUEBA001', 'Punto y Coma',   80000, 0, 80000, 'PENDIENTE'),
    (v_club_id, v_player_id, 'PRUEBA001', 'JBC (Fútbol 7)', 50000, 0, 50000, 'PENDIENTE'),
    (v_club_id, v_player_id, 'PRUEBA001', 'INDESA 2026 I', 120000, 0,120000, 'PENDIENTE'),
    (v_club_id, v_player_id, 'PRUEBA001', 'INDER Envigado', 100000, 0,100000,'PENDIENTE');

  RAISE NOTICE 'Jugador de prueba creado con ID: %', v_player_id;
END $$;


-- =================================================================
-- PARTE 3: CAMBIAR EL CELULAR DE DIEGO ESCOBAR
-- =================================================================
-- Esto evita que el bot confunda al jugador de prueba con Diego.
-- ↓ CAMBIAR: pon el número real de Diego (10 dígitos, sin +57)
-- Si no tienes su número nuevo, usa '0000000000' como placeholder temporal.

UPDATE players
SET celular = '0000000000'   -- ← CAMBIAR al número real de Diego
WHERE cedula = '1032401947';


-- =================================================================
-- VERIFICACIÓN FINAL
-- =================================================================
SELECT cedula, nombre, apellidos, celular, activo
FROM players
WHERE cedula IN ('1032401947', 'PRUEBA001')
ORDER BY cedula;
