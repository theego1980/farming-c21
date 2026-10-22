-- =====================================================================
-- FARMING C21 INMOPUL — Actualización v3
-- (Etapas de captación: contacto → tasación → captación)
-- Pegar TODO en Supabase > SQL Editor > New snippet > Run
-- Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.visitas add column if not exists etapa           text not null default '';
alter table public.visitas add column if not exists tasacion_fecha  date;
alter table public.visitas add column if not exists captacion_fecha date;

create index if not exists visitas_etapa on public.visitas(etapa) where etapa <> '';
