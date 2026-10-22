-- =============================================================================
-- 0006 · El operario graba audio o video; el administrador escucha, escribe
-- el informe y arma los pasos del procedimiento antes de cargarlo al plan.
--
--   · mant_aprender_de_ot(p_orden, p_pasos): si se pasan los pasos editados por
--     el administrador ([{"texto": "...", "foto_ruta": "..."}]), ese es el
--     procedimiento que queda en la tarea; si no, se usan las fotos de pasos.
-- Se puede volver a correr.
-- =============================================================================

drop function if exists mant_aprender_de_ot(uuid);

create or replace function mant_aprender_de_ot(p_orden uuid, p_pasos jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o mant_ordenes; n_pasos int := 0; n_rep int := 0; n_herr int := 0; prom numeric;
begin
  if not mant_tiene_rol('referente','supervisor') then raise exception 'Solo mantenimiento guarda referencias.'; end if;
  select * into o from mant_ordenes where id = p_orden;
  if o.id is null then raise exception 'Orden inexistente.'; end if;
  if o.estado <> 'completada' then raise exception 'La orden tiene que estar cerrada.'; end if;
  if o.tarea_id is null then raise exception 'Esta orden no viene de una tarea del plan: queda en el historial del equipo.'; end if;

  if p_pasos is not null and jsonb_typeof(p_pasos) = 'array' then
    -- pasos escritos/revisados por el administrador
    delete from mant_tarea_pasos where tarea_id = o.tarea_id;
    insert into mant_tarea_pasos (tarea_id, orden, texto, foto_ruta, orden_origen_id)
    select o.tarea_id, row_number() over (order by x.n), nullif(trim(x.e->>'texto'), ''), nullif(x.e->>'foto_ruta', ''), p_orden
      from jsonb_array_elements(p_pasos) with ordinality as x(e, n)
     where coalesce(nullif(trim(x.e->>'texto'), ''), nullif(x.e->>'foto_ruta', '')) is not null;
    get diagnostics n_pasos = row_count;
  elsif exists (select 1 from mant_ot_fotos where orden_id = p_orden and tipo = 'paso') then
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
revoke execute on function mant_aprender_de_ot(uuid, jsonb) from anon;
grant execute on function mant_aprender_de_ot(uuid, jsonb) to authenticated;
