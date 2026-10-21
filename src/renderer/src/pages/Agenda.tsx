import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useOperarios } from '@/lib/catalogos'
import { deISO, fmtNum, hoy, lunesDe, numOT, numPedido, sumarDias, useDatos } from '@/lib/util'
import type { AgendaCelda, Orden, Prioridad } from '@/lib/tipos'
import { grupoPrioridad } from '@/lib/tickets'
import { Boton, Cargando, ErrorBox, Pagina } from '@/components/ui'

const BORDE: Record<'alta' | 'media' | 'baja', string> = { alta: 'border-l-[#c1440e]', media: 'border-l-pendiente', baja: 'border-l-[#2e8b7d]' }
const DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const etiqueta = (iso: string) => { const d = deISO(iso); return `${DIA[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` }

/**
 * Agenda semanal: qué está haciendo cada persona cada día (esta semana y la que viene).
 * Junta los tickets cargados desde el panel (en fracciones de jornada) con las órdenes
 * preventivas programadas. La ven todos; mantenimiento la arma desde cada ticket.
 */
export function Agenda() {
  const nav = useNavigate()
  const { puede } = useSesion()
  const editor = puede('referente', 'supervisor')
  const [base, setBase] = useState(lunesDe(new Date()))
  const { data: operarios } = useOperarios()
  const semanas = useMemo(() => [base, sumarDias(base, 7)].map((ini, i) => ({
    titulo: `${i === 0 ? 'Semana' : 'Semana siguiente'} (${etiqueta(ini)} al ${etiqueta(sumarDias(ini, 6))})`,
    dias: Array.from({ length: 7 }, (_, k) => sumarDias(ini, k))
  })), [base])
  const desde = base, hasta = sumarDias(base, 13)

  const { data, cargando, error } = useDatos(async () => {
    const [a, o] = await Promise.all([
      supabase.from('mant_v_agenda').select('*').gte('dia', desde).lte('dia', hasta).neq('estado', 'rechazado'),
      supabase.from('mant_v_ordenes').select('*').gte('fecha_programada', desde).lte('fecha_programada', hasta).neq('estado', 'cancelada').is('pedido_id', null)
    ])
    return { data: { agenda: (a.data ?? []) as AgendaCelda[], ordenes: (o.data ?? []) as Orden[] }, error: a.error || o.error }
  }, [base])

  const celda = (uid: string, dia: string) => {
    const tickets = (data?.agenda ?? []).filter((x) => x.usuario_id === uid && x.dia === dia)
    const ots = (data?.ordenes ?? []).filter((o) => o.asignado_id === uid && o.fecha_programada === dia)
    const carga = tickets.reduce((s, x) => s + Number(x.fraccion), 0) + ots.reduce((s, o) => s + Number(o.duracion_estimada_horas ?? 0) / 8, 0)
    const prios = [...tickets.map((t) => t.prioridad), ...ots.map((o) => o.prioridad)].filter(Boolean) as Prioridad[]
    const prio: 'alta' | 'media' | 'baja' | null = prios.some((p) => grupoPrioridad(p) === 'alta') ? 'alta' : prios.some((p) => grupoPrioridad(p) === 'media') ? 'media' : prios.length ? 'baja' : null
    return { tickets, ots, carga: Math.round(carga * 100) / 100, prio }
  }

  return (
    <Pagina titulo="Agenda semanal de mantenimiento" subtitulo="Programación de tareas por integrante y por día. Los tickets se cargan desde el panel (Asignar personal → Cargar en agenda)."
      acciones={<>
        <Boton variante="secundario" onClick={() => setBase(sumarDias(base, -7))}>‹ Anterior</Boton>
        <Boton variante="secundario" onClick={() => setBase(lunesDe(new Date()))}>Esta semana</Boton>
        <Boton variante="secundario" onClick={() => setBase(sumarDias(base, 7))}>Siguiente ›</Boton>
      </>}>
      <ErrorBox texto={error} />
      {cargando && !data ? <Cargando /> : semanas.map((s) => (
        <section key={s.titulo} className="mb-7">
          <h2 className="mb-2.5 text-sm font-extrabold uppercase tracking-wide text-[#9a7100]">{s.titulo}</h2>
          <div className="overflow-x-auto rounded-xl border border-borde bg-white">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-borde bg-fondo-2 p-2 text-left text-xs uppercase tracking-wide text-suave">Responsable</th>
                  {s.dias.map((d) => (
                    <th key={d} className={`border-b border-l border-borde p-2 text-left text-xs uppercase tracking-wide ${d === hoy() ? 'bg-primario/10 text-primario' : 'bg-fondo-2 text-suave'}`}>{etiqueta(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(operarios ?? []).map((u) => (
                  <tr key={u.id} className="align-top">
                    <td className="whitespace-nowrap border-b border-borde bg-fondo-2 p-2 font-extrabold">{u.nombre}<div className="text-xs font-normal text-suave">{u.turno ?? ''}</div></td>
                    {s.dias.map((d) => {
                      const c = celda(u.id, d)
                      const sobre = c.carga > 1.0001
                      return (
                        <td key={d} className={`min-w-[130px] border-b border-l border-borde p-1.5 ${c.prio ? `border-l-8 ${BORDE[c.prio]}` : ''} ${sobre ? 'shadow-[inset_0_0_0_2px_#c1440e]' : ''}`}>
                          {c.tickets.map((t) => (
                            <button key={t.pedido_id} onClick={() => nav(editor ? `/pedidos?busca=${numPedido(t.numero)}` : '/pedidos?mios=1')}
                              className={`mb-1 flex w-full items-start justify-between gap-1 rounded border-l-4 bg-fondo-2 px-1.5 py-1 text-left text-[11px] ${BORDE[grupoPrioridad(t.prioridad)]}`}>
                              <span className="min-w-0"><span className="block truncate font-bold">{t.titulo}</span><span className="text-[9px] italic text-suave">según {numPedido(t.numero)}</span></span>
                              <b className="whitespace-nowrap">{fmtNum(Number(t.fraccion), 2)} d</b>
                            </button>
                          ))}
                          {c.ots.map((o) => (
                            <button key={o.id} onClick={() => nav(`/ordenes/${o.id}`)}
                              className={`mb-1 flex w-full items-start justify-between gap-1 rounded border-l-4 bg-[#2e8b7d]/10 px-1.5 py-1 text-left text-[11px] ${BORDE[grupoPrioridad(o.prioridad)]} ${o.estado === 'completada' ? 'opacity-50 line-through' : ''}`}>
                              <span className="min-w-0"><span className="block truncate font-bold">{o.equipo_codigo ?? o.tarea_unidad ?? numOT(o.numero)}</span><span className="block truncate">{o.titulo}</span></span>
                              {o.duracion_estimada_horas ? <b className="whitespace-nowrap">{fmtNum(Number(o.duracion_estimada_horas) / 8, 2)} d</b> : null}
                            </button>
                          ))}
                          {c.carga > 0
                            ? <div className={`mt-0.5 text-[10px] font-bold ${sobre ? 'text-[#c1440e]' : 'text-[#3a6b4a]'}`}>Carga: {fmtNum(c.carga, 2)} día{c.carga !== 1 ? 's' : ''}{sobre ? ' ⚠️ supera la jornada' : ''}</div>
                            : <div className="text-[11px] text-suave">—</div>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <div className="flex flex-wrap gap-4 text-xs text-suave">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#c1440e]" />Prioridad alta</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-pendiente" />Prioridad media</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2e8b7d]" />Prioridad baja</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2e8b7d]/30" />Orden preventiva programada</span>
      </div>
    </Pagina>
  )
}
