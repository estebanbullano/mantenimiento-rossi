import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useOperarios, usePlantas } from '@/lib/catalogos'
import { deISO, fmtFecha, fmtFrecuencia, fmtNum, hoy, lunesDe, numOT, sumarDias, useDatos } from '@/lib/util'
import { PRIORIDADES, type Clasificacion, type Prioridad, type Unidad } from '@/lib/tipos'
import { Boton, Cargando, Chip, ErrorBox, InsCriticidad, Insignia, InsPrioridad, Modal, Vacio, useAviso } from '@/components/ui'

interface Fila {
  tarea_id: string; descripcion: string; unidad: string | null; frecuencia_valor: number; frecuencia_unidad: Unidad
  duracion_estimada_horas: number | null; turno: string | null; requiere_parada: boolean; ultima_ejecucion: string | null; proxima_fecha: string
  dias_atraso: number; equipo_id: string | null; equipo_codigo: string | null; equipo_nombre: string | null; planta_id: string | null; planta_codigo: string | null
  clasificacion: Clasificacion | null; criticidad: number | null; prioridad_sugerida: Prioridad
  orden_id: string | null; orden_numero: number | null; orden_estado: 'pendiente' | 'en_proceso' | null; orden_prioridad: Prioridad | null
  asignado_id: string | null; asignado_nombre: string | null; fecha_programada: string | null
}
interface Amontonada { proxima_fecha: string; tareas: number; equipos: number }
type Horizonte = 'atrasadas' | 'semana' | 'proxima' | 'mes' | 'todo'
type EstadoF = 'sin_asignar' | 'asignadas' | 'todas'
const RANGO_P: Record<Prioridad, number> = { urgente: 0, alta: 1, media: 2, baja: 3 }
const TURNOS = ['Mañana', 'Tarde', 'Noche']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const dTxt = (h: number) => h >= 8 ? `${fmtNum(Math.round((h / 8) * 10) / 10, 1)} d` : `${fmtNum(Math.round(h * 10) / 10, 1)} h`
const etiq = (f: Fila) => f.equipo_codigo ?? f.unidad ?? 'Ronda'

/** Qué preventivos vencen, con qué prioridad, y generar la OT ya asignada */
export function Programar({ onCambio }: { onCambio: () => void }) {
  const nav = useNavigate()
  const avisar = useAviso()
  const lunesHoy = lunesDe(new Date())
  const [horizonte, setHorizonte] = useState<Horizonte>('semana')
  const [estadoF, setEstadoF] = useState<EstadoF>('sin_asignar')
  const [crit, setCrit] = useState<Clasificacion | ''>('')
  const [planta, setPlanta] = useState('')
  const [texto, setTexto] = useState('')
  const [orden, setOrden] = useState<'prioridad' | 'equipo'>('prioridad')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [repartir, setRepartir] = useState<Amontonada | null>(null)
  // a quién, qué día
  const [asignado, setAsignado] = useState('')
  const [dia, setDia] = useState(() => { const d = deISO(hoy()).getDay(); return d === 6 ? sumarDias(hoy(), 2) : d === 0 ? sumarDias(hoy(), 1) : hoy() })
  const [turno, setTurno] = useState('')
  const [prio, setPrio] = useState<Prioridad | ''>('')
  const [obs, setObs] = useState('')
  const [guardando, setGuardando] = useState(false)

  const { data: pl } = usePlantas()
  const { data: operarios } = useOperarios()
  const { data, cargando, error, recargar } = useDatos(async () => {
    const [v, a] = await Promise.all([
      supabase.from('mant_v_preventivo_programar').select('*').order('proxima_fecha').limit(3000),
      supabase.from('mant_v_fechas_amontonadas').select('*').order('tareas', { ascending: false })
    ])
    return { data: { filas: (v.data ?? []) as Fila[], amontonadas: (a.data ?? []) as Amontonada[] }, error: v.error || a.error }
  })
  // carga de cada operario en la semana del día elegido
  const lunesDia = lunesDe(dia)
  const { data: cargas, recargar: recargarCargas } = useDatos(async () => {
    const r = await supabase.from('mant_ordenes').select('asignado_id,duracion_estimada_horas,fecha_programada')
      .gte('fecha_programada', lunesDia).lte('fecha_programada', sumarDias(lunesDia, 6)).in('estado', ['pendiente', 'en_proceso']).not('asignado_id', 'is', null)
    const sem = new Map<string, number>(), deDia = new Map<string, number>()
    for (const o of (r.data ?? []) as { asignado_id: string; duracion_estimada_horas: number | null; fecha_programada: string }[]) {
      const h = o.duracion_estimada_horas ?? 1
      sem.set(o.asignado_id, (sem.get(o.asignado_id) ?? 0) + h)
      if (o.fecha_programada === dia) deDia.set(o.asignado_id, (deDia.get(o.asignado_id) ?? 0) + h)
    }
    return { data: { sem, deDia }, error: r.error }
  }, [lunesDia, dia])

  const filas = data?.filas ?? []
  const enHorizonte = (f: Fila, h: Horizonte) => {
    const p = f.proxima_fecha
    if (h === 'atrasadas') return p < hoy()
    if (h === 'semana') return p <= sumarDias(lunesHoy, 6)
    if (h === 'proxima') return p <= sumarDias(lunesHoy, 13)
    if (h === 'mes') return p <= sumarDias(hoy(), 30)
    return true
  }
  const sinAsignar = (f: Fila) => !f.orden_id || (!f.asignado_id && f.orden_estado === 'pendiente')
  const cuenta = (h: Horizonte) => filas.filter((f) => enHorizonte(f, h) && sinAsignar(f)).length

  const lista = useMemo(() => {
    const q = texto.toLowerCase().trim()
    const r = filas.filter((f) => enHorizonte(f, horizonte)
      && (estadoF === 'todas' || (estadoF === 'sin_asignar' ? sinAsignar(f) : !sinAsignar(f)))
      && (!crit || f.clasificacion === crit) && (!planta || f.planta_id === planta)
      && (!q || `${etiq(f)} ${f.equipo_nombre ?? ''} ${f.descripcion}`.toLowerCase().includes(q)))
    return r.sort((a, b) => orden === 'equipo'
      ? etiq(a).localeCompare(etiq(b)) || a.proxima_fecha.localeCompare(b.proxima_fecha)
      : RANGO_P[a.prioridad_sugerida] - RANGO_P[b.prioridad_sugerida] || a.proxima_fecha.localeCompare(b.proxima_fecha) || (b.criticidad ?? 0) - (a.criticidad ?? 0) || etiq(a).localeCompare(etiq(b)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, horizonte, estadoF, crit, planta, texto, orden])

  const elegibles = (f: Fila) => f.orden_estado !== 'en_proceso'
  const visibles = lista.slice(0, 400)
  const elegidas = filas.filter((f) => sel.has(f.tarea_id))
  const horasSel = elegidas.reduce((s, f) => s + (f.duracion_estimada_horas ?? 1), 0)
  const todasMarcadas = visibles.filter(elegibles).length > 0 && visibles.filter(elegibles).every((f) => sel.has(f.tarea_id))
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const marcarTodas = () => setSel((s) => { const n = new Set(s); visibles.filter(elegibles).forEach((f) => todasMarcadas ? n.delete(f.tarea_id) : n.add(f.tarea_id)); return n })
  const marcarEquipo = (f: Fila) => setSel((s) => { const n = new Set(s); lista.filter((x) => x.equipo_id && x.equipo_id === f.equipo_id && elegibles(x)).forEach((x) => n.add(x.tarea_id)); return n })

  const op = operarios?.find((u) => u.id === asignado)
  const libreSem = (id: string) => Math.max(0, 40 - (cargas?.sem.get(id) ?? 0))
  const ocupadoDia = (id: string) => cargas?.deDia.get(id) ?? 0

  async function programar() {
    if (!elegidas.length) return
    if (!asignado && !confirm('No elegiste operario: las OT quedan "Sin asignar" en la agenda. ¿Seguir?')) return
    setGuardando(true)
    const { data: r, error } = await supabase.rpc('mant_generar_ots', {
      p_tareas: elegidas.map((f) => f.tarea_id), p_asignado: asignado || null, p_fecha: dia,
      p_turno: turno || null, p_prioridad: prio || null, p_observacion: obs.trim() || null
    })
    setGuardando(false)
    if (error) return avisar(mensajeError(error), 'error')
    const x = r as { nuevas: number; reasignadas: number }
    avisar(`${x.nuevas ? `${x.nuevas} OT nuevas` : ''}${x.nuevas && x.reasignadas ? ' y ' : ''}${x.reasignadas ? `${x.reasignadas} reasignadas` : ''}${!x.nuevas && !x.reasignadas ? 'No había nada para programar' : ''}${op ? ` · ${op.nombre}, ${DIAS[deISO(dia).getDay()]} ${fmtFecha(dia).slice(0, 5)}` : ''}.`)
    setSel(new Set()); setObs('')
    void recargar(); void recargarCargas(); onCambio()
  }

  const venceTxt = (f: Fila) => f.dias_atraso > 0 ? <span className="font-semibold text-primario-oscuro">atrasada {f.dias_atraso} d</span>
    : f.dias_atraso === 0 ? <span className="font-semibold text-pendiente">vence hoy</span> : <span className="text-suave">en {-f.dias_atraso} d</span>

  return (
    <div className="flex flex-col gap-4">
      {/* Cómo se usa */}
      <div className="flex flex-col gap-1.5 rounded-2xl border border-borde bg-white px-4 py-3.5 text-sm">
        <span><b>1.</b> Elegí qué ver: lo atrasado, lo de esta semana o lo que viene. La lista se ordena por prioridad: <b>criticidad de la máquina</b> y <b>días de atraso</b>.</span>
        <span><b>2.</b> Tildá las tareas (o "todas las de este equipo", para parar la máquina una sola vez).</span>
        <span><b>3.</b> Abajo elegí <b>operario, día y turno</b> y tocá <b>Generar y asignar</b>. La OT aparece en su celular y en la agenda.</span>
      </div>

      {(data?.amontonadas ?? []).map((a) => (
        <div key={a.proxima_fecha} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#f1d49a] bg-[#fff6e5] px-4 py-3 text-sm">
          <span className="flex-1"><b>El {fmtFecha(a.proxima_fecha)} vencen {a.tareas} rutinas de {a.equipos} equipos a la vez.</b> Es la fecha que quedó en la carga inicial de las planillas: hay que repartirlas en el año para que la carga semanal sea pareja.</span>
          <Boton chico variante="secundario" onClick={() => setRepartir(a)}>Repartir fechas…</Boton>
        </div>
      ))}

      {/* Filtros */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] text-suave">Vencen</span>
          {([['atrasadas', 'Atrasadas'], ['semana', 'Hasta esta semana'], ['proxima', 'Hasta la próxima semana'], ['mes', 'Próximos 30 días'], ['todo', 'Próximos 60 días']] as [Horizonte, string][]).map(([k, t]) => (
            <Chip key={k} activo={horizonte === k} onClick={() => setHorizonte(k)}>{t} <span className={horizonte === k ? 'opacity-80' : 'text-tenue'}>· {cuenta(k)}</span></Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="campo-chico w-auto" value={estadoF} onChange={(e) => setEstadoF(e.target.value as EstadoF)}>
            <option value="sin_asignar">Sin asignar (sin OT o sin operario)</option><option value="asignadas">Ya asignadas</option><option value="todas">Todas</option>
          </select>
          <select className="campo-chico w-auto" value={crit} onChange={(e) => setCrit(e.target.value as Clasificacion | '')}>
            <option value="">Toda criticidad</option><option value="C">C · Crítico</option><option value="MC">MC · Media</option><option value="NC">NC · No crítico</option>
          </select>
          <select className="campo-chico w-auto" value={planta} onChange={(e) => setPlanta(e.target.value)}>
            <option value="">Todas las plantas</option>{(pl?.plantas ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </select>
          <input className="campo-chico min-w-[200px] flex-1" placeholder="Buscar equipo o tarea…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <select className="campo-chico w-auto" value={orden} onChange={(e) => setOrden(e.target.value as 'prioridad' | 'equipo')}>
            <option value="prioridad">Ordenar por prioridad</option><option value="equipo">Ordenar por equipo</option>
          </select>
        </div>
      </div>

      <ErrorBox texto={error} />
      {cargando && !data ? <Cargando /> : !lista.length ? <Vacio texto={estadoF === 'sin_asignar' ? 'Nada sin asignar en este período. 👌' : 'No hay tareas con estos filtros.'} /> : (
        <section className="tarjeta overflow-x-auto">
          <table className="tabla min-w-[900px]">
            <thead>
              <tr>
                <th className="w-9"><input type="checkbox" className="h-4 w-4 accent-primario" checked={todasMarcadas} onChange={marcarTodas} aria-label="Marcar todas" /></th>
                <th>Prioridad</th><th>Equipo</th><th>Tarea</th><th>Vence</th><th>Duración</th><th>OT</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.tarea_id} className={sel.has(f.tarea_id) ? '!bg-rojo-suave' : ''}>
                  <td><input type="checkbox" className="h-4 w-4 accent-primario" disabled={!elegibles(f)} checked={sel.has(f.tarea_id)} onChange={() => alternar(f.tarea_id)} aria-label="Elegir" /></td>
                  <td className="whitespace-nowrap"><InsPrioridad p={f.prioridad_sugerida} /></td>
                  <td className="min-w-[170px]">
                    <div className="flex items-center gap-1.5"><b className="text-[13px]">{etiq(f)}</b>{f.clasificacion && <InsCriticidad c={f.clasificacion} corta />}</div>
                    {f.equipo_nombre && <div className="text-xs text-suave">{f.equipo_nombre}</div>}
                    {f.equipo_id && <button className="text-xs font-medium text-primario hover:underline" onClick={() => marcarEquipo(f)}>+ todas las de este equipo</button>}
                  </td>
                  <td>
                    <div className="text-[13px]">{f.descripcion}</div>
                    <div className="text-xs capitalize text-tenue">{fmtFrecuencia(f.frecuencia_valor, f.frecuencia_unidad)}{f.requiere_parada && <span className="ml-1.5 normal-case text-primario-oscuro">· requiere parada</span>}</div>
                  </td>
                  <td className="whitespace-nowrap text-[13px]"><div>{fmtFecha(f.proxima_fecha)}</div><div className="text-xs">{venceTxt(f)}</div></td>
                  <td className="whitespace-nowrap text-[13px] text-suave">{f.duracion_estimada_horas ? dTxt(f.duracion_estimada_horas) : '—'}</td>
                  <td className="whitespace-nowrap text-[13px]">
                    {!f.orden_id ? <span className="text-tenue">Sin OT</span> : (
                      <button className="flex flex-col items-start text-left" onClick={() => nav(`/ordenes/${f.orden_id}`)}>
                        <span className="font-semibold">{numOT(f.orden_numero!)} {f.orden_estado === 'en_proceso' && <Insignia t="azul">En proceso</Insignia>}</span>
                        <span className={f.asignado_nombre ? 'text-xs text-suave' : 'text-xs font-semibold text-primario-oscuro'}>{f.asignado_nombre ?? 'Sin asignar'}{f.fecha_programada ? ` · ${fmtFecha(f.fecha_programada).slice(0, 5)}` : ''}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > visibles.length && <div className="px-4 py-3 text-[13px] text-tenue">Se muestran {visibles.length} de {lista.length} · filtrá por planta, criticidad o buscá.</div>}
        </section>
      )}

      {/* Barra para asignar lo elegido */}
      <div className={`${repartir ? "" : "sticky bottom-3 z-20"} flex flex-col gap-3 rounded-2xl border bg-white px-4 py-3.5 shadow-[0_8px_28px_rgba(60,40,20,.14)] ${sel.size ? 'border-primario' : 'border-borde'}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold">{sel.size ? `${sel.size} ${sel.size === 1 ? 'tarea elegida' : 'tareas elegidas'} · ${dTxt(horasSel)} estimadas` : 'Tildá tareas de la lista para asignarlas'}</span>
          {sel.size > 0 && <button className="text-[13px] text-suave hover:text-texto" onClick={() => setSel(new Set())}>Quitar selección</button>}
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,2fr)_auto] lg:items-end">
          <label className="flex flex-col gap-1 text-xs text-suave">Operario
            <select className="campo min-h-[42px] rounded-xl" value={asignado} onChange={(e) => { setAsignado(e.target.value); setTurno('') }}>
              <option value="">Sin asignar</option>
              {(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.turno ? ` · ${u.turno.toLowerCase()}` : ''} · libre {dTxt(libreSem(u.id))} en la semana</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-suave">Día
            <input type="date" className="campo min-h-[42px] rounded-xl" value={dia} min={hoy()} onChange={(e) => e.target.value && setDia(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-suave">Turno
            <select className="campo min-h-[42px] rounded-xl" value={turno} onChange={(e) => setTurno(e.target.value)}>
              <option value="">{op?.turno ? `El suyo (${op.turno.toLowerCase()})` : 'De la tarea'}</option>{TURNOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-suave">Prioridad
            <select className="campo min-h-[42px] rounded-xl" value={prio} onChange={(e) => setPrio(e.target.value as Prioridad | '')}>
              <option value="">La sugerida</option>{PRIORIDADES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-suave">Observación para el operario (opcional)
            <input className="campo min-h-[42px] rounded-xl" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: coordinar la parada con producción" />
          </label>
          <Boton className="min-h-[42px]" disabled={!sel.size} cargando={guardando} onClick={() => void programar()}>Generar y asignar</Boton>
        </div>
        {asignado && (
          <span className="text-xs text-suave">
            {op?.nombre} tiene {dTxt(ocupadoDia(asignado))} asignadas el {DIAS[deISO(dia).getDay()]} {fmtFecha(dia).slice(0, 5)}
            {sel.size > 0 && <> · con estas quedaría en <b className={ocupadoDia(asignado) + horasSel > 8 ? 'text-primario-oscuro' : 'text-aprobado'}>{dTxt(ocupadoDia(asignado) + horasSel)}</b>{ocupadoDia(asignado) + horasSel > 8 ? ' (supera la jornada de 8 h: repartí en más días o en otro operario)' : ''}</>}
          </span>
        )}
      </div>

      {repartir && <RepartirFechas a={repartir} onCerrar={() => setRepartir(null)} onListo={() => { setRepartir(null); setSel(new Set()); void recargar(); onCambio() }} />}
    </div>
  )
}

function RepartirFechas({ a, onCerrar, onListo }: { a: Amontonada; onCerrar: () => void; onListo: () => void }) {
  const avisar = useAviso()
  const [inicio, setInicio] = useState(sumarDias(lunesDe(new Date()), 7))
  const [guardando, setGuardando] = useState(false)
  async function aplicar() {
    setGuardando(true)
    const { data: r, error } = await supabase.rpc('mant_repartir_fechas', { p_fecha: a.proxima_fecha, p_inicio: inicio })
    setGuardando(false)
    if (error) return avisar(mensajeError(error), 'error')
    const x = r as { tareas: number; ots_movidas: number; ots_canceladas: number }
    avisar(`Se repartieron ${x.tareas} rutinas. ${x.ots_movidas} OT pasaron a su nueva fecha y ${x.ots_canceladas} sin asignar se cancelaron (se vuelven a generar cuando les toque).`)
    onListo()
  }
  return (
    <Modal abierto titulo={`Repartir las ${a.tareas} rutinas del ${fmtFecha(a.proxima_fecha)}`} onCerrar={onCerrar} ancho="max-w-xl"
      pie={<><Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void aplicar()}>Repartir fechas</Boton></>}>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">
        <p className="m-0">Cada rutina pasa a tener su propia fecha dentro de su ciclo, empezando por las máquinas más críticas:</p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          <li><b>Mensuales:</b> repartidas en las 4 semanas del mes.</li>
          <li><b>Anuales:</b> una o pocas máquinas por semana a lo largo del año.</li>
          <li><b>Cada 2 años:</b> repartidas en las 104 semanas.</li>
          <li>Las tareas de una misma máquina con la misma frecuencia caen <b>la misma semana</b>, así se para una sola vez.</li>
        </ul>
        <p className="m-0 text-suave">Las OT ya generadas de esas tareas que no tienen operario ni empezaron: si la nueva fecha cae en estas 2 semanas se mueven; si no, se cancelan y se vuelven a generar cuando les toque. Las asignadas o en proceso no se tocan.</p>
        <label className="flex flex-col gap-1 text-xs text-suave">Empezar la semana del
          <input type="date" className="campo max-w-[220px]" value={inicio} onChange={(e) => e.target.value && setInicio(e.target.value)} />
        </label>
        <p className="m-0 text-xs text-tenue">Después podés ajustar la fecha o la frecuencia de cualquier tarea desde Preventivo → Por equipo.</p>
      </div>
    </Modal>
  )
}
