import { useMemo, useState, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useEquipos, useOperarios } from '@/lib/catalogos'
import { deISO, fmtFecha, fmtMin, fmtNum, hoy, lunesDe, numOT, semanaISO, sumarDias, useDatos } from '@/lib/util'
import { PRIORIDADES, type Orden, type Prioridad, type Usuario } from '@/lib/tipos'
import { Boton, Campo, Cargando, Chip, CRIT, ErrorBox, H2, Insignia, InsEstadoOT, Modal, Pagina, Pestanas, Tarjeta, Vacio, useAviso } from '@/components/ui'
import { Foto, SelectorEquipo } from '@/components/selectores'

type Vista = 'agenda' | 'supervisor' | 'lista'
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const dTxt = (x: number) => `${fmtNum(Math.round(x * 100) / 100, 2).replace(/,?0+$/, '')} d`
const dias = (o: Orden) => (o.duracion_estimada_horas ?? 8) / 8
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

interface Datos { ots: Orden[]; operarios: Usuario[] }

export function Ordenes() {
  const [params] = useSearchParams()
  const { puede } = useSesion()
  const avisar = useAviso()
  const esMant = puede('referente', 'supervisor')
  const [vista, setVista] = useState<Vista>(params.get('vencidas') ? 'lista' : 'agenda')
  const [lunes, setLunes] = useState(lunesDe(new Date()))
  const [nueva, setNueva] = useState(false)
  const [generando, setGenerando] = useState(false)
  const viernes = sumarDias(lunes, 4)

  const { data, cargando, error, recargar } = useDatos(async () => {
    const [o, u] = await Promise.all([
      supabase.from('mant_v_ordenes').select('*').gte('fecha_programada', lunes).lte('fecha_programada', sumarDias(lunes, 6)).neq('estado', 'cancelada').order('fecha_programada'),
      supabase.from('mant_usuarios').select('*').eq('activo', true).in('rol', ['operario', 'supervisor', 'referente']).order('nombre')
    ])
    return { data: { ots: (o.data ?? []) as Orden[], operarios: (u.data ?? []) as Usuario[] } as Datos, error: o.error || u.error }
  }, [lunes])

  async function generar() {
    setGenerando(true)
    const { data: n, error } = await supabase.rpc('mant_generar_semana', { p_lunes: lunes })
    setGenerando(false)
    if (error) avisar(mensajeError(error), 'error')
    else { avisar(`${n ?? 0} órdenes preventivas generadas para la semana.`); void recargar() }
  }

  const ini = deISO(lunes), fin = deISO(viernes)
  const rango = ini.getMonth() === fin.getMonth() ? `${ini.getDate()} al ${fin.getDate()} de ${MESES[fin.getMonth()]}` : `${ini.getDate()}/${ini.getMonth() + 1} al ${fin.getDate()}/${fin.getMonth() + 1}`

  return (
    <Pagina kicker={`Módulo 1 y 2 · Semana ${semanaISO(lunes)} · ${rango}`} titulo="Órdenes de trabajo"
      acciones={<>
        <div className="flex items-center gap-1 rounded-full border border-borde bg-white p-1">
          <button className="h-9 w-9 rounded-full hover:bg-crema" onClick={() => setLunes(sumarDias(lunes, -7))} aria-label="Semana anterior">‹</button>
          <button className="rounded-full px-3 py-1.5 text-sm hover:bg-crema" onClick={() => setLunes(lunesDe(new Date()))}>Esta semana</button>
          <button className="h-9 w-9 rounded-full hover:bg-crema" onClick={() => setLunes(sumarDias(lunes, 7))} aria-label="Semana siguiente">›</button>
        </div>
        <Pestanas valor={vista} onCambio={setVista} opciones={[['agenda', 'Agenda por operario'], ['supervisor', 'Panel del supervisor'], ['lista', 'Listado']]} />
      </>}>
      <ErrorBox texto={error} />
      {cargando && !data ? <Cargando /> : !data ? null : vista === 'agenda'
        ? <Agenda d={data} lunes={lunes} esMant={esMant} onCambio={() => void recargar()}
            acciones={esMant && <div className="flex flex-wrap gap-2"><Boton chico variante="secundario" cargando={generando} onClick={() => void generar()}>Generar desde el preventivo</Boton><Boton chico onClick={() => setNueva(true)}>+ Nueva OT</Boton></div>} />
        : vista === 'supervisor' ? <PanelSupervisor d={data} esMant={esMant} onCambio={() => void recargar()} />
        : <Listado ots={data.ots} soloVencidas={!!params.get('vencidas')} />}
      {nueva && <NuevaOT lunes={lunes} onCerrar={() => setNueva(false)} onListo={() => { setNueva(false); void recargar() }} />}
    </Pagina>
  )
}

// ---------------------------------------------------------------------
// Agenda por operario (arrastrar y soltar)
// ---------------------------------------------------------------------
function Agenda({ d, lunes, esMant, onCambio, acciones }: { d: Datos; lunes: string; esMant: boolean; onCambio: () => void; acciones: React.ReactNode }) {
  const nav = useNavigate()
  const avisar = useAviso()
  const [filtro, setFiltro] = useState('Todos')
  const [sobre, setSobre] = useState<string | null>(null)
  const finDeSemana = d.ots.some((o) => o.fecha_programada && deISO(o.fecha_programada).getDay() % 6 === 0)
  const columnas = Array.from({ length: finDeSemana ? 7 : 5 }, (_, i) => sumarDias(lunes, i))

  const filas = useMemo(() => {
    const ops = d.operarios.filter((u) => u.rol === 'operario' || d.ots.some((o) => o.asignado_id === u.id))
    const r: { id: string; nombre: string; turno: string | null }[] = ops.map((u) => ({ id: u.id, nombre: u.nombre, turno: u.turno }))
    if (d.ots.some((o) => !o.asignado_id)) r.push({ id: '', nombre: 'Sin asignar', turno: null })
    return r
  }, [d])
  const visibles = filas.filter((f) => filtro === 'Todos' || f.nombre === filtro)

  const prev = d.ots.filter((o) => o.tipo === 'preventiva'), corr = d.ots.filter((o) => o.tipo === 'correctiva')
  const dPrev = prev.reduce((s, o) => s + dias(o), 0), dCorr = corr.reduce((s, o) => s + dias(o), 0)
  const pct = dPrev + dCorr ? Math.round((dPrev / (dPrev + dCorr)) * 100) : 0

  async function mover(id: string, asignado: string | null, dia: string) {
    const { error } = await supabase.from('mant_ordenes').update({ asignado_id: asignado || null, fecha_programada: dia, semana: lunesDe(dia) }).eq('id', id)
    if (error) avisar(mensajeError(error), 'error'); else onCambio()
  }
  const soltar = (e: DragEvent, asignado: string, dia: string) => {
    e.preventDefault(); setSobre(null)
    const id = e.dataTransfer.getData('text/plain')
    const o = d.ots.find((x) => x.id === id)
    if (o && (o.asignado_id ?? '') + o.fecha_programada !== asignado + dia) void mover(id, asignado, dia)
  }

  return (
    <>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-[2_1_380px] flex-col gap-2.5 rounded-2xl border border-borde bg-white px-4 py-3.5 text-sm">
          {esMant && <span className="rounded-xl bg-rojo-suave px-3 py-2 text-[13px] text-[#8e0f14]"><b>Arrastrá y soltá</b> una OT pendiente en otra celda, o usá los selectores de cada tarjeta, para cambiar quién la hace o qué día.</span>}
          <span><b>La semana se genera sola desde el preventivo.</b> <span className="text-suave">{prev.length} preventivas desde el plan + {corr.length} correctivas desde pedidos · {d.ots.length} OT en total</span></span>
          <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[13px] text-suave">Ver operario</span>
            {['Todos', ...filas.map((f) => f.nombre)].map((n) => <Chip key={n} activo={filtro === n} onClick={() => setFiltro(n)}>{n}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3.5 text-xs text-suave">
              <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-azul bg-[#eef3fb]" />Preventiva</span>
              <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-ambar bg-[#fff6e5]" />Correctiva</span>
              <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border-[1.5px] border-dashed border-[#7db892] bg-[#f3faf5]" />Tiempo libre</span>
            </div>
            {acciones}
          </div>
        </div>
        <div className="flex flex-[1_1_260px] flex-col gap-2 rounded-2xl border border-borde bg-white px-4 py-3.5">
          <span className="text-[13px] font-semibold text-suave">Tiempo dedicado esta semana</span>
          <span className="flex items-baseline gap-2.5"><span className="text-[30px] font-semibold text-revision">{pct}%</span><span className="text-sm">preventivo</span><span className="ml-auto text-sm font-semibold text-pendiente">{dPrev + dCorr ? 100 - pct : 0}% correctivo</span></span>
          <span className="flex h-2.5 overflow-hidden rounded-full bg-linea"><span style={{ width: `${pct}%`, background: '#5b84c4' }} /><span style={{ width: `${dPrev + dCorr ? 100 - pct : 0}%`, background: '#d9a21b' }} /></span>
          <span className="text-xs text-tenue">{dTxt(dPrev)} preventivo · {dTxt(dCorr)} correctivo · meta: 80% preventivo</span>
        </div>
      </div>

      {filas.length === 0 ? <Vacio texto="No hay operarios activos. Dalos de alta en Usuarios." /> : (
        <div className="tarjeta overflow-x-auto">
          <div className="min-w-[1000px]">
            <div className="grid border-b border-linea" style={{ gridTemplateColumns: `160px repeat(${columnas.length}, minmax(0,1fr))` }}>
              <span className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.05em] text-tenue">Operario</span>
              {columnas.map((c) => (
                <span key={c} className={`px-3 py-3 text-[13px] font-semibold ${c === hoy() ? 'bg-rojo-suave text-primario-oscuro' : ''}`}>{DIAS[deISO(c).getDay()]} {fmtFecha(c).slice(0, 5)}{c === hoy() ? ' · hoy' : ''}</span>
              ))}
            </div>
            {visibles.map((f) => {
              const mias = d.ots.filter((o) => (o.asignado_id ?? '') === f.id)
              const ocP = mias.filter((o) => o.tipo === 'preventiva').reduce((s, o) => s + dias(o), 0)
              const ocC = mias.filter((o) => o.tipo === 'correctiva').reduce((s, o) => s + dias(o), 0)
              const cap = columnas.length >= 5 ? 5 : columnas.length
              return (
                <div key={f.id || 'sin'} className="grid border-b border-linea-2" style={{ gridTemplateColumns: `160px repeat(${columnas.length}, minmax(0,1fr))` }}>
                  <span className="flex flex-col gap-0.5 px-4 py-3">
                    <span className="text-[15px] font-semibold">{f.nombre}</span>
                    {f.turno && <span className="text-xs text-suave">Turno {f.turno.toLowerCase()}</span>}
                    {f.id && <>
                      <span className="mt-1 flex h-[5px] w-full overflow-hidden rounded-full bg-linea"><span style={{ width: `${Math.min(100, (ocP / cap) * 100)}%`, background: '#5b84c4' }} /><span style={{ width: `${Math.min(100, (ocC / cap) * 100)}%`, background: '#d9a21b' }} /></span>
                      <span className="text-[11px] leading-tight text-suave">Ocupado {dTxt(ocP + ocC)} · libre {dTxt(Math.max(0, cap - ocP - ocC))}</span>
                    </>}
                  </span>
                  {columnas.map((c) => {
                    const items = mias.filter((o) => o.fecha_programada === c)
                    const carga = items.reduce((s, o) => s + dias(o), 0)
                    const clave = `${f.id}|${c}`
                    return (
                      <div key={c} onDragOver={(e) => { if (esMant) { e.preventDefault(); setSobre(clave) } }} onDragLeave={() => setSobre(null)} onDrop={(e) => soltar(e, f.id, c)}
                        className={`flex min-h-[120px] flex-col gap-1.5 border-l border-linea-2 p-2 ${c === hoy() ? 'bg-[#fffafa]' : ''} ${sobre === clave ? 'bg-rojo-suave outline-2 -outline-offset-2 outline-primario outline-dashed' : ''}`}>
                        {items.map((o) => <TarjetaOT key={o.id} o={o} esMant={esMant} filas={filas} columnas={columnas} onAbrir={() => nav(`/ordenes/${o.id}`)} onMover={mover} />)}
                        {f.id && carga < 1 && (
                          <span className={`flex flex-1 items-center justify-center rounded-xl border-[1.5px] border-dashed border-[#7db892] bg-[#f3faf5] py-2 text-xs font-semibold text-aprobado ${items.length ? 'min-h-[30px] flex-none' : 'min-h-[60px]'}`}>Libre {dTxt(1 - carga)}</span>
                        )}
                        {carga > 1.0001 && <span className="rounded-lg bg-rojo-claro px-2 py-1 text-[11px] font-semibold text-primario-oscuro">Supera la jornada ({dTxt(carga)})</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="text-[13px] text-tenue">Prioridad según criticidad del equipo · turnos rotativos mañana / tarde / noche · duración estimada en días (1 d = 8 h).</div>
    </>
  )
}

function TarjetaOT({ o, esMant, filas, columnas, onAbrir, onMover }:
  { o: Orden; esMant: boolean; filas: { id: string; nombre: string }[]; columnas: string[]; onAbrir: () => void; onMover: (id: string, a: string | null, dia: string) => void }) {
  const prev = o.tipo === 'preventiva'
  const abierta = o.estado === 'pendiente' || o.estado === 'en_proceso'
  const vencida = abierta && !!o.fecha_programada && o.fecha_programada < hoy()
  const c = o.equipo_clasificacion
  return (
    <div draggable={esMant && abierta} onDragStart={(e) => e.dataTransfer.setData('text/plain', o.id)} title={esMant && abierta ? 'Arrastrala a otra celda para reprogramarla' : undefined}
      className={`flex flex-col gap-1 rounded-xl border p-2 ${prev ? 'border-[#c9d6ee] bg-[#eef3fb]' : 'border-[#f1d49a] bg-[#fff6e5]'} ${esMant && abierta ? 'cursor-grab' : ''} ${o.estado === 'completada' ? 'opacity-80' : ''}`}>
      <button onClick={onAbrir} className="flex flex-col gap-1 text-left">
        <span className="flex justify-between gap-1.5 text-[11px] text-suave">
          <span className="flex items-center gap-1.5"><span className={`rounded-full px-1.5 py-px text-[10px] font-semibold text-white ${prev ? 'bg-azul' : 'bg-ambar'}`}>{prev ? 'Preventiva' : 'Correctiva'}</span><span className="font-semibold">{numOT(o.numero)}</span></span>
          <span>{dTxt(dias(o))}</span>
        </span>
        <span className="text-[13px] font-semibold leading-tight">{o.titulo}</span>
        <span className="text-[11px] text-suave">{o.equipo_codigo ?? '—'}</span>
      </button>
      <span className="flex flex-wrap gap-1">
        {c && <Insignia t={CRIT[c][0]}>{CRIT[c][1]}</Insignia>}
        <InsEstadoOT e={o.estado} vencida={vencida} />
      </span>
      {esMant && abierta && (
        <span className="mt-0.5 flex items-center gap-1 border-t border-dashed border-black/10 pt-1.5">
          <select className="min-w-0 flex-1 rounded-full border border-borde-campo bg-white px-1.5 py-0.5 text-[11px]" value={o.asignado_id ?? ''} aria-label="Reasignar operario"
            onChange={(e) => onMover(o.id, e.target.value, o.fecha_programada ?? hoy())}>
            {filas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
          <select className="w-[64px] rounded-full border border-borde-campo bg-white px-1.5 py-0.5 text-[11px]" value={o.fecha_programada ?? ''} aria-label="Cambiar día"
            onChange={(e) => onMover(o.id, o.asignado_id, e.target.value)}>
            {columnas.map((c) => <option key={c} value={c}>{DIAS[deISO(c).getDay()]}</option>)}
          </select>
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Panel del supervisor: cumplimiento por turno, vencidas, pendientes y fotos
// ---------------------------------------------------------------------
interface FotoCierre { orden_id: string; ruta: string }
interface RepCierre { orden_id: string; texto: string; cantidad: number }
type FiltroFoto = 'pendiente' | 'aprobada' | 'rehacer' | 'todas'

function PanelSupervisor({ d, esMant, onCambio }: { d: Datos; esMant: boolean; onCambio: () => void }) {
  const nav = useNavigate()
  const avisar = useAviso()
  const [filtro, setFiltro] = useState<FiltroFoto>('pendiente')
  const cerradas = d.ots.filter((o) => o.estado === 'completada' || o.revision_foto === 'rehacer')
  const { data: extra } = useDatos(async () => {
    const ids = cerradas.map((o) => o.id)
    if (!ids.length) return { data: { fotos: [] as FotoCierre[], reps: [] as RepCierre[] }, error: null }
    const [f, r] = await Promise.all([
      supabase.from('mant_ot_fotos').select('orden_id,ruta').in('orden_id', ids).eq('tipo', 'cierre').order('creado_en'),
      supabase.from('mant_ot_repuestos').select('orden_id,texto,cantidad').in('orden_id', ids)
    ])
    return { data: { fotos: (f.data ?? []) as FotoCierre[], reps: (r.data ?? []) as RepCierre[] }, error: f.error }
  }, [cerradas.map((o) => o.id).join()])

  const turnos = useMemo(() => {
    const m = new Map<string, { ops: Set<string>; total: number; ok: number; venc: number }>()
    for (const o of d.ots) {
      const t = o.asignado_turno ?? o.turno ?? 'Sin turno'
      const v = m.get(t) ?? { ops: new Set(), total: 0, ok: 0, venc: 0 }
      v.total++; if (o.estado === 'completada') v.ok++
      if (o.estado !== 'completada' && o.fecha_programada && o.fecha_programada < hoy()) v.venc++
      if (o.asignado_nombre) v.ops.add(o.asignado_nombre)
      m.set(t, v)
    }
    const orden = ['Mañana', 'Tarde', 'Noche']
    return [...m.entries()].sort((a, b) => (orden.indexOf(a[0]) + 1 || 9) - (orden.indexOf(b[0]) + 1 || 9))
  }, [d.ots])
  const vencidas = d.ots.filter((o) => o.estado !== 'completada' && o.fecha_programada && o.fecha_programada < hoy())
  const deHoy = d.ots.filter((o) => o.estado !== 'completada' && o.fecha_programada === hoy())
  const fotos = cerradas.filter((o) => filtro === 'todas' || (o.revision_foto ?? 'pendiente') === filtro)

  async function revisar(o: Orden, r: 'aprobada' | 'rehacer' | 'pendiente') {
    let comentario: string | null = null
    if (r === 'rehacer') { comentario = prompt('¿Qué hay que rehacer? (lo ve el operario en la tarea)'); if (comentario === null) return }
    const { error } = await supabase.rpc('mant_revisar_foto', { p_orden: o.id, p_resultado: r, p_comentario: comentario })
    if (error) avisar(mensajeError(error), 'error'); else onCambio()
  }

  const fila = (o: Orden, rojo?: boolean) => (
    <button key={o.id} onClick={() => nav(`/ordenes/${o.id}`)} className={`flex items-center justify-between gap-2.5 rounded-[14px] px-3.5 py-3 text-left text-sm ${rojo ? 'bg-rojo-suave' : 'bg-crema'}`}>
      <span className="flex flex-col gap-0.5"><span className="font-semibold">{numOT(o.numero)} · {o.titulo}</span><span className="text-[13px] text-suave">{o.equipo_codigo ?? '—'} · {o.asignado_nombre ?? 'sin asignar'}{rojo && o.fecha_programada ? ` · ${DIAS[deISO(o.fecha_programada).getDay()]} ${fmtFecha(o.fecha_programada).slice(0, 5)}` : ''}</span></span>
      {!rojo && <InsEstadoOT e={o.estado} />}
    </button>
  )

  return (
    <>
      <div className="flex flex-col gap-1"><H2 texto="Cumplimiento de OT por turno" className="text-[22px]" /><span className="text-sm text-suave">Porcentaje de órdenes de trabajo completadas sobre las asignadas en la semana</span></div>
      {turnos.length === 0 ? <Vacio texto="No hay órdenes en esta semana." /> : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          {turnos.map(([t, v]) => {
            const pct = v.total ? Math.round((v.ok / v.total) * 100) : 0
            return (
              <Tarjeta key={t} className="flex flex-col gap-2.5">
                <span className="text-[15px] font-semibold">Turno {t.toLowerCase()}</span>
                <span className="text-[13px] text-suave">{[...v.ops].join(' · ') || '—'}</span>
                <span className="sobretitulo">Cumplimiento de OT</span>
                <span className="text-[40px] font-semibold leading-none">{pct}%</span>
                <span className="block h-2 overflow-hidden rounded-full bg-beige"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 80 ? '#1e6b3a' : pct >= 50 ? '#d9a21b' : '#cc1a20' }} /></span>
                <span className="text-[13px] text-suave">{v.ok} de {v.total} OT completadas · {v.venc} vencidas</span>
              </Tarjeta>
            )
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <Tarjeta className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5">
          <h2 className="m-0 text-lg font-semibold text-primario-oscuro">Vencidas ({vencidas.length})</h2>
          {vencidas.length === 0 ? <span className="text-sm text-suave">No hay órdenes vencidas.</span> : vencidas.map((o) => fila(o, true))}
        </Tarjeta>
        <Tarjeta className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5">
          <h2 className="m-0 text-lg font-semibold">Pendientes de hoy ({deHoy.length})</h2>
          {deHoy.length === 0 ? <span className="text-sm text-suave">Nada pendiente para hoy.</span> : deHoy.map((o) => fila(o))}
        </Tarjeta>
      </div>
      <Tarjeta className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-end justify-between gap-2.5">
          <div className="flex flex-col gap-1"><H2 texto="Revisión de fotos de cierre" className="text-[22px]" /><span className="text-sm text-suave">Fotos que mandaron los operarios al cerrar cada OT. Aprobá o pedí que se rehaga.</span></div>
          <div className="flex flex-wrap gap-1.5">
            {([['pendiente', 'Por revisar'], ['aprobada', 'Aprobadas'], ['rehacer', 'Para rehacer'], ['todas', 'Todas']] as [FiltroFoto, string][]).map(([v, t]) => <Chip key={v} activo={filtro === v} onClick={() => setFiltro(v)}>{t}</Chip>)}
          </div>
        </div>
        {fotos.length === 0 ? <div className="text-sm text-suave">No hay fotos con ese filtro.</div> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
            {fotos.map((o) => {
              const foto = extra?.fotos.filter((f) => f.orden_id === o.id).at(-1)
              const reps = extra?.reps.filter((r) => r.orden_id === o.id) ?? []
              const rev = o.revision_foto ?? 'pendiente'
              return (
                <div key={o.id} className={`overflow-hidden rounded-[18px] border ${rev === 'aprobada' ? 'border-[#bfe0c9]' : rev === 'rehacer' ? 'border-[#f3c4c6]' : 'border-borde'} bg-white`}>
                  <button onClick={() => nav(`/ordenes/${o.id}`)} className="rayado relative flex h-[150px] w-full items-end justify-between p-2.5" aria-label="Ver detalle del cierre">
                    {foto ? <span className="absolute inset-0"><Foto ruta={foto.ruta} sinEnlace className="h-full w-full rounded-none" /></span> : <span className="absolute inset-0 flex items-center justify-center"><Insignia t="rojo">Sin foto adjunta</Insignia></span>}
                    <span className="relative ml-auto"><Insignia t={rev === 'aprobada' ? 'verde' : rev === 'rehacer' ? 'rojo' : 'blanco'}>{rev === 'aprobada' ? 'Aprobada' : rev === 'rehacer' ? 'Para rehacer' : 'Por revisar'}</Insignia></span>
                  </button>
                  <div className="flex flex-col gap-1.5 p-3.5">
                    <span className="text-xs text-tenue">{numOT(o.numero)} · {o.tipo === 'preventiva' ? 'Preventiva' : 'Correctiva'} · {o.completada_en ? new Date(o.completada_en).toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : 'reabierta'}</span>
                    <span className="text-[15px] font-semibold leading-snug">{o.titulo}</span>
                    <span className="text-[13px] text-suave">{o.equipo_codigo ?? '—'} · {o.asignado_nombre ?? '—'}</span>
                    <span className="rounded-[10px] bg-fondo px-2.5 py-1.5 text-xs text-texto-2">Tiempo real {fmtMin(o.tiempo_real_min)} · Repuestos: {reps.length ? reps.map((r) => `${r.cantidad} × ${r.texto}`).join(', ') : 'ninguno'}</span>
                    {esMant && rev === 'pendiente' && o.estado === 'completada' && (
                      <div className="mt-1 flex gap-2">
                        <Boton variante="verde" chico className="flex-1" onClick={() => void revisar(o, 'aprobada')}>Aprobar</Boton>
                        <Boton variante="peligro" chico className="flex-1" onClick={() => void revisar(o, 'rehacer')}>Pedir rehacer</Boton>
                      </div>
                    )}
                    {esMant && rev === 'aprobada' && <button className="self-start text-xs text-tenue underline" onClick={() => void revisar(o, 'pendiente')}>Deshacer</button>}
                    <button className="self-start py-1 text-[13px] font-semibold text-primario-oscuro" onClick={() => nav(`/ordenes/${o.id}`)}>Escuchar audio, revisar pasos y cargar al plan →</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Tarjeta>
    </>
  )
}

// ---------------------------------------------------------------------
// Listado simple (con vencidas)
// ---------------------------------------------------------------------
function Listado({ ots, soloVencidas }: { ots: Orden[]; soloVencidas: boolean }) {
  const nav = useNavigate()
  const [venc, setVenc] = useState(soloVencidas)
  const { data: vencidas } = useDatos(async () => {
    if (!venc) return { data: null, error: null }
    const r = await supabase.from('mant_v_ordenes').select('*').eq('vencida', true).order('fecha_comprometida')
    return { data: (r.data ?? []) as Orden[], error: r.error }
  }, [venc])
  const lista = venc ? vencidas ?? [] : ots
  return (
    <>
      <div className="flex gap-2"><Chip activo={!venc} onClick={() => setVenc(false)}>Esta semana</Chip><Chip activo={venc} onClick={() => setVenc(true)}>Todas las vencidas</Chip></div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla min-w-[860px]">
          <thead><tr><th>OT</th><th>Tarea</th><th>Equipo</th><th>Asignado</th><th>Programada</th><th>Comprometida</th><th>Estado</th></tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={7} className="text-suave">Sin órdenes.</td></tr>}
            {lista.map((o) => (
              <tr key={o.id} className="cursor-pointer" onClick={() => nav(`/ordenes/${o.id}`)}>
                <td className="font-semibold">{numOT(o.numero)}</td><td>{o.titulo}</td><td>{o.equipo_codigo ?? '—'}</td><td>{o.asignado_nombre ?? '—'}</td>
                <td>{fmtFecha(o.fecha_programada)}</td><td>{fmtFecha(o.fecha_comprometida)}</td><td><InsEstadoOT e={o.estado} vencida={o.vencida} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function NuevaOT({ lunes, onCerrar, onListo }: { lunes: string; onCerrar: () => void; onListo: () => void }) {
  const { data: equipos } = useEquipos()
  const { data: operarios } = useOperarios()
  const dia0 = hoy() >= lunes && hoy() <= sumarDias(lunes, 6) ? hoy() : lunes
  const [f, setF] = useState({ titulo: '', descripcion: '', equipo_id: null as string | null, prioridad: 'media' as Prioridad, asignado_id: '', fecha_programada: dia0, fecha_comprometida: sumarDias(dia0, 3), duracion: '1', tipo: 'correctiva' })
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  async function guardar() {
    if (!f.titulo.trim()) { setError('Poné un título.'); return }
    setGuardando(true)
    const op = operarios?.find((u) => u.id === f.asignado_id)
    const { error } = await supabase.from('mant_ordenes').insert({
      tipo: f.tipo, titulo: f.titulo.trim(), descripcion: f.descripcion.trim() || null, equipo_id: f.equipo_id,
      prioridad: f.prioridad, asignado_id: f.asignado_id || null, turno: op?.turno ?? null,
      semana: lunesDe(f.fecha_programada), fecha_programada: f.fecha_programada, fecha_comprometida: f.fecha_comprometida || null,
      duracion_estimada_horas: (Number(f.duracion.replace(',', '.')) || 1) * 8
    })
    setGuardando(false)
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <Modal abierto titulo="Nueva orden de trabajo" onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Crear OT</Boton></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <ErrorBox texto={error} />
        <Campo etiqueta="Título" className="sm:col-span-2"><input className="campo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Campo>
        <Campo etiqueta="Equipo" className="sm:col-span-2"><SelectorEquipo equipos={equipos ?? []} valor={f.equipo_id} onCambio={(id) => setF({ ...f, equipo_id: id })} /></Campo>
        <Campo etiqueta="Detalle para el operario" className="sm:col-span-2"><textarea className="campo" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>
        <Campo etiqueta="Tipo"><select className="campo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="correctiva">Correctiva</option><option value="preventiva">Preventiva</option></select></Campo>
        <Campo etiqueta="Prioridad"><select className="campo" value={f.prioridad} onChange={(e) => setF({ ...f, prioridad: e.target.value as Prioridad })}>{PRIORIDADES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></Campo>
        <Campo etiqueta="Asignar a">
          <select className="campo" value={f.asignado_id} onChange={(e) => setF({ ...f, asignado_id: e.target.value })}>
            <option value="">Sin asignar</option>{(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.turno ? ` · turno ${u.turno.toLowerCase()}` : ''}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Duración (días)"><input className="campo" inputMode="decimal" value={f.duracion} onChange={(e) => setF({ ...f, duracion: e.target.value })} /></Campo>
        <Campo etiqueta="Día"><input type="date" className="campo" value={f.fecha_programada} onChange={(e) => setF({ ...f, fecha_programada: e.target.value })} /></Campo>
        <Campo etiqueta="Plazo"><input type="date" className="campo" value={f.fecha_comprometida} onChange={(e) => setF({ ...f, fecha_comprometida: e.target.value })} /></Campo>
      </div>
    </Modal>
  )
}
