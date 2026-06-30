-- Tabla de sesiones del agente WhatsApp
-- Guarda historial de conversación y contexto del jugador por número de teléfono

create table if not exists wa_sessions (
  phone        text primary key,
  jugador      jsonb,           -- datos del jugador identificado (nombre, club_id, etc.)
  messages     jsonb not null default '[]'::jsonb,  -- historial últimos 10 mensajes
  updated_at   timestamptz not null default now()
);

-- Limpiar sesiones sin actividad por más de 24 horas (opcional, correr como cron)
-- delete from wa_sessions where updated_at < now() - interval '24 hours';
