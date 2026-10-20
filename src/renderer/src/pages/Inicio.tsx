import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { fmtFecha, lunesDe, numOT, numPedido, useDatos } from '@/lib/util'
import type { Orden, Pedido } from '@/lib/tipos'
import { Boton, Cargando, InsEstadoOT, InsEstadoPedido, InsPrioridad, Kpi, Pagina, Tarjeta, Vacio } from '@/components/ui'

const contar = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0)

export function Inicio() {
  const { usuario, puede } = useSesion()
  const nav = useNavigate()
  const esMant = puede('referente', 'supervisor', 'director')
  const esOperario = puede('operario', 'referente', 'supervisor')
  const verStock = puede('panolero', 'referente', 'supervisor', 'compras', 'director')
  const verCompras = puede('referente', 'director', 'compras', 'panolero')

  const { data, cargando } = useDatos(async () => {
    const lunes = lunesDe(new Date())
    const n = (t: string) => supabase.from(t).select('*', { count: 'exact', head: true })
    const [porPriorizar, vencidas, semana, semanaOk, misTareas, stockBajo, comprasPend] = await Promise.all([
      esMant ? contar(n('mant_pedidos').eq('estado', 'nuevo')) : 0,
      esMant ? contar(n('mant_v_ordenes').eq('vencida', true)) : 0,
      esMant ? contar(n('mant_ordenes').eq('semana', lunes).neq('estado', 'cancelada')) : 0,
      esMant ? contar(n('mant_ordenes').eq('semana', lunes).eq('estado', 'completada')) : 0,
      esOperario ? contar(n('mant_ordenes').eq('asignado_id', usuario!.id).in('estado', ['pendiente', 'en_proceso'])) : 0,
      verStock ? contar(n('mant_v_stock').eq('bajo_minimo', true).eq('activo', true)) : 0,
      verCompras ? contar(n('mant_compras').eq('estado', 'pendiente')) : 0
    ])
    const pedidos = await supabase.from('mant_v_pedidos').select('*').eq('solicitante_id', usuario!.id)
      .order('creado_en', { ascending: false }).limit(5)
    const tareas = esOperario
      ? await supabase.from('mant_v_ordenes').select('*').eq('asignado_id', usuario!.id).in('estado', ['pendiente', 'en_proceso'])
          .order('fecha_programada').limit(5)
      : { data: [] }
    return {
      data: { porPriorizar, vencidas, semana, semanaOk, misTareas, stockBajo, comprasPend,
              pedidos: (pedidos.data ?? []) as Pedido[], tareas: (tareas.data ?? []) as Orden[] },
      error: pedidos.error
    }
  }, [usuario?.id])

  return (
    <Pagina titulo={`Hola, ${usuario?.nombre?.split(' ')[0] ?? ''}`} subtitulo={new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
      acciones={<Boton onClick={() => nav('/pedido/nuevo')}>+ Pedir reparación</Boton>}>
      {cargando || !data ? <Cargando /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {esOperario && <Kpi titulo="Mis tareas abiertas" valor={data.misTareas} onClick={() => nav('/tareas')} />}
            {esMant && <Kpi titulo="Pedidos por priorizar" valor={data.porPriorizar} alerta={data.porPriorizar > 0} onClick={() => nav('/pedidos')} />}
            {esMant && <Kpi titulo="Órdenes vencidas" valor={data.vencidas} alerta={data.vencidas > 0} onClick={() => nav('/ordenes?vencidas=1')} />}
            {esMant && <Kpi titulo="Avance de la semana" valor={data.semana ? `${Math.round((data.semanaOk / data.semana) * 100)}%` : '—'} detalle={`${data.semanaOk} de ${data.semana} órdenes`} onClick={() => nav('/agenda')} />}
            {verStock && <Kpi titulo="Repuestos bajo mínimo" valor={data.stockBajo} alerta={data.stockBajo > 0} onClick={() => nav('/panol?bajo=1')} />}
            {verCompras && <Kpi titulo="Compras a aprobar" valor={data.comprasPend} alerta={data.comprasPend > 0} onClick={() => nav('/compras')} />}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {esOperario && (
              <Tarjeta titulo="Mis próximas tareas" acciones={<Boton variante="secundario" onClick={() => nav('/tareas')}>Ver todas</Boton>}>
                {data.tareas.length === 0 ? <p className="text-sm text-suave">No tenés tareas abiertas.</p> : (
                  <ul className="divide-y divide-borde">
                    {data.tareas.map((o) => (
                      <li key={o.id}>
                        <button className="flex w-full items-center justify-between gap-3 py-2 text-left" onClick={() => nav(`/ordenes/${o.id}`)}>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">{o.titulo}</span>
                            <span className="text-xs text-suave">{numOT(o.numero)} · {o.equipo_codigo ?? o.tarea_unidad ?? 'Sin equipo'} · {fmtFecha(o.fecha_programada)}</span>
                          </span>
                          <span className="flex gap-1"><InsPrioridad p={o.prioridad} /><InsEstadoOT e={o.estado} /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Tarjeta>
            )}
            <Tarjeta titulo="Mis pedidos de reparación" acciones={<Boton variante="secundario" onClick={() => nav('/pedidos?mios=1')}>Ver todos</Boton>}>
              {data.pedidos.length === 0 ? <Vacio texto="Todavía no hiciste pedidos." /> : (
                <ul className="divide-y divide-borde">
                  {data.pedidos.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{p.descripcion}</span>
                        <span className="text-xs text-suave">{numPedido(p.numero)} · {p.equipo_codigo ?? p.ubicacion ?? '—'}{p.fecha_comprometida ? ` · para el ${fmtFecha(p.fecha_comprometida)}` : ''}</span>
                      </span>
                      <InsEstadoPedido e={p.estado} />
                    </li>
                  ))}
                </ul>
              )}
            </Tarjeta>
          </div>
        </div>
      )}
    </Pagina>
  )
}
