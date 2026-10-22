import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { fmtNum, hoy, numOT, useDatos } from '@/lib/util'
import type { Orden } from '@/lib/tipos'
import { Cargando, CRIT, ErrorBox, Insignia, InsEstadoOT, Vacio } from '@/components/ui'
import { PantallaCelular } from '@/components/Celular'
import { MarcoTelefono } from './Solicitante'

const PESO = { urgente: 0, alta: 1, media: 2, baja: 3 }
export const durTxt = (h?: number | null) => h ? `${fmtNum(h / 8, h % 8 ? 2 : 0).replace(/,?0+$/, '')} día${h / 8 === 1 ? '' : 's'}` : 'sin estimar'

export function CritTipo({ o }: { o: Orden }) {
  const c = o.equipo_clasificacion
  const tipo = o.tipo === 'preventiva' ? 'Preventiva' : 'Correctiva'
  return c ? <Insignia t={CRIT[c][0]}>{CRIT[c][1]} · {tipo}</Insignia> : <Insignia t={o.tipo === 'preventiva' ? 'azul' : 'amarillo'}>{tipo}</Insignia>
}

/** Celular del operario: solo sus tareas abiertas, primero las de hoy */
export function MisTareas() {
  const { usuario } = useSesion()
  const nav = useNavigate()
  const { data, cargando, error } = useDatos(async () => {
    const r = await supabase.from('mant_v_ordenes').select('*').eq('asignado_id', usuario!.id)
      .in('estado', ['pendiente', 'en_proceso']).order('fecha_programada')
    return { data: (r.data ?? []) as Orden[], error: r.error }
  }, [usuario?.id])

  const orden = (a: Orden, b: Orden) => PESO[a.prioridad] - PESO[b.prioridad] || (a.fecha_programada ?? '').localeCompare(b.fecha_programada ?? '')
  const deHoy = (data ?? []).filter((o) => !o.fecha_programada || o.fecha_programada <= hoy()).sort(orden)
  const proximas = (data ?? []).filter((o) => o.fecha_programada && o.fecha_programada > hoy()).sort(orden)
  const fecha = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  const tarjeta = (o: Orden) => (
    <button key={o.id} onClick={() => nav(`/ordenes/${o.id}`)} className="flex flex-col gap-2 rounded-[18px] border border-borde bg-white p-3.5 text-left text-texto active:scale-[0.99]">
      <span className="flex w-full justify-between gap-2"><CritTipo o={o} /><InsEstadoOT e={o.estado} vencida={!!o.fecha_programada && o.fecha_programada < hoy()} /></span>
      <span className="text-base font-semibold leading-snug">{o.titulo}</span>
      <span className="text-[13px] text-suave">{o.equipo_codigo ?? o.tarea_unidad ?? 'Sin equipo'} · {numOT(o.numero)} · {durTxt(o.duracion_estimada_horas)}</span>
    </button>
  )

  return (
    <MarcoTelefono>
      <PantallaCelular titulo="Mis tareas de hoy"
        derecha={usuario?.turno ? <span className="rounded-full bg-fondo px-2.5 py-1 text-xs font-medium">Turno {usuario.turno.toLowerCase()}</span> : undefined}
        sub={`${usuario?.nombre?.split(' ')[0] ?? ''} · ${fecha}`}>
        <ErrorBox texto={error} />
        {cargando && !data ? <Cargando /> : (
          <div className="flex flex-col gap-3">
            {deHoy.length === 0 && <Vacio texto="No tenés tareas para hoy." />}
            {deHoy.map(tarjeta)}
            {proximas.length > 0 && <div className="pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-tenue">Próximos días</div>}
            {proximas.map(tarjeta)}
            <div className="pt-1 text-center text-xs text-tenue">Solo ves las tareas de tu turno.</div>
          </div>
        )}
      </PantallaCelular>
    </MarcoTelefono>
  )
}

export { TareaCelular } from './Tarea'
