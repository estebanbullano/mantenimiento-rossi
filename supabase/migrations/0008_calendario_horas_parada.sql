-- =============================================================================
-- 0008 · Calendario editable, horas de uso por máquina (lista para el PLC) y
-- "no se hizo por máquina parada".
-- Se puede volver a correr.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Mover una tarea en el calendario (arrastrar) y editar frecuencia/fecha
-- ---------------------------------------------------------------------------
alter table mant_tareas_historial
  add column if not exists fecha_anterior date,
  add column if not exists fecha_nueva    date;

-- Cambia la próxima fecha de una tarea (y su OT pendiente sin empezar, si tiene)
create or replace function mant_mover_tarea(p_tarea uuid, p_fecha date, p_motivo text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare t mant_tareas; n int := 0;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo referentes o supervisores reprograman el plan.';
  end if;
  select * into t from mant_tareas where id = p_tarea;
  if t.id is null then raise exception 'Tarea inexistente.'; end if;
  if p_fecha is null then raise exception 'Indicá la nueva fecha.'; end if;
  if p_fecha = t.proxima_fecha then return 0; end if;

  update mant_tareas set proxima_fecha = p_fecha where id = p_tarea;
  insert into mant_tareas_historial (tarea_id, valor_anterior, unidad_anterior, valor_nuevo, unidad_nueva, motivo, fecha_anterior, fecha_nueva)
  values (p_tarea, t.frecuencia_valor, t.frecuencia_unidad, t.frecuencia_valor, t.frecuencia_unidad, nullif(trim(p_motivo), ''), t.proxima_fecha, p_fecha);

  update mant_ordenes set fecha_programada = p_fecha, semana = date_trunc('week', p_fecha)::date,
         fecha_comprometida = p_fecha
   where tarea_id = p_tarea and estado = 'pendiente' and iniciada_en is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function mant_mover_tarea(uuid, date, text) from anon;
grant execute on function mant_mover_tarea(uuid, date, text) to authenticated;

-- Ajustar frecuencia: además del valor/unidad, opcionalmente fija la próxima fecha
drop function if exists mant_ajustar_frecuencia(uuid, int, text, text);
create or replace function mant_ajustar_frecuencia(p_tarea uuid, p_valor int, p_unidad text, p_motivo text, p_proxima date default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo referentes ajustan frecuencias.';
  end if;
  if p_valor is null or p_valor < 1 then raise exception 'La frecuencia tiene que ser 1 o más.'; end if;
  if p_unidad not in ('dias','semanas','meses','horas') then raise exception 'Unidad inválida: %', p_unidad; end if;
  perform set_config('mant.motivo', coalesce(p_motivo, ''), true);
  update mant_tareas t set frecuencia_valor = p_valor, frecuencia_unidad = p_unidad,
         proxima_fecha = coalesce(p_proxima, mant_sumar_frecuencia(coalesce(t.ultima_ejecucion, current_date), p_valor, p_unidad))
   where id = p_tarea;
  if p_proxima is not null then
    update mant_ordenes set fecha_programada = p_proxima, semana = date_trunc('week', p_proxima)::date, fecha_comprometida = p_proxima
     where tarea_id = p_tarea and estado = 'pendiente' and iniciada_en is null;
  end if;
end $$;
revoke execute on function mant_ajustar_frecuencia(uuid, int, text, text, date) from anon;
grant execute on function mant_ajustar_frecuencia(uuid, int, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Horas de uso de cada máquina (manual hoy; el PLC después)
-- ---------------------------------------------------------------------------
-- Datos de uso y de conexión al PLC de cada equipo (tabla aparte para no tocar la vista de equipos)
create table if not exists mant_equipo_uso (
  equipo_id      uuid primary key references mant_equipos(id) on delete cascade,
  horas_uso      numeric(12,1),             -- última lectura del horómetro
  horas_uso_en   timestamptz,
  plc_habilitado boolean not null default false,
  plc_protocolo  text,                      -- Modbus TCP · OPC UA · Siemens S7 · otro
  plc_direccion  text,                      -- IP / endpoint del PLC o gateway
  plc_tag        text,                      -- registro / tag de horas de marcha
  plc_nota       text,
  actualizado_en timestamptz not null default now()
);
alter table mant_equipo_uso enable row level security;
drop policy if exists equso_ver on mant_equipo_uso;
create policy equso_ver on mant_equipo_uso for select using (mant_activo());
drop policy if exists equso_editar on mant_equipo_uso;
create policy equso_editar on mant_equipo_uso for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));
grant select, insert, update on mant_equipo_uso to authenticated;

create table if not exists mant_equipo_horas (
  id          uuid primary key default gen_random_uuid(),
  equipo_id   uuid not null references mant_equipos(id) on delete cascade,
  horas       numeric(12,1) not null check (horas >= 0),
  leida_en    timestamptz not null default now(),
  origen      text not null default 'manual' check (origen in ('manual','plc')),
  nota        text,
  cargado_por uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index if not exists mant_equipo_horas_eq on mant_equipo_horas(equipo_id, leida_en desc);

create or replace function mant_validar_horas() returns trigger
language plpgsql security definer set search_path = public as $$
declare ant numeric;
begin
  select horas into ant from mant_equipo_horas
   where equipo_id = new.equipo_id and leida_en <= new.leida_en order by leida_en desc limit 1;
  if ant is not null and new.horas < ant and coalesce(trim(new.nota), '') = '' then
    raise exception 'La lectura (% h) es menor que la anterior (% h). Si se cambió o reseteó el horómetro, aclaralo en la nota.', new.horas, ant;
  end if;
  return new;
end $$;
drop trigger if exists mant_equipo_horas_validar on mant_equipo_horas;
create trigger mant_equipo_horas_validar before insert on mant_equipo_horas
  for each row execute function mant_validar_horas();

create or replace function mant_actualizar_horas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into mant_equipo_uso (equipo_id, horas_uso, horas_uso_en, actualizado_en)
  select coalesce(new.equipo_id, old.equipo_id), x.horas, x.leida_en, now()
    from (select 1) d
    left join lateral (select horas, leida_en from mant_equipo_horas where equipo_id = coalesce(new.equipo_id, old.equipo_id)
                        order by leida_en desc limit 1) x on true
  on conflict (equipo_id) do update set horas_uso = excluded.horas_uso, horas_uso_en = excluded.horas_uso_en, actualizado_en = now();
  return null;
end $$;
drop trigger if exists mant_equipo_horas_ultima on mant_equipo_horas;
create trigger mant_equipo_horas_ultima after insert or delete on mant_equipo_horas
  for each row execute function mant_actualizar_horas();

-- Clave para que el PLC (o el gateway: Node-RED, Kepware, etc.) mande las horas por la API.
-- Tabla cerrada: solo se lee con mant_plc_clave() (referente/supervisor/admin).
create table if not exists mant_plc_clave (
  id        int primary key default 1 check (id = 1),
  clave     text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  creado_en timestamptz not null default now()
);
insert into mant_plc_clave (id) values (1) on conflict do nothing;
alter table mant_plc_clave enable row level security;
revoke all on mant_plc_clave from anon, authenticated;

create or replace function mant_plc_clave() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not mant_tiene_rol('referente','supervisor','admin') then raise exception 'Solo mantenimiento ve la clave del PLC.'; end if;
  return (select clave from mant_plc_clave where id = 1);
end $$;
revoke execute on function mant_plc_clave() from anon;

-- Lo llama el PLC/gateway: POST /rest/v1/rpc/mant_plc_horas {"p_clave": "...", "p_equipo": "FP-PL-HORNO-1", "p_horas": 12345.6}
create or replace function mant_plc_horas(p_clave text, p_equipo text, p_horas numeric, p_leida_en timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare eid uuid; u mant_equipo_uso;
begin
  if p_clave is null or p_clave <> (select clave from mant_plc_clave where id = 1) then
    raise exception 'Clave de PLC inválida.';
  end if;
  select id into eid from mant_equipos where codigo = p_equipo;
  if eid is null then raise exception 'Equipo % no existe.', p_equipo; end if;
  select * into u from mant_equipo_uso where equipo_id = eid;
  if not coalesce(u.plc_habilitado, false) then raise exception 'El equipo % no tiene habilitada la lectura por PLC.', p_equipo; end if;
  insert into mant_equipo_horas (equipo_id, horas, leida_en, origen, cargado_por, nota)
  values (eid, p_horas, coalesce(p_leida_en, now()), 'plc', null, case when p_horas < coalesce(u.horas_uso, 0) then 'Reset informado por el PLC' end);
  return jsonb_build_object('equipo', p_equipo, 'horas', p_horas);
end $$;
grant execute on function mant_plc_horas(text, text, numeric, timestamptz) to anon, authenticated;

alter table mant_equipo_horas enable row level security;
drop policy if exists eqhoras_ver on mant_equipo_horas;
create policy eqhoras_ver on mant_equipo_horas for select using (mant_activo());
drop policy if exists eqhoras_cargar on mant_equipo_horas;
create policy eqhoras_cargar on mant_equipo_horas for insert
  with check (mant_tiene_rol('referente','supervisor','operario') and origen = 'manual');
drop policy if exists eqhoras_borrar on mant_equipo_horas;
create policy eqhoras_borrar on mant_equipo_horas for delete using (mant_tiene_rol('referente','supervisor'));
grant select, insert, delete on mant_equipo_horas to authenticated;

-- ---------------------------------------------------------------------------
-- 3. "No se hizo": máquina parada (o otro motivo). Queda en el historial.
-- ---------------------------------------------------------------------------
alter table mant_ordenes drop constraint if exists mant_ordenes_estado_check;
alter table mant_ordenes add constraint mant_ordenes_estado_check
  check (estado in ('pendiente','en_proceso','completada','cancelada','no_realizada'));
alter table mant_ordenes
  add column if not exists no_realizada_motivo text check (no_realizada_motivo in ('maquina_parada','otro')),
  add column if not exists no_realizada_por    uuid references mant_usuarios(id) on delete set null;

create or replace function mant_ot_no_realizada(p_orden uuid, p_motivo text default 'maquina_parada', p_detalle text default null)
returns date
language plpgsql security definer set search_path = public as $$
declare o mant_ordenes; prox date;
begin
  select * into o from mant_ordenes where id = p_orden for update;
  if o.id is null then raise exception 'Orden inexistente.'; end if;
  if not mant_puede_operar_ot(p_orden) then raise exception 'No tenés esta tarea asignada.'; end if;
  if o.estado not in ('pendiente','en_proceso') then raise exception 'La tarea ya está cerrada.'; end if;
  if p_motivo not in ('maquina_parada','otro') then raise exception 'Motivo inválido.'; end if;
  if p_motivo = 'otro' and coalesce(trim(p_detalle), '') = '' then raise exception 'Contá por qué no se hizo.'; end if;

  if exists (select 1 from mant_ot_eventos where orden_id = p_orden)
     and mant_ot_reloj(p_orden) in ('corriendo','pausada') then
    insert into mant_ot_eventos (orden_id, tipo) values (p_orden, 'fin');
  end if;
  update mant_ordenes set estado = 'no_realizada', no_realizada_motivo = p_motivo, no_realizada_por = auth.uid(),
         completada_en = now(),
         comentario_cierre = coalesce(nullif(trim(p_detalle), ''), case p_motivo when 'maquina_parada' then 'Máquina parada: no se hizo el mantenimiento.' end)
   where id = p_orden;

  -- la tarea vuelve a tocar cuando corresponda según su frecuencia, contando desde hoy
  if o.tarea_id is not null then
    update mant_tareas t set proxima_fecha = mant_sumar_frecuencia(current_date, t.frecuencia_valor, t.frecuencia_unidad)
     where t.id = o.tarea_id returning proxima_fecha into prox;
  end if;
  return prox;
end $$;
revoke execute on function mant_ot_no_realizada(uuid, text, text) from anon;
grant execute on function mant_ot_no_realizada(uuid, text, text) to authenticated;

-- La vista de órdenes vuelve a crearse para incluir las columnas nuevas (o.*)
drop view if exists mant_v_ordenes;
create view mant_v_ordenes with (security_invoker = true) as
select o.*,
       e.codigo as equipo_codigo, e.nombre as equipo_nombre, e.planta_id,
       (select v.clasificacion from mant_v_equipos v where v.id = o.equipo_id) as equipo_clasificacion,
       t.unidad as tarea_unidad,
       u.nombre as asignado_nombre, u.turno as asignado_turno,
       p.numero as pedido_numero, p.area as pedido_area,
       (o.estado in ('pendiente','en_proceso') and o.fecha_comprometida < current_date) as vencida,
       (select count(*) from mant_ot_fotos f where f.orden_id = o.id and f.tipo = 'cierre') as fotos_cierre,
       (select count(*) from mant_ot_items i where i.orden_id = o.id) as items_total,
       (select count(*) from mant_ot_items i where i.orden_id = o.id and i.hecho) as items_hechos
from mant_ordenes o
left join mant_equipos e on e.id = o.equipo_id
left join mant_tareas t on t.id = o.tarea_id
left join mant_usuarios u on u.id = o.asignado_id
left join mant_pedidos p on p.id = o.pedido_id;
grant select on mant_v_ordenes to authenticated;
