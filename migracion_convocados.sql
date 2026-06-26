-- Lista de jugadores convocados por partido en el calendario
ALTER TABLE public.calendario ADD COLUMN IF NOT EXISTS convocados text[];
