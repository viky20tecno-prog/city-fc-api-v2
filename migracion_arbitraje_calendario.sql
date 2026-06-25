-- Integrar arbitraje al calendario
-- Ejecutar en Supabase SQL Editor

-- 1. Valor del arbitraje por jugador en el evento
ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS monto_arbitraje integer;

-- 2. Registro de pago por jugador (reutiliza la tabla de asistencia)
ALTER TABLE public.asistencia ADD COLUMN IF NOT EXISTS pago_arbitraje boolean NOT NULL DEFAULT false;
