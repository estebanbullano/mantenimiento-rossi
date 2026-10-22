-- =====================================================================
-- 0004 · Plataforma con la forma de la demo "Plataforma de mantenimiento · Famiglia Rossi"
--
--   · Ingreso de planta: operarios y solicitantes entran con legajo o DNI (sin contraseña)
--   · Pedido: estado del equipo (parado / funciona con problemas / detalle menor),
--     nombre y mail de contacto, llega "sin prioridad" a la bandeja
--   · "Convertir en OT y asignar": prioridad, plazo, duración, operario, día y observación
--   · Avisos al solicitante en el seguimiento del pedido
--   · Revisión de fotos de cierre por el supervisor (aprobar / pedir rehacer)
--   · Compras con centro de costo (planta) y "pedir presupuesto" desde el pañol
-- Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Usuarios de planta (legajo / DNI)
-- ---------------------------------------------------------------------
alter table mant_usuarios
  add column if not exists legajo       text,
  add column if not exists dni          text;

create unique index if not exists mant_usuarios_legajo on mant_usuarios(legajo) where legajo is not null;
create unique index if not exists mant_usuarios_dni on mant_usuarios(dni) where dni is not null;

-- Clave interna del ingreso por legajo: tabla aparte, sin acceso desde la app
create table if not exists mant_usuarios_planta (
  id     uuid primary key references mant_usuarios(id) on delete cascade,
  clave  text not null
);
alter table mant_usuarios_planta enable row level security;
revoke all on mant_usuarios_planta from anon, authenticated;

-- Ingreso de planta: con el legajo o el DNI devuelve el mail interno y la clave
-- de esa cuenta para iniciar sesión. Solo cuentas activas con ingreso de planta.
create or replace function mant_ingreso_planta(p_id text)
returns table (email text, clave text)
language sql stable security definer set search_path = public as $$
  select u.email, k.clave
    from mant_usuarios u
    join mant_usuarios_planta k on k.id = u.id
   where u.activo
     and (u.legajo = trim(p_id) or u.dni = regexp_replace(trim(p_id), '\D', '', 'g'))
   limit 1
$$;
grant execute on function mant_ingreso_planta(text) to anon, authenticated;

-- Alta de una persona de planta (operario o solicitante) por el administrador.
-- Crea la cuenta de acceso con un mail interno y la deja activa.
create or replace function mant_crear_usuario_planta(
  p_nombre text, p_legajo text, p_dni text, p_rol text default 'operario',
  p_turno text default null, p_area text default null)
returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); correo text; clave text;
begin
  if not mant_tiene_rol('admin') then raise exception 'Solo el administrador da de alta usuarios.'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Falta el nombre.'; end if;
  if coalesce(trim(p_legajo), '') = '' and coalesce(trim(p_dni), '') = '' then
    raise exception 'Cargá el legajo o el DNI.';
  end if;
  if p_rol not in ('operario','solicitante','supervisor','panolero') then raise exception 'Rol no válido para planta.'; end if;
  correo := 'planta-' || coalesce(nullif(trim(p_legajo), ''), regexp_replace(p_dni, '\D', '', 'g')) || '@planta.famigliarossi.local';
  clave := encode(gen_random_bytes(18), 'hex');

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', correo,
          crypt(clave, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nombre', trim(p_nombre)),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', correo, 'email_verified', true),
          'email', now(), now(), now());

  update mant_usuarios
     set nombre = trim(p_nombre), rol = p_rol, turno = nullif(trim(p_turno), ''), area = nullif(trim(p_area), ''),
         legajo = nullif(trim(p_legajo), ''), dni = nullif(regexp_replace(coalesce(p_dni, ''), '\D', '', 'g'), ''),
         activo = true
   where id = uid;
  insert into mant_usuarios_planta (id, clave) values (uid, clave);
  return uid;
end $$;
revoke execute on function mant_crear_usuario_planta(text, text, text, text, text, text) from anon;

-- ---------------------------------------------------------------------
-- 2. Pedido de reparación: estado del equipo, contacto y "sin prioridad"
-- ---------------------------------------------------------------------
alter table mant_pedidos
  add column if not exists nombre_contacto text,
  add column if not exists email_contacto  text;

create or replace function mant_nuevo_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
declare u mant_usuarios;
begin
  new.solicitante_id := coalesce(auth.uid(), new.solicitante_id);
  select * into u from mant_usuarios where id = new.solicitante_id;
  new.estado := 'nuevo';
  -- urgencia reportada = estado del equipo: alta parado · media funciona con problemas · baja detalle menor
  new.urgencia_reportada := coalesce(new.urgencia_reportada, case when new.equipo_detenido then 'alta' else 'media' end);
  new.equipo_detenido := new.urgencia_reportada = 'alta';
  new.prioridad := null;                         -- la fija mantenimiento en la bandeja
  new.fecha_reporte := coalesce(new.fecha_reporte, current_date);
  new.titulo := coalesce(nullif(trim(new.titulo), ''), left(new.descripcion, 80));
  new.nombre_contacto := coalesce(nullif(trim(new.nombre_contacto), ''), u.nombre);
  new.email_contacto := coalesce(nullif(trim(new.email_contacto), ''),
                                 case when u.email not like '%@planta.famigliarossi.local' then u.email end);
  new.area := coalesce(nullif(trim(new.area), ''), u.area);
  new.fecha_comprometida := null; new.fecha_cierre_estimada := null;
  new.referente_id := null; new.motivo_rechazo := null; new.cambio_fecha := null;
  new.responsable_id := null; new.asignados_ids := '{}'; new.tercerizado := false;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Órdenes: observación para el operario y revisión de la foto de cierre
-- ---------------------------------------------------------------------
alter table mant_ordenes
  add column if not exists observacion    text,
  add column if not exists revision_foto  text check (revision_foto in ('pendiente','aprobada','rehacer')),
  add column if not exists revisada_por   uuid references mant_usuarios(id) on delete set null,
  add column if not exists revisada_en    timestamptz;

alter table mant_ot_fotos drop constraint if exists mant_ot_fotos_tipo_check;
alter table mant_ot_fotos add constraint mant_ot_fotos_tipo_check check (tipo in ('antes','cierre','rechazada'));

-- Al cerrarse una OT su foto queda para revisar; al cerrarse una correctiva se avisa al solicitante
create or replace function mant_ot_aviso_cierre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'completada' and old.estado <> 'completada' then
    update mant_ordenes set revision_foto = 'pendiente', revisada_por = null, revisada_en = null where id = new.id;
    if new.pedido_id is not null then
      insert into mant_pedido_comentarios (pedido_id, autor_id, texto)
      values (new.pedido_id, null, format('Trabajo terminado · %s', 'OT-' || lpad(new.numero::text, 4, '0')));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists mant_ot_aviso_cierre on mant_ordenes;
create trigger mant_ot_aviso_cierre after update of estado on mant_ordenes
  for each row execute function mant_ot_aviso_cierre();

-- El supervisor aprueba la foto o pide rehacer el trabajo (la OT se reabre y pide foto nueva)
create or replace function mant_revisar_foto(p_orden uuid, p_resultado text, p_comentario text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare o mant_ordenes;
begin
  if not mant_tiene_rol('referente','supervisor') then raise exception 'Solo mantenimiento revisa las fotos de cierre.'; end if;
  select * into o from mant_ordenes where id = p_orden for update;
  if o.id is null then raise exception 'Orden inexistente.'; end if;
  if p_resultado = 'aprobada' then
    update mant_ordenes set revision_foto = 'aprobada', revisada_por = auth.uid(), revisada_en = now() where id = p_orden;
  elsif p_resultado = 'rehacer' then
    if o.estado = 'completada' then
      update mant_ot_fotos set tipo = 'rechazada' where orden_id = p_orden and tipo = 'cierre';
      update mant_ordenes set estado = 'en_proceso', revision_foto = 'rehacer', revisada_por = auth.uid(), revisada_en = now(),
             observacion = trim(both ' ' from coalesce(observacion, '') || case when coalesce(trim(p_comentario), '') <> ''
                                 then E'\nPara rehacer: ' || trim(p_comentario) else '' end)
       where id = p_orden;
      if o.pedido_id is not null then
        update mant_pedidos set estado = 'en_ot' where id = o.pedido_id and estado = 'cerrado';
      end if;
    end if;
  elsif p_resultado = 'pendiente' then
    update mant_ordenes set revision_foto = 'pendiente', revisada_por = null, revisada_en = null where id = p_orden;
  else
    raise exception 'Resultado desconocido: %', p_resultado;
  end if;
end $$;
revoke execute on function mant_revisar_foto(uuid, text, text) from anon;

-- ---------------------------------------------------------------------
-- 4. Convertir un pedido en OT y asignarlo (bandeja de pedidos)
-- ---------------------------------------------------------------------
create or replace function mant_convertir_pedido(
  p_pedido uuid, p_prioridad text, p_plazo date, p_duracion_dias numeric,
  p_operario uuid, p_dia date default null, p_observacion text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos; ot uuid; dia date; nro bigint; nom text;
begin
  if not mant_tiene_rol('referente','supervisor') then raise exception 'Solo mantenimiento asigna pedidos.'; end if;
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
  return ot;
end $$;
revoke execute on function mant_convertir_pedido(uuid, text, date, numeric, uuid, date, text) from anon;

-- ---------------------------------------------------------------------
-- 5. Compras: centro de costo y pedido de presupuesto desde el pañol
-- ---------------------------------------------------------------------
alter table mant_compras
  add column if not exists planta_id uuid references mant_plantas(id) on delete set null;

-- Si la compra viene de una OT o de una tarea, el centro de costo es la planta del equipo
create or replace function mant_compra_centro_costo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.planta_id is null then
    select e.planta_id into new.planta_id
      from mant_equipos e
     where e.id = coalesce((select equipo_id from mant_ordenes where id = new.orden_id),
                           (select equipo_id from mant_tareas where id = new.tarea_id));
  end if;
  return new;
end $$;
drop trigger if exists mant_compra_cc on mant_compras;
create trigger mant_compra_cc before insert or update of orden_id, tarea_id on mant_compras
  for each row execute function mant_compra_centro_costo();

update mant_compras c set planta_id = e.planta_id
  from mant_equipos e
 where c.planta_id is null
   and e.id = coalesce((select equipo_id from mant_ordenes where id = c.orden_id),
                       (select equipo_id from mant_tareas where id = c.tarea_id));

-- "Pedir presupuesto" de un repuesto bajo mínimo: crea la compra pendiente con su ítem
create or replace function mant_pedir_presupuesto(p_articulo uuid, p_cantidad numeric default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare a mant_articulos; c uuid; cant numeric; pl uuid;
begin
  if not mant_tiene_rol('referente','supervisor','panolero','compras') then
    raise exception 'No tenés permiso para pedir presupuestos.';
  end if;
  select * into a from mant_articulos where id = p_articulo;
  if a.id is null then raise exception 'Repuesto inexistente.'; end if;
  if exists (select 1 from mant_compra_items i join mant_compras k on k.id = i.compra_id
              where i.articulo_id = p_articulo and k.estado in ('borrador','pendiente','aprobada','comprada')) then
    raise exception 'Ya hay un pedido en curso para este repuesto.';
  end if;
  cant := coalesce(p_cantidad, greatest(coalesce(a.stock_sugerido, a.stock_minimo * 2) - a.stock_actual, 1));
  select e.planta_id into pl
    from mant_equipo_repuestos r join mant_equipos e on e.id = r.equipo_id
   where r.articulo_id = p_articulo limit 1;
  insert into mant_compras (descripcion, moneda, monto, estado, planta_id, comentario)
  values (format('%s × %s', a.descripcion, trim(to_char(cant, 'FM999999990.###'))), 'USD',
          coalesce(a.costo_unit_usd, 0) * cant, 'pendiente', pl, 'Pedido de presupuesto desde el pañol')
  returning id into c;
  insert into mant_compra_items (compra_id, articulo_id, descripcion, cantidad)
  values (c, p_articulo, a.descripcion, cant);
  return c;
end $$;
revoke execute on function mant_pedir_presupuesto(uuid, numeric) from anon;

-- ---------------------------------------------------------------------
-- 6. Vistas
-- ---------------------------------------------------------------------
drop view if exists mant_v_pedidos;
create view mant_v_pedidos with (security_invoker = true) as
select p.*,
       e.codigo as equipo_codigo, e.nombre as equipo_nombre,
       pl.nombre as planta_nombre, sc.nombre as sector_nombre,
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
left join mant_plantas pl on pl.id = e.planta_id
left join mant_sectores sc on sc.id = e.sector_id
left join mant_usuarios s on s.id = p.solicitante_id
left join mant_usuarios r on r.id = p.responsable_id;

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

grant select on mant_v_pedidos, mant_v_ordenes to authenticated;
