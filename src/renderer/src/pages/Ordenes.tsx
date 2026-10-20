import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { TURNOS, useEquipos, useOperarios } from '@/lib/catalogos'
import { fmtFecha, fmtMin, hoy, lunesDe, numOT, sumarDias, useDatos } from '@/lib/util'
import { PRIORIDADES, type EstadoOT, type Orden, type Prioridad } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, Insignia, InsEstadoOT, InsPrioridad, Modal, Pagina, Tarjeta, Vacio, useAviso } from '@/components/ui'
import { SelectorEquipo } from '@/components/selectores'

export function Ordenes() {
  const nav = useNavigate()
  const avisar = useAviso()
  const { puede } = useSesion()
  const [params] = useSearchParams()
  const esMant = puede('referente', 'supervisor')
  const [semana, setSemana] = useState(params.get('vencidas') ? '' : lunesDe(new Date()))
  const [estado, setEstado] = useState<'' | 'abiertas' | EstadoOT>(params.get('vencidas') ? 'abiertas' : '')
  const [tipo, setTipo] = useState('')
  const [asignado, setAsignado] = useState('')
  const [soloVencidas, setSoloVencidas] = useState(!!params.get('vencidas'))
  const [nueva, setNueva] = useState(false)
  const { data: operarios } = useOperarios()

  const { data, cargando, error, recargar } = useDatos(async () => {
    let q = supabase.from('mant_v_ordenes').select('*').order('fecha_programada', { ascending: true }).limit(1000)
    if (semana) q = q.eq('semana', semana)
    if (estado === 'abiertas') q = q.in('estado', ['pendiente', 'en_proceso'])
    else if (estado) q = q.eq('estado', estado)
    if (tipo) q = q.eq('tipo', tipo)
    if (asignado === 'sin') q = q.is('asignado_id', null)
    else if (asignado) q = q.eq('asignado_id', asignado)
    if (soloVencidas) q = q.eq('vencida', true)
    const r = await q
    return { data: (r.data ?? []) as Orden[], error: r.error }
  }, [semana, estado, tipo, asignado, soloVencidas])

  // Control de avance por turno: lo pendiente y lo cumplido, sin perseguir por WhatsApp
  const avance = useMemo(() => {
    const m = new Map<string, { total: number; ok: number; proceso: number }>()
    for (const o of data ?? []) {
      if (o.estado === 'cancelada') continue
      const k = o.turno || 'Sin turno'
      const v = m.get(k) ?? { total: 0, ok: 0, proceso: 0 }
      v.total++; if (o.estado === 'completada') v.ok++; if (o.estado === 'en_proceso') v.proceso++
      m.set(k, v)
    }
    return [...m.entries()].sort()
  }, [data])

  async function asignar(o: Orden, uid: string) {
    const { error } = await supabase.from('mant_ordenes').update({ asignado_id: uid || null }).eq('id', o.id)
    if (error) avisar(mensajeError(error), 'error'); else void recargar()
  }

  return (
    <Pagina titulo="Órdenes de trabajo" acciones={esMant && <Boton onClick={() => setNueva(true)}>+ Nueva OT</Boton>}>
      <div className="no-imprimir mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
        <Campo etiqueta="Semana">
          <div className="flex gap-1">
            <button className="rounded border border-borde bg-white px-2" onClick={() => setSemana(sumarDias(semana || lunesDe(new Date()), -7))}>‹</button>
            <input type="date" className="campo" value={semana} onChange={(e) => setSemana(e.target.value ? lunesDe(e.target.value) : '')} />
            <button className="rounded border border-borde bg-white px-2" onClick={() => setSemana(sumarDias(semana || lunesDe(new Date()), 7))}>›</button>
          </div>
        </Campo>
        <Campo etiqueta="Estado">
          <select className="campo" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
            <option value="">Todos</option><option value="abiertas">Abiertas</option>
            <option value="pendiente">Pendientes</option><option value="en_proceso">En proceso</option>
            <option value="completada">Completadas</option><option value="cancelada">Canceladas</option>
          </select>
        </Campo>
        <Campo etiqueta="Tipo">
          <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option><option value="preventiva">Preventivo</option><option value="correctiva">Correctivo</option>
          </select>
        </Campo>
        <Campo etiqueta="Asignado">
          <select className="campo" value={asignado} onChange={(e) => setAsignado(e.target.value)}>
            <option value="">Todos</option><option value="sin">Sin asignar</option>
            {(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </Campo>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={soloVencidas} onChange={(e) => setSoloVencidas(e.target.checked)} /> Solo vencidas</label>
        <div className="flex items-end pb-1"><Boton variante="fantasma" onClick={() => setSemana('')}>Todas las semanas</Boton></div>
      </div>

      {avance.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          {avance.map(([turno, v]) => (
            <div key={turno} className="rounded-xl border border-borde bg-white p-3">
              <div className="text-xs font-bold uppercase text-suave">{turno}</div>
              <div className="mt-1 text-xl font-extrabold">{v.ok}/{v.total}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fondo-2"><div className="h-full bg-aprobado" style={{ width: `${(v.ok / v.total) * 100}%` }} /></div>
              <div className="mt-1 text-xs text-suave">{v.proceso} en proceso · {v.total - v.ok - v.proceso} pendientes</div>
            </div>
          ))}
        </div>
      )}

      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data?.length ? <Vacio texto="No hay órdenes con estos filtros." /> : (
        <Tarjeta className="overflow-x-auto" titulo={`${data.length} órdenes`}>
          <table className="tabla -m-4 w-[calc(100%+2rem)]">
            <thead><tr><th>OT</th><th>Tarea</th><th>Equipo</th><th>Prioridad</th><th>Asignado</th><th>Turno</th><th>Programada</th><th>Comprometida</th><th>Estado</th><th>Tiempo</th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} className="cursor-pointer" onClick={() => nav(`/ordenes/${o.id}`)}>
                  <td className="whitespace-nowrap font-bold">{numOT(o.numero)}<div><Insignia t={o.tipo === 'preventiva' ? 'azul' : 'gris'}>{o.tipo === 'preventiva' ? 'Prev.' : 'Corr.'}</Insignia></div></td>
                  <td className="max-w-72">{o.titulo}</td>
                  <td className="whitespace-nowrap">{o.equipo_codigo ?? o.tarea_unidad ?? '—'}</td>
                  <td><InsPrioridad p={o.prioridad} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {esMant && (o.estado === 'pendiente' || o.estado === 'en_proceso') ? (
                      <select className="campo py-1" value={o.asignado_id ?? ''} onChange={(e) => void asignar(o, e.target.value)}>
                        <option value="">Sin asignar</option>
                        {(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                      </select>
                    ) : o.asignado_nombre ?? '—'}
                  </td>
                  <td>{o.turno ?? '—'}</td>
                  <td className="whitespace-nowrap">{fmtFecha(o.fecha_programada)}</td>
                  <td className={`whitespace-nowrap ${o.vencida ? 'font-bold text-rechazado' : ''}`}>{fmtFecha(o.fecha_comprometida)}</td>
                  <td><InsEstadoOT e={o.estado} /></td>
                  <td className="whitespace-nowrap text-suave">{fmtMin(o.tiempo_real_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
      {nueva && <NuevaOT onCerrar={() => setNueva(false)} onListo={(id) => nav(`/ordenes/${id}`)} />}
    </Pagina>
  )
}

/** OT directa del referente (sin pedido previo), por ejemplo algo que detectó en recorrida */
function NuevaOT({ onCerrar, onListo }: { onCerrar: () => void; onListo: (id: string) => void }) {
  const { data: equipos } = useEquipos()
  const { data: operarios } = useOperarios()
  const [f, setF] = useState({ titulo: '', descripcion: '', equipo_id: null as string | null, prioridad: 'media' as Prioridad, asignado_id: '', turno: '', fecha_programada: hoy(), fecha_comprometida: sumarDias(hoy(), 3), duracion: '' })
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  async function guardar() {
    if (!f.titulo.trim()) { setError('Poné un título.'); return }
    setGuardando(true)
    const { data, error } = await supabase.from('mant_ordenes').insert({
      tipo: 'correctiva', titulo: f.titulo.trim(), descripcion: f.descripcion.trim() || null, equipo_id: f.equipo_id,
      prioridad: f.prioridad, asignado_id: f.asignado_id || null, turno: f.turno || null,
      semana: lunesDe(f.fecha_programada), fecha_programada: f.fecha_programada, fecha_comprometida: f.fecha_comprometida || null,
      duracion_estimada_horas: f.duracion ? Number(f.duracion.replace(',', '.')) : null
    }).select('id').single()
    setGuardando(false)
    if (error) setError(mensajeError(error)); else onListo(data.id)
  }
  return (
    <Modal abierto titulo="Nueva orden de trabajo" onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Crear</Boton></>}>
      <ErrorBox texto={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Título" className="sm:col-span-2"><input className="campo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Campo>
        <Campo etiqueta="Equipo" className="sm:col-span-2"><SelectorEquipo equipos={equipos ?? []} valor={f.equipo_id} onCambio={(id) => setF({ ...f, equipo_id: id })} /></Campo>
        <Campo etiqueta="Descripción" className="sm:col-span-2"><textarea className="campo" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>
        <Campo etiqueta="Prioridad">
          <select className="campo" value={f.prioridad} onChange={(e) => setF({ ...f, prioridad: e.target.value as Prioridad })}>{PRIORIDADES.map((p) => <option key={p}>{p}</option>)}</select>
        </Campo>
        <Campo etiqueta="Duración estimada (h)"><input className="campo" inputMode="decimal" value={f.duracion} onChange={(e) => setF({ ...f, duracion: e.target.value })} /></Campo>
        <Campo etiqueta="Asignar a">
          <select className="campo" value={f.asignado_id} onChange={(e) => setF({ ...f, asignado_id: e.target.value })}>
            <option value="">Sin asignar</option>{(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Turno">
          <select className="campo" value={f.turno} onChange={(e) => setF({ ...f, turno: e.target.value })}><option value="">—</option>{TURNOS.map((t) => <option key={t}>{t}</option>)}</select>
        </Campo>
        <Campo etiqueta="Programada"><input type="date" className="campo" value={f.fecha_programada} onChange={(e) => setF({ ...f, fecha_programada: e.target.value })} /></Campo>
        <Campo etiqueta="Comprometida"><input type="date" className="campo" value={f.fecha_comprometida} onChange={(e) => setF({ ...f, fecha_comprometida: e.target.value })} /></Campo>
      </div>
    </Modal>
  )
}
