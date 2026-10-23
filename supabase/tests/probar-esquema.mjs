// Prueba el esquema contra Postgres embebido, simulando lo mínimo de Supabase.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const db = new PGlite()
const sql = process.argv.slice(2).map(f => fs.readFileSync(f, 'utf8')).join('\n')

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
`)
await db.exec(sql).catch(e => { console.log('SQL ERROR:', e.message, 'pos', e.position, 'where', e.where); const p=+e.position||0; console.log(sql.slice(Math.max(0,p-300), p+100)); process.exit(1) })
await db.exec(`
  grant usage on schema public, auth to authenticated;
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant execute on all functions in schema auth to authenticated;
`)
// segunda corrida: el script tiene que poder re-ejecutarse
await db.exec(sql).catch(e => { console.log('SQL ERROR:', e.message, 'pos', e.position, 'where', e.where); const p=+e.position||0; console.log(sql.slice(Math.max(0,p-300), p+100)); process.exit(1) })

let ok = 0, fail = 0
const check = (cond, msg) => { if (cond) { ok++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }
const U = {
  admin: '00000000-0000-0000-0000-000000000001',
  ref: '00000000-0000-0000-0000-000000000002',
  op: '00000000-0000-0000-0000-000000000003',
  sol: '00000000-0000-0000-0000-000000000004',
  pan: '00000000-0000-0000-0000-000000000005',
  dir: '00000000-0000-0000-0000-000000000006',
  op2: '00000000-0000-0000-0000-000000000007',
}
const as = async (uid, q, params) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); ${uid ? 'set role authenticated;' : ''}`)
  return db.query(q, params)
}
const fails = async (uid, q, params) => { try { await as(uid, q, params); return null } catch (e) { return e.message } }

console.log('Usuarios')
for (const [k, id] of Object.entries(U)) await as(null, `insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)`, [id, k + '@rossi.com', { nombre: k }])
check((await as(null, `select count(*)::int n from mant_usuarios where not activo`)).rows[0].n === 7, 'altas nuevas quedan inactivas')
const roles = { admin: 'admin', ref: 'referente', op: 'operario', sol: 'solicitante', pan: 'panolero', dir: 'director', op2: 'operario' }
for (const [k, r] of Object.entries(roles)) await as(null, `update mant_usuarios set activo=true, rol=$1, limite_aprobacion_usd=$2 where id=$3`, [r, r === 'referente' ? 1000 : 0, U[k]])
check(!!(await fails(U.sol, `update mant_usuarios set rol='admin' where id=$1`, [U.sol])) || (await as(null, `select rol from mant_usuarios where id=$1`, [U.sol])).rows[0].rol === 'solicitante', 'un solicitante no se puede subir de rol')

console.log('Equipos y criticidad')
const pl = (await as(U.ref, `insert into mant_plantas (codigo,nombre) values ('FP','Fábrica de pastas') returning id`)).rows[0].id
const se = (await as(U.ref, `insert into mant_sectores (planta_id,codigo,nombre) values ($1,'PL','Planta') returning id`, [pl])).rows[0].id
const eq = (await as(U.ref, `insert into mant_equipos (codigo,nombre,planta_id,sector_id,io,fo,costo_falla_usd,isa) values ('FP-PL-HORNO-1','Horno 1',$1,$2,4,5,8000,10) returning id`, [pl, se])).rows[0].id
let ve = (await as(U.sol, `select criticidad, clasificacion, cm from mant_v_equipos where id=$1`, [eq])).rows[0]
check(ve.cm === 2 && ve.criticidad === 32 && ve.clasificacion === 'MC', `C = 4×5 + 2 + 10 = 32 → MC (dio ${ve.criticidad} ${ve.clasificacion})`)
await as(U.ref, `update mant_config set corte_costo_usd = 10000`)
ve = (await as(U.sol, `select criticidad, clasificacion from mant_v_equipos where id=$1`, [eq])).rows[0]
check(ve.criticidad === 31 && ve.clasificacion === 'MC', `al subir el corte a USD 10.000 se recalcula sola → ${ve.criticidad} ${ve.clasificacion}`)
await as(U.ref, `update mant_equipos set clasificacion_manual='C' where id=$1`, [eq])
ve = (await as(U.sol, `select clasificacion, clasificacion_calculada from mant_v_equipos where id=$1`, [eq])).rows[0]
check(ve.clasificacion === 'C' && ve.clasificacion_calculada === 'MC', 'la clasificación manual del referente manda sobre la calculada')
check(!!(await fails(U.sol, `insert into mant_equipos (codigo,nombre,planta_id) values ('X','X',$1)`, [pl])), 'un solicitante no crea equipos')

console.log('Pañol')
const art = (await as(U.pan, `insert into mant_articulos (codigo,descripcion,stock_minimo) values ('ROD-6205','Rodamiento 6205',2) returning id`)).rows[0].id
await as(U.pan, `insert into mant_movimientos (articulo_id,tipo,cantidad,proveedor) values ($1,'entrada',5,'Rulemanes SA')`, [art])
check((await as(U.pan, `select stock_actual::int s from mant_articulos where id=$1`, [art])).rows[0].s === 5, 'entrada suma stock (5)')

console.log('Preventivo')
const lunes = (await as(null, `select date_trunc('week', current_date)::date::text d`)).rows[0].d
const tarea = (await as(U.ref, `insert into mant_tareas (equipo_id,descripcion,frecuencia_valor,frecuencia_unidad,duracion_estimada_horas,responsable_id,proxima_fecha) values ($1,'Cambio de goma válvula mariposa',3,'meses',4,$2,$3) returning id`, [eq, U.op, lunes])).rows[0].id
await as(U.ref, `insert into mant_tarea_items (tarea_id, orden, descripcion, detalle) values ($1,1,'Engrasar rodamientos','Grasa Berulub FG-H 2 EP'),($1,2,'Limpiar sensores',null)`, [tarea])
check(!!(await fails(U.op, `select mant_generar_semana()`)), 'un operario no genera el plan')
let n = (await as(U.ref, `select mant_generar_semana($1::date) n`, [lunes])).rows[0].n
check(n === 1, `genera 1 OT preventiva para la semana del ${lunes}`)
n = (await as(U.ref, `select mant_generar_semana($1::date) n`, [lunes])).rows[0].n
check(n === 0, 'no duplica si se vuelve a generar')
const ot = (await as(U.op, `select id, prioridad, asignado_id from mant_ordenes where tarea_id=$1`, [tarea])).rows[0]
check((await as(U.op, `select count(*)::int n from mant_ot_items where orden_id=$1`, [ot.id])).rows[0].n === 2, 'la OT copia los puntos de la rutina para tildar')
check(ot && ot.prioridad === 'alta', `el operario ve su OT, prioridad por criticidad C = ${ot?.prioridad}`)
check((await as(U.op2, `select count(*)::int n from mant_ordenes`)).rows[0].n === 0, 'otro operario no ve OT ajenas')
check(!!(await fails(U.op, `update mant_ordenes set prioridad='urgente' where id=$1`, [ot.id])), 'el operario no cambia la prioridad')
await as(U.op, `update mant_ordenes set estado='en_proceso' where id=$1`, [ot.id])
await as(U.op, `insert into mant_ot_repuestos (orden_id,texto,cantidad) values ($1,'perno de la tapa',2)`, [ot.id])
const rep = (await as(U.op, `insert into mant_ot_repuestos (orden_id,texto,cantidad,articulo_id) values ($1,'rodamiento',1,$2) returning id`, [ot.id, art])).rows[0].id
check((await as(U.pan, `select stock_actual::int s from mant_articulos where id=$1`, [art])).rows[0].s === 4, 'repuesto vinculado al catálogo descuenta stock (4)')
await as(U.op, `update mant_ot_repuestos set cantidad=2 where id=$1`, [rep])
check((await as(U.pan, `select stock_actual::int s from mant_articulos where id=$1`, [art])).rows[0].s === 3, 'corregir la cantidad ajusta el stock (3)')
const e1 = await fails(U.op, `update mant_ordenes set estado='completada', tiempo_real_min=200 where id=$1`, [ot.id])
check(e1 && e1.includes('sin foto'), 'sin foto no se cierra: ' + e1)
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'ot/x.jpg','cierre',true,now())`, [ot.id])
await as(U.op, `update mant_ordenes set estado='completada', tiempo_real_min=200, comentario_cierre='ok' where id=$1`, [ot.id])
const t2 = (await as(U.ref, `select ultima_ejecucion::text u, proxima_fecha::text p from mant_tareas where id=$1`, [tarea])).rows[0]
check(t2.u && t2.p > t2.u, `al cerrar se reprograma: última ${t2.u}, próxima ${t2.p}`)
await as(U.ref, `select mant_ajustar_frecuencia($1, 1, 'meses', 'Se adelanta por desgaste')`, [tarea])
// (la frecuencia real del ejemplo pasó de 3 meses a 1 año; acá se prueba el mecanismo)
const h = (await as(U.ref, `select valor_anterior, unidad_anterior, valor_nuevo, motivo from mant_tareas_historial where tarea_id=$1`, [tarea])).rows[0]
check(h && h.valor_anterior === 3 && h.motivo === 'Se adelanta por desgaste', 'el ajuste de frecuencia queda en el historial con su motivo')

console.log('Correctivo')
const ped = (await as(U.sol, `insert into mant_pedidos (equipo_id,area,descripcion,equipo_detenido) values ($1,'Producción','Pierde aceite el reductor',true) returning id`, [eq])).rows[0].id
check((await as(U.sol, `select count(*)::int n from mant_v_pedidos`)).rows[0].n === 1, 'el solicitante ve su pedido')
check(!!(await fails(U.sol, `select mant_resolver_pedido($1,true)`, [ped])), 'el solicitante no aprueba su pedido')
const otc = (await as(U.ref, `select mant_resolver_pedido($1,true,'urgente',current_date+1,$2,'Noche') id`, [ped, U.op])).rows[0].id
check(!!otc, 'el referente lo convierte en OT urgente asignada')
const vp = (await as(U.sol, `select estado, orden_estado from mant_v_pedidos where id=$1`, [ped])).rows[0]
check(vp.estado === 'en_ot' && vp.orden_estado === 'pendiente', 'el solicitante sigue el estado: ' + JSON.stringify(vp))
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'ot/y.jpg','cierre',true,now())`, [otc])
await as(U.op, `update mant_ordenes set estado='completada', tiempo_real_min=45 where id=$1`, [otc])
check((await as(U.sol, `select estado from mant_pedidos where id=$1`, [ped])).rows[0].estado === 'cerrado', 'al cerrar la OT se cierra el pedido')

console.log('Compras')
const c1 = (await as(U.ref, `insert into mant_compras (orden_id,descripcion,proveedor,moneda,monto,tipo_cambio) values ($1,'Reductor nuevo','Proveedor A','ARS',3000000,1500) returning id, monto_usd`, [otc])).rows[0]
check(Number(c1.monto_usd) === 2000, 'ARS 3.000.000 a 1.500 = USD 2.000')
await as(U.ref, `insert into mant_compra_items (compra_id,articulo_id,descripcion,cantidad) values ($1,$2,'Rodamiento 6205',10)`, [c1.id, art])
check(!!(await fails(U.ref, `update mant_compras set estado='aprobada' where id=$1`, [c1.id])), 'no se puede aprobar editando el estado a mano')
await as(U.ref, `update mant_compras set estado='pendiente' where id=$1`, [c1.id])
const e2 = await fails(U.ref, `select mant_decidir_compra($1,true)`, [c1.id])
check(e2 && e2.includes('director'), 'el referente no aprueba por encima de su límite: ' + e2)
await as(U.dir, `select mant_decidir_compra($1,true,'ok')`, [c1.id])
check((await as(U.ref, `select estado from mant_compras where id=$1`, [c1.id])).rows[0].estado === 'aprobada', 'el director la aprueba')
check(!!(await fails(U.ref, `update mant_compras set monto=1 where id=$1`, [c1.id])), 'no se cambia el monto de una compra aprobada')
await as(U.ref, `update mant_compras set estado='comprada' where id=$1`, [c1.id])
await as(U.ref, `update mant_compras set estado='recibida' where id=$1`, [c1.id])
check((await as(U.pan, `select stock_actual::int s from mant_articulos where id=$1`, [art])).rows[0].s === 13, 'al recibirla entran 10 al pañol (13)')
const g = (await as(U.dir, `select total_usd from mant_v_gasto_mensual`)).rows[0]
check(g && Number(g.total_usd) === 2000, 'gasto mensual USD 2.000')

console.log('Seguridad (hallazgos de la revisión)')
check(!!(await fails(null, `set role anon; select mant_generar_semana('2030-01-07'::date)`)), 'anónimo no puede generar el plan semanal')
await db.exec('reset role')
const otOp = (await as(U.ref, `insert into mant_ordenes (tipo, titulo, asignado_id, estado) values ('correctiva','OT op',$1,'pendiente') returning id`, [U.op])).rows[0].id
const pedAjeno = (await as(U.sol, `insert into mant_pedidos (descripcion, estado, prioridad) values ('ajeno','cerrado','urgente') returning id, estado, prioridad`)).rows[0]
check(pedAjeno.estado === 'nuevo' && pedAjeno.prioridad === null, 'un pedido nuevo siempre arranca como nuevo y sin prioridad (no la que mande el solicitante)')
check(!!(await fails(U.op, `update mant_ordenes set pedido_id=$1 where id=$2`, [pedAjeno.id, otOp])), 'el operario no puede colgar su OT de un pedido ajeno')
check(!!(await fails(U.op, `update mant_ordenes set tarea_id=$1 where id=$2`, [tarea, otOp])), 'ni cambiarle la tarea preventiva')
check(!!(await fails(U.op, `update mant_ordenes set completada_en=now() where id=$1`, [otOp])), 'ni setear la fecha de cierre a mano')
const s0 = Number((await as(U.pan, `select stock_actual from mant_articulos where id=$1`, [art])).rows[0].stock_actual)
await as(U.op, `insert into mant_ot_repuestos (orden_id, texto, cantidad, articulo_id, movimiento_id) values ($1,'x',3,$2,'00000000-0000-0000-0000-00000000dead')`, [otOp, art])
const s1 = Number((await as(U.pan, `select stock_actual from mant_articulos where id=$1`, [art])).rows[0].stock_actual)
check(s0 - s1 === 3, `movimiento_id del cliente se ignora: el stock igual se descuenta (${s0} → ${s1})`)
check(!!(await fails(U.pan, `insert into mant_movimientos (articulo_id,tipo,cantidad) values ($1,'salida',-5)`, [art])), 'una salida negativa se rechaza')
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'x.jpg','cierre',true,now())`, [otOp])
await as(U.op, `update mant_ordenes set estado='completada', tiempo_real_min=10 where id=$1`, [otOp])
await as(U.op, `delete from mant_ot_fotos where orden_id=$1`, [otOp])
check((await as(U.ref, `select count(*)::int n from mant_ot_fotos where orden_id=$1`, [otOp])).rows[0].n === 1, 'cerrada la OT, el operario no borra la foto')
check(!!(await fails(U.op, `update mant_ordenes set estado='en_proceso' where id=$1`, [otOp])), 'el operario no reabre una OT cerrada')
await as(U.ref, `update mant_ordenes set estado='en_proceso' where id=$1`, [otOp])
check((await as(U.ref, `select completada_en from mant_ordenes where id=$1`, [otOp])).rows[0].completada_en === null, 'el referente reabre y se limpia el cierre')
// cancelar devuelve el pedido a nuevo
const ped2 = (await as(U.sol, `insert into mant_pedidos (descripcion) values ('cancelable') returning id`)).rows[0].id
const ot2 = (await as(U.ref, `select mant_resolver_pedido($1,true,'baja',current_date+7) id`, [ped2])).rows[0].id
const o2 = (await as(U.ref, `select semana::text s, fecha_programada::text f from mant_ordenes where id=$1`, [ot2])).rows[0]
check(o2.f >= o2.s && o2.f <= (await as(null, `select ($1::date + 6)::text d`, [o2.s])).rows[0].d, `la OT del pedido cae dentro de su semana (${o2.s} / ${o2.f})`)
await as(U.ref, `update mant_ordenes set estado='cancelada' where id=$1`, [ot2])
check((await as(U.sol, `select estado from mant_pedidos where id=$1`, [ped2])).rows[0].estado === 'nuevo', 'cancelar la OT devuelve el pedido a "por priorizar"')
// ítems de compra congelados
await as(U.ref, `update mant_compra_items set cantidad=999 where compra_id=$1`, [c1.id])
check(Number((await as(U.ref, `select max(cantidad) m from mant_compra_items where compra_id=$1`, [c1.id])).rows[0].m) === 10, 'los ítems de una compra aprobada no se editan')
// ajuste por conteo
const dif = (await as(U.pan, `select mant_ajustar_stock($1, 100, 'conteo') d`, [art])).rows[0].d
check(Number((await as(U.pan, `select stock_actual from mant_articulos where id=$1`, [art])).rows[0].stock_actual) === 100 && dif !== null, 'ajuste por conteo deja el stock en lo contado')

console.log('Auditoría e indicadores')
check((await as(U.ref, `select count(*)::int n from mant_auditoria`)).rows[0].n > 10, 'cada cambio queda auditado')
const ind = (await as(U.ref, `select * from mant_v_indicadores_semana`)).rows
check(ind.length >= 1, 'indicadores por semana: ' + JSON.stringify(ind))

console.log('Tickets (forma del panel)')
const tk = (await as(U.sol, `insert into mant_pedidos (equipo_id,area,descripcion,urgencia_reportada,fecha_reporte) values ($1,'MOLINO TRIGO','Ruido en el reductor','alta',current_date-3) returning id`, [eq])).rows[0].id
let vt = (await as(U.sol, `select * from mant_v_pedidos where id=$1`, [tk])).rows[0]
check(vt.prioridad === null && vt.urgencia_reportada === 'alta' && vt.equipo_detenido === true && vt.titulo === 'Ruido en el reductor' && vt.recursos === 'sinmateriales' && vt.dias_abierto === 3, 'llega sin prioridad, con equipo parado, título y días abiertos')
await as(U.ref, `update mant_pedidos set prioridad='alta' where id=$1`, [tk])
check(!!(await fails(U.sol, `select mant_cambiar_fecha_cierre($1, current_date+7)`, [tk])), 'el solicitante no define fecha de cierre')
await as(U.ref, `select mant_cambiar_fecha_cierre($1, current_date+7)`, [tk])
check(!!(await fails(U.ref, `select mant_cambiar_fecha_cierre($1, current_date+15)`, [tk])), 'cambiar la fecha sin motivo falla')
await as(U.ref, `select mant_cambiar_fecha_cierre($1, current_date+15, 'Falta el repuesto')`, [tk])
vt = (await as(U.sol, `select * from mant_v_pedidos where id=$1`, [tk])).rows[0]
check(vt.cambio_fecha && vt.cambio_fecha.avisado === false && Number(vt.comentarios) === 1, 'el cambio de fecha deja comentario, motivo y aviso pendiente')
check((await as(U.sol, `select texto from mant_pedido_comentarios where pedido_id=$1`, [tk])).rows.length === 1, 'el solicitante ve los comentarios de seguimiento')
await as(U.sol, `insert into mant_pedido_comentarios (pedido_id, texto) values ($1, '¿Novedades?')`, [tk])
check(!!(await fails(U.sol, `insert into mant_pedido_materiales (pedido_id, nombre) values ($1, 'Rodamiento')`, [tk])), 'el solicitante no carga materiales')
await as(U.ref, `insert into mant_pedido_materiales (pedido_id, nombre, cantidad, disponibilidad) values ($1, 'Rodamiento 6205', '2', 'pedido')`, [tk])
check((await as(U.sol, `select recursos from mant_v_pedidos where id=$1`, [tk])).rows[0].recursos === 'esperando', 'con un material a pedir queda "esperando material"')
await as(U.ref, `update mant_pedido_materiales set disponibilidad='stock' where pedido_id=$1`, [tk])
check((await as(U.sol, `select recursos from mant_v_pedidos where id=$1`, [tk])).rows[0].recursos === 'listo', 'con todo en stock queda "listo para hacer"')
check(!!(await fails(U.ref, `select mant_cargar_agenda($1)`, [tk])), 'sin personal asignado no se carga en la agenda')
await as(U.ref, `update mant_pedidos set asignados_ids=array[$1,$2]::uuid[], duracion_dias=1.5, fecha_inicio=current_date, responsable_id=$1 where id=$3`, [U.op, U.op2, tk])
let sob = (await as(U.ref, `select mant_cargar_agenda($1) s`, [tk])).rows[0].s
check(sob.length === 0 && (await as(U.op, `select count(*)::int n, sum(fraccion) f from mant_pedido_agenda where pedido_id=$1`, [tk])).rows[0].n === 4, '1,5 días × 2 personas = 4 celdas (1 + 0,5 cada uno)')
const tk2 = (await as(U.sol, `insert into mant_pedidos (descripcion,urgencia_reportada) values ('Otro','media') returning id`)).rows[0].id
await as(U.ref, `update mant_pedidos set asignados_ids=array[$1]::uuid[], duracion_dias=1, fecha_inicio=current_date where id=$2`, [U.op, tk2])
sob = (await as(U.ref, `select mant_cargar_agenda($1) s`, [tk2])).rows[0].s
check(sob.length === 1 && Number(sob[0].total) === 2, 'avisa la sobrecarga de la persona ese día')
const otk = (await as(U.ref, `select mant_estado_pedido($1, 'proceso') o`, [tk])).rows[0].o
const ot1 = (await as(U.ref, `select * from mant_ordenes where id=$1`, [otk])).rows[0]
check(otk && ot1.prioridad === 'alta' && ot1.asignado_id === U.op && Number(ot1.duracion_estimada_horas) === 12 && (await as(U.sol, `select estado from mant_v_pedidos where id=$1`, [tk])).rows[0].estado === 'en_ot', 'pasar a "en proceso" crea la OT con prioridad, responsable y duración')
await as(U.ref, `update mant_pedidos set prioridad='baja' where id=$1`, [tk])
check((await as(U.ref, `select prioridad from mant_ordenes where id=$1`, [otk])).rows[0].prioridad === 'baja', 'la prioridad del ticket se refleja en la OT')
check((await as(U.op2, `select count(*)::int n from mant_pedidos where id=$1`, [tk])).rows[0].n === 1, 'el personal asignado ve el ticket')
await as(U.ref, `select mant_estado_pedido($1, 'pendiente')`, [tk])
check((await as(U.sol, `select estado from mant_v_pedidos where id=$1`, [tk])).rows[0].estado === 'nuevo' && (await as(U.ref, `select estado from mant_ordenes where id=$1`, [otk])).rows[0].estado === 'cancelada', 'volver a "pendiente" cancela la OT')

console.log('Plataforma (forma de la demo)')
// pgcrypto / auth.identities no están en el Postgres de prueba: el ingreso se prueba con una clave cargada a mano
await as(null, `update mant_usuarios set legajo='1042', dni='30512884', turno='mañana' where id=$1`, [U.op])
await as(null, `insert into mant_usuarios_planta (id, clave) values ($1, 'secreta') on conflict do nothing`, [U.op])
let ing = (await as(null, `select * from mant_ingreso_planta('1042')`)).rows[0]
check(ing && ing.clave === 'secreta' && ing.email === 'op@rossi.com', 'con el legajo se obtiene el acceso de planta')
check((await as(null, `select * from mant_ingreso_planta('30.512.884')`)).rows.length === 1, 'también con el DNI (con puntos)')
check((await as(null, `select * from mant_ingreso_planta('9999')`)).rows.length === 0, 'un legajo inexistente no entra')
check(!!(await fails(U.op, `select * from mant_usuarios_planta`)), 'la clave interna no se puede leer desde la app')
const pd = (await as(U.sol, `insert into mant_pedidos (equipo_id, descripcion, urgencia_reportada, nombre_contacto, email_contacto) values ($1,'Portón chocado','baja','Martín','martin@rossi.com') returning *`, [eq])).rows[0]
check(pd.prioridad === null && pd.estado === 'nuevo' && pd.equipo_detenido === false && pd.email_contacto === 'martin@rossi.com', 'el pedido llega sin prioridad, con el estado del equipo y el contacto')
check(!!(await fails(U.op, `select mant_convertir_pedido($1,'media',current_date+3,1,$2)`, [pd.id, U.op])), 'un operario no convierte pedidos')
check(!!(await fails(U.ref, `select mant_convertir_pedido($1,'media',null,1,$2)`, [pd.id, U.op])), 'sin plazo no se convierte')
const otd = (await as(U.ref, `select mant_convertir_pedido($1,'media',current_date+3,0.5,$2,current_date,'Llevar guía de 3 m') o`, [pd.id, U.op])).rows[0].o
const od = (await as(U.ref, `select * from mant_v_ordenes where id=$1`, [otd])).rows[0]
check(od.asignado_id === U.op && Number(od.duracion_estimada_horas) === 4 && od.observacion === 'Llevar guía de 3 m' && od.prioridad === 'media' && od.turno === 'mañana', 'convertir crea la OT asignada, con duración, turno y observación')
let vpd = (await as(U.sol, `select * from mant_v_pedidos where id=$1`, [pd.id])).rows[0]
check(vpd.estado === "en_ot" && String(vpd.fecha_comprometida) === String(vpd.fecha_cierre_estimada) && vpd.fecha_cierre_estimada !== null && Number(vpd.comentarios) === 1, 'el solicitante ve la fecha comprometida y el aviso de asignación')
check(!!(await fails(U.ref, `select mant_convertir_pedido($1,'media',current_date+3,1,$2)`, [pd.id, U.op])), 'no se convierte dos veces')
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'x/cierre.jpg','cierre',true,now())`, [otd])
await as(U.op, `update mant_ordenes set estado='completada' where id=$1`, [otd])
let oc = (await as(U.ref, `select estado, revision_foto from mant_ordenes where id=$1`, [otd])).rows[0]
check(oc.estado === 'completada' && oc.revision_foto === 'pendiente', 'al cerrar, la foto queda para revisar')
check((await as(U.sol, `select count(*)::int n from mant_pedido_comentarios where pedido_id=$1 and texto like 'Trabajo completado%'`, [pd.id])).rows[0].n === 1, 'el solicitante recibe el aviso de trabajo terminado')
check(!!(await fails(U.op, `select mant_revisar_foto($1,'aprobada')`, [otd])), 'el operario no revisa fotos')
await as(U.ref, `select mant_revisar_foto($1,'rehacer','La guía quedó floja')`, [otd])
oc = (await as(U.ref, `select estado, revision_foto, observacion from mant_ordenes where id=$1`, [otd])).rows[0]
check(oc.estado === 'en_proceso' && oc.revision_foto === 'rehacer' && oc.observacion.includes('La guía quedó floja') && (await as(U.sol, `select estado from mant_pedidos where id=$1`, [pd.id])).rows[0].estado === 'en_ot', 'pedir rehacer reabre la OT y el pedido')
check(!!(await fails(U.op, `update mant_ordenes set estado='completada' where id=$1`, [otd])), 'sin una foto nueva no se vuelve a cerrar')
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'x/cierre2.jpg','cierre',true,now())`, [otd])
await as(U.op, `update mant_ordenes set estado='completada' where id=$1`, [otd])
await as(U.ref, `select mant_revisar_foto($1,'aprobada')`, [otd])
check((await as(U.ref, `select revision_foto from mant_ordenes where id=$1`, [otd])).rows[0].revision_foto === 'aprobada', 'con la foto nueva se cierra y se aprueba')
const artp = (await as(U.ref, `insert into mant_articulos (codigo, descripcion, stock_actual, stock_minimo, costo_unit_usd) values ('SELLO-ROOT','Sello mecánico bomba root',0,1,350) returning id`)).rows[0].id
await as(U.ref, `insert into mant_equipo_repuestos (equipo_id, articulo_id) values ($1,$2)`, [eq, artp])
const cp = (await as(U.pan, `select mant_pedir_presupuesto($1) c`, [artp])).rows[0].c
const cpr = (await as(U.ref, `select * from mant_compras where id=$1`, [cp])).rows[0]
check(cpr.estado === 'pendiente' && cpr.planta_id === pl && Number(cpr.monto) === 700, 'pedir presupuesto crea la compra pendiente con su centro de costo')
check(!!(await fails(U.pan, `select mant_pedir_presupuesto($1)`, [artp])), 'no se duplica el pedido de un repuesto en curso')

console.log('Ejecución en el celular (0005)')
const tar = (await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha) values ($1,'Cambio de rodamiento',4,'semanas',current_date) returning id`, [eq])).rows[0].id
const ox = (await as(U.ref, `insert into mant_ordenes (tipo, titulo, equipo_id, tarea_id, asignado_id, estado) values ('preventiva','Cambio de rodamiento',$1,$2,$3,'pendiente') returning id`, [eq, tar, U.op])).rows[0].id
check(!!(await fails(U.op, `select mant_ot_terminar($1)`, [ox])), 'no se termina sin iniciar la actividad')
check(!!(await fails(U.op2, `select mant_ot_marcar($1,'inicio')`, [ox])), 'otro operario no inicia una tarea ajena')
let rel = (await as(U.op, `select mant_ot_marcar($1,'inicio') r`, [ox])).rows[0].r
check(rel.reloj === 'corriendo' && (await as(U.op, `select estado from mant_ordenes where id=$1`, [ox])).rows[0].estado === 'en_proceso', 'iniciar pone la OT en proceso y el cronómetro corriendo')
check(!!(await fails(U.op, `select mant_ot_marcar($1,'inicio')`, [ox])), 'no se inicia dos veces')
// simular 40 min de trabajo, 10 de pausa y 20 más
await as(null, `update mant_ot_eventos set creado_en = now() - interval '70 minutes' where orden_id=$1`, [ox])
await as(U.op, `select mant_ot_marcar($1,'pausa')`, [ox])
await as(null, `update mant_ot_eventos set creado_en = now() - interval '30 minutes' where orden_id=$1 and tipo='pausa'`, [ox])
await as(U.op, `select mant_ot_marcar($1,'reanudar')`, [ox])
await as(null, `update mant_ot_eventos set creado_en = now() - interval '20 minutes' where orden_id=$1 and tipo='reanudar'`, [ox])
check((await as(U.op, `select mant_ot_minutos($1) m`, [ox])).rows[0].m === 60, 'el tiempo real descuenta las pausas (40 + 20 = 60 min)')
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, nota, desde_camara, tomada_en) values ($1,'p1.jpg','paso','Aflojar la tapa',true,now())`, [ox])
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, nota, desde_camara, tomada_en) values ($1,'p2.jpg','paso','Sacar el rodamiento',true,now())`, [ox])
check((await as(U.op, `select array_agg(paso order by paso) p from mant_ot_fotos where orden_id=$1 and tipo='paso'`, [ox])).rows[0].p.join() === '1,2', 'las fotos del trabajo se numeran como pasos')
check(!!(await fails(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo) values ($1,'galeria.jpg','cierre')`, [ox])), 'la foto final no se puede subir de la galería')
check(!!(await fails(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'vieja.jpg','cierre',true,now() - interval '2 hours')`, [ox])), 'una foto final vieja se rechaza')
await as(U.op, `insert into mant_ot_herramientas (orden_id, texto) values ($1,'Llave de 19'),($1,'  llave DE 19 '),($1,'Extractor de rodamientos')`, [ox])
check((await as(U.op, `select count(*)::int n from mant_herramientas`)).rows[0].n === 2, 'las herramientas arman su catálogo sin duplicar')
await as(U.op, `insert into mant_ot_repuestos (orden_id, texto, cantidad) values ($1,'rodamiento 6205',2)`, [ox])
await as(U.op, `insert into mant_ot_medios (orden_id, tipo, ruta, transcripcion) values ($1,'audio','a.webm','Cambié el rodamiento lado acople')`, [ox])
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'cierre.jpg','cierre',true,now())`, [ox])
const mins = (await as(U.op, `select mant_ot_terminar($1,'Cambié el rodamiento lado acople') m`, [ox])).rows[0].m
const oxr = (await as(U.ref, `select estado, tiempo_real_min, comentario_cierre from mant_ordenes where id=$1`, [ox])).rows[0]
check(mins >= 60 && mins <= 61 && oxr.estado === 'completada' && oxr.tiempo_real_min === mins && oxr.comentario_cierre.includes('rodamiento'), 'terminar cierra la OT con el tiempo del cronómetro y el informe')
const rod = (await as(U.ref, `insert into mant_articulos (codigo, descripcion, stock_actual, stock_minimo) values ('ROD-6205-T','Rodamiento 6205 (prueba)',10,2) returning id`)).rows[0].id
await as(U.ref, `update mant_ot_repuestos set articulo_id=$1 where orden_id=$2`, [rod, ox])
const apr = (await as(U.ref, `select mant_aprender_de_ot($1) r`, [ox])).rows[0].r
check(apr.pasos === 2 && apr.repuestos === 1 && apr.herramientas === 2 && Number(apr.horas) === 1, 'guardar como referencia arma el procedimiento, los repuestos, las herramientas y el tiempo')
check((await as(U.op2, `select count(*)::int n from mant_tarea_pasos where tarea_id=$1`, [tar])).rows[0].n === 2, 'cualquier operario ve el procedimiento de la tarea')
const pr = (await as(U.ref, `select * from mant_v_tarea_prediccion where tarea_id=$1`, [tar])).rows[0]
check(Number(pr.ejecuciones) === 1 && pr.minutos_promedio === mins, 'la predicción de tiempo sale de las veces que se hizo')
check(!!(await fails(U.op, `select mant_aprender_de_ot($1)`, [ox])), 'el operario no guarda referencias')

console.log('Revisión con audio (0006)')
await as(U.ref, `update mant_ot_medios set transcripcion='Se cambió el rodamiento del lado acople y se engrasó' where orden_id=$1`, [ox])
check((await as(U.ref, `select transcripcion from mant_ot_medios where orden_id=$1`, [ox])).rows[0].transcripcion.includes('engrasó'), 'el administrador escribe el texto del audio')
const apr2 = (await as(U.ref, `select mant_aprender_de_ot($1, $2::jsonb) r`, [ox, JSON.stringify([{ texto: 'Cortar energía y bloquear' }, { texto: '', foto_ruta: '' }, { texto: 'Cambiar rodamiento', foto_ruta: 'p1.jpg' }, { texto: 'Engrasar' }])])).rows[0].r
const pasos2 = (await as(U.op2, `select orden, texto, foto_ruta from mant_tarea_pasos where tarea_id=$1 order by orden`, [tar])).rows
check(apr2.pasos === 3 && pasos2.length === 3 && pasos2[0].texto === 'Cortar energía y bloquear' && pasos2[1].foto_ruta === 'p1.jpg' && pasos2[2].orden === 3, 'los pasos que escribe el administrador quedan como procedimiento (los vacíos se ignoran)')

console.log('Programar el preventivo (0007)')
const tv = (await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha, duracion_estimada_horas) values ($1,'Limpieza de quemadores',2,'semanas',current_date - 10, 2) returning id`, [eq])).rows[0].id
await as(U.ref, `insert into mant_tarea_items (tarea_id, orden, descripcion) values ($1,1,'Sacar quemadores'),($1,2,'Limpiar picos')`, [tv])
const tf = (await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha) values ($1,'Revisión anual',1,'meses',current_date + 90) returning id`, [eq])).rows[0].id
const pp = (await as(U.ref, `select * from mant_v_preventivo_programar where tarea_id=$1`, [tv])).rows[0]
check(pp && pp.dias_atraso === 10 && pp.prioridad_sugerida === 'urgente' && pp.orden_id === null, 'una tarea de equipo crítico atrasada 10 días aparece como urgente y sin OT')
check(!(await as(U.ref, `select 1 from mant_v_preventivo_programar where tarea_id=$1`, [tf])).rows.length, 'lo que vence en más de 60 días no aparece')
check(!!(await fails(U.op, `select mant_generar_ots(array[$1::uuid], $2::uuid, current_date)`, [tv, U.op])), 'un operario no genera OT')
const manana = (await as(null, `select (current_date + 1)::text d`)).rows[0].d
const gr = (await as(U.ref, `select mant_generar_ots(array[$1::uuid], $2::uuid, $3::date, 'Mañana', null, 'Llevar cepillo de bronce') r`, [tv, U.op, manana])).rows[0].r
const og = (await as(U.ref, `select * from mant_ordenes where tarea_id=$1 and estado='pendiente'`, [tv])).rows[0]
check(gr.nuevas === 1 && og.asignado_id === U.op && og.prioridad === 'urgente' && og.turno === 'Mañana' && og.observacion === 'Llevar cepillo de bronce', 'genera la OT asignada al operario, con día, turno, observación y la prioridad sugerida')
check((await as(U.ref, `select count(*)::int n from mant_ot_items where orden_id=$1`, [og.id])).rows[0].n === 2, 'la OT trae los puntos de control de la tarea')
check((await as(U.op, `select count(*)::int n from mant_ordenes where id=$1`, [og.id])).rows[0].n === 1, 'el operario ve la OT que le asignaron')
const gr2 = (await as(U.ref, `select mant_generar_ots(array[$1::uuid], $2::uuid, current_date) r`, [tv, U.op2])).rows[0].r
check(gr2.nuevas === 0 && gr2.reasignadas === 1 && (await as(U.ref, `select count(*)::int n from mant_ordenes where tarea_id=$1 and estado='pendiente'`, [tv])).rows[0].n === 1, 'si ya tiene OT pendiente no se duplica: se reasigna')
check((await as(U.ref, `select asignado_id from mant_ordenes where id=$1`, [og.id])).rows[0].asignado_id === U.op2, 'la OT pasó al otro operario')
await as(U.ref, `select mant_generar_ots(array[$1::uuid], $2::uuid, current_date)`, [tv, U.op])
const pp2 = (await as(U.ref, `select * from mant_v_preventivo_programar where tarea_id=$1`, [tv])).rows[0]
check(pp2.orden_id === og.id && pp2.asignado_id === U.op, 'la vista muestra la OT abierta y a quién está asignada')
check(!!(await fails(U.ref, `select mant_generar_ots(array[$1::uuid], null, current_date, null, 'altisima')`, [tv])), 'rechaza una prioridad inválida')

// repartir fechas amontonadas
const fm = (await as(null, `select (current_date + 9)::text d`)).rows[0].d
const eqs2 = []
for (let k = 0; k < 6; k++) eqs2.push((await as(U.ref, `insert into mant_equipos (codigo,nombre,planta_id,io,fo,isa) values ($1,$2,$3,$4,1,0) returning id`, [`EQ-R${k}`, `Equipo ${k}`, pl, 6 - k])).rows[0].id)
const anuales = [], mensuales = []
for (const e of eqs2) {
  anuales.push((await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha) values ($1,'Anual',12,'meses',$2) returning id`, [e, fm])).rows[0].id)
  mensuales.push((await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha) values ($1,'Mensual',1,'meses',$2) returning id`, [e, fm])).rows[0].id)
}
await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha) values ($1,'Anual 2',12,'meses',$2)`, [eqs2[5], fm])
await as(U.ref, `select mant_generar_semana($1::date)`, [fm])
const pendAntes = (await as(U.ref, `select count(*)::int n from mant_ordenes where tarea_id = any($1::uuid[]) and estado='pendiente'`, [[...anuales, ...mensuales]])).rows[0].n
check(!!(await fails(U.op, `select mant_repartir_fechas($1::date)`, [fm])), 'un operario no reparte fechas')
const rp = (await as(U.ref, `select mant_repartir_fechas($1::date) r`, [fm])).rows[0].r
const fa = (await as(U.ref, `select t.proxima_fecha::text f, e.codigo from mant_tareas t join mant_equipos e on e.id=t.equipo_id where t.id = any($1::uuid[]) order by e.codigo`, [anuales])).rows
const fmn = (await as(U.ref, `select t.proxima_fecha::text f from mant_tareas t join mant_equipos e on e.id=t.equipo_id where t.id = any($1::uuid[]) order by e.codigo`, [mensuales])).rows.map((r) => r.f)
const a2 = (await as(U.ref, `select proxima_fecha::text f from mant_tareas where descripcion='Anual 2'`)).rows[0].f
check(rp.tareas === 13 && new Set(fa.map((r) => r.f)).size === 6, `las anuales quedan una máquina por semana (${rp.tareas} tareas reprogramadas)`)
check(fa[0].f === rp.desde && fa[0].codigo === 'EQ-R0', 'empieza por el equipo más crítico')
check(a2 === fa[5].f, 'las tareas del mismo equipo y frecuencia caen la misma semana')
check(new Set(fmn).size === 4 && fmn[4] === fmn[0], 'las mensuales se reparten en las 4 semanas del mes')
check(pendAntes === 12 && rp.ots_movidas + rp.ots_canceladas === 13 && rp.ots_canceladas > 0, `las OT sin asignar se mueven (${rp.ots_movidas}) o se cancelan (${rp.ots_canceladas})`)
check((await as(U.ref, `select count(*)::int n from mant_ordenes where tarea_id = any($1::uuid[]) and estado='pendiente' and fecha_programada <> (select proxima_fecha from mant_tareas where id = tarea_id)`, [[...anuales, ...mensuales]])).rows[0].n === 0, 'las OT que quedan pendientes tienen la nueva fecha')

console.log('Calendario, horas y máquina parada (0008)')
// mover en el calendario
const tm = (await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha) values ($1,'Engrase general',1,'meses',current_date + 3) returning id`, [eq])).rows[0].id
await as(U.ref, `select mant_generar_ots(array[$1::uuid], $2::uuid, current_date + 3)`, [tm, U.op])
check(!!(await fails(U.op, `select mant_mover_tarea($1, current_date + 10)`, [tm])), 'un operario no mueve tareas del plan')
const mv = (await as(U.ref, `select mant_mover_tarea($1, current_date + 10, 'Parada de planta') n`, [tm])).rows[0].n
const tm1 = (await as(U.ref, `select (proxima_fecha - current_date) d from mant_tareas where id=$1`, [tm])).rows[0].d
const om = (await as(U.ref, `select (fecha_programada - current_date) d from mant_ordenes where tarea_id=$1 and estado='pendiente'`, [tm])).rows[0].d
const hm = (await as(U.ref, `select * from mant_tareas_historial where tarea_id=$1 and fecha_nueva is not null`, [tm])).rows[0]
check(mv === 1 && tm1 === 10 && om === 10 && hm?.motivo === 'Parada de planta', 'arrastrar en el calendario mueve la tarea, su OT pendiente y queda en el historial')
await as(U.ref, `select mant_ajustar_frecuencia($1, 2, 'semanas', 'Más seguido', current_date + 5)`, [tm])
const tm2 = (await as(U.ref, `select frecuencia_valor v, frecuencia_unidad u, (proxima_fecha - current_date) d from mant_tareas where id=$1`, [tm])).rows[0]
check(tm2.v === 2 && tm2.u === 'semanas' && tm2.d === 5, 'editar frecuencia y próxima fecha desde el calendario')
check(!!(await fails(U.ref, `select mant_ajustar_frecuencia($1, 0, 'semanas', 'x')`, [tm])), 'no acepta frecuencia 0')
// horas de uso
await as(U.op, `insert into mant_equipo_horas (equipo_id, horas, leida_en) values ($1, 1200, now() - interval '10 days')`, [eq])
await as(U.op, `insert into mant_equipo_horas (equipo_id, horas) values ($1, 1440)`, [eq])
check(Number((await as(U.sol, `select horas_uso from mant_equipo_uso where equipo_id=$1`, [eq])).rows[0].horas_uso) === 1440, 'la ficha muestra la última lectura del horómetro')
check(!!(await fails(U.op, `insert into mant_equipo_horas (equipo_id, horas) values ($1, 100)`, [eq])), 'una lectura menor que la anterior pide aclaración')
check(!!(await fails(U.sol, `insert into mant_equipo_horas (equipo_id, horas) values ($1, 1500)`, [eq])), 'un solicitante no carga horas')
check(!!(await fails(U.op, `insert into mant_equipo_horas (equipo_id, horas, origen) values ($1, 1500, 'plc')`, [eq])), 'desde la app no se cargan lecturas como si fueran del PLC')
check(!!(await fails(U.op, `select mant_plc_clave()`)), 'el operario no ve la clave del PLC')
const clave = (await as(U.ref, `select mant_plc_clave() c`)).rows[0].c
check(!!(await fails(null, `select mant_plc_horas('mala', 'FP-PL-HORNO-1', 1500)`)), 'el PLC con clave equivocada se rechaza')
check(!!(await fails(null, `select mant_plc_horas($1, 'FP-PL-HORNO-1', 1500)`, [clave])), 'si el equipo no tiene PLC habilitado se rechaza')
await as(U.ref, `insert into mant_equipo_uso (equipo_id, plc_habilitado, plc_protocolo, plc_direccion, plc_tag) values ($1, true, 'Modbus TCP', '192.168.1.50', 'HR40001') on conflict (equipo_id) do update set plc_habilitado = true, plc_protocolo='Modbus TCP'`, [eq])
await as(null, `select mant_plc_horas($1, 'FP-PL-HORNO-1', 1500)`, [clave])
const ul = (await as(U.ref, `select horas_uso from mant_equipo_uso where equipo_id=$1`, [eq])).rows[0]
check(Number(ul.horas_uso) === 1500 && (await as(U.ref, `select origen from mant_equipo_horas where equipo_id=$1 order by leida_en desc limit 1`, [eq])).rows[0].origen === 'plc', 'el PLC manda las horas con la clave y quedan registradas como lectura del PLC')
check(!(await as(U.ref, `select * from mant_plc_clave`).catch(() => ({ rows: [] }))).rows.length, 'la tabla de la clave no se lee directo')
// máquina parada
const tp = (await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha) values ($1,'Limpieza de tolva',1,'meses',current_date - 2) returning id`, [eq])).rows[0].id
await as(U.ref, `select mant_generar_ots(array[$1::uuid], $2::uuid, current_date)`, [tp, U.op])
const op0 = (await as(U.ref, `select id from mant_ordenes where tarea_id=$1 and estado='pendiente'`, [tp])).rows[0].id
check(!!(await fails(U.op2, `select mant_ot_no_realizada($1)`, [op0])), 'otro operario no la marca como no realizada')
check(!!(await fails(U.op, `select mant_ot_no_realizada($1, 'otro', '')`, [op0])), 'con "otro motivo" hay que explicar por qué')
await as(U.op, `select mant_ot_marcar($1,'inicio')`, [op0])
const prox = (await as(U.op, `select (mant_ot_no_realizada($1, 'maquina_parada', 'Sin producción de legumbres desde el lunes') - current_date) d`, [op0])).rows[0].d
const onr = (await as(U.ref, `select estado, no_realizada_motivo, comentario_cierre, completada_en is not null c, no_realizada_por from mant_ordenes where id=$1`, [op0])).rows[0]
check(onr.estado === 'no_realizada' && onr.no_realizada_motivo === 'maquina_parada' && onr.comentario_cierre.includes('legumbres') && onr.c && onr.no_realizada_por === U.op, 'el operario deja asentado que no se hizo por máquina parada')
check(prox >= 28 && prox <= 31, 'la tarea se reprograma a la próxima vez según su frecuencia')
check((await as(U.ref, `select ultima_ejecucion from mant_tareas where id=$1`, [tp])).rows[0].ultima_ejecucion === null, 'no cuenta como ejecutada')
check((await as(U.ref, `select mant_ot_reloj($1) r`, [op0])).rows[0].r === 'terminada', 'si había arrancado el cronómetro, se cierra')
check((await as(U.ref, `select count(*)::int n from mant_v_ordenes where equipo_id=$1 and estado='no_realizada' and no_realizada_motivo='maquina_parada'`, [eq])).rows[0].n === 1, 'queda en el historial de la máquina, con el motivo')
check(!!(await fails(U.op, `select mant_ot_no_realizada($1)`, [op0])), 'no se marca dos veces')

console.log('Pedidos: adjuntos y aviso al mover la OT (0009)')
const pj = (await as(U.sol, `insert into mant_pedidos (equipo_id, descripcion, urgencia_reportada) values ($1,'Gotea la bomba','media') returning id`, [eq])).rows[0].id
await as(U.sol, `insert into mant_pedido_adjuntos (pedido_id, tipo, ruta, nombre) values ($1,'foto','p/1.jpg','foto.jpg'),($1,'documento','p/2.pdf','plano.pdf'),($1,'audio','p/3.webm',null),($1,'video','p/4.mp4',null)`, [pj])
check((await as(U.ref, `select count(*)::int n from mant_pedido_adjuntos where pedido_id=$1`, [pj])).rows[0].n === 4, 'el solicitante adjunta foto, documento, audio y video, y mantenimiento los ve')
check(!!(await fails(U.op2, `insert into mant_pedido_adjuntos (pedido_id, tipo, ruta) values ($1,'foto','x.jpg')`, [pj])), 'otro usuario no adjunta en un pedido ajeno')
check(!!(await fails(U.sol, `insert into mant_pedido_adjuntos (pedido_id, tipo, ruta) values ($1,'planilla','x.xls')`, [pj])), 'tipo de adjunto inválido')
const cAntes = (await as(U.ref, `select count(*)::int n from mant_pedido_comentarios where pedido_id=$1`, [pj])).rows[0].n
const otj = (await as(U.ref, `select mant_convertir_pedido($1,'media',current_date+3,1,$2,current_date) o`, [pj, U.op])).rows[0].o
const cConv = (await as(U.ref, `select texto from mant_pedido_comentarios where pedido_id=$1 order by creado_en`, [pj])).rows.slice(cAntes).map((r) => r.texto)
check(cConv.length === 1 && cConv[0].startsWith('Asignado a'), 'al convertir no aparece un aviso de "reprogramado"')
await as(U.ref, `update mant_ordenes set fecha_programada = current_date + 7, semana = date_trunc('week', current_date + 7)::date where id=$1`, [otj])
const pjv = (await as(U.sol, `select (fecha_cierre_estimada - current_date) d from mant_pedidos where id=$1`, [pj])).rows[0].d
const avis = (await as(U.sol, `select texto from mant_pedido_comentarios where pedido_id=$1 order by creado_en desc limit 1`, [pj])).rows[0].texto
check(pjv === 7 && avis.startsWith('Reprogramamos el trabajo para el'), 'al mover la OT en la agenda, el solicitante ve la nueva fecha y el aviso')
check((await as(U.ref, `select (fecha_comprometida - current_date) d from mant_ordenes where id=$1`, [otj])).rows[0].d === 7, 'la OT queda con la misma fecha comprometida')
await as(U.ref, `update mant_ordenes set asignado_id=$2, prioridad='alta' where id=$1`, [otj, U.op2])
const pjr = (await as(U.ref, `select responsable_id, prioridad from mant_pedidos where id=$1`, [pj])).rows[0]
check(pjr.responsable_id === U.op2 && pjr.prioridad === 'alta', 'cambiar operario o prioridad en la agenda también actualiza el pedido')
check((await as(U.sol, `select texto from mant_pedido_comentarios where pedido_id=$1 order by creado_en desc limit 1`, [pj])).rows[0].texto.startsWith('Lo va a hacer'), 'y le avisa al solicitante quién lo hace')

console.log('Verificación y evaluación del pedido (0011)')
const pv = (await as(U.sol, `insert into mant_pedidos (equipo_id, descripcion, urgencia_reportada) values ($1,'Pierde la válvula','media') returning id`, [eq])).rows[0].id
const otv = (await as(U.ref, `select mant_convertir_pedido($1,'media',current_date+2,1,$2,current_date) o`, [pv, U.op])).rows[0].o
check(!!(await fails(U.sol, `select mant_evaluar_pedido($1, 8)`, [pv])), 'no se califica antes de terminar')
await as(U.op, `insert into mant_ot_fotos (orden_id, ruta, tipo, desde_camara, tomada_en) values ($1,'c.jpg','cierre',true,now())`, [otv])
await as(U.op, `update mant_ordenes set estado='completada' where id=$1`, [otv])
const ult = async () => (await as(U.sol, `select texto from mant_pedido_comentarios where pedido_id=$1 order by creado_en desc, texto limit 1`, [pv])).rows[0].texto
check((await ult()).includes('falta verificación de supervisión'), 'al cerrar la OT el solicitante ve "falta verificación de supervisión"')
check((await as(U.sol, `select revision_foto from mant_ordenes where pedido_id=$1`, [pv])).rows[0].revision_foto === 'pendiente', 'el solicitante ve que la revisión está pendiente')
await as(U.ref, `select mant_revisar_foto($1,'aprobada')`, [otv])
check((await ult()).includes('aprobó'), 'cuando el supervisor aprueba, el solicitante recibe el aviso')
check(!!(await fails(U.sol, `select mant_evaluar_pedido($1, 11)`, [pv])), 'la nota va de 1 a 10')
check(!!(await fails(U.op, `select mant_evaluar_pedido($1, 9)`, [pv])), 'solo el solicitante califica')
await as(U.sol, `select mant_evaluar_pedido($1, 9, 'Rápido y prolijo')`, [pv])
const ev = (await as(U.ref, `select evaluacion, evaluacion_comentario from mant_pedidos where id=$1`, [pv])).rows[0]
check(ev.evaluacion === 9 && ev.evaluacion_comentario === 'Rápido y prolijo', 'el solicitante califica el trabajo con nota y comentario')
const eo = (await as(U.ref, `select * from mant_v_evaluacion_operarios where operario_id=$1`, [U.op])).rows[0]
check(eo && Number(eo.promedio) === 9 && Number(eo.calificaciones) >= 1, 'el promedio queda por operario')

console.log('Eliminar tarea del plan (0012)')
const te = (await as(U.ref, `insert into mant_tareas (equipo_id, descripcion, frecuencia_valor, frecuencia_unidad, proxima_fecha, duracion_estimada_horas) values ($1,'Tarea a borrar',1,'meses',current_date, 1.5) returning id, duracion_estimada_horas d`, [eq])).rows[0]
check(Number(te.d) === 1.5, 'la duración acepta fracción de horas (1,5 h)')
await as(U.ref, `insert into mant_tarea_items (tarea_id, orden, descripcion) values ($1,1,'Punto')`, [te.id])
const ohecha = (await as(U.ref, `insert into mant_ordenes (tipo,titulo,equipo_id,tarea_id,estado) values ('preventiva','Hecha',$1,$2,'pendiente') returning id`, [eq, te.id])).rows[0].id
await as(null, `update mant_ordenes set estado='no_realizada', completada_en=now() where id=$1`, [ohecha])
await as(U.ref, `select mant_generar_ots(array[$1::uuid], $2::uuid, current_date)`, [te.id, U.op])
check(!!(await fails(U.op, `select mant_eliminar_tarea($1)`, [te.id])), 'un operario no elimina tareas')
const el = (await as(U.ref, `select mant_eliminar_tarea($1, 'Ya no se usa') r`, [te.id])).rows[0].r
check(el.ots_canceladas === 1 && el.ots_en_historial === 1, 'al eliminar se cancela la OT pendiente y la hecha queda en el historial')
check(!(await as(U.ref, `select 1 from mant_tareas where id=$1`, [te.id])).rows.length && !(await as(U.ref, `select 1 from mant_tarea_items where tarea_id=$1`, [te.id])).rows.length, 'la tarea y su checklist se borran')
check((await as(U.ref, `select count(*)::int n from mant_ordenes where id=$1`, [ohecha])).rows[0].n === 1, 'la OT del historial sigue en la máquina')

console.log(`\n${ok} ok, ${fail} con error`)
process.exit(fail ? 1 : 0)
