-- =============================================================================
-- 0009 · Pedidos: adjuntos (fotos, documentos, video, audio) y aviso al solicitante
-- cuando se mueve su OT en la agenda.
-- Se puede volver a correr.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Adjuntos del pedido
-- ---------------------------------------------------------------------------
create table if not exists mant_pedido_adjuntos (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references mant_pedidos(id) on delete cascade,
  tipo        text not null check (tipo in ('foto','documento','video','audio')),
  ruta        text not null,
  nombre      text,
  tamano      bigint,
  duracion_seg int,
  subido_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index if not exists mant_pedido_adjuntos_pedido on mant_pedido_adjuntos(pedido_id, creado_en);

create or replace function mant_puede_ver_pedido(p_pedido uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mant_pedidos p where p.id = p_pedido
                  and (p.solicitante_id = auth.uid() or auth.uid() = any(p.asignados_ids)
                       or mant_tiene_rol('referente','supervisor','operario','director','panolero','compras')))
$$;

alter table mant_pedido_adjuntos enable row level security;
drop policy if exists pedadj_ver on mant_pedido_adjuntos;
create policy pedadj_ver on mant_pedido_adjuntos for select using (mant_puede_ver_pedido(pedido_id));
drop policy if exists pedadj_cargar on mant_pedido_adjuntos;
create policy pedadj_cargar on mant_pedido_adjuntos for insert with check (
  exists (select 1 from mant_pedidos p where p.id = pedido_id and p.solicitante_id = auth.uid())
  or mant_tiene_rol('referente','supervisor'));
drop policy if exists pedadj_borrar on mant_pedido_adjuntos;
create policy pedadj_borrar on mant_pedido_adjuntos for delete using (
  (subido_por = auth.uid() and exists (select 1 from mant_pedidos p where p.id = pedido_id and p.estado = 'nuevo'))
  or mant_tiene_rol('referente','supervisor'));
grant select, insert, delete on mant_pedido_adjuntos to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Si se mueve la OT de un pedido (día, operario o prioridad), el pedido se entera:
--    el solicitante ve la nueva fecha y un aviso en "Mis pedidos".
-- ---------------------------------------------------------------------------
create or replace function mant_ot_sync_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos; quien text;
begin
  if new.pedido_id is null or new.estado not in ('pendiente','en_proceso') then return null; end if;
  if coalesce(current_setting('mant.convirtiendo', true), '') = '1' then return null; end if;
  if pg_trigger_depth() > 1 then return null; end if;   -- el cambio vino del propio pedido
  select * into ped from mant_pedidos where id = new.pedido_id;
  if ped.id is null or ped.estado <> 'en_ot' then return null; end if;

  if new.fecha_programada is distinct from old.fecha_programada and new.fecha_programada is not null then
    insert into mant_pedido_comentarios (pedido_id, texto)
    values (ped.id, format('Reprogramamos el trabajo para el %s%s.',
                           to_char(new.fecha_programada, 'DD/MM/YYYY'),
                           case when old.fecha_programada is not null then ' (antes ' || to_char(old.fecha_programada, 'DD/MM') || ')' else '' end));
    if ped.fecha_cierre_estimada is distinct from new.fecha_programada then
      update mant_pedidos
         set fecha_cierre_estimada = new.fecha_programada,
             cambio_fecha = jsonb_build_object('de', ped.fecha_cierre_estimada, 'a', new.fecha_programada,
                                               'motivo', 'Reprogramado en la agenda', 'fecha', current_date, 'avisado', false)
       where id = ped.id;
    end if;
  end if;

  if new.asignado_id is distinct from old.asignado_id and new.asignado_id is not null then
    select nombre into quien from mant_usuarios where id = new.asignado_id;
    update mant_pedidos set responsable_id = new.asignado_id, asignados_ids = array[new.asignado_id] where id = ped.id;
    insert into mant_pedido_comentarios (pedido_id, texto)
    values (ped.id, format('Lo va a hacer %s.', coalesce(quien, 'otro operario')));
  end if;

  if new.prioridad is distinct from old.prioridad then
    update mant_pedidos set prioridad = new.prioridad where id = ped.id and prioridad is distinct from new.prioridad;
  end if;
  return null;
end $$;
drop trigger if exists mant_ot_al_mover on mant_ordenes;
create trigger mant_ot_al_mover after update of fecha_programada, asignado_id, prioridad on mant_ordenes
  for each row execute function mant_ot_sync_pedido();

-- Al convertir un pedido en OT no se avisa "reprogramado" (es la primera fecha)
create or replace function mant_convertir_pedido(
  p_pedido uuid, p_prioridad text, p_plazo date, p_duracion_dias numeric,
  p_operario uuid, p_dia date default null, p_observacion text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos; ot uuid; dia date; nro bigint; nom text;
begin
  if not mant_tiene_rol('referente','supervisor') then raise exception 'Solo mantenimiento asigna pedidos.'; end if;
  perform set_config('mant.convirtiendo', '1', true);   -- la OT recién creada no genera avisos de reprogramación
  select * into ped from mant_pedidos where id = p_pedido for update;
  if ped.id is null then raise exception 'Pedido inexistente.'; end if;
  if ped.estado in ('en_ot','cerrado') then raise exception 'El pedido ya tiene orden de trabajo.'; end if;
  if p_prioridad not in ('baja','media','alta','urgente') then raise exception 'Elegí la prioridad.'; end if;
  if p_plazo is null then raise exception 'Elegí el plazo.'; end if;
  if p_operario is null then raise exception 'Elegí quién lo hace.'; end if;
  if ped.estado <> 'nuevo' then
    update mant_pedidos set estado = 'nuevo', motivo_rechazo = null where id = p_pedido;
  end if;

  dia := greatest(current_date, coalesce(p_dia, current_date));
  ot := mant_resolver_pedido(p_pedido, true, p_prioridad, p_plazo, p_operario, null, null);
  update mant_ordenes
     set fecha_programada = dia, semana = date_trunc('week', dia)::date,
         duracion_estimada_horas = coalesce(p_duracion_dias, 1) * 8,
         observacion = nullif(trim(p_observacion), ''),
         turno = (select turno from mant_usuarios where id = p_operario)
   where id = ot
  returning numero into nro;

  update mant_pedidos
     set fecha_cierre_estimada = p_plazo, responsable_id = p_operario, asignados_ids = array[p_operario],
         duracion_dias = coalesce(p_duracion_dias, 1), fecha_inicio = dia, prioridad = p_prioridad
   where id = p_pedido;

  select nombre into nom from mant_usuarios where id = p_operario;
  insert into mant_pedido_comentarios (pedido_id, autor_id, texto)
  values (p_pedido, null, format('Asignado a %s · fecha comprometida %s · OT-%s',
                                 nom, to_char(p_plazo, 'DD/MM'), lpad(nro::text, 4, '0')));
  perform set_config('mant.convirtiendo', '', true);
  return ot;
end $$;
revoke execute on function mant_convertir_pedido(uuid, text, date, numeric, uuid, date, text) from anon;
