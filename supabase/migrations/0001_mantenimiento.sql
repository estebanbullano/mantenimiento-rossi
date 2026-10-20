-- =====================================================================
-- Mantenimiento Rossi — Agrícola Magdalena S.R.L.
-- Esquema completo de la Etapa 1: planificación, correctivo y ejecución,
-- pañol y compras.
--
-- Todas las tablas usan el prefijo mant_ para poder convivir en el mismo
-- proyecto de Supabase que Compras Rossi sin chocar con sus tablas.
-- Se corre una sola vez en el SQL Editor de Supabase.
-- =====================================================================

-- gen_random_uuid() es nativo desde Postgres 13; no hace falta pgcrypto.

-- ---------------------------------------------------------------------
-- 1. Usuarios y roles
-- ---------------------------------------------------------------------
-- Roles:
--   solicitante  áreas de planta que piden reparaciones
--   operario     operarios de turno y de mantenimiento central
--   referente    referentes de mantenimiento: priorizan, planifican, aprueban hasta su límite
--   supervisor   supervisor de mantenimiento: asigna y controla avance
--   panolero     pañol: catálogo, entradas y salidas
--   compras      área de compras: presupuestos y proveedores
--   director     aprueba compras por encima del límite del referente
--   admin        administra usuarios y configuración

create table if not exists mant_usuarios (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text,
  nombre                text not null default '',
  rol                   text not null default 'solicitante'
                        check (rol in ('solicitante','operario','referente','supervisor','panolero','compras','director','admin')),
  area                  text,
  turno                 text,
  limite_aprobacion_usd numeric(14,2) not null default 0,
  activo                boolean not null default false,
  creado_en             timestamptz not null default now()
);

-- Rol del usuario conectado (null si no está activo)
create or replace function mant_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from mant_usuarios where id = auth.uid() and activo
$$;

create or replace function mant_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from mant_usuarios where id = auth.uid() and activo)
$$;

-- ¿El usuario conectado tiene alguno de estos roles? (admin siempre pasa)
create or replace function mant_tiene_rol(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mant_rol() = 'admin' or mant_rol() = any(roles), false)
$$;

-- Personal de mantenimiento con visión completa
create or replace function mant_es_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select mant_tiene_rol('referente','supervisor','director')
$$;

-- Cada alta en auth crea su fila, inactiva hasta que un admin la habilite
create or replace function mant_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into mant_usuarios (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists mant_al_crear_usuario on auth.users;
create trigger mant_al_crear_usuario after insert on auth.users
  for each row execute function mant_nuevo_usuario();

-- Usuarios que ya existían (por ejemplo, los de Compras Rossi)
insert into mant_usuarios (id, email, nombre)
select id, email, coalesce(raw_user_meta_data->>'nombre', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Configuración (una sola fila)
-- ---------------------------------------------------------------------
create table if not exists mant_config (
  id                     int primary key default 1 check (id = 1),
  corte_costo_usd        numeric(14,2) not null default 5000,  -- corte de costo de la matriz RG MA 03
  cm_supera_corte        int not null default 2,               -- CM si el costo de mantenimiento es >= al corte
  cm_no_supera_corte     int not null default 1,               -- CM si es menor
  umbral_mc              int not null default 16,              -- desde esta consecuencia: MC (media criticidad)
  umbral_c               int not null default 35,              -- desde esta consecuencia: C (crítico)
  hora_inicio_turno_noche time not null default '22:00',
  actualizado_en         timestamptz not null default now()
);
insert into mant_config (id) values (1) on conflict (id) do nothing;

comment on table mant_config is 'Valores tomados de la matriz RG MA 03 (rev. 01); los umbrales salen de la clasificación cargada en el RG MA 01.';

-- ---------------------------------------------------------------------
-- 3. Plantas, sectores y equipos
-- ---------------------------------------------------------------------
create table if not exists mant_plantas (
  id      uuid primary key default gen_random_uuid(),
  codigo  text not null unique,          -- ej. FP
  nombre  text not null,
  activo  boolean not null default true
);

create table if not exists mant_sectores (
  id        uuid primary key default gen_random_uuid(),
  planta_id uuid not null references mant_plantas(id) on delete restrict,
  codigo    text not null,               -- ej. PL
  nombre    text not null,
  activo    boolean not null default true,
  unique (planta_id, codigo)
);

create table if not exists mant_equipos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,  -- ej. FP-PL-HORNO-1
  nombre           text not null,
  planta_id        uuid not null references mant_plantas(id) on delete restrict,
  sector_id        uuid references mant_sectores(id) on delete set null,
  descripcion      text,
  marca            text,
  modelo           text,
  nro_serie        text,
  diseno_propio    boolean not null default false,
  tiene_reemplazo  boolean not null default false,
  -- Criticidad: C = (IO × FO) + CM + ISA
  io               int not null default 1 check (io >= 0),   -- impacto operacional
  fo               int not null default 1 check (fo >= 0),   -- flexibilidad operacional
  cm_manual        int check (cm_manual >= 0),               -- si se carga, reemplaza al calculado por costo
  costo_falla_usd  numeric(14,2),                            -- costo de mantenimiento / falla
  isa              int not null default 0 check (isa >= 0),  -- impacto en seguridad y ambiente
  frecuencia_fallas int check (frecuencia_fallas between 1 and 4), -- FREC: 4 pobre (>3/año) … 1 excelente (<1/año)
  clasificacion_manual text check (clasificacion_manual in ('NC','MC','C')), -- la que asigna el referente (RG MA 01)
  notas            text,
  activo           boolean not null default true,
  creado_en        timestamptz not null default now()
);
create index if not exists mant_equipos_planta on mant_equipos(planta_id, sector_id);

-- Vista con la criticidad calculada según la configuración vigente
create or replace view mant_v_equipos with (security_invoker = true) as
select e.*,
       p.codigo as planta_codigo, p.nombre as planta_nombre,
       s.codigo as sector_codigo, s.nombre as sector_nombre,
       x.cm,
       (e.io * e.fo + x.cm + e.isa) as criticidad,
       x.calculada as clasificacion_calculada,
       coalesce(e.clasificacion_manual, x.calculada) as clasificacion
from mant_equipos e
join mant_plantas p on p.id = e.planta_id
left join mant_sectores s on s.id = e.sector_id
cross join mant_config c
cross join lateral (
  select coalesce(e.cm_manual,
                  case when coalesce(e.costo_falla_usd, 0) >= c.corte_costo_usd
                       then c.cm_supera_corte else c.cm_no_supera_corte end) as cm
) x0
cross join lateral (
  select x0.cm,
         case when (e.io * e.fo + x0.cm + e.isa) >= c.umbral_c  then 'C'
              when (e.io * e.fo + x0.cm + e.isa) >= c.umbral_mc then 'MC'
              else 'NC' end as calculada
) x;

-- ---------------------------------------------------------------------
-- 4. Pañol: artículos y movimientos de stock
-- ---------------------------------------------------------------------
create table if not exists mant_articulos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,
  descripcion      text not null,
  familia          text,
  unidad           text not null default 'un',
  ubicacion        text,
  alias            text[] not null default '{}',   -- nombres viejos o alternativos ("perno", "pistón")
  stock_actual     numeric(14,3) not null default 0,
  stock_minimo     numeric(14,3) not null default 0,
  stock_sugerido   numeric(14,3),                  -- según criticidad de los equipos que lo usan
  costo_unit_usd   numeric(14,2),
  activo           boolean not null default true,
  creado_en        timestamptz not null default now()
);
create index if not exists mant_articulos_desc on mant_articulos using gin (to_tsvector('spanish', descripcion));

create table if not exists mant_movimientos (
  id           uuid primary key default gen_random_uuid(),
  articulo_id  uuid not null references mant_articulos(id) on delete restrict,
  tipo         text not null check (tipo in ('entrada','salida','consumo_ot','ajuste')),
  cantidad     numeric(14,3) not null check (cantidad <> 0 and (tipo = 'ajuste' or cantidad > 0)),  -- positiva; en 'ajuste' lleva signo
  orden_id     uuid,                                         -- FK más abajo
  proveedor    text,
  comprobante  text,
  comentario   text,
  usuario_id   uuid default auth.uid() references mant_usuarios(id),
  creado_en    timestamptz not null default now()
);
create index if not exists mant_movimientos_articulo on mant_movimientos(articulo_id, creado_en desc);

create or replace function mant_aplicar_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
declare signo numeric;
begin
  if tg_op = 'INSERT' then
    signo := case new.tipo when 'entrada' then 1 when 'ajuste' then 1 else -1 end;
    update mant_articulos set stock_actual = stock_actual + signo * new.cantidad where id = new.articulo_id;
    return new;
  elsif tg_op = 'DELETE' then
    signo := case old.tipo when 'entrada' then 1 when 'ajuste' then 1 else -1 end;
    update mant_articulos set stock_actual = stock_actual - signo * old.cantidad where id = old.articulo_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists mant_movimiento_stock on mant_movimientos;
create trigger mant_movimiento_stock after insert or delete on mant_movimientos
  for each row execute function mant_aplicar_movimiento();

-- Repuestos de referencia de cada equipo (ficha técnica)
create table if not exists mant_equipo_repuestos (
  equipo_id    uuid not null references mant_equipos(id) on delete cascade,
  articulo_id  uuid not null references mant_articulos(id) on delete restrict,
  cantidad_ref numeric(14,3) not null default 1,
  primary key (equipo_id, articulo_id)
);

-- ---------------------------------------------------------------------
-- 5. Plan preventivo
-- ---------------------------------------------------------------------
create table if not exists mant_tareas (
  id                      uuid primary key default gen_random_uuid(),
  equipo_id               uuid references mant_equipos(id) on delete cascade,
  unidad                  text,                       -- ronda sin equipo codificado (ej. "Sala de bombas Roots pasta")
  descripcion             text not null,
  origen                  text,                       -- RG MA 01 / Plan semanal / manual
  frecuencia_valor        int not null check (frecuencia_valor > 0),
  frecuencia_unidad       text not null check (frecuencia_unidad in ('dias','semanas','meses','horas')),
  duracion_estimada_horas numeric(8,2),
  responsable_id          uuid references mant_usuarios(id) on delete set null,
  turno                   text,
  requiere_parada         boolean not null default false,
  ultima_ejecucion        date,
  proxima_fecha           date not null default current_date,
  activa                  boolean not null default true,
  notas                   text,
  creado_en               timestamptz not null default now()
);
create index if not exists mant_tareas_proxima on mant_tareas(proxima_fecha) where activa;
create index if not exists mant_tareas_equipo on mant_tareas(equipo_id);

-- Puntos a revisar de cada rutina (las líneas de la ficha del equipo)
create table if not exists mant_tarea_items (
  id           uuid primary key default gen_random_uuid(),
  tarea_id     uuid not null references mant_tareas(id) on delete cascade,
  orden        int not null default 0,
  descripcion  text not null,
  horas        numeric(8,2),
  detalle      text                                   -- observaciones: grasa a usar, valores a verificar, etc.
);
create index if not exists mant_tarea_items_tarea on mant_tarea_items(tarea_id, orden);

-- Historial de ajustes de frecuencia (ej. goma de válvula mariposa: 3 meses → 1 año)
create table if not exists mant_tareas_historial (
  id               uuid primary key default gen_random_uuid(),
  tarea_id         uuid not null references mant_tareas(id) on delete cascade,
  valor_anterior   int,
  unidad_anterior  text,
  valor_nuevo      int,
  unidad_nueva     text,
  motivo           text,
  usuario_id       uuid default auth.uid(),
  creado_en        timestamptz not null default now()
);

create or replace function mant_registrar_cambio_frecuencia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.frecuencia_valor is distinct from old.frecuencia_valor
     or new.frecuencia_unidad is distinct from old.frecuencia_unidad then
    insert into mant_tareas_historial (tarea_id, valor_anterior, unidad_anterior, valor_nuevo, unidad_nueva, motivo)
    values (new.id, old.frecuencia_valor, old.frecuencia_unidad, new.frecuencia_valor, new.frecuencia_unidad,
            nullif(current_setting('mant.motivo', true), ''));
  end if;
  return new;
end $$;

drop trigger if exists mant_tarea_frecuencia on mant_tareas;
create trigger mant_tarea_frecuencia after update on mant_tareas
  for each row execute function mant_registrar_cambio_frecuencia();

-- Repuestos que pide cada tarea (para anticipar compras del preventivo)
create table if not exists mant_tarea_repuestos (
  tarea_id    uuid not null references mant_tareas(id) on delete cascade,
  articulo_id uuid not null references mant_articulos(id) on delete restrict,
  cantidad    numeric(14,3) not null default 1,
  primary key (tarea_id, articulo_id)
);

-- Suma la frecuencia a una fecha. Las horas se toman corridas (plantas 24/7).
create or replace function mant_sumar_frecuencia(fecha date, valor int, unidad text) returns date
language sql immutable as $$
  select (case unidad
            when 'dias'    then fecha + valor
            when 'semanas' then fecha + valor * 7
            when 'meses'   then (fecha + make_interval(months => valor))::date
            when 'horas'   then fecha + greatest(1, ceil(valor / 24.0)::int)
          end)
$$;

create table if not exists mant_proveedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  localidad  text,
  contacto   text,
  telefono   text,
  telefono2  text,
  rubro      text,
  activo     boolean not null default true
);

-- Ajuste por conteo físico: el servidor calcula la diferencia con el stock actual
create or replace function mant_ajustar_stock(p_articulo uuid, p_contado numeric, p_comentario text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare actual numeric;
begin
  if not mant_tiene_rol('panolero','referente') then raise exception 'Solo el pañolero ajusta stock.'; end if;
  select stock_actual into actual from mant_articulos where id = p_articulo for update;
  if actual is null then raise exception 'Artículo inexistente.'; end if;
  if p_contado <> actual then
    insert into mant_movimientos (articulo_id, tipo, cantidad, comentario)
    values (p_articulo, 'ajuste', p_contado - actual, coalesce(p_comentario, 'Ajuste por conteo'));
  end if;
  return p_contado - actual;
end $$;

-- ---------------------------------------------------------------------
-- 6. Pedidos de reparación (correctivo)
-- ---------------------------------------------------------------------
create table if not exists mant_pedidos (
  id                 uuid primary key default gen_random_uuid(),
  numero             bigint generated always as identity unique,
  equipo_id          uuid references mant_equipos(id) on delete set null,
  ubicacion          text,                      -- si no se sabe el equipo
  area               text,
  descripcion        text not null,
  equipo_detenido    boolean not null default false,
  solicitante_id     uuid not null default auth.uid() references mant_usuarios(id),
  estado             text not null default 'nuevo'
                     check (estado in ('nuevo','aprobado','rechazado','en_ot','cerrado')),
  prioridad          text check (prioridad in ('baja','media','alta','urgente')),
  fecha_comprometida date,
  referente_id       uuid references mant_usuarios(id),
  motivo_rechazo     text,
  foto_ruta          text,                      -- foto opcional del problema
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
create index if not exists mant_pedidos_estado on mant_pedidos(estado, creado_en desc);

create or replace function mant_nuevo_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.estado := 'nuevo'; new.prioridad := null; new.fecha_comprometida := null;
  new.referente_id := null; new.motivo_rechazo := null;
  new.solicitante_id := coalesce(auth.uid(), new.solicitante_id);
  return new;
end $$;
drop trigger if exists mant_pedido_inicial on mant_pedidos;
create trigger mant_pedido_inicial before insert on mant_pedidos
  for each row execute function mant_nuevo_pedido();

-- ---------------------------------------------------------------------
-- 7. Órdenes de trabajo
-- ---------------------------------------------------------------------
create table if not exists mant_ordenes (
  id                       uuid primary key default gen_random_uuid(),
  numero                   bigint generated always as identity unique,
  tipo                     text not null check (tipo in ('preventiva','correctiva')),
  equipo_id                uuid references mant_equipos(id) on delete set null,
  tarea_id                 uuid references mant_tareas(id) on delete set null,
  pedido_id                uuid references mant_pedidos(id) on delete set null,
  titulo                   text not null,
  descripcion              text,
  prioridad                text not null default 'media' check (prioridad in ('baja','media','alta','urgente')),
  estado                   text not null default 'pendiente'
                           check (estado in ('pendiente','en_proceso','completada','cancelada')),
  asignado_id              uuid references mant_usuarios(id) on delete set null,
  turno                    text,
  semana                   date,              -- lunes de la semana planificada
  fecha_programada         date,
  fecha_comprometida       date,
  duracion_estimada_horas  numeric(8,2),
  iniciada_en              timestamptz,
  completada_en            timestamptz,
  tiempo_real_min          int,
  comentario_cierre        text,
  creada_por               uuid default auth.uid(),
  creado_en                timestamptz not null default now()
);
create index if not exists mant_ordenes_asignado on mant_ordenes(asignado_id, estado);
create index if not exists mant_ordenes_semana on mant_ordenes(semana, estado);
-- Una sola OT abierta por tarea preventiva
create unique index if not exists mant_ordenes_tarea_abierta on mant_ordenes(tarea_id)
  where tarea_id is not null and estado in ('pendiente','en_proceso');

alter table mant_movimientos drop constraint if exists mant_movimientos_orden_fk;
alter table mant_movimientos add constraint mant_movimientos_orden_fk
  foreign key (orden_id) references mant_ordenes(id) on delete set null;

create table if not exists mant_ot_items (
  id           uuid primary key default gen_random_uuid(),
  orden_id     uuid not null references mant_ordenes(id) on delete cascade,
  orden        int not null default 0,
  descripcion  text not null,
  detalle      text,
  hecho        boolean not null default false,
  observacion  text,
  hecho_por    uuid,
  hecho_en     timestamptz
);
create index if not exists mant_ot_items_orden on mant_ot_items(orden_id, orden);

create or replace function mant_marcar_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.hecho is distinct from old.hecho then
    new.hecho_por := case when new.hecho then auth.uid() end;
    new.hecho_en  := case when new.hecho then now() end;
  end if;
  return new;
end $$;
drop trigger if exists mant_ot_item_marcado on mant_ot_items;
create trigger mant_ot_item_marcado before update on mant_ot_items
  for each row execute function mant_marcar_item();

create table if not exists mant_ot_fotos (
  id          uuid primary key default gen_random_uuid(),
  orden_id    uuid not null references mant_ordenes(id) on delete cascade,
  ruta        text not null,                 -- ruta en el bucket mant-fotos
  tipo        text not null default 'cierre' check (tipo in ('antes','cierre')),
  subida_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);

-- Repuestos usados: se cargan en texto y se vinculan al catálogo (ahí descuentan stock)
create table if not exists mant_ot_repuestos (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null references mant_ordenes(id) on delete cascade,
  texto          text not null,
  cantidad       numeric(14,3) not null default 1 check (cantidad > 0),
  articulo_id    uuid references mant_articulos(id) on delete restrict,
  movimiento_id  uuid,                      -- movimiento de stock que generó (sin FK: lo maneja el trigger)
  cargado_por    uuid default auth.uid(),
  creado_en      timestamptz not null default now()
);

create or replace function mant_descontar_repuesto() returns trigger
language plpgsql security definer set search_path = public as $$
declare mov uuid;
begin
  if tg_op = 'INSERT' then new.movimiento_id := null; end if;       -- lo asigna este trigger, nunca el cliente
  if tg_op = 'UPDATE' and new.movimiento_id is distinct from old.movimiento_id then new.movimiento_id := old.movimiento_id; end if;
  if tg_op = 'UPDATE' and new.orden_id is distinct from old.orden_id then raise exception 'No se puede mover un repuesto a otra orden.'; end if;
  if tg_op = 'DELETE' then
    if old.movimiento_id is not null then delete from mant_movimientos where id = old.movimiento_id and tipo = 'consumo_ot'; end if;
    return old;
  end if;
  -- cambio de artículo o cantidad: se revierte el movimiento anterior
  if tg_op = 'UPDATE' and old.movimiento_id is not null
     and (new.articulo_id is distinct from old.articulo_id or new.cantidad <> old.cantidad) then
    delete from mant_movimientos where id = old.movimiento_id and tipo = 'consumo_ot';
    new.movimiento_id := null;
  end if;
  if new.articulo_id is not null and new.movimiento_id is null then
    insert into mant_movimientos (articulo_id, tipo, cantidad, orden_id, comentario)
    values (new.articulo_id, 'consumo_ot', new.cantidad, new.orden_id, new.texto)
    returning id into mov;
    new.movimiento_id := mov;
  end if;
  return new;
end $$;

drop trigger if exists mant_repuesto_stock on mant_ot_repuestos;
create trigger mant_repuesto_stock before insert or update on mant_ot_repuestos
  for each row execute function mant_descontar_repuesto();
drop trigger if exists mant_repuesto_stock_borrado on mant_ot_repuestos;
create trigger mant_repuesto_stock_borrado after delete on mant_ot_repuestos
  for each row execute function mant_descontar_repuesto();

-- Reglas de estado de la OT: sin foto no se cierra
create or replace function mant_validar_ot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not mant_tiene_rol('referente','supervisor')
     and (new.asignado_id is distinct from old.asignado_id or new.prioridad is distinct from old.prioridad
          or new.fecha_comprometida is distinct from old.fecha_comprometida or new.tipo is distinct from old.tipo
          or new.equipo_id is distinct from old.equipo_id or new.estado = 'cancelada'
          or new.pedido_id is distinct from old.pedido_id or new.tarea_id is distinct from old.tarea_id
          or new.semana is distinct from old.semana or new.fecha_programada is distinct from old.fecha_programada
          or new.creada_por is distinct from old.creada_por or new.titulo is distinct from old.titulo
          or new.duracion_estimada_horas is distinct from old.duracion_estimada_horas) then
    raise exception 'El operario solo puede registrar el avance y el cierre de su orden.';
  end if;
  -- nadie cambia a mano los campos que llena el cierre
  if new.completada_en is distinct from old.completada_en and new.estado = old.estado then
    raise exception 'La fecha de cierre la registra el sistema.';
  end if;
  -- reabrir una orden cerrada: solo referente/supervisor, y se limpia el cierre
  if old.estado = 'completada' and new.estado in ('pendiente','en_proceso') then
    if not mant_tiene_rol('referente','supervisor') then
      raise exception 'Solo un referente puede reabrir una orden cerrada.';
    end if;
    new.completada_en := null; new.tiempo_real_min := null;
  end if;
  if old.estado = 'cancelada' and new.estado <> 'cancelada' and not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo un referente puede reactivar una orden cancelada.';
  end if;
  if new.estado = 'en_proceso' and old.estado = 'pendiente' and new.iniciada_en is null then
    new.iniciada_en := now();
  end if;
  if new.estado = 'completada' and old.estado <> 'completada' then
    if not exists (select 1 from mant_ot_fotos where orden_id = new.id and tipo = 'cierre') then
      raise exception 'La orden no se puede cerrar sin foto.' using errcode = 'P0001';
    end if;
    new.completada_en := now();
    if new.tiempo_real_min is null and new.iniciada_en is not null then
      new.tiempo_real_min := greatest(1, extract(epoch from (new.completada_en - new.iniciada_en)) / 60)::int;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists mant_ot_reglas on mant_ordenes;
create trigger mant_ot_reglas before update on mant_ordenes
  for each row execute function mant_validar_ot();

-- Al completarse: reprograma la tarea preventiva y cierra el pedido de origen
create or replace function mant_ot_completada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'completada' and old.estado <> 'completada' then
    if new.tarea_id is not null then
      update mant_tareas t
         set ultima_ejecucion = new.completada_en::date,
             proxima_fecha    = mant_sumar_frecuencia(new.completada_en::date, t.frecuencia_valor, t.frecuencia_unidad)
       where t.id = new.tarea_id;
    end if;
    if new.pedido_id is not null then
      update mant_pedidos set estado = 'cerrado', actualizado_en = now() where id = new.pedido_id;
    end if;
  end if;
  if new.estado = 'cancelada' and old.estado <> 'cancelada' and new.pedido_id is not null then
    update mant_pedidos set estado = 'nuevo', actualizado_en = now() where id = new.pedido_id and estado = 'en_ot';
  end if;
  return new;
end $$;

drop trigger if exists mant_ot_al_completar on mant_ordenes;
create trigger mant_ot_al_completar after update on mant_ordenes
  for each row execute function mant_ot_completada();

-- ---------------------------------------------------------------------
-- 8. Funciones de negocio (llamadas desde la app)
-- ---------------------------------------------------------------------

-- Genera las OT preventivas de la semana que empieza en p_lunes
create or replace function mant_generar_semana(p_lunes date default date_trunc('week', current_date)::date)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo referentes o supervisores generan el plan semanal.';
  end if;
  return mant_generar_semana_interna(p_lunes);
end $$;

-- Versión sin control de rol: solo para pg_cron (no expuesta a la API)
create or replace function mant_generar_semana_interna(p_lunes date)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  p_lunes := date_trunc('week', p_lunes)::date;

  with nuevas as (
    insert into mant_ordenes (tipo, equipo_id, tarea_id, titulo, descripcion, prioridad, asignado_id,
                              turno, semana, fecha_programada, fecha_comprometida, duracion_estimada_horas)
    select 'preventiva', t.equipo_id, t.id,
           t.descripcion,
           t.notas,
           case e.clasificacion when 'C' then 'alta' when 'MC' then 'media' when 'NC' then 'baja' else 'media' end,
           t.responsable_id, t.turno, p_lunes,
           greatest(t.proxima_fecha, p_lunes), p_lunes + 6, t.duracion_estimada_horas
    from mant_tareas t
    left join mant_v_equipos e on e.id = t.equipo_id
    where t.activa and coalesce(e.activo, true)
      and t.proxima_fecha <= p_lunes + 6
      and not exists (select 1 from mant_ordenes o
                      where o.tarea_id = t.id and o.estado in ('pendiente','en_proceso'))
    returning id, tarea_id
  ), puntos as (
    insert into mant_ot_items (orden_id, orden, descripcion, detalle)
    select nv.id, i.orden, i.descripcion, i.detalle
    from nuevas nv join mant_tarea_items i on i.tarea_id = nv.tarea_id
    returning 1
  )
  select count(*) into n from nuevas;
  return n;
end $$;

-- El referente prioriza un pedido y lo convierte en OT (o lo rechaza)
create or replace function mant_resolver_pedido(
  p_pedido uuid, p_aprobar boolean, p_prioridad text default 'media',
  p_fecha_comprometida date default null, p_asignado uuid default null,
  p_turno text default null, p_motivo text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare ped mant_pedidos; ot uuid;
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo referentes o supervisores priorizan pedidos.';
  end if;
  select * into ped from mant_pedidos where id = p_pedido for update;
  if ped.id is null then raise exception 'Pedido inexistente.'; end if;
  if ped.estado <> 'nuevo' then raise exception 'El pedido ya fue resuelto.'; end if;

  if not p_aprobar then
    update mant_pedidos set estado = 'rechazado', motivo_rechazo = p_motivo,
           referente_id = auth.uid(), actualizado_en = now() where id = p_pedido;
    return null;
  end if;

  insert into mant_ordenes (tipo, equipo_id, pedido_id, titulo, descripcion, prioridad, asignado_id,
                            turno, semana, fecha_programada, fecha_comprometida)
  values ('correctiva', ped.equipo_id, ped.id,
          left(ped.descripcion, 120), ped.descripcion, p_prioridad, p_asignado, p_turno,
          date_trunc('week', greatest(current_date, coalesce(p_fecha_comprometida, current_date)))::date,
          greatest(current_date, date_trunc('week', coalesce(p_fecha_comprometida, current_date))::date), p_fecha_comprometida)
  returning id into ot;

  update mant_pedidos set estado = 'en_ot', prioridad = p_prioridad, fecha_comprometida = p_fecha_comprometida,
         referente_id = auth.uid(), actualizado_en = now() where id = p_pedido;

  if ped.foto_ruta is not null then
    insert into mant_ot_fotos (orden_id, ruta, tipo) values (ot, ped.foto_ruta, 'antes');
  end if;
  return ot;
end $$;

-- Cambia la frecuencia de una tarea dejando el motivo en el historial
create or replace function mant_ajustar_frecuencia(p_tarea uuid, p_valor int, p_unidad text, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not mant_tiene_rol('referente','supervisor') then
    raise exception 'Solo referentes ajustan frecuencias.';
  end if;
  perform set_config('mant.motivo', coalesce(p_motivo, ''), true);
  update mant_tareas t set frecuencia_valor = p_valor, frecuencia_unidad = p_unidad,
         proxima_fecha = mant_sumar_frecuencia(coalesce(t.ultima_ejecucion, current_date), p_valor, p_unidad)
   where id = p_tarea;
end $$;

-- ---------------------------------------------------------------------
-- 9. Compras y presupuestos
-- ---------------------------------------------------------------------
create table if not exists mant_compras (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity unique,
  orden_id        uuid references mant_ordenes(id) on delete set null,
  tarea_id        uuid references mant_tareas(id) on delete set null,  -- compra anticipada del preventivo
  descripcion     text not null,
  proveedor       text,
  moneda          text not null default 'ARS' check (moneda in ('ARS','USD')),
  monto           numeric(16,2) not null default 0,
  tipo_cambio     numeric(14,4),
  estado          text not null default 'borrador'
                  check (estado in ('borrador','pendiente','aprobada','rechazada','comprada','recibida')),
  adjunto_ruta    text,                       -- presupuesto en PDF o foto
  solicitado_por  uuid default auth.uid() references mant_usuarios(id),
  decidido_por    uuid references mant_usuarios(id),
  decidido_en     timestamptz,
  comentario      text,
  monto_usd       numeric(16,2) generated always as
                    (case when moneda = 'USD' then monto
                          when tipo_cambio > 0 then round(monto / tipo_cambio, 2) end) stored,
  creado_en       timestamptz not null default now()
);

create table if not exists mant_compra_items (
  id           uuid primary key default gen_random_uuid(),
  compra_id    uuid not null references mant_compras(id) on delete cascade,
  articulo_id  uuid references mant_articulos(id) on delete set null,
  descripcion  text not null,
  cantidad     numeric(14,3) not null default 1,
  precio_unit  numeric(16,2)
);

-- Al recibir una compra, los ítems con artículo entran al pañol
create or replace function mant_compra_recibida() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'recibida' and old.estado <> 'recibida' then
    insert into mant_movimientos (articulo_id, tipo, cantidad, proveedor, comprobante, comentario)
    select i.articulo_id, 'entrada', i.cantidad, new.proveedor, 'Compra #' || new.numero, i.descripcion
    from mant_compra_items i where i.compra_id = new.id and i.articulo_id is not null and i.cantidad > 0;
  end if;
  return new;
end $$;

drop trigger if exists mant_compra_al_recibir on mant_compras;
create trigger mant_compra_al_recibir after update on mant_compras
  for each row execute function mant_compra_recibida();

-- ---------------------------------------------------------------------
-- 10. Auditoría: cada cambio queda con usuario y fecha
-- ---------------------------------------------------------------------
create table if not exists mant_auditoria (
  id           bigint generated always as identity primary key,
  tabla        text not null,
  registro_id  uuid,
  accion       text not null,
  usuario_id   uuid default auth.uid(),
  datos        jsonb,
  creado_en    timestamptz not null default now()
);
create index if not exists mant_auditoria_registro on mant_auditoria(tabla, registro_id);

-- mant_config no tiene uuid: ahí el registro_id queda nulo
create or replace function mant_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare fila jsonb;
begin
  fila := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into mant_auditoria (tabla, registro_id, accion, datos)
  values (tg_table_name,
          case when fila->>'id' ~ '^[0-9a-f-]{36}$' then (fila->>'id')::uuid end,
          lower(tg_op), fila);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['mant_equipos','mant_tareas','mant_pedidos','mant_ordenes','mant_ot_repuestos',
                           'mant_articulos','mant_movimientos','mant_compras','mant_usuarios','mant_config','mant_ot_items']
  loop
    execute format('drop trigger if exists %I on %I', t || '_auditoria', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function mant_auditar()',
                   t || '_auditoria', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 11. Vistas para la app y los reportes
-- ---------------------------------------------------------------------
create or replace view mant_v_ordenes with (security_invoker = true) as
select o.*,
       e.codigo as equipo_codigo, e.nombre as equipo_nombre, e.planta_id,
       t.unidad as tarea_unidad,
       u.nombre as asignado_nombre,
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

create or replace view mant_v_pedidos with (security_invoker = true) as
select p.*, e.codigo as equipo_codigo, e.nombre as equipo_nombre,
       s.nombre as solicitante_nombre,
       (select o.id from mant_ordenes o where o.pedido_id = p.id order by o.creado_en desc limit 1) as orden_id,
       (select o.estado from mant_ordenes o where o.pedido_id = p.id order by o.creado_en desc limit 1) as orden_estado
from mant_pedidos p
left join mant_equipos e on e.id = p.equipo_id
left join mant_usuarios s on s.id = p.solicitante_id;

create or replace view mant_v_stock with (security_invoker = true) as
select a.*,
       (a.stock_actual <= a.stock_minimo) as bajo_minimo,
       (a.stock_sugerido is not null and a.stock_actual < a.stock_sugerido) as bajo_sugerido,
       (select count(*) from mant_equipo_repuestos r where r.articulo_id = a.id) as equipos_que_lo_usan
from mant_articulos a;

-- Repuestos que va a pedir el preventivo en las próximas 8 semanas, contra el stock
create or replace view mant_v_necesidades_preventivo with (security_invoker = true) as
select a.id as articulo_id, a.codigo, a.descripcion, a.unidad, a.stock_actual,
       sum(tr.cantidad) as cantidad_necesaria,
       min(t.proxima_fecha) as primera_fecha,
       greatest(0, sum(tr.cantidad) - a.stock_actual) as faltante
from mant_tareas t
join mant_tarea_repuestos tr on tr.tarea_id = t.id
join mant_articulos a on a.id = tr.articulo_id
where t.activa and t.proxima_fecha <= current_date + 56
group by a.id;

create or replace view mant_v_gasto_mensual with (security_invoker = true) as
select date_trunc('month', coalesce(c.decidido_en, c.creado_en))::date as mes,
       count(*) as compras,
       sum(c.monto_usd) as total_usd,
       sum(case when c.moneda = 'ARS' then c.monto end) as total_ars
from mant_compras c
where c.estado in ('aprobada','comprada','recibida')
group by 1;

create or replace view mant_v_indicadores_semana with (security_invoker = true) as
select o.semana,
       count(*) filter (where o.tipo = 'preventiva') as preventivas,
       count(*) filter (where o.tipo = 'preventiva' and o.estado = 'completada') as preventivas_ok,
       count(*) filter (where o.tipo = 'correctiva') as correctivas,
       count(*) filter (where o.tipo = 'correctiva' and o.estado = 'completada') as correctivas_ok,
       round(avg(o.tiempo_real_min) filter (where o.tipo = 'correctiva' and o.estado = 'completada')) as mttr_min
from mant_ordenes o
where o.semana is not null
group by o.semana;

-- ---------------------------------------------------------------------
-- 12. Seguridad por filas (RLS)
-- ---------------------------------------------------------------------
alter table mant_usuarios          enable row level security;
alter table mant_config            enable row level security;
alter table mant_plantas           enable row level security;
alter table mant_sectores          enable row level security;
alter table mant_equipos           enable row level security;
alter table mant_articulos         enable row level security;
alter table mant_movimientos       enable row level security;
alter table mant_equipo_repuestos  enable row level security;
alter table mant_tareas            enable row level security;
alter table mant_tareas_historial  enable row level security;
alter table mant_tarea_repuestos   enable row level security;
alter table mant_pedidos           enable row level security;
alter table mant_ordenes           enable row level security;
alter table mant_ot_fotos          enable row level security;
alter table mant_ot_repuestos      enable row level security;
alter table mant_compras           enable row level security;
alter table mant_compra_items      enable row level security;
alter table mant_auditoria         enable row level security;
alter table mant_tarea_items       enable row level security;
alter table mant_ot_items          enable row level security;
alter table mant_proveedores       enable row level security;

-- Borra políticas previas para poder volver a correr el script
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename like 'mant\_%'
  loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- Usuarios: cada uno se ve a sí mismo; los activos ven al resto; solo admin edita
create policy usuarios_ver on mant_usuarios for select
  using (id = auth.uid() or mant_activo());
create policy usuarios_editar on mant_usuarios for update
  using (mant_tiene_rol('admin')) with check (mant_tiene_rol('admin'));

create policy config_ver on mant_config for select using (mant_activo());
create policy config_editar on mant_config for update
  using (mant_tiene_rol('referente')) with check (mant_tiene_rol('referente'));

-- Maestros: todos los activos leen; referentes y supervisores editan
create policy plantas_ver on mant_plantas for select using (mant_activo());
create policy plantas_editar on mant_plantas for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));
create policy sectores_ver on mant_sectores for select using (mant_activo());
create policy sectores_editar on mant_sectores for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));
create policy equipos_ver on mant_equipos for select using (mant_activo());
create policy equipos_editar on mant_equipos for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));
create policy eqrep_ver on mant_equipo_repuestos for select using (mant_activo());
create policy eqrep_editar on mant_equipo_repuestos for all
  using (mant_tiene_rol('referente','supervisor','panolero')) with check (mant_tiene_rol('referente','supervisor','panolero'));

create policy tareas_ver on mant_tareas for select using (mant_activo());
create policy tareas_editar on mant_tareas for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));
create policy tareashist_ver on mant_tareas_historial for select using (mant_activo());
create policy tareaitems_ver on mant_tarea_items for select using (mant_activo());
create policy tareaitems_editar on mant_tarea_items for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));
create policy proveedores_ver on mant_proveedores for select using (mant_activo());
create policy proveedores_editar on mant_proveedores for all
  using (mant_tiene_rol('referente','supervisor','panolero','compras')) with check (mant_tiene_rol('referente','supervisor','panolero','compras'));
create policy tarearep_ver on mant_tarea_repuestos for select using (mant_activo());
create policy tarearep_editar on mant_tarea_repuestos for all
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));

-- Pañol
create policy articulos_ver on mant_articulos for select using (mant_activo());
create policy articulos_editar on mant_articulos for all
  using (mant_tiene_rol('panolero','referente')) with check (mant_tiene_rol('panolero','referente'));
create policy movimientos_ver on mant_movimientos for select
  using (mant_tiene_rol('panolero','referente','supervisor','compras','director'));
create policy movimientos_cargar on mant_movimientos for insert
  with check (mant_tiene_rol('panolero','referente'));

-- Pedidos: cualquiera activo pide; ve los suyos; mantenimiento ve todos
create policy pedidos_crear on mant_pedidos for insert
  with check (mant_activo() and solicitante_id = auth.uid());
create policy pedidos_ver on mant_pedidos for select
  using (solicitante_id = auth.uid() or mant_tiene_rol('referente','supervisor','operario','director'));
create policy pedidos_editar on mant_pedidos for update
  using (mant_tiene_rol('referente','supervisor')) with check (mant_tiene_rol('referente','supervisor'));

-- Órdenes: el operario ve y actualiza las suyas; mantenimiento todas;
-- el solicitante ve las de sus pedidos
create policy ordenes_ver on mant_ordenes for select
  using (asignado_id = auth.uid()
         or mant_tiene_rol('referente','supervisor','director','panolero','compras')
         or exists (select 1 from mant_pedidos p where p.id = pedido_id and p.solicitante_id = auth.uid()));
create policy ordenes_crear on mant_ordenes for insert
  with check (mant_tiene_rol('referente','supervisor'));
create policy ordenes_editar on mant_ordenes for update
  using (mant_tiene_rol('referente','supervisor') or (asignado_id = auth.uid() and mant_tiene_rol('operario')))
  with check (mant_tiene_rol('referente','supervisor') or (asignado_id = auth.uid() and mant_tiene_rol('operario')));

create or replace function mant_puede_operar_ot(p_orden uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mant_tiene_rol('referente','supervisor')
      or exists (select 1 from mant_ordenes o where o.id = p_orden and o.asignado_id = auth.uid() and mant_tiene_rol('operario'))
$$;

create or replace function mant_puede_ver_ot(p_orden uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mant_tiene_rol('referente','supervisor','director','panolero','compras')
      or exists (select 1 from mant_ordenes o
                 left join mant_pedidos p on p.id = o.pedido_id
                 where o.id = p_orden and (o.asignado_id = auth.uid() or p.solicitante_id = auth.uid()))
$$;

create policy fotos_ver on mant_ot_fotos for select using (mant_puede_ver_ot(orden_id));
create or replace function mant_ot_abierta(p_orden uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mant_ordenes o where o.id = p_orden and o.estado in ('pendiente','en_proceso'))
$$;
create policy fotos_subir on mant_ot_fotos for insert with check (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));
create policy fotos_borrar on mant_ot_fotos for delete using (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));

create policy otitems_ver on mant_ot_items for select using (mant_puede_ver_ot(orden_id));
create policy otitems_editar on mant_ot_items for update
  using (mant_puede_operar_ot(orden_id)) with check (mant_puede_operar_ot(orden_id));
create policy otitems_cargar on mant_ot_items for insert with check (mant_tiene_rol('referente','supervisor'));
create policy otrep_ver on mant_ot_repuestos for select using (mant_puede_ver_ot(orden_id));
create policy otrep_cargar on mant_ot_repuestos for insert with check (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));
create policy otrep_editar on mant_ot_repuestos for update
  using (mant_puede_operar_ot(orden_id) or mant_tiene_rol('panolero'))
  with check (mant_puede_operar_ot(orden_id) or mant_tiene_rol('panolero'));
create policy otrep_borrar on mant_ot_repuestos for delete using (mant_puede_operar_ot(orden_id) and mant_ot_abierta(orden_id));

-- Compras
create policy compras_ver on mant_compras for select
  using (mant_tiene_rol('referente','supervisor','panolero','compras','director'));
create policy compras_crear on mant_compras for insert
  with check (mant_tiene_rol('referente','supervisor','panolero','compras'));
create policy compras_editar on mant_compras for update
  using (mant_tiene_rol('referente','supervisor','panolero','compras'))
  with check (mant_tiene_rol('referente','supervisor','panolero','compras'));
create policy compitems_ver on mant_compra_items for select
  using (mant_tiene_rol('referente','supervisor','panolero','compras','director'));
create or replace function mant_compra_editable(p_compra uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mant_compras c where c.id = p_compra and c.estado in ('borrador','rechazada'))
$$;
create policy compitems_editar on mant_compra_items for all
  using (mant_tiene_rol('referente','supervisor','panolero','compras') and mant_compra_editable(compra_id))
  with check (mant_tiene_rol('referente','supervisor','panolero','compras') and mant_compra_editable(compra_id));

create policy auditoria_ver on mant_auditoria for select using (mant_tiene_rol('referente','supervisor','director'));

-- La aprobación de compras solo pasa por mant_decidir_compra
create or replace function mant_validar_cambio_compra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado is distinct from old.estado
     and current_setting('mant.decision', true) is distinct from 'si'
     and not ((old.estado = 'borrador'  and new.estado = 'pendiente')
           or (old.estado = 'rechazada' and new.estado = 'borrador')
           or (old.estado = 'aprobada'  and new.estado = 'comprada')
           or (old.estado = 'comprada'  and new.estado = 'recibida')) then
    raise exception 'Cambio de estado no permitido: % → %', old.estado, new.estado;
  end if;
  if current_setting('mant.decision', true) is distinct from 'si'
     and (new.decidido_por is distinct from old.decidido_por or new.decidido_en is distinct from old.decidido_en) then
    raise exception 'La aprobación solo se registra con mant_decidir_compra.';
  end if;
  if old.estado in ('aprobada','comprada','recibida')
     and (new.monto is distinct from old.monto or new.moneda is distinct from old.moneda
          or new.tipo_cambio is distinct from old.tipo_cambio) then
    raise exception 'No se puede cambiar el monto de una compra aprobada.';
  end if;
  return new;
end $$;
drop trigger if exists mant_compra_reglas on mant_compras;
create trigger mant_compra_reglas before update on mant_compras
  for each row execute function mant_validar_cambio_compra();

-- mant_decidir_compra marca su propio cambio como decisión
create or replace function mant_decidir_compra(p_compra uuid, p_aprobar boolean, p_comentario text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare c mant_compras; u mant_usuarios;
begin
  select * into u from mant_usuarios where id = auth.uid() and activo;
  select * into c from mant_compras where id = p_compra for update;
  if c.id is null then raise exception 'Compra inexistente.'; end if;
  if c.estado <> 'pendiente' then raise exception 'La compra no está pendiente de aprobación.'; end if;
  if u.id is null or u.rol not in ('referente','director','admin') then
    raise exception 'No tiene permiso para aprobar compras.';
  end if;
  if p_aprobar and u.rol = 'referente' then
    if c.monto_usd is null then raise exception 'Falta el tipo de cambio para calcular el monto en USD.'; end if;
    if c.monto_usd > u.limite_aprobacion_usd then
      raise exception 'Supera su límite de USD %: debe aprobarla el director.', u.limite_aprobacion_usd;
    end if;
  end if;
  perform set_config('mant.decision', 'si', true);
  update mant_compras set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         decidido_por = u.id, decidido_en = now(), comentario = coalesce(p_comentario, comentario)
   where id = p_compra;
  perform set_config('mant.decision', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 13. Almacenamiento de fotos y adjuntos (bucket privado)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('mant-fotos', 'mant-fotos', false)
on conflict (id) do nothing;

drop policy if exists mant_fotos_ver on storage.objects;
drop policy if exists mant_fotos_subir on storage.objects;
create policy mant_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'mant-fotos' and mant_activo());
create policy mant_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'mant-fotos' and mant_activo());

-- ---------------------------------------------------------------------
-- 14. Generación automática del plan semanal (opcional)
-- Requiere habilitar la extensión pg_cron en Supabase (Database → Extensions).
-- Genera las OT preventivas cada domingo a las 20:00 (hora Argentina = 23:00 UTC).
-- ---------------------------------------------------------------------
-- select cron.schedule('mant-generar-semana', '0 23 * * 0',
--   $$ select mant_generar_semana_interna((current_date + 1)) $$);

-- ---------------------------------------------------------------------
-- 15. Funciones que la API no debe exponer a anónimos
-- ---------------------------------------------------------------------
revoke execute on function mant_generar_semana_interna(date) from public, anon, authenticated;
revoke execute on function mant_generar_semana(date) from anon;
revoke execute on function mant_resolver_pedido(uuid, boolean, text, date, uuid, text, text) from anon;
revoke execute on function mant_ajustar_frecuencia(uuid, int, text, text) from anon;
revoke execute on function mant_decidir_compra(uuid, boolean, text) from anon;
revoke execute on function mant_ajustar_stock(uuid, numeric, text) from anon;
