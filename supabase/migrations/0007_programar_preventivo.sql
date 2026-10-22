-- =============================================================================
-- 0007 · Programar el preventivo: ver qué máquinas tienen preventivo en fecha,
-- con una prioridad sugerida, y generar la OT ya asignada (operario, día, turno).
-- Se puede volver a correr.
-- =============================================================================

-- Prioridad sugerida: por criticidad del equipo, y sube un escalón si está atrasada más de 7 días
create or replace function mant_prioridad_sugerida(p_clasificacion text, p_proxima date) returns text
language sql immutable as $$
  select case
    when p_clasificacion = 'C'  then case when current_date - p_proxima > 7 then 'urgente' else 'alta'  end
    when p_clasificacion = 'NC' then case when current_date - p_proxima > 7 then 'media'   else 'baja'  end
    else                             case when current_date - p_proxima > 7 then 'alta'    else 'media' end
  end
$$;

-- Tareas del plan que vencen en los próximos 60 días (o ya vencieron), con su OT abierta si tiene
drop view if exists mant_v_preventivo_programar;
create view mant_v_preventivo_programar with (security_invoker = true) as
select t.id as tarea_id, t.descripcion, t.unidad, t.frecuencia_valor, t.frecuencia_unidad,
       t.duracion_estimada_horas, t.turno, t.requiere_parada, t.ultima_ejecucion, t.proxima_fecha,
       t.responsable_id,
       (current_date - t.proxima_fecha) as dias_atraso,
       e.id as equipo_id, e.codigo as equipo_codigo, e.nombre as equipo_nombre,
       e.planta_id, e.planta_codigo, e.planta_nombre, e.clasificacion, e.criticidad,
       mant_prioridad_sugerida(e.clasificacion, t.proxima_fecha) as prioridad_sugerida,
       o.id as orden_id, o.numero as orden_numero, o.estado as orden_estado, o.prioridad as orden_prioridad,
       o.asignado_id, u.nombre as asignado_nombre, o.fecha_programada, o.turno as orden_turno
from mant_tareas t
left join mant_v_equipos e on e.id = t.equipo_id
left join lateral (
  select * from mant_ordenes x
   where x.tarea_id = t.id and x.estado in ('pendiente','en_proceso')
   order by x.creado_en desc limit 1
) o on true
left join mant_usuarios u on u.id = o.asignado_id
where t.activa and coalesce(e.activo, true)
  and t.proxima_fecha <= current_date + 60;
grant select on mant_v_preventivo_programar to authenticated;

-- Programa las tareas elegidas: genera la OT de las que no tienen, ya asignada (operario, día,
-- turno), y reasigna las que tienen OT pendiente sin empezar. p_prioridad null → la sugerida.
drop function if exists mant_generar_ots(uuid[], uuid, date, text, text, text);
create or replace function mant_generar_ots(
  p_tareas uuid[], p_asignado uuid default null, p_fecha date default current_date,
  p_turno text default null, p_prioridad text default null, p_observacion text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_nuevas int; n_reasig int; turno_op text;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo referentes o supervisores generan órdenes.';
  end if;
  if p_prioridad is not null and p_prioridad not in ('baja','media','alta','urgente') then
    raise exception 'Prioridad inválida: %', p_prioridad;
  end if;
  if p_asignado is not null and not exists (select 1 from mant_usuarios where id = p_asignado and activo) then
    raise exception 'El operario elegido no está activo.';
  end if;
  p_fecha := coalesce(p_fecha, current_date);
  select turno into turno_op from mant_usuarios where id = p_asignado;

  -- las que ya tienen OT pendiente (sin empezar): se reasignan
  update mant_ordenes o
     set asignado_id = coalesce(p_asignado, o.asignado_id),
         fecha_programada = p_fecha, semana = date_trunc('week', p_fecha)::date,
         fecha_comprometida = greatest(coalesce(o.fecha_comprometida, p_fecha), p_fecha),
         turno = coalesce(nullif(p_turno, ''), turno_op, o.turno),
         prioridad = coalesce(p_prioridad, o.prioridad),
         observacion = coalesce(nullif(trim(p_observacion), ''), o.observacion)
   where o.tarea_id = any(p_tareas) and o.estado = 'pendiente';
  get diagnostics n_reasig = row_count;

  with nuevas as (
    insert into mant_ordenes (tipo, equipo_id, tarea_id, titulo, descripcion, prioridad, asignado_id,
                              turno, semana, fecha_programada, fecha_comprometida, duracion_estimada_horas, observacion)
    select 'preventiva', t.equipo_id, t.id, t.descripcion, t.notas,
           coalesce(p_prioridad, mant_prioridad_sugerida(e.clasificacion, t.proxima_fecha)),
           coalesce(p_asignado, t.responsable_id),
           coalesce(nullif(p_turno, ''), turno_op, t.turno),
           date_trunc('week', p_fecha)::date, p_fecha, p_fecha, t.duracion_estimada_horas,
           nullif(trim(p_observacion), '')
      from mant_tareas t
      left join mant_v_equipos e on e.id = t.equipo_id
     where t.id = any(p_tareas) and t.activa
       and not exists (select 1 from mant_ordenes o where o.tarea_id = t.id and o.estado in ('pendiente','en_proceso'))
    returning id, tarea_id
  ), puntos as (
    insert into mant_ot_items (orden_id, orden, descripcion, detalle)
    select nv.id, i.orden, i.descripcion, i.detalle
      from nuevas nv join mant_tarea_items i on i.tarea_id = nv.tarea_id
    returning 1
  )
  select count(*) into n_nuevas from nuevas;
  return jsonb_build_object('nuevas', n_nuevas, 'reasignadas', n_reasig);
end $$;
revoke execute on function mant_generar_ots(uuid[], uuid, date, text, text, text) from anon;
grant execute on function mant_generar_ots(uuid[], uuid, date, text, text, text) to authenticated;

-- Repartir fechas: en la carga inicial muchas rutinas mensuales/anuales quedaron con la misma
-- próxima fecha. Esto las distribuye a lo largo de su ciclo, de a una máquina por vez (todas las
-- tareas de un equipo con la misma frecuencia caen la misma semana, así se para una sola vez),
-- empezando por los equipos más críticos. Las OT pendientes sin asignar ni empezar de esas
-- tareas se mueven a la nueva fecha si cae en las próximas 2 semanas, o se cancelan si no.
create or replace function mant_repartir_fechas(p_fecha date, p_inicio date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ini date; n_t int; n_mov int; n_canc int;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo referentes o supervisores reprograman el plan.';
  end if;
  ini := date_trunc('week', coalesce(p_inicio, current_date + 7))::date;

  create temp table _rep on commit drop as
  with base as (
    select t.id, t.equipo_id, t.frecuencia_valor, e.criticidad, e.codigo
      from mant_tareas t join mant_v_equipos e on e.id = t.equipo_id
     where t.activa and t.proxima_fecha = p_fecha and t.frecuencia_unidad = 'meses'
       and not exists (select 1 from mant_ordenes o where o.tarea_id = t.id and o.estado = 'en_proceso')
  ), eqs as (
    select frecuencia_valor, equipo_id,
           row_number() over (partition by frecuencia_valor order by max(criticidad) desc nulls last, min(codigo)) - 1 as r
      from base group by frecuencia_valor, equipo_id
  )
  select b.id, ini + (((x.r % greatest(1, round(b.frecuencia_valor * 52 / 12.0)::int)))::int * 7) as nueva
    from base b join eqs x on x.equipo_id = b.equipo_id and x.frecuencia_valor = b.frecuencia_valor;

  update mant_tareas t set proxima_fecha = r.nueva from _rep r where r.id = t.id;
  get diagnostics n_t = row_count;

  update mant_ordenes o set fecha_programada = r.nueva, fecha_comprometida = r.nueva, semana = date_trunc('week', r.nueva)::date
    from _rep r
   where o.tarea_id = r.id and o.estado = 'pendiente' and o.asignado_id is null and o.iniciada_en is null
     and r.nueva <= ini + 13;
  get diagnostics n_mov = row_count;

  update mant_ordenes o set estado = 'cancelada',
         observacion = coalesce(o.observacion || ' · ', '') || 'Cancelada al repartir las fechas del plan (nueva fecha ' || to_char(r.nueva, 'DD/MM/YYYY') || ')'
    from _rep r
   where o.tarea_id = r.id and o.estado = 'pendiente' and o.asignado_id is null and o.iniciada_en is null
     and r.nueva > ini + 13;
  get diagnostics n_canc = row_count;

  return jsonb_build_object('tareas', n_t, 'ots_movidas', n_mov, 'ots_canceladas', n_canc, 'desde', ini);
end $$;
revoke execute on function mant_repartir_fechas(date, date) from anon;
grant execute on function mant_repartir_fechas(date, date) to authenticated;

-- Fechas amontonadas: cuántas rutinas de equipos (frecuencia en meses) comparten la misma próxima fecha
drop view if exists mant_v_fechas_amontonadas;
create view mant_v_fechas_amontonadas with (security_invoker = true) as
select t.proxima_fecha, count(*) as tareas, count(distinct t.equipo_id) as equipos
  from mant_tareas t
 where t.activa and t.equipo_id is not null and t.frecuencia_unidad = 'meses'
 group by t.proxima_fecha
having count(*) >= 40;
grant select on mant_v_fechas_amontonadas to authenticated;
