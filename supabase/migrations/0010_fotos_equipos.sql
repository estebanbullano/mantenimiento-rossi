-- =============================================================================
-- 0010 · Fotos de las máquinas (para identificarlas). Se cargan desde el celular
-- con el link #/fotos-equipos o desde la ficha del equipo.
-- Se puede volver a correr.
-- =============================================================================
create table if not exists mant_equipo_fotos (
  id         uuid primary key default gen_random_uuid(),
  equipo_id  uuid not null references mant_equipos(id) on delete cascade,
  ruta       text not null,
  nota       text,
  creado_por uuid default auth.uid(),
  creado_en  timestamptz not null default now()
);
create index if not exists mant_equipo_fotos_eq on mant_equipo_fotos(equipo_id, creado_en desc);

alter table mant_equipo_fotos enable row level security;
drop policy if exists eqfotos_ver on mant_equipo_fotos;
create policy eqfotos_ver on mant_equipo_fotos for select using (mant_activo());
drop policy if exists eqfotos_cargar on mant_equipo_fotos;
create policy eqfotos_cargar on mant_equipo_fotos for insert with check (mant_tiene_rol('referente','supervisor','operario'));
drop policy if exists eqfotos_borrar on mant_equipo_fotos;
create policy eqfotos_borrar on mant_equipo_fotos for delete using (mant_tiene_rol('referente','supervisor') or creado_por = auth.uid());
grant select, insert, delete on mant_equipo_fotos to authenticated;

-- La foto principal de cada equipo es la última que se sacó
drop view if exists mant_v_equipo_foto;
create view mant_v_equipo_foto with (security_invoker = true) as
select distinct on (equipo_id) equipo_id, ruta, creado_en
  from mant_equipo_fotos order by equipo_id, creado_en desc;
grant select on mant_v_equipo_foto to authenticated;
