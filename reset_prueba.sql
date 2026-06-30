DO $$
DECLARE
  v_club_id UUID;
BEGIN
  SELECT id INTO v_club_id FROM clubs WHERE slug = 'city-fc';

  -- Borrar todos los datos relacionados a PRUEBA001
  DELETE FROM pagos         WHERE club_id = v_club_id AND cedula = 'PRUEBA001';
  DELETE FROM mensualidades WHERE club_id = v_club_id AND cedula = 'PRUEBA001';
  DELETE FROM uniformes     WHERE club_id = v_club_id AND cedula = 'PRUEBA001';
  DELETE FROM torneos       WHERE club_id = v_club_id AND cedula = 'PRUEBA001';
  DELETE FROM players       WHERE club_id = v_club_id AND cedula = 'PRUEBA001';

  -- Crear jugador nuevo limpio con el número de prueba
  INSERT INTO players (
    club_id, cedula, nombre, apellidos,
    celular, municipio, activo
  ) VALUES (
    v_club_id,
    'PRUEBA002',
    'Jugador',
    'Prueba Contable',
    '3023903192',
    'Medellín',
    true
  );

  RAISE NOTICE 'Listo: PRUEBA001 eliminado, PRUEBA002 creado con celular 3023903192';
END $$;
