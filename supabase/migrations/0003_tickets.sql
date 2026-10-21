-- =====================================================================
-- 0003 · Tickets de mantenimiento con la forma del "Panel de mantenimiento"
--
-- El pedido de reparación pasa a ser el ticket completo que ven el
-- solicitante (desde el celular) y el equipo de mantenimiento:
--   · urgencia reportada por quien pide, prioridad que fija mantenimiento
--   · fecha probable de cierre, con motivo cuando se cambia y aviso al solicitante
--   · responsable, personal asignado (varios) o tercerizado, duración y día de inicio
--   · materiales / recursos con disponibilidad (readiness)
--   · comentarios de seguimiento (los ve el solicitante)
--   · carga en la agenda semanal por persona y día, en fracciones de jornada
-- La orden de trabajo sigue existiendo por debajo (se crea al pasar el ticket a
-- "en proceso") y el cierre sigue exigiendo foto. Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas del ticket
-- ---------------------------------------------------------------------
alter table mant_pedidos
  add column if not exists titulo               text,
  add column if not exists urgencia_reportada   text check (urgencia_reportada in ('alta','media','baja')),
  add column if not exists fecha_reporte        date not null default current_date,
  add column if not exists fecha_cierre_estimada date,
  add column if not exists responsable_id       uuid references mant_usuarios(id) on delete set null,
  add column if not exists asignados_ids        uuid[] not null default '{}',
  add column if not exists tercerizado          boolean not null default false,
  add column if not exists tercerizado_detalle  text,
  add column if not exists duracion_dias        numeric(5,2) check (duracion_dias is null or duracion_dias > 0),
  add column if not exists fecha_inicio         date,
  add column if not exists cambio_fecha         jsonb;   -- {de, a, motivo, fecha, avisado}

-- Al crear el ticket: estado nuevo, prioridad inicial = urgencia reportada
create or replace function mant_nuevo_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.estado := 'nuevo';
  new.urgencia_reportada := coalesce(new.urgencia_reportada, case when new.equipo_detenido then 'alta' else 'media' end);
  new.equipo_detenido := coalesce(new.equipo_detenido, false) or new.urgencia_reportada = 'alta';
  new.prioridad := new.urgencia_reportada;
  new.fecha_reporte := coalesce(new.fecha_reporte, current_date);
  new.titulo := coalesce(nullif(trim(new.titulo), ''), left(new.descripcion, 80));
  new.fecha_comprometida := null; new.fecha_cierre_estimada := null;
  new.referente_id := null; new.motivo_rechazo := null; new.cambio_fecha := null;
  new.responsable_id := null; new.asignados_ids := '{}'; new.tercerizado := false;
  new.solicitante_id := coalesce(auth.uid(), new.solicitante_id);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Comentarios, materiales y agenda del ticket
-- ---------------------------------------------------------------------
create table if not exists mant_pedido_comentarios (
  id         uuid primary key default gen_random_uuid(),
  pedido_id  uuid not null references mant_pedidos(id) on delete cascade,
  autor_id   uuid default auth.uid() references mant_usuarios(id) on delete set null,
  texto      text not null check (length(trim(texto)) > 0),
  creado_en  timestamptz not null default now()
);
create index if not exists mant_pedido_comentarios_pedido on mant_pedido_comentarios(pedido_id, creado_en);

create table if not exists mant_pedido_materiales (
  id             uuid primary key default gen_random_uuid(),
  pedido_id      uuid not null references mant_pedidos(id) on delete cascade,
  articulo_id    uuid references mant_articulos(id) on delete set null,
  nombre         text not null check (length(trim(nombre)) > 0),
  cantidad       text,
  disponibilidad text not null default 'sin_verificar'
                 check (disponibilidad in ('sin_verificar','stock','pedido','transito')),
  creado_en      timestamptz not null default now()
);
create index if not exists mant_pedido_materiales_pedido on mant_pedido_materiales(pedido_id);

create table if not exists mant_pedido_agenda (
  pedido_id  uuid not null references mant_pedidos(id) on delete cascade,
  usuario_id uuid not null references mant_usuarios(id) on delete cascade,
  dia        date not null,
  fraccion   numeric(4,2) not null check (fraccion > 0 and fraccion <= 1),
  primary key (pedido_id, usuario_id, dia)
);
create index if not exists mant_pedido_agenda_dia on mant_pedido_agenda(dia, usuario_id);

-- ---------------------------------------------------------------------
-- 3. Reglas
-- ---------------------------------------------------------------------
-- Quién ve un ticket: el que lo pidió, el personal asignado y mantenimiento
create or replace function mant_puede_ver_pedido(p_pedido uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from mant_pedidos p
    where p.id = p_pedido
      and (p.solicitante_id = auth.uid()
           or auth.uid() = any(p.asignados_ids)
           or mant_tiene_rol('referente','supervisor','operario','director','panolero','compras'))
  );
$$;

drop policy if exists pedidos_ver on mant_pedidos;
create policy pedidos_ver on mant_pedidos for select
  using (solicitante_id = auth.uid() or auth.uid() = any(asignados_ids)
         or mant_tiene_rol('referente','supervisor','operario','director','panolero','compras'));

-- Cambios de prioridad / responsable / fecha del ticket se reflejan en su OT abierta
create or replace function mant_pedido_sync_ot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'en_ot' and (new.prioridad is distinct from old.prioridad
      or new.responsable_id is distinct from old.responsable_id
      or new.fecha_cierre_estimada is distinct from old.fecha_cierre_estimada
      or new.titulo is distinct from old.titulo) then
    update mant_ordenes
       set prioridad = coalesce(new.prioridad, prioridad),
           asignado_id = coalesce(new.responsable_id, asignado_id),
           fecha_comprometida = new.fecha_cierre_estimada,
           titulo = coalesce(new.titulo, titulo)
     where pedido_id = new.id and estado in ('pendiente','en_proceso');
  end if;
  new.fecha_comprometida := new.fecha_cierre_estimada;
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists mant_pedido_sync on mant_pedidos;
create trigger mant_pedido_sync before update on mant_pedidos
  for each row execute function mant_pedido_sync_ot();

-- Cambio de fecha probable de cierre: queda el motivo, un comentario y el aviso pendiente
create or replace function mant_cambiar_fecha_cierre(p_pedido uuid, p_fecha date, p_motivo text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo mantenimiento define la fecha de cierre.';
  end if;
  select * into ped from mant_pedidos where id = p_pedido for update;
  if ped.id is null then raise exception 'Ticket inexistente.'; end if;
  if ped.fecha_cierre_estimada is not null and ped.fecha_cierre_estimada <> p_fecha then
    if coalesce(trim(p_motivo), '') = '' then
      raise exception 'Hace falta el motivo del cambio de fecha.';
    end if;
    insert into mant_pedido_comentarios (pedido_id, texto)
    values (p_pedido, format('Fecha probable de cierre modificada de %s a %s. Motivo: %s',
                             to_char(ped.fecha_cierre_estimada, 'DD/MM/YYYY'), to_char(p_fecha, 'DD/MM/YYYY'), trim(p_motivo)));
    update mant_pedidos
       set fecha_cierre_estimada = p_fecha,
           cambio_fecha = jsonb_build_object('de', ped.fecha_cierre_estimada, 'a', p_fecha, 'motivo', trim(p_motivo),
                                             'fecha', current_date, 'avisado', false)
     where id = p_pedido;
  else
    update mant_pedidos set fecha_cierre_estimada = p_fecha where id = p_pedido;
  end if;
end $$;

-- Estado del ticket desde la tarjeta: 'pendiente' (sin OT) o 'proceso' (con OT).
-- 'completado' se hace cerrando la OT con foto (regla que no cambia).
create or replace function mant_estado_pedido(p_pedido uuid, p_estado text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos; ot uuid;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo mantenimiento cambia el estado del ticket.';
  end if;
  select * into ped from mant_pedidos where id = p_pedido for update;
  if ped.id is null then raise exception 'Ticket inexistente.'; end if;
  if ped.estado = 'cerrado' then raise exception 'El ticket ya está completado.'; end if;

  if p_estado = 'proceso' then
    if ped.estado = 'en_ot' then
      select id into ot from mant_ordenes where pedido_id = p_pedido and estado in ('pendiente','en_proceso') limit 1;
      return ot;
    end if;
    if ped.estado = 'rechazado' then
      update mant_pedidos set estado = 'nuevo', motivo_rechazo = null where id = p_pedido;
    end if;
    ot := mant_resolver_pedido(p_pedido, true, coalesce(ped.prioridad, 'media'), ped.fecha_cierre_estimada,
                               ped.responsable_id, null, null);
    update mant_ordenes set fecha_programada = coalesce(ped.fecha_inicio, fecha_programada),
                            semana = date_trunc('week', coalesce(ped.fecha_inicio, fecha_programada))::date,
                            duracion_estimada_horas = coalesce(ped.duracion_dias * 8, duracion_estimada_horas)
     where id = ot;
    return ot;
  elsif p_estado = 'pendiente' then
    if ped.estado = 'en_ot' then
      update mant_ordenes set estado = 'cancelada' where pedido_id = p_pedido and estado in ('pendiente','en_proceso');
    end if;
    update mant_pedidos set estado = 'nuevo', motivo_rechazo = null where id = p_pedido and estado <> 'nuevo';
    return null;
  elsif p_estado = 'rechazado' then
    update mant_ordenes set estado = 'cancelada' where pedido_id = p_pedido and estado in ('pendiente','en_proceso');
    update mant_pedidos set estado = 'rechazado' where id = p_pedido;
    return null;
  else
    raise exception 'Estado desconocido: %', p_estado;
  end if;
end $$;

-- Carga del ticket en la agenda semanal: reparte la duración (en jornadas) desde el
-- día de inicio entre las personas asignadas. Devuelve las celdas que quedan sobrecargadas.
create or replace function mant_cargar_agenda(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos; dias int; i int; f numeric; u uuid; sobre jsonb := '[]'::jsonb; celda record;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo mantenimiento carga la agenda.';
  end if;
  select * into ped from mant_pedidos where id = p_pedido for update;
  if ped.id is null then raise exception 'Ticket inexistente.'; end if;
  if coalesce(array_length(ped.asignados_ids, 1), 0) = 0 and not ped.tercerizado then
    raise exception 'Tildá al menos una persona (o "Tercerizar") antes de cargar en la agenda.';
  end if;
  if ped.fecha_inicio is null then raise exception 'Elegí un día de inicio antes de cargar en la agenda.'; end if;
  if ped.duracion_dias is null then raise exception 'Ingresá la duración estimada en días.'; end if;

  delete from mant_pedido_agenda where pedido_id = p_pedido;
  dias := ceil(ped.duracion_dias);
  for i in 0 .. dias - 1 loop
    f := least(ped.duracion_dias - i, 1);
    foreach u in array ped.asignados_ids loop
      insert into mant_pedido_agenda (pedido_id, usuario_id, dia, fraccion)
      values (p_pedido, u, ped.fecha_inicio + i, f);
    end loop;
  end loop;

  -- la OT (si existe) sigue a la agenda
  update mant_ordenes
     set asignado_id = coalesce(ped.asignados_ids[1], ped.responsable_id, asignado_id),
         fecha_programada = ped.fecha_inicio,
         semana = date_trunc('week', ped.fecha_inicio)::date,
         duracion_estimada_horas = ped.duracion_dias * 8
   where pedido_id = p_pedido and estado in ('pendiente','en_proceso');

  for celda in
    select a.usuario_id, a.dia, sum(a.fraccion) as total, u2.nombre
      from mant_pedido_agenda a join mant_usuarios u2 on u2.id = a.usuario_id
     where (a.usuario_id, a.dia) in (select usuario_id, dia from mant_pedido_agenda where pedido_id = p_pedido)
     group by a.usuario_id, a.dia, u2.nombre
    having sum(a.fraccion) > 1.0001
  loop
    sobre := sobre || jsonb_build_object('usuario_id', celda.usuario_id, 'nombre', celda.nombre, 'dia', celda.dia, 'total', celda.total);
  end loop;
  return sobre;
end $$;

-- ---------------------------------------------------------------------
-- 4. Seguridad
-- ---------------------------------------------------------------------
alter table mant_pedido_comentarios enable row level security;
alter table mant_pedido_materiales  enable row level security;
alter table mant_pedido_agenda      enable row level security;

drop policy if exists pcom_ver on mant_pedido_comentarios;
create policy pcom_ver on mant_pedido_comentarios for select using (mant_puede_ver_pedido(pedido_id));
drop policy if exists pcom_crear on mant_pedido_comentarios;
create policy pcom_crear on mant_pedido_comentarios for insert
  with check (mant_activo() and autor_id = auth.uid() and mant_puede_ver_pedido(pedido_id));
drop policy if exists pcom_borrar on mant_pedido_comentarios;
create policy pcom_borrar on mant_pedido_comentarios for delete
  using (autor_id = auth.uid() or mant_tiene_rol('referente','supervisor'));

drop policy if exists pmat_ver on mant_pedido_materiales;
create policy pmat_ver on mant_pedido_materiales for select using (mant_puede_ver_pedido(pedido_id));
drop policy if exists pmat_editar on mant_pedido_materiales;
create policy pmat_editar on mant_pedido_materiales for all
  using (mant_tiene_rol('referente','supervisor','panolero'))
  with check (mant_tiene_rol('referente','supervisor','panolero'));

drop policy if exists pag_ver on mant_pedido_agenda;
create policy pag_ver on mant_pedido_agenda for select using (mant_activo());
-- la agenda solo se escribe por mant_cargar_agenda (security definer)

revoke execute on function mant_cambiar_fecha_cierre(uuid, date, text) from anon;
revoke execute on function mant_estado_pedido(uuid, text) from anon;
revoke execute on function mant_cargar_agenda(uuid) from anon;

do $$
declare t text;
begin
  foreach t in array array['mant_pedido_comentarios','mant_pedido_materiales'] loop
    execute format('drop trigger if exists %I on %I', t || '_auditoria', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function mant_auditar()',
                   t || '_auditoria', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Vistas
-- ---------------------------------------------------------------------
drop view if exists mant_v_pedidos;
create view mant_v_pedidos with (security_invoker = true) as
select p.*,
       e.codigo as equipo_codigo, e.nombre as equipo_nombre,
       s.nombre as solicitante_nombre, s.email as solicitante_email,
       r.nombre as responsable_nombre,
       (select array_agg(u.nombre order by u.nombre) from mant_usuarios u where u.id = any(p.asignados_ids)) as asignados_nombres,
       (select o.id from mant_ordenes o where o.pedido_id = p.id order by o.creado_en desc limit 1) as orden_id,
       (select o.estado from mant_ordenes o where o.pedido_id = p.id order by o.creado_en desc limit 1) as orden_estado,
       (select o.numero from mant_ordenes o where o.pedido_id = p.id order by o.creado_en desc limit 1) as orden_numero,
       (select case when count(*) = 0 then 'sinmateriales'
                    when bool_and(m.disponibilidad = 'stock') then 'listo'
                    else 'esperando' end
          from mant_pedido_materiales m where m.pedido_id = p.id) as recursos,
       (select count(*) from mant_pedido_comentarios c where c.pedido_id = p.id) as comentarios,
       (current_date - p.fecha_reporte) as dias_abierto
from mant_pedidos p
left join mant_equipos e on e.id = p.equipo_id
left join mant_usuarios s on s.id = p.solicitante_id
left join mant_usuarios r on r.id = p.responsable_id;

create or replace view mant_v_agenda with (security_invoker = true) as
select a.pedido_id, a.usuario_id, a.dia, a.fraccion,
       u.nombre as usuario_nombre, p.numero, p.titulo, p.prioridad, p.estado
from mant_pedido_agenda a
join mant_usuarios u on u.id = a.usuario_id
join mant_pedidos p on p.id = a.pedido_id;

grant select on mant_v_pedidos, mant_v_agenda to authenticated;
grant all on mant_pedido_comentarios, mant_pedido_materiales, mant_pedido_agenda to authenticated;
