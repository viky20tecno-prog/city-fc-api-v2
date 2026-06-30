DO $$
DECLARE
  v_club_id UUID;
BEGIN
  SELECT id INTO v_club_id FROM clubs WHERE slug = 'city-fc';

  UPDATE players SET
    nombre               = 'Carlos',
    apellidos            = 'Mendoza Torres',
    tipo_id              = 'CC',
    correo_electronico   = 'carlos.mendoza@gmail.com',
    instagram            = '@carlitos_gol',
    celular              = '3023903192',
    municipio            = 'Medellín',
    barrio               = 'El Poblado',
    direccion            = 'Cra 43A #18-111 Apto 302',
    lugar_de_nacimiento  = 'Medellín, Antioquia',
    fecha_nacimiento     = '1998-07-15',
    tipo_sangre          = 'O+',
    eps                  = 'Sura',
    estatura             = 1.78,
    peso                 = 72.5,
    familiar_emergencia  = 'Ana Torres (Mamá)',
    celular_contacto     = '3001234567',
    posicion             = 'Delantero',
    numero_camiseta      = 9,
    activo               = true
  WHERE club_id = v_club_id AND cedula = 'PRUEBA002';

  RAISE NOTICE 'PRUEBA002 actualizado con todos los campos';
END $$;
