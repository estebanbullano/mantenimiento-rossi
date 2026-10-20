import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useOperarios } from '@/lib/catalogos'
import { deISO, fmtNum, hoy, lunesDe, numOT, sumarDias, useDatos } from '@/lib/util'
import type { Orden } from '@/lib/tipos'
import { Boton, Cargando, ErrorBox, Pagina, useAviso } from '@/components/ui'

const COLOR = { urgente: 'border-primario bg-primario/10', alta: 'border-rechazado/50 bg-rechazado/5', media: 'border-pendiente bg-pendiente/10', baja: 'border-borde bg-fondo-2' }

/** Carga de trabajo por persona y día. Las OT se arrastran para reasignar o reprogramar. */
export function Agenda() {
  const nav = useNavigate()
  const avisar = useAviso()
  const [lunes, setLunes] = useState(lunesDe(new Date()))
  const [capacidad, setCapacidad] = useState(40)
  const { data: operarios } = useOperarios()
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))

  const { data, cargando, error, recargar, setData } = useDatos(async () => {
    const r = await supabase.from('mant_v_ordenes').select('*').eq('semana', lunes).neq('estado', 'cancelada')
    return { data: (r.data ?? []) as Orden[], error: r.error }
  }, [lunes])

  const filas = useMemo(() => [{ id: '', nombre: 'Sin asignar', turno: null as string | null }, ...(operarios ?? [])], [operarios])
  const horas = (uid: string) => (data ?? []).filter((o) => (o.asignado_id ?? '') === uid).reduce((s, o) => s + Number(o.duracion_estimada_horas ?? 0), 0)

  async function mover(otId: string, uid: string, dia: string) {
    const o = data?.find((x) => x.id === otId)
    if (!o || o.estado === 'completada') return
    setData((d) => d?.map((x) => (x.id === otId ? { ...x, asignado_id: uid || null, fecha_programada: dia } : x)) ?? null)
    const { error } = await supabase.from('mant_ordenes').update({ asignado_id: uid || null, fecha_programada: dia }).eq('id', otId)
    if (error) avisar(mensajeError(error), 'error')
    void recargar()
  }

  return (
    <Pagina titulo="Agenda semanal" subtitulo="Arrastrá una orden para cambiar quién la hace o qué día."
      acciones={<>
        <Boton variante="secundario" onClick={() => setLunes(sumarDias(lunes, -7))}>‹ Anterior</Boton>
        <Boton variante="secundario" onClick={() => setLunes(lunesDe(new Date()))}>Esta semana</Boton>
        <Boton variante="secundario" onClick={() => setLunes(sumarDias(lunes, 7))}>Siguiente ›</Boton>
      </>}>
      <ErrorBox texto={error} />
      <div className="mb-3 flex items-center gap-2 text-sm text-suave">
        Capacidad semanal por persona: <input className="campo w-20 py-1" type="number" value={capacidad} onChange={(e) => setCapacidad(Number(e.target.value) || 40)} /> h
      </div>
      {cargando ? <Cargando /> : (
        <div className="overflow-x-auto rounded-xl border border-borde bg-white">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-48 border-b border-borde bg-fondo-2 p-2 text-left text-xs uppercase text-suave">Persona</th>
                {dias.map((d) => (
                  <th key={d} className={`border-b border-l border-borde p-2 text-left text-xs uppercase ${d === hoy() ? 'bg-primario/10 text-primario' : 'bg-fondo-2 text-suave'}`}>
                    {deISO(d).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })}
                  </th>
                ))}
                <th className="w-32 border-b border-l border-borde bg-fondo-2 p-2 text-left text-xs uppercase text-suave">Carga</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((u) => {
                const h = horas(u.id)
                const pct = Math.min(100, (h / capacidad) * 100)
                return (
                  <tr key={u.id || 'sin'} className="align-top">
                    <td className="border-b border-borde p-2"><div className="font-bold">{u.nombre}</div><div className="text-xs text-suave">{u.turno ?? ''}</div></td>
                    {dias.map((d) => (
                      <td key={d} className="h-20 border-b border-l border-borde p-1"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); void mover(e.dataTransfer.getData('ot'), u.id, d) }}>
                        <div className="flex flex-col gap-1">
                          {(data ?? []).filter((o) => (o.asignado_id ?? '') === u.id && (o.fecha_programada ?? lunes) === d).map((o) => (
                            <div key={o.id} draggable={o.estado !== 'completada'} onDragStart={(e) => e.dataTransfer.setData('ot', o.id)}
                              onClick={() => nav(`/ordenes/${o.id}`)}
                              className={`cursor-pointer rounded border-l-4 px-1.5 py-1 text-xs ${COLOR[o.prioridad]} ${o.estado === 'completada' ? 'opacity-50 line-through' : ''}`}>
                              <div className="truncate font-bold">{o.equipo_codigo ?? o.tarea_unidad ?? numOT(o.numero)}</div>
                              <div className="truncate">{o.titulo}</div>
                              {o.duracion_estimada_horas ? <div className="text-suave">{fmtNum(o.duracion_estimada_horas, 1)} h</div> : null}
                            </div>
                          ))}
                        </div>
                      </td>
                    ))}
                    <td className="border-b border-l border-borde p-2">
                      <div className={`font-bold ${h > capacidad ? 'text-primario' : ''}`}>{fmtNum(h, 1)} h</div>
                      {u.id && <div className="mt-1 h-2 overflow-hidden rounded-full bg-fondo-2"><div className={`h-full ${h > capacidad ? 'bg-primario' : 'bg-aprobado'}`} style={{ width: `${pct}%` }} /></div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Pagina>
  )
}
