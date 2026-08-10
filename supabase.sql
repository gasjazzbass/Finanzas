-- ============================================================
-- ORBIT · Base compartida
-- Pensado para instalarse DENTRO de un proyecto de Supabase que
-- ya usás para otra cosa (en tu caso, el de "sueldos-bucor").
--
-- No toca ninguna tabla, función ni trigger que ya exista:
-- todo lo que crea lleva el prefijo orbit_ y no se mete con
-- auth.users. Se puede ejecutar más de una vez sin romper nada.
--
-- >>> ANTES DE EJECUTAR: cambiá los dos mails de más abajo. <<<
-- ============================================================


-- ------------------------------------------------------------
-- 1) Quiénes tienen permitido entrar
--    Solo estos mails pueden ver las finanzas. Cualquier otra
--    persona con cuenta en el proyecto (los coordinadores de
--    Bucor, por ejemplo) queda afuera aunque sepa la dirección.
-- ------------------------------------------------------------
create table if not exists public.orbit_invitados (
  email text primary key
);

-- ↓↓↓ CAMBIÁ ESTOS DOS MAILS POR LOS DE USTEDES ↓↓↓
insert into public.orbit_invitados (email) values
  ('gaspar@ejemplo.com'),
  ('samanta@ejemplo.com')
on conflict (email) do nothing;
-- ↑↑↑ CAMBIÁ ESTOS DOS MAILS POR LOS DE USTEDES ↑↑↑


-- ------------------------------------------------------------
-- 2) Tablas de la app
-- ------------------------------------------------------------
create table if not exists public.orbit_perfiles (
  user_id uuid primary key,
  hogar   text not null default 'casa',
  nombre  text not null
);

create table if not exists public.orbit_registros (
  id         text primary key,
  hogar      text not null,
  tipo       text not null,
  data       jsonb not null,
  borrado    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists orbit_registros_hogar_fecha
  on public.orbit_registros (hogar, updated_at desc);

-- La hora de modificación la pone el servidor, no el teléfono.
create or replace function public.orbit_marcar_hora()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists orbit_registros_hora on public.orbit_registros;
create trigger orbit_registros_hora
  before insert or update on public.orbit_registros
  for each row execute function public.orbit_marcar_hora();


-- ------------------------------------------------------------
-- 3) Seguridad
-- ------------------------------------------------------------
alter table public.orbit_invitados enable row level security;
alter table public.orbit_perfiles  enable row level security;
alter table public.orbit_registros enable row level security;

-- orbit_invitados queda sin políticas a propósito: nadie la lee
-- desde la app, solo la consulta la función de acá abajo.

-- ¿El mail con el que entré está en la lista de invitados?
create or replace function public.orbit_invitado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orbit_invitados
    where lower(email) = lower(auth.jwt() ->> 'email')
  )
$$;

-- ¿A qué hogar pertenezco?
create or replace function public.orbit_mi_hogar()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select hogar from public.orbit_perfiles where user_id = auth.uid()
$$;

-- Perfiles: veo los de mi casa (y el mío siempre, incluso recién creado)
drop policy if exists "orbit ver perfiles" on public.orbit_perfiles;
create policy "orbit ver perfiles" on public.orbit_perfiles
  for select using (
    user_id = auth.uid() or hogar = public.orbit_mi_hogar()
  );

-- Solo un mail invitado puede darse de alta, y siempre en la casa
drop policy if exists "orbit crear perfil" on public.orbit_perfiles;
create policy "orbit crear perfil" on public.orbit_perfiles
  for insert with check (
    user_id = auth.uid()
    and hogar = 'casa'
    and public.orbit_invitado()
  );

drop policy if exists "orbit editar perfil" on public.orbit_perfiles;
create policy "orbit editar perfil" on public.orbit_perfiles
  for update
  using      (user_id = auth.uid())
  with check (user_id = auth.uid() and hogar = 'casa');

-- Registros: solo lo de mi casa, tanto para leer como para escribir
drop policy if exists "orbit registros" on public.orbit_registros;
create policy "orbit registros" on public.orbit_registros
  for all
  using      (hogar = public.orbit_mi_hogar())
  with check (hogar = public.orbit_mi_hogar());


-- ------------------------------------------------------------
-- Listo. Si dice "Success. No rows returned", salió bien.
--
-- Para sumar o sacar gente más adelante:
--   insert into public.orbit_invitados values ('otro@mail.com');
--   delete from public.orbit_invitados where email = 'otro@mail.com';
-- ------------------------------------------------------------
