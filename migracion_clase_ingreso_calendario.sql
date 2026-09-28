-- Migración: tipo CLASE_INGRESO en calendario (las 2 primeras clases de un jugador nuevo)
-- Ejecutar en Supabase SQL Editor → https://supabase.com/dashboard/project/olcevdnhmexaahymfzii/sql
-- No modifica datos existentes: solo amplía los tipos permitidos.

ALTER TABLE calendario DROP CONSTRAINT IF EXISTS calendario_tipo_check;
ALTER TABLE calendario ADD CONSTRAINT calendario_tipo_check
  CHECK (tipo IN ('PARTIDO', 'ENTRENAMIENTO', 'EVENTO', 'CLASE_INGRESO'));
