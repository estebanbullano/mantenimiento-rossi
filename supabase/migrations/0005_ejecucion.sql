-- =====================================================================
-- 0005 · Ejecución de la tarea en el celular y base de conocimiento
--
--   · Cronómetro: Iniciar / Pausar / Reanudar / Terminar con hora del servidor;
--     el tiempo real sale de esas marcas (no se carga a mano)
--   · Fotos de pasos durante el trabajo (con nota) → procedimiento de la tarea
--   · Foto final sacada con la cámara de la app, con hora del celular y del servidor
--   · Herramientas usadas (catálogo que se arma solo) y repuestos
--   · Audios y videos de lo que se hizo, con su texto
--   · "Guardar como referencia": la OT revisada alimenta el procedimiento, los repuestos,
--     las herramientas y el tiempo estimado de la próxima vez
-- Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Marcas de tiempo de la OT
-- ---------------------------------------------------------------------
create table if not exists mant_ot_eventos (
  id          uuid primary key default gen_random_uuid(),
  orden_id    uuid not null references mant_ordenes(id) on delete cascade,
  tipo        text not null check (tipo in ('inicio','pausa','reanudar','fin')),
  usuario_id  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index if not exists mant_ot_eventos_orden on mant_ot_eventos(orden_id, creado_en);

-- Minutos efectivos de trabajo (descontando pausas); si está corriendo, hasta ahora
create or replace function mant_ot_minutos(p_orden uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare e record; desde timestamptz; total numeric := 0;
begin
  for e in select tipo, creado_en from mant_ot_eventos where orden_id = p_orden order by creado_en, id loop
    if e.tipo in ('inicio','reanudar') then
      desde := coalesce(desde, e.creado_en);
    elsif desde is not null then
      total := total + extract(epoch from (e.creado_en - desde)); desde := null;
    end if;
  end loop;
  if desde is not null then total := total + extract(epoch from (now() - desde)); end if;
  return round(total / 60)::int;
end $$;

-- Estado del cronómetro: sin_iniciar · corriendo · pausada · terminada
create or replace function mant_ot_reloj(p_orden uuid) returns text
language sql stable security definer set search_path = public as $$
  select case (select tipo from mant_ot_eventos where orden_id = p_orden order by creado_en desc, id desc limit 1)
           when 'inicio' then 'corriendo' when 'reanudar' then 'corriendo'
           when 'pausa' then 'pausada' when 'fin' then 'terminada' else 'sin_iniciar' end
$$;

-- Iniciar / pausar / reanudar desde el celular
create or replace function mant_ot_marcar(p_orden uuid, p_tipo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o mant_ordenes; reloj text;
begin
  select * into o from mant_ordenes where id = p_orden for update;
  if o.id is null then raise exception 'Orden inexistente.'; end if;
  if not mant_puede_operar_ot(p_orden) then raise exception 'No tenés esta tarea asignada.'; end if;
  if o.estado not in ('pendiente','en_proceso') then raise exception 'La tarea ya está cerrada.'; end if;
  reloj := mant_ot_reloj(p_orden);
  if p_tipo = 'inicio' and reloj not in ('sin_iniciar','terminada') then raise exception 'La actividad ya está iniciada.'; end if;
  if p_tipo = 'pausa' and reloj <> 'corriendo' then raise exception 'La actividad no está corriendo.'; end if;
  if p_tipo = 'reanudar' and reloj <> 'pausada' then raise exception 'La actividad no está en pausa.'; end if;
  if p_tipo not in ('inicio','pausa','reanudar') then raise exception 'Marca desconocida: %', p_tipo; end if;
  insert into mant_ot_eventos (orden_id, tipo) values (p_orden, p_tipo);
  if p_tipo = 'inicio' and o.estado = 'pendiente' then
    update mant_ordenes set estado = 'en_proceso' where id = p_orden;
  end if;
  return jsonb_build_object('reloj', mant_ot_reloj(p_orden), 'minutos', mant_ot_minutos(p_orden));
end $$;

-- Terminar: cierra el cronómetro, calcula el tiempo real y cierra la OT (exige foto de cierre)
create or replace function mant_ot_terminar(p_orden uuid, p_informe text default null) returns int
language plpgsql security definer set search_path = public as $$
declare o mant_ordenes; minutos int;
begin
  select * into o from mant_ordenes where id = p_orden for update;
  if o.id is null then raise exception 'Orden inexistente.'; end if;
  if not mant_puede_operar_ot(p_orden) then raise exception 'No tenés esta tarea asignada.'; end if;
  if o.estado not in ('pendiente','en_proceso') then raise exception 'La tarea ya está cerrada.'; end if;
  if mant_ot_reloj(p_orden) = 'sin_iniciar' then raise exception 'Primero tocá "Iniciar actividad".'; end if;
  if mant_ot_reloj(p_orden) in ('corriendo','pausada') then
    insert into mant_ot_eventos (orden_id, tipo) values (p_orden, 'fin');
  end if;
  minutos := greatest(1, mant_ot_minutos(p_orden));
  update mant_ordenes
     set estado = 'completada', tiempo_real_min = minutos,
         comentario_cierre = coalesce(nullif(trim(p_informe), ''), comentario_cierre)
   where id = p_orden;
  return minutos;
end $$;

-- Si se reabre una OT (pedir rehacer), el cronómetro vuelve a empezar desde "Iniciar"
revoke execute on function mant_ot_marcar(uuid, text) from anon;
revoke execute on function mant_ot_terminar(uuid, text) from anon;
revoke execute on function mant_ot_minutos(uuid) from anon;
revoke execute on function mant_ot_reloj(uuid) from anon;

-- ---------------------------------------------------------------------
-- 2. Fotos: pasos del trabajo y foto final con hora
-- ---------------------------------------------------------------------
alter table mant_ot_fotos
  add column if not exists nota          text,
  add column if not exists paso          int,
  add column if not exists tomada_en     timestamptz,          -- reloj del celular al sacarla
  add column if not exists desde_camara  boolean not null default false,
  add column if not exists desfase_seg   int;                  -- diferencia entre celular y servidor

alter table mant_ot_fotos drop constraint if exists mant_ot_fotos_tipo_check;
alter table mant_ot_fotos add constraint mant_ot_fotos_tipo_check check (tipo in ('antes','paso','cierre','rechazada'));

-- La foto final del operario tiene que salir de la cámara en ese momento
create or replace function mant_validar_foto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.creado_en := now();
  new.subida_por := coalesce(auth.uid(), new.subida_por);
  if new.tomada_en is not null then
    new.desfase_seg := round(extract(epoch from (now() - new.tomada_en)))::int;
  end if;
  if new.tipo = 'paso' and new.paso is null then
    select coalesce(max(paso), 0) + 1 into new.paso from mant_ot_fotos where orden_id = new.orden_id and tipo = 'paso';
  end if;
  if new.tipo = 'cierre' and mant_rol() = 'operario' then
    if not new.desde_camara or new.tomada_en is null then
      raise exception 'La foto final se saca con la cámara desde la aplicación.';
    end if;
    if abs(new.desfase_seg) > 900 then
      raise exception 'La foto no es de este momento (diferencia de % minutos con el servidor). Sacala de nuevo.', round(abs(new.desfase_seg) / 60.0);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists mant_ot_foto_validar on mant_ot_fotos;
create trigger mant_ot_foto_validar before insert on mant_ot_fotos
  for each row execute function mant_validar_foto();

-- ---------------------------------------------------------------------
-- 3. Herramientas (el catálogo se arma solo con lo que cargan los operarios)
-- ---------------------------------------------------------------------
create table if not exists mant_herramientas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  clave      text not null unique,          -- nombre normalizado para no duplicar
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create table if not exists mant_ot_herramientas (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references mant_ordenes(id) on delete cascade,
  herramienta_id  uuid references mant_herramientas(id) on delete set null,
  texto           text not null check (length(trim(texto)) > 0),
  cargado_por     uuid default auth.uid(),
  creado_en       timestamptz not null default now()
);
create index if not exists mant_ot_herramientas_orden on mant_ot_herramientas(orden_id);

create table if not exists mant_tarea_herramientas (
  tarea_id        uuid not null references mant_tareas(id) on delete cascade,
  herramienta_id  uuid not null references mant_herramientas(id) on delete cascade,
  primary key (tarea_id, herramienta_id)
);

create or replace function mant_clave_texto(t text) returns text
language sql immutable as $$
  select regexp_replace(lower(translate(trim(t), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g')
$$;

create or replace function mant_vincular_herramienta() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := mant_clave_texto(new.texto);
begin
  new.texto := trim(new.texto);
  if new.herramienta_id is null then
    insert into mant_herramientas (nombre, clave) values (new.texto, k)
    on conflict (clave) do nothing;
    select id into new.herramienta_id from mant_herramientas where clave = k;
  end if;
  return new;
end $$;
drop trigger if exists mant_ot_herramienta_vincular on mant_ot_herramientas;
create trigger mant_ot_herramienta_vincular before insert on mant_ot_herramientas
  for each row execute function mant_vincular_herramienta();

-- ---------------------------------------------------------------------
-- 4. Audios y videos de lo que se hizo
-- ---------------------------------------------------------------------
create table if not exists mant_ot_medios (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references mant_ordenes(id) on delete cascade,
  tipo           text not null check (tipo in ('audio','video')),
  ruta           text not null,
  duracion_seg   int,
  transcripcion  text,
  creado_por     uuid default auth.uid(),
  creado_en      timestamptz not null default now()
);
create index if not exists mant_ot_medios_orden on mant_ot_medios(orden_id);

-- ---------------------------------------------------------------------
-- 5. Procedimiento de cada tarea (pasos con foto) y aprendizaje desde una OT revisada
-- ---------------------------------------------------------------------
create table if not exists mant_tarea_pasos (
  id              uuid primary key default gen_random_uuid(),
  tarea_id        uuid not null references mant_tareas(id) on delete cascade,
  orden           int not null,
  texto           text,
  foto_ruta       text,
  orden_origen_id uuid references mant_ordenes(id) on delete set null,
  creado_en       timestamptz not null default now()
);
create index if not exists mant_tarea_pasos_tarea on mant_tarea_pasos(tarea_id, orden);

-- Tiempo, repuestos y herramientas de cada tarea según las veces que se hizo
create or replace view mant_v_tarea_prediccion with (security_invoker = true) as
select t.id as tarea_id,
       count(o.id) as ejecuciones,
       round(avg(o.tiempo_real_min))::int as minutos_promedio,
       min(o.tiempo_real_min) as minutos_min,
       max(o.tiempo_real_min) as minutos_max,
       max(o.completada_en) as ultima
from mant_tareas t
left join mant_ordenes o on o.tarea_id = t.id and o.estado = 'completada' and o.tiempo_real_min is not null
group by t.id;

-- El administrador revisa el cierre y lo guarda como referencia de la tarea:
-- pasos con foto → procedimiento; repuestos del pañol y herramientas → lo que se va a necesitar;
-- tiempo estimado → promedio de las últimas 5 veces
create or replace function mant_aprender_de_ot(p_orden uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o mant_ordenes; n_pasos int := 0; n_rep int := 0; n_herr int := 0; prom numeric;
begin
  if not mant_tiene_rol('referente','supervisor') then raise exception 'Solo mantenimiento guarda referencias.'; end if;
  select * into o from mant_ordenes where id = p_orden;
  if o.id is null then raise exception 'Orden inexistente.'; end if;
  if o.estado <> 'completada' then raise exception 'La orden tiene que estar cerrada.'; end if;
  if o.tarea_id is null then raise exception 'Esta orden no viene de una tarea del plan: queda en el historial del equipo.'; end if;

  if exists (select 1 from mant_ot_fotos where orden_id = p_orden and tipo = 'paso') then
    delete from mant_tarea_pasos where tarea_id = o.tarea_id;
    insert into mant_tarea_pasos (tarea_id, orden, texto, foto_ruta, orden_origen_id)
    select o.tarea_id, row_number() over (order by f.paso, f.creado_en), f.nota, f.ruta, p_orden
      from mant_ot_fotos f where f.orden_id = p_orden and f.tipo = 'paso';
    get diagnostics n_pasos = row_count;
  end if;

  insert into mant_tarea_repuestos (tarea_id, articulo_id, cantidad)
  select o.tarea_id, r.articulo_id, sum(r.cantidad)
    from mant_ot_repuestos r where r.orden_id = p_orden and r.articulo_id is not null
   group by r.articulo_id
  on conflict (tarea_id, articulo_id) do update set cantidad = excluded.cantidad;
  get diagnostics n_rep = row_count;

  insert into mant_tarea_herramientas (tarea_id, herramienta_id)
  select distinct o.tarea_id, h.herramienta_id from mant_ot_herramientas h
   where h.orden_id = p_orden and h.herramienta_id is not null
  on conflict do nothing;
  get diagnostics n_herr = row_count;

  select avg(x.tiempo_real_min) into prom from (
    select tiempo_real_min from mant_ordenes
     where tarea_id = o.tarea_id and estado = 'completada' and tiempo_real_min is not null
     order by completada_en desc limit 5) x;
  if prom is not null then
    update mant_tareas set duracion_estimada_horas = round(prom / 60.0, 2) where id = o.tarea_id;
  end if;
  update mant_ordenes set revision_foto = 'aprobada', revisada_por = auth.uid(), revisada_en = now()
   where id = p_orden and coalesce(revision_foto, 'pendiente') = 'pendiente';
  return jsonb_build_object('pasos', n_pasos, 'repuestos', n_rep, 'herramientas', n_herr, 'horas', round(prom / 60.0, 2));
end $$;
revoke execute on function mant_aprender_de_ot(uuid) from anon;

-- Al generar la OT preventiva, la duración estimada sale de la tarea (que ya aprendió)
-- (mant_generar_semana_interna ya copia duracion_estimada_horas de la tarea)

-- ---------------------------------------------------------------------
-- 6. Seguridad
-- ---------------------------------------------------------------------
alter table mant_ot_eventos         enable row level security;
alter table mant_herramientas       enable row level security;
alter table mant_ot_herramientas    enable row level security;
alter table mant_tarea_herramientas enable row level security;
alter table mant_ot_medios          enable row level security;
alter table mant_tarea_pasos        enable row level security;

drop policy if exists oteventos_ver on mant_ot_eventos;
create policy oteventos_ver on mant_ot_eventos for select using (mant_puede_ver_ot(orden_id));
-- las marcas solo se escriben con mant_ot_marcar / mant_ot_terminar

drop policy if exists herr_ver on mant_herramientas;
create policy herr_ver on mant_herramientas for select using (mant_activo());
drop policy if exists herr_editar on mant_herramientas;
create policy herr_editar on mant_herramientas for update
  using (mant_tiene_rol('referente','supervisor','panolero')) with check (mant_tiene_rol('referente','supervisor','panolero'));

drop policy if exists otherr_ver on mant_ot_herramientas;
create policy otherr_ver on mant_ot_herramientas for select using (mant_puede_ver_ot(orden_id));
drop policy if exists otherr_cargar on mant_ot_herramientas;
create policy otherr_cargar on mant_ot_herramientas for insert with check (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));
drop policy if exists otherr_borrar on mant_ot_herramientas;
create policy otherr_borrar on mant_ot_herramientas for delete using (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));

drop policy if exists tareaherr_ver on mant_tarea_herramientas;
create policy tareaherr_ver on mant_tarea_herramientas for select using (mant_activo());
drop policy if exists tareaherr_editar on mant_tarea_herramientas;
create policy tareaherr_editar on mant_tarea_herramientas for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));

drop policy if exists otmedios_ver on mant_ot_medios;
create policy otmedios_ver on mant_ot_medios for select using (mant_puede_ver_ot(orden_id));
drop policy if exists otmedios_cargar on mant_ot_medios;
create policy otmedios_cargar on mant_ot_medios for insert with check (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));
drop policy if exists otmedios_editar on mant_ot_medios;
create policy otmedios_editar on mant_ot_medios for update
  using (mant_puede_operar_ot(orden_id)) with check (mant_puede_operar_ot(orden_id));
drop policy if exists otmedios_borrar on mant_ot_medios;
create policy otmedios_borrar on mant_ot_medios for delete using (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));

drop policy if exists tareapasos_ver on mant_tarea_pasos;
create policy tareapasos_ver on mant_tarea_pasos for select using (mant_activo());
drop policy if exists tareapasos_editar on mant_tarea_pasos;
create policy tareapasos_editar on mant_tarea_pasos for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));

grant select on mant_v_tarea_prediccion to authenticated;
grant all on mant_ot_eventos, mant_herramientas, mant_ot_herramientas, mant_tarea_herramientas, mant_ot_medios, mant_tarea_pasos to authenticated;
