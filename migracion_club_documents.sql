-- Tabla de documentos del club (lineamientos, reglamentos, contratos, etc.)
create table if not exists public.club_documents (
  id                    uuid primary key default gen_random_uuid(),
  club_id               uuid not null references public.clubs(id) on delete cascade,
  nombre                text not null,
  url                   text not null,
  descripcion           text,
  enviar_al_inscribirse boolean not null default false,
  activo                boolean not null default true,
  orden                 integer not null default 0,
  created_at            timestamptz not null default now()
);

-- Índice para queries por club
create index if not exists idx_club_documents_club_id on public.club_documents(club_id);

-- RLS: solo el dueño del club puede gestionar sus documentos
alter table public.club_documents enable row level security;

create policy "Club owner manages own documents"
  on public.club_documents
  for all
  using (
    club_id in (
      select id from public.clubs where owner_user_id = auth.uid()
    )
  );
