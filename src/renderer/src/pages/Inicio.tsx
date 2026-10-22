import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { deISO, fmtFecha, hoy, lunesDe, numCompra, numOT, numPedido, semanaISO, sumarDias, useDatos } from '@/lib/util'
import type { Articulo, Compra, Equipo, Orden, Pedido, Tarea } from '@/lib/tipos'
import { Cargando, ErrorBox, H2, Insignia, InsEstadoOT, Kpi, Pagina, Tarjeta, Titulo } from '@/components/ui'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const cuando = (iso: string) => iso === hoy() ? 'Hoy' : iso < hoy() ? `Atrasada ${fmtFecha(iso).slice(0, 5)}` : `${DIAS[deISO(iso).getDay()]} ${fmtFecha(iso).slice(0, 5)}`
const haceTxt = (iso: string) => { const d = new Date(iso); return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

interface Evento { t: string; w: string; color: string }

export function Inicio() {
  const nav = useNavigate()
  const { puede } = useSesion()
  const verMant = puede('referente', 'supervisor', 'director')
  const verPanol = puede('panolero', 'referente', 'supervisor', 'compras', 'director')

  const { data, cargando, error } = useDatos(async () => {
    const lunes = lunesDe(new Date()), domingo = sumarDias(lunes, 6)
    const [ots, ped, stock, tareas, cerradas, compras, plantas] = await Promise.all([
      supabase.from('mant_v_ordenes').select('id,numero,tipo,estado,duracion_estimada_horas,tiempo_real_min,fecha_programada').gte('fecha_programada', lunes).lte('fecha_programada', domingo).neq('estado', 'cancelada'),
      supabase.from('mant_v_pedidos').select('id,numero,titulo,descripcion,estado,prioridad,creado_en,nombre_contacto,solicitante_nombre').order('creado_en', { ascending: false }).limit(300),
      verPanol ? supabase.from('mant_v_stock').select('id,descripcion,stock_actual,stock_minimo').eq('activo', true).eq('bajo_minimo', true).gt('stock_minimo', 0).order('stock_actual').limit(200) : Promise.resolve({ data: [] }),
      supabase.from('mant_v_equipos').select('id,codigo,nombre').eq('activo', true).eq('clasificacion', 'C'),
      supabase.from('mant_v_ordenes').select('id,numero,titulo,completada_en,asignado_nombre,tarea_id,estado,asignado_id,fecha_programada').eq('estado', 'completada').order('completada_en', { ascending: false }).limit(4),
      verPanol ? supabase.from('mant_compras').select('id,numero,descripcion,estado,decidido_en').not('decidido_en', 'is', null).order('decidido_en', { ascending: false }).limit(3) : Promise.resolve({ data: [] }),
      supabase.from('mant_plantas').select('id', { count: 'exact', head: true })
    ])
    const criticos = new Map(((tareas.data ?? []) as Pick<Equipo, 'id' | 'codigo' | 'nombre'>[]).map((e) => [e.id, e]))
    const tq = criticos.size
      ? await supabase.from('mant_tareas').select('id,descripcion,proxima_fecha,equipo_id').eq('activa', true).in('equipo_id', [...criticos.keys()]).order('proxima_fecha').limit(4)
      : { data: [] }
    const tareasC = ((tq.data ?? []) as Tarea[]).map((t) => ({ ...t, equipo: criticos.get(t.equipo_id!)! }))
    const abiertas = tareasC.length
      ? await supabase.from('mant_v_ordenes').select('tarea_id,estado,asignado_nombre,fecha_programada').in('tarea_id', tareasC.map((t) => t.id)).in('estado', ['pendiente', 'en_proceso'])
      : { data: [] }
    return {
      data: {
        ots: (ots.data ?? []) as Orden[], pedidos: (ped.data ?? []) as Pedido[], stock: (stock.data ?? []) as Articulo[],
        tareas: tareasC, abiertas: (abiertas.data ?? []) as Orden[], cerradas: (cerradas.data ?? []) as Orden[],
        compras: (compras.data ?? []) as Compra[], plantas: plantas.count ?? 0
      },
      error: ots.error || ped.error
    }
  })

  const fecha = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const encabezado = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-sm text-tenue first-letter:uppercase">{fecha} · Semana {semanaISO(hoy())}</div>
        <h1 className="m-0 mt-1"><Titulo texto="Panel de mantenimiento" className="text-[30px] md:text-[36px]" /></h1>
      </div>
      {data && <div className="text-sm text-suave">{data.plantas} plantas en la misma base</div>}
    </div>
  )

  if (cargando && !data) return <div className="mx-auto max-w-[1400px] px-4 pt-6 md:px-6">{encabezado}<Cargando /></div>
  if (!data) return <Pagina titulo="Panel de mantenimiento"><ErrorBox texto={error} /></Pagina>

  const otTot = data.ots.length, otOk = data.ots.filter((o) => o.estado === 'completada').length
  const prev = data.ots.filter((o) => o.tipo === 'preventiva' && o.estado !== 'no_realizada'), prevOk = prev.filter((o) => o.estado === 'completada').length
  const abiertos = data.pedidos.filter((p) => p.estado === 'nuevo' || p.estado === 'aprobado' || p.estado === 'en_ot')
  const sinAsignar = abiertos.filter((p) => p.estado === 'nuevo').length
  const horas = (o: Orden) => (o.tiempo_real_min ? o.tiempo_real_min / 60 : o.duracion_estimada_horas ?? 0)
  const hPrev = prev.reduce((s, o) => s + horas(o), 0), hTot = data.ots.reduce((s, o) => s + horas(o), 0)
  const pctPrev = hTot ? Math.round((hPrev / hTot) * 100) : 0

  const eventos: Evento[] = [
    ...data.pedidos.slice(0, 4).map((p) => ({ t: `Nuevo pedido ${numPedido(p.numero)} · ${(p.titulo || p.descripcion).toLowerCase()}`, w: p.creado_en, color: '#cc1a20' })),
    ...data.cerradas.filter((o) => o.completada_en).map((o) => ({ t: `${o.asignado_nombre ?? 'Mantenimiento'} cerró ${numOT(o.numero)} · ${o.titulo.toLowerCase()}`, w: o.completada_en!, color: '#1e6b3a' })),
    ...data.compras.map((c) => ({ t: `Compra ${numCompra(c.numero)} ${c.estado === 'rechazada' ? 'rechazada' : 'aprobada'} · ${c.descripcion.toLowerCase()}`, w: c.decidido_en!, color: '#8c8174' }))
  ].sort((a, b) => b.w.localeCompare(a.w)).slice(0, 6)

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 pb-16 pt-6 md:px-6">
      {encabezado}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
        {verMant && <Kpi titulo="OT de la semana" valor={otTot} avance={otTot ? (otOk / otTot) * 100 : 0} color="#1f1b16" detalle={`${otOk} completadas · ${otTot - otOk} abiertas`} onClick={() => nav('/ordenes')} />}
        {verMant && <Kpi titulo="Cumplimiento del preventivo" valor={prev.length ? `${Math.round((prevOk / prev.length) * 100)}%` : '—'} avance={prev.length ? (prevOk / prev.length) * 100 : 0} color="#9a6b00" detalle={`${prevOk} de ${prev.length} tareas preventivas`} onClick={() => nav('/preventivo')} />}
        {verMant && <Kpi titulo="Pedidos abiertos" valor={abiertos.length} avance={abiertos.length ? ((abiertos.length - sinAsignar) / abiertos.length) * 100 : 0} color="#3a332b" detalle={`${sinAsignar} sin asignar`} onClick={() => nav('/pedidos')} />}
        {verPanol && <Kpi titulo="Repuestos bajo mínimo" valor={data.stock.length} avance={data.stock.length ? 100 : 0} color="#cc1a20"
          detalle={data.stock.length ? `${data.stock.slice(0, 2).map((a) => a.descripcion).join(' · ')}${data.stock.length > 2 ? ` y ${data.stock.length - 2} más` : ''}` : 'Todo en orden'} onClick={() => nav('/panol')} />}
        {verMant && <Kpi titulo="Preventivo vs. correctivo" valor={hTot ? `${pctPrev}%` : '—'} avance={pctPrev} color="#24508f" detalle={hTot ? `del tiempo fue preventivo · ${100 - pctPrev}% correctivo` : 'Sin horas cargadas esta semana'} onClick={() => nav('/ordenes')} />}
      </div>
      <div className="flex flex-wrap gap-4">
        <Tarjeta className="flex min-w-0 flex-[3_1_460px] flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <H2 texto="Equipos críticos con tareas próximas" />
            {verMant && <button className="text-[13px] font-semibold text-primario hover:underline" onClick={() => nav('/ordenes?programar=1')}>Programar y asignar preventivos →</button>}
          </div>
          {data.tareas.length === 0 && <span className="text-sm text-suave">No hay tareas preventivas de equipos críticos.</span>}
          {data.tareas.map((t) => {
            const ot = data.abiertas.find((o) => o.tarea_id === t.id)
            return (
              <button key={t.id} onClick={() => nav(`/equipos/${t.equipo_id}`)} className="flex flex-wrap items-center gap-3 rounded-[14px] bg-crema px-3.5 py-3 text-left text-texto">
                <Insignia t="rojo">C</Insignia>
                <span className="flex flex-[1_1_200px] flex-col gap-0.5"><span className="text-[15px] font-semibold">{t.descripcion}</span><span className="text-[13px] text-suave">{t.equipo.codigo} · {t.equipo.nombre}</span></span>
                <span className="text-sm font-medium">{cuando(ot?.fecha_programada ?? t.proxima_fecha)}{ot ? ` · ${ot.asignado_nombre ?? 'sin asignar'}` : ''}</span>
                {ot ? <InsEstadoOT e={ot.estado} /> : <Insignia>Programada</Insignia>}
              </button>
            )
          })}
        </Tarjeta>
        <Tarjeta className="flex min-w-0 flex-[2_1_300px] flex-col gap-3">
          <H2 texto="Actividad reciente" />
          {eventos.length === 0 && <span className="text-sm text-suave">Sin movimientos todavía.</span>}
          {eventos.map((e, i) => (
            <div key={i} className="flex gap-2.5 text-sm leading-snug">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
              <span className="flex flex-col gap-0.5"><span>{e.t}</span><span className="text-xs text-tenue">{haceTxt(e.w)}</span></span>
            </div>
          ))}
        </Tarjeta>
      </div>
    </div>
  )
}
