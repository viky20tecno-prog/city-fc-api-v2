-- ============================================================
-- Migración: penalidad en mensualidades + tabla wa_log_envios
-- Ejecutar desde /root/city-fc-api-v2 con:
--   supabase db query --linked -f migracion_penalidad_y_wa_log.sql
-- ============================================================

-- 1. Columna penalidad en mensualidades
ALTER TABLE mensualidades
  ADD COLUMN IF NOT EXISTS penalidad NUMERIC(10,2) DEFAULT 0;

-- 2. Actualizar registros ya en MORA que no tienen penalidad aplicada
UPDATE mensualidades
SET
  penalidad       = 10000,
  saldo_pendiente = GREATEST(0, valor_oficial + 10000 - valor_pagado)
WHERE estado = 'MORA'
  AND (penalidad IS NULL OR penalidad = 0);

-- 3. Tabla de log de envíos WA para deduplicación del ciclo de cobro
CREATE TABLE IF NOT EXISTS wa_log_envios (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      UUID        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  cedula       TEXT        NOT NULL,
  tipo_mensaje TEXT        NOT NULL,  -- preventivo | activacion | recordatorio | vencimiento | mora
  mes          INTEGER     NOT NULL,
  anio         INTEGER     NOT NULL,
  enviado_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_wa_log UNIQUE (club_id, cedula, tipo_mensaje, mes, anio)
);

CREATE INDEX IF NOT EXISTS idx_wa_log_club_mes
  ON wa_log_envios (club_id, mes, anio);
