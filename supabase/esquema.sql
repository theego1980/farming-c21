-- =====================================================================
-- FARMING C21 INMOPUL — Esquema de base de datos (Supabase)
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Perfiles (broker y asesores) ----------
create table if not exists public.perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  nombre    text not null default '',
  apellido  text not null default '',
  email     text not null unique,
  rol       text not null default 'asesor' check (rol in ('admin','asesor')),
  creado    timestamptz not null default now()
);

-- ---------- Zonas (territorios fijos, no se superponen) ----------
create table if not exists public.zonas (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  color          text not null default '#BEAF87',
  geometria      jsonb not null,               -- GeoJSON Polygon
  calles_limite  text[] not null default '{}',  -- si se creó por calles
  cuadras        jsonb not null default '[]',   -- calles divididas por cuadra
  barrio         text,
  creado         timestamptz not null default now()
);

-- ---------- Asignaciones (tenencia de 90 días) ----------
create table if not exists public.asignaciones (
  id              uuid primary key default gen_random_uuid(),
  zona_id         uuid not null references public.zonas(id) on delete cascade,
  asesor_id       uuid not null references public.perfiles(id) on delete cascade,
  inicio          timestamptz not null default now(),
  vence           timestamptz not null default (now() + interval '90 days'),
  estado          text not null default 'activa' check (estado in ('activa','vencida','finalizada')),
  renovaciones    int not null default 0,
  alerta_enviada  boolean not null default false,
  aviso_previo    boolean not null default false,
  finalizada      timestamptz,
  motivo_fin      text,
  creado          timestamptz not null default now()
);
-- Una zona sólo puede tener una asignación vigente (activa o vencida a la espera de decisión)
create unique index if not exists una_vigente_por_zona
  on public.asignaciones(zona_id) where estado in ('activa','vencida');

-- ---------- Jornadas: día y horas dedicadas ----------
create table if not exists public.jornadas (
  id             uuid primary key default gen_random_uuid(),
  asignacion_id  uuid not null references public.asignaciones(id) on delete cascade,
  asesor_id      uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  fecha          date not null default current_date,
  horas          numeric(4,1) not null check (horas > 0 and horas <= 24),
  notas          text not null default '',
  creado         timestamptz not null default now()
);

-- ---------- Visitas: casas visitadas y datos del propietario ----------
create table if not exists public.visitas (
  id             uuid primary key default gen_random_uuid(),
  asignacion_id  uuid not null references public.asignaciones(id) on delete cascade,
  asesor_id      uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  cuadra_id      text not null,
  calle          text not null,
  altura         int,
  propietario    text not null default '',
  telefono       text not null default '',
  resultado      text not null default '',
  notas          text not null default '',
  fecha          date not null default current_date,
  creado         timestamptz not null default now()
);

create index if not exists visitas_asig on public.visitas(asignacion_id);
create index if not exists jornadas_asig on public.jornadas(asignacion_id);
create index if not exists asig_asesor on public.asignaciones(asesor_id);

-- ---------- Funciones auxiliares ----------
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'admin');
$$;

-- El asesor sólo puede cargar datos mientras su asignación esté activa y en plazo
create or replace function public.puede_cargar(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from asignaciones
    where id = a and asesor_id = auth.uid() and estado = 'activa' and vence > now()
  );
$$;

create or replace function public.zona_visible(z uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from asignaciones
    where zona_id = z and asesor_id = auth.uid() and estado in ('activa','vencida')
  );
$$;

-- Al crear un usuario se crea su perfil. El PRIMER usuario queda como administrador (broker).
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, email, nombre, apellido, rol)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce(new.raw_user_meta_data->>'apellido', ''),
    case when exists (select 1 from perfiles where rol = 'admin') then 'asesor' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- ---------- Seguridad por filas ----------
alter table public.perfiles     enable row level security;
alter table public.zonas        enable row level security;
alter table public.asignaciones enable row level security;
alter table public.jornadas     enable row level security;
alter table public.visitas      enable row level security;

drop policy if exists perfiles_leer on public.perfiles;
create policy perfiles_leer on public.perfiles for select
  using (id = auth.uid() or public.es_admin());
drop policy if exists perfiles_admin on public.perfiles;
create policy perfiles_admin on public.perfiles for update
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists zonas_leer on public.zonas;
create policy zonas_leer on public.zonas for select
  using (public.es_admin() or public.zona_visible(id));
drop policy if exists zonas_admin on public.zonas;
create policy zonas_admin on public.zonas for all
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists asig_leer on public.asignaciones;
create policy asig_leer on public.asignaciones for select
  using (public.es_admin() or asesor_id = auth.uid());
drop policy if exists asig_admin on public.asignaciones;
create policy asig_admin on public.asignaciones for all
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists jor_leer on public.jornadas;
create policy jor_leer on public.jornadas for select
  using (public.es_admin() or asesor_id = auth.uid());
drop policy if exists jor_cargar on public.jornadas;
create policy jor_cargar on public.jornadas for insert
  with check (public.es_admin() or (asesor_id = auth.uid() and public.puede_cargar(asignacion_id)));
drop policy if exists jor_editar on public.jornadas;
create policy jor_editar on public.jornadas for update
  using (public.es_admin() or (asesor_id = auth.uid() and public.puede_cargar(asignacion_id)));
drop policy if exists jor_borrar on public.jornadas;
create policy jor_borrar on public.jornadas for delete
  using (public.es_admin() or (asesor_id = auth.uid() and public.puede_cargar(asignacion_id)));

drop policy if exists vis_leer on public.visitas;
create policy vis_leer on public.visitas for select
  using (public.es_admin() or asesor_id = auth.uid());
drop policy if exists vis_cargar on public.visitas;
create policy vis_cargar on public.visitas for insert
  with check (public.es_admin() or (asesor_id = auth.uid() and public.puede_cargar(asignacion_id)));
drop policy if exists vis_editar on public.visitas;
create policy vis_editar on public.visitas for update
  using (public.es_admin() or (asesor_id = auth.uid() and public.puede_cargar(asignacion_id)));
drop policy if exists vis_borrar on public.visitas;
create policy vis_borrar on public.visitas for delete
  using (public.es_admin() or (asesor_id = auth.uid() and public.puede_cargar(asignacion_id)));

-- Listo. Si alguna vez necesitás hacer administrador a otro usuario:
-- update public.perfiles set rol = 'admin' where email = 'correo@ejemplo.com';
