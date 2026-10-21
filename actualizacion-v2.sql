-- =====================================================================
-- FARMING C21 INMOPUL — Actualización v2
-- (En venta con colega, seguimiento de contactos, fotos y avisos)
-- Pegar TODO en Supabase > SQL Editor > New snippet > Run
-- Se puede correr más de una vez sin problema.
-- =====================================================================

-- ---------- Casas: venta con colega, seguimiento y fotos ----------
alter table public.visitas add column if not exists en_venta_colega    boolean not null default false;
alter table public.visitas add column if not exists venta_desde        date;
alter table public.visitas add column if not exists venta_inmobiliaria text not null default '';
alter table public.visitas add column if not exists venta_valor        numeric;
alter table public.visitas add column if not exists ultimo_contacto    date;
alter table public.visitas add column if not exists recordado          date;
alter table public.visitas add column if not exists fotos              text[] not null default '{}';

-- ---------- Asignaciones: avisos al asesor ----------
alter table public.asignaciones add column if not exists aviso_30          boolean not null default false;
alter table public.asignaciones add column if not exists aviso_inactividad timestamptz;

-- ---------- Fotos: almacenamiento privado ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Cada asesor sube y ve sus propias fotos (carpeta = su id). El broker ve todas.
drop policy if exists fotos_subir on storage.objects;
create policy fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists fotos_ver on storage.objects;
create policy fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin()));

drop policy if exists fotos_borrar on storage.objects;
create policy fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin()));
