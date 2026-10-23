-- =============================================================================
-- 0012 · Eliminar una tarea del plan preventivo.
-- Las OT ya hechas quedan en el historial de la máquina (pierden el vínculo con la
-- tarea); las pendientes sin empezar se cancelan. Si tiene una OT en proceso, no se borra.
-- Se puede volver a correr.
-- =============================================================================
create or replace function mant_eliminar_tarea(p_tarea uuid, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t mant_tareas; n_canc int := 0; n_hist int := 0;
begin
  if not mant_tiene_rol('referente','supervisor') then raise exception 'Solo referentes o supervisores eliminan tareas del plan.'; end if;
  select * into t from mant_tareas where id = p_tarea for update;
  if t.id is null then raise exception 'La tarea no existe (quizás ya se eliminó).'; end if;
  if exists (select 1 from mant_ordenes where tarea_id = p_tarea and estado = 'en_proceso') then
    raise exception 'La tarea tiene una OT en proceso: terminala o cancelala antes de eliminarla.';
  end if;
  update mant_ordenes
     set estado = 'cancelada',
         observacion = coalesce(observacion || ' · ', '') || 'Cancelada: se eliminó la tarea del plan' || coalesce(' (' || nullif(trim(p_motivo), '') || ')', '')
   where tarea_id = p_tarea and estado = 'pendiente';
  get diagnostics n_canc = row_count;
  select count(*) into n_hist from mant_ordenes where tarea_id = p_tarea and estado in ('completada','no_realizada');
  delete from mant_tareas where id = p_tarea;
  return jsonb_build_object('ots_canceladas', n_canc, 'ots_en_historial', n_hist);
end $$;
revoke execute on function mant_eliminar_tarea(uuid, text) from anon;
grant execute on function mant_eliminar_tarea(uuid, text) to authenticated;
