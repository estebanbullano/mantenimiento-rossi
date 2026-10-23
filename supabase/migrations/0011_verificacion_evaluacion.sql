-- =============================================================================
-- 0011 · Pedidos: verificación de supervisión y evaluación del solicitante (1 a 10)
--   · Cuando el operario cierra la OT, el solicitante ve "Trabajo completado · falta
--     verificación de supervisión". Cuando el supervisor aprueba, ve "Aprobado".
--   · Con el trabajo terminado, el solicitante califica de 1 a 10 (sirve para evaluar
--     a los operarios).
-- Se puede volver a correr.
-- =============================================================================

alter table mant_pedidos
  add column if not exists evaluacion            int check (evaluacion between 1 and 10),
  add column if not exists evaluacion_comentario text,
  add column if not exists evaluado_en           timestamptz;

-- Aviso al cerrar la OT: ahora dice que falta la verificación
create or replace function mant_ot_aviso_cierre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'completada' and old.estado <> 'completada' then
    update mant_ordenes set revision_foto = 'pendiente', revisada_por = null, revisada_en = null where id = new.id;
    if new.pedido_id is not null then
      insert into mant_pedido_comentarios (pedido_id, autor_id, texto)
      values (new.pedido_id, null, format('Trabajo completado (OT-%s) · falta verificación de supervisión', lpad(new.numero::text, 4, '0')));
    end if;
  end if;
  return null;
end $$;

-- Aviso al solicitante cuando el supervisor aprueba o pide rehacer
create or replace function mant_ot_aviso_revision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pedido_id is null or new.revision_foto is not distinct from old.revision_foto then return null; end if;
  if new.revision_foto = 'aprobada' then
    insert into mant_pedido_comentarios (pedido_id, autor_id, texto)
    values (new.pedido_id, null, 'Supervisión verificó y aprobó el trabajo. Ya podés calificarlo.');
  elsif new.revision_foto = 'rehacer' then
    insert into mant_pedido_comentarios (pedido_id, autor_id, texto)
    values (new.pedido_id, null, 'Supervisión pidió corregir algo del trabajo: el operario lo vuelve a revisar.');
  end if;
  return null;
end $$;
drop trigger if exists mant_ot_aviso_revision on mant_ordenes;
create trigger mant_ot_aviso_revision after update of revision_foto on mant_ordenes
  for each row execute function mant_ot_aviso_revision();

-- Calificación del solicitante (solo el que pidió, con el trabajo terminado). Se puede cambiar.
create or replace function mant_evaluar_pedido(p_pedido uuid, p_nota int, p_comentario text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos;
begin
  select * into ped from mant_pedidos where id = p_pedido for update;
  if ped.id is null then raise exception 'Pedido inexistente.'; end if;
  if ped.solicitante_id is distinct from auth.uid() then raise exception 'Solo quien hizo el pedido lo califica.'; end if;
  if ped.estado <> 'cerrado' then raise exception 'Se califica cuando el trabajo está completado.'; end if;
  if p_nota is null or p_nota < 1 or p_nota > 10 then raise exception 'La nota va de 1 a 10.'; end if;
  update mant_pedidos set evaluacion = p_nota, evaluacion_comentario = nullif(trim(p_comentario), ''), evaluado_en = now()
   where id = p_pedido;
  insert into mant_pedido_comentarios (pedido_id, texto)
  values (p_pedido, format('Calificación del solicitante: %s/10%s', p_nota, coalesce(' · ' || nullif(trim(p_comentario), ''), '')));
end $$;
revoke execute on function mant_evaluar_pedido(uuid, int, text) from anon;
grant execute on function mant_evaluar_pedido(uuid, int, text) to authenticated;

-- Promedio de las calificaciones por operario (quien hizo la OT del pedido)
drop view if exists mant_v_evaluacion_operarios;
create view mant_v_evaluacion_operarios with (security_invoker = true) as
select o.asignado_id as operario_id, u.nombre as operario,
       count(*) as calificaciones,
       round(avg(p.evaluacion)::numeric, 1) as promedio,
       min(p.evaluacion) as minima, max(p.evaluacion) as maxima,
       max(p.evaluado_en) as ultima
  from mant_pedidos p
  join mant_ordenes o on o.pedido_id = p.id and o.estado = 'completada'
  left join mant_usuarios u on u.id = o.asignado_id
 where p.evaluacion is not null
 group by o.asignado_id, u.nombre;
grant select on mant_v_evaluacion_operarios to authenticated;
