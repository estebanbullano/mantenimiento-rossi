import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { fmtFecha, fmtNum, hoy, lunesDe, numOT, sumarDias, useDatos } from '@/lib/util'
import type { Orden } from '@/lib/tipos'
import { Cargando, ErrorBox, Insignia, InsEstadoOT, InsPrioridad, Pagina, Vacio } from '@/components/ui'

const PESO = { urgente: 0, alta: 1, media: 2, baja: 3 }

/** Vista del operario: solo sus tareas del turno, para cerrar en pocos toques desde el celular */
export function MisTareas() {
  const { usuario } = useSesion()
  const nav = useNavigate()
  const { data, cargando, error } = useDatos(async () => {
    const r = await supabase.from('mant_v_ordenes').select('*').eq('asignado_id', usuario!.id)
      .in('estado', ['pendiente', 'en_proceso']).order('fecha_programada')
    return { data: (r.data ?? []) as Orden[], error: r.error }
  }, [usuario?.id])

  const fin = sumarDias(lunesDe(new Date()), 6)
  const orden = (a: Orden, b: Orden) =>
    (a.estado === 'en_proceso' ? -1 : 0) - (b.estado === 'en_proceso' ? -1 : 0) ||
    PESO[a.prioridad] - PESO[b.prioridad] || (a.fecha_programada ?? '').localeCompare(b.fecha_programada ?? '')
  const grupos: [string, Orden[]][] = [
    ['Para hoy o atrasadas', (data ?? []).filter((o) => !o.fecha_programada || o.fecha_programada <= hoy() || o.prioridad === 'urgente').sort(orden)],
    ['Resto de la semana', (data ?? []).filter((o) => o.fecha_programada && o.fecha_programada > hoy() && o.fecha_programada <= fin && o.prioridad !== 'urgente').sort(orden)],
    ['Más adelante', (data ?? []).filter((o) => o.fecha_programada && o.fecha_programada > fin && o.prioridad !== 'urgente').sort(orden)]
  ]

  return (
    <Pagina titulo="Mis tareas" subtitulo={usuario?.turno ? `Turno ${usuario.turno}` : undefined}>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data?.length ? <Vacio texto="No tenés tareas abiertas. ¡Bien!" /> : (
        <div className="space-y-6">
          {grupos.filter(([, l]) => l.length).map(([titulo, lista]) => (
            <section key={titulo}>
              <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-suave">{titulo} · {lista.length}</h2>
              <div className="grid gap-2 md:grid-cols-2">
                {lista.map((o) => (
                  <button key={o.id} onClick={() => nav(`/ordenes/${o.id}`)}
                    className={`rounded-xl border-l-4 bg-white p-4 text-left shadow-sm active:scale-[0.99] ${o.estado === 'en_proceso' ? 'border-revision' : o.prioridad === 'urgente' ? 'border-primario' : 'border-borde'}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <InsEstadoOT e={o.estado} />
                      <InsPrioridad p={o.prioridad} />
                      <Insignia t={o.tipo === 'preventiva' ? 'azul' : 'gris'}>{o.tipo === 'preventiva' ? 'Preventivo' : 'Correctivo'}</Insignia>
                      {o.vencida && <Insignia t="rojo">Vencida</Insignia>}
                    </div>
                    <div className="mt-2 text-base font-extrabold leading-tight">{o.titulo}</div>
                    <div className="mt-1 text-sm text-suave">{o.equipo_codigo ? `${o.equipo_codigo} · ${o.equipo_nombre ?? ''}` : o.tarea_unidad ?? 'Sin equipo'}</div>
                    <div className="mt-1 text-xs text-suave">{numOT(o.numero)} · {fmtFecha(o.fecha_programada)}{o.duracion_estimada_horas ? ` · ${fmtNum(o.duracion_estimada_horas, 1)} h estimadas` : ''}</div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Pagina>
  )
}
