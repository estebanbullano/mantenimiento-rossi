import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { usePlantas } from '@/lib/catalogos'
import { fmtFecha, fmtFrecuencia, fmtNum, lunesDe, numOT, semanaISO, sumarDias, sumarFrecuencia, useDatos } from '@/lib/util'
import { UNIDADES, type Clasificacion, type Orden, type Tarea, type Unidad } from '@/lib/tipos'
import { Boton, Cargando, ErrorBox, H2, Insignia, InsCriticidad, InsEstadoOT, Modal, Pagina, Pestanas, Tarjeta, Vacio, useAviso } from '@/components/ui'

type Vista = 'equipo' | 'anual' | 'semana' | 'repuestos'
type TareaEq = Tarea & { equipo: { codigo: string; nombre: string; planta_id: string } | null }
const etiq = (t: TareaEq) => t.equipo?.codigo ?? t.unidad ?? 'Ronda'

export function Preventivo() {
  const [vista, setVista] = useState<Vista>('equipo')
  return (
    <Pagina kicker="Módulo 1 · Planificación" titulo="Planes preventivos"
      acciones={<Pestanas valor={vista} onCambio={setVista} opciones={[['equipo', 'Por equipo'], ['anual', 'Calendario por semana'], ['semana', 'Esta semana'], ['repuestos', 'Repuestos']]} />}>
      {vista === 'equipo' && <PorEquipo />}
      {vista === 'semana' && <PlanSemanal />}
      {vista === 'anual' && <CalendarioAnual />}
      {vista === 'repuestos' && <RepuestosPreventivo />}
    </Pagina>
  )
}

function PlanSemanal() {
  const nav = useNavigate()
  const { puede } = useSesion()
  const [lunes, setLunes] = useState(lunesDe(new Date()))
  const [editar, setEditar] = useState<TareaEq | null>(null)

  const { data, cargando, error, recargar } = useDatos(async () => {
    const [ot, tareas] = await Promise.all([
      supabase.from('mant_v_ordenes').select('*').eq('tipo', 'preventiva').eq('semana', lunes).order('prioridad'),
      supabase.from('mant_tareas').select('*, equipo:mant_equipos(codigo, nombre, planta_id)').eq('activa', true)
        .lte('proxima_fecha', sumarDias(lunes, 6)).order('proxima_fecha')
    ])
    return { data: { ordenes: (ot.data ?? []) as Orden[], tareas: (tareas.data ?? []) as TareaEq[] }, error: ot.error || tareas.error }
  }, [lunes])

  const conOT = new Set((data?.ordenes ?? []).map((o) => o.tarea_id))
  const faltan = (data?.tareas ?? []).filter((t) => !conOT.has(t.id))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Boton variante="secundario" onClick={() => setLunes(sumarDias(lunes, -7))}>‹</Boton>
        <div className="rounded-lg border border-borde bg-white px-4 py-2 text-sm font-bold">S{semanaISO(lunes)} · {fmtFecha(lunes)} al {fmtFecha(sumarDias(lunes, 6))}</div>
        <Boton variante="secundario" onClick={() => setLunes(sumarDias(lunes, 7))}>›</Boton>
        {puede('referente', 'supervisor') && <Boton className="ml-auto" onClick={() => nav('/ordenes?programar=1')}>Programar y asignar{faltan.length ? ` (${faltan.length} sin OT)` : ''}</Boton>}
      </div>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data ? null : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Tarjeta titulo={`Órdenes de la semana (${data!.ordenes.length})`} className="lg:col-span-2">
            {!data!.ordenes.length ? <Vacio texto="Todavía no hay órdenes para esta semana: programalas desde Órdenes → Programar preventivo." /> : (
              <table className="tabla -m-4 w-[calc(100%+2rem)]">
                <thead><tr><th>OT</th><th>Equipo</th><th>Tarea</th><th>Asignado</th><th>Estado</th></tr></thead>
                <tbody>
                  {data!.ordenes.map((o) => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => nav(`/ordenes/${o.id}`)}>
                      <td className="whitespace-nowrap font-bold">{numOT(o.numero)}</td><td>{o.equipo_codigo ?? o.tarea_unidad}</td><td>{o.titulo}</td>
                      <td>{o.asignado_nombre ?? <span className="text-primario">Sin asignar</span>}</td><td><InsEstadoOT e={o.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Tarjeta>
          <Tarjeta titulo={`Tareas que vencen y aún no tienen OT (${faltan.length})`}>
            {!faltan.length ? <p className="text-sm text-suave">Todo generado.</p> : (
              <ul className="divide-y divide-borde text-sm">
                {faltan.map((t) => (
                  <li key={t.id} className="py-2">
                    <button className="w-full text-left" disabled={!puede('referente', 'supervisor')} onClick={() => setEditar(t)}>
                      <b>{etiq(t)}</b> · {t.descripcion}
                      <div className="text-xs capitalize text-suave">{fmtFrecuencia(t.frecuencia_valor, t.frecuencia_unidad)} · vence {fmtFecha(t.proxima_fecha)}{puede('referente', 'supervisor') && <span className="normal-case text-primario"> · cambiar</span>}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>
      )}
      {editar && <EditarTarea t={editar} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); void recargar() }} />}
    </>
  )
}

/** Vista equivalente a la planilla RG MA 01: una fila por tarea, una columna por semana.
 *  Mantenimiento puede arrastrar una "P" a otra semana y editar frecuencia y fecha. */
function CalendarioAnual() {
  const nav = useNavigate()
  const avisar = useAviso()
  const { puede } = useSesion()
  const editable = puede('referente', 'supervisor')
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [planta, setPlanta] = useState('')
  const [texto, setTexto] = useState('')
  const [editar, setEditar] = useState<{ t: TareaEq; fecha?: string } | null>(null)
  const [arrastre, setArrastre] = useState<{ id: string; semana: number } | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const { data: pl } = usePlantas()
  const { data, cargando, error, recargar } = useDatos(async () => {
    const [t, o, e] = await Promise.all([
      supabase.from('mant_tareas').select('*, equipo:mant_equipos(codigo, nombre, planta_id)').eq('activa', true).limit(3000),
      supabase.from('mant_ordenes').select('tarea_id, semana, estado, completada_en').eq('tipo', 'preventiva').in('estado', ['completada', 'no_realizada'])
        .gte('completada_en', `${anio}-01-01`).lte('completada_en', `${anio}-12-31T23:59:59`),
      supabase.from('mant_v_equipos').select('id, clasificacion, criticidad')
    ])
    return {
      data: {
        tareas: ((t.data ?? []) as TareaEq[]).sort((a, b) => etiq(a).localeCompare(etiq(b))),
        ordenes: (o.data ?? []) as Pick<Orden, 'tarea_id' | 'semana' | 'estado' | 'completada_en'>[],
        crit: new Map(((e.data ?? []) as { id: string; clasificacion: Clasificacion; criticidad: number }[]).map((x) => [x.id, x]))
      },
      error: t.error || o.error
    }
  }, [anio])

  const semanas = Array.from({ length: 52 }, (_, i) => i + 1)
  const filas = useMemo(() => {
    const q = texto.toLowerCase().trim()
    return (data?.tareas ?? []).filter((t) => (!planta || t.equipo?.planta_id === planta) && (!q || `${etiq(t)} ${t.equipo?.nombre ?? ''} ${t.descripcion}`.toLowerCase().includes(q))).map((t) => {
      // semanas planificadas: proyección desde la próxima fecha según la frecuencia (semana → fecha)
      const plan = new Map<number, string>()
      let f = t.proxima_fecha
      for (let i = 0; i < 400 && f <= `${anio}-12-31`; i++) {
        if (f >= `${anio}-01-01` && !plan.has(semanaISO(f))) plan.set(semanaISO(f), f)
        f = sumarFrecuencia(f, t.frecuencia_valor, t.frecuencia_unidad)
      }
      const hechas = new Set<number>(), noHechas = new Set<number>()
      for (const o of data!.ordenes) if (o.tarea_id === t.id && o.completada_en?.startsWith(String(anio))) (o.estado === 'completada' ? hechas : noHechas).add(semanaISO(o.completada_en.slice(0, 10)))
      return { t, plan, hechas, noHechas }
    })
  }, [data, planta, anio, texto])
  const actual = new Date().getFullYear() === anio ? semanaISO(lunesDe(new Date())) : 0

  async function mover(t: TareaEq, desde: number, hasta: number) {
    if (desde === hasta) return
    const nueva = sumarDias(t.proxima_fecha, (hasta - desde) * 7)
    const { data: n, error } = await supabase.rpc('mant_mover_tarea', { p_tarea: t.id, p_fecha: nueva, p_motivo: 'Movida en el calendario' })
    if (error) return avisar(mensajeError(error), 'error')
    avisar(`${etiq(t)} · ${t.descripcion}: próxima ${fmtFecha(nueva)}${n ? ' (su OT pendiente también se movió)' : ''}. Las siguientes se corren igual.`)
    void recargar()
  }

  return (
    <>
      <div className="no-imprimir mb-3 flex flex-wrap items-center gap-2">
        <Boton variante="secundario" onClick={() => setAnio(anio - 1)}>‹</Boton>
        <span className="font-extrabold">{anio}</span>
        <Boton variante="secundario" onClick={() => setAnio(anio + 1)}>›</Boton>
        <select className="campo w-auto" value={planta} onChange={(e) => setPlanta(e.target.value)}>
          <option value="">Todas las plantas y rondas</option>{(pl?.plantas ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
        </select>
        <input className="campo-chico min-w-[180px] max-w-[280px] flex-1" placeholder="Buscar equipo o tarea…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <span className="ml-2 text-xs text-suave"><b className="text-revision">P</b> planificada · <b className="text-aprobado">✓</b> hecha · <b className="text-pendiente">–</b> no se hizo (máquina parada)</span>
        <Boton variante="secundario" className="ml-auto" onClick={() => window.print()}>Imprimir</Boton>
      </div>
      {editable && <div className="no-imprimir mb-3 rounded-xl bg-rojo-suave px-3 py-2 text-[13px] text-[#8e0f14]"><b>Arrastrá una P</b> a otra semana para reprogramar la tarea (se corren también las siguientes). <b>Tocá el nombre o la frecuencia</b> para cambiar cada cuánto se hace o la próxima fecha.</div>}
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !filas.length ? <Vacio texto="No hay tareas preventivas con estos filtros. Se cargan desde la ficha de cada equipo." /> : (
        <div className="overflow-x-auto rounded-xl border border-borde bg-white">
          <table className="border-collapse text-xs">
            <thead>
              <tr className="bg-fondo-2">
                <th className="sticky left-0 z-10 min-w-64 border-b border-borde bg-fondo-2 p-2 text-left">Equipo / tarea</th>
                <th className="border-b border-borde p-1">Frec.</th>
                {semanas.map((s) => <th key={s} className={`w-6 border-b border-l border-borde p-0.5 text-center font-bold ${s === actual ? 'bg-primario text-white' : 'text-suave'}`}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, 500).map(({ t, plan, hechas, noHechas }) => (
                <tr key={t.id} className="hover:bg-fondo-2/60">
                  <td className="sticky left-0 z-10 border-b border-borde bg-white p-1.5">
                    <button className="text-left" onClick={() => editable ? setEditar({ t }) : t.equipo_id && nav(`/equipos/${t.equipo_id}`)}>
                      <b>{etiq(t)}</b> {t.equipo_id && <InsCriticidad c={data!.crit.get(t.equipo_id)?.clasificacion} />}{t.turno && !t.equipo_id && <span className="ml-1 text-suave">· {t.turno}</span>}
                      <div className="text-suave">{t.descripcion}</div>
                    </button>
                  </td>
                  <td className="whitespace-nowrap border-b border-borde px-1">
                    <button className={`rounded px-1 py-0.5 text-suave ${editable ? 'hover:bg-rojo-suave hover:text-primario-oscuro' : ''}`} disabled={!editable} onClick={() => setEditar({ t })} title={editable ? 'Cambiar frecuencia' : undefined}>
                      {t.frecuencia_valor} {UNIDADES[t.frecuencia_unidad].slice(0, 3)}
                    </button>
                  </td>
                  {semanas.map((s) => {
                    const clave = `${t.id}|${s}`
                    const esP = plan.has(s) && !hechas.has(s)
                    return (
                      <td key={s}
                        onDragOver={(e) => { if (arrastre?.id === t.id) { e.preventDefault(); setSobre(clave) } }}
                        onDragLeave={() => setSobre(null)}
                        onDrop={(e) => { e.preventDefault(); setSobre(null); if (arrastre?.id === t.id) void mover(t, arrastre.semana, s); setArrastre(null) }}
                        className={`h-7 border-b border-l border-borde text-center font-bold ${s === actual ? 'bg-primario/5' : ''} ${sobre === clave ? 'bg-rojo-suave outline-2 -outline-offset-2 outline-dashed outline-primario' : ''}`}>
                        {hechas.has(s) ? <span className="text-aprobado">✓</span>
                          : noHechas.has(s) && !esP ? <span className="text-pendiente" title="No se hizo (máquina parada)">–</span>
                          : esP ? (
                            <span draggable={editable} onDragStart={(e) => { e.dataTransfer.setData('text/plain', clave); setArrastre({ id: t.id, semana: s }) }} onDragEnd={() => { setArrastre(null); setSobre(null) }}
                              onClick={() => editable && setEditar({ t, fecha: plan.get(s) })} title={editable ? `${fmtFecha(plan.get(s)!)} · arrastrá para mover, tocá para editar` : fmtFecha(plan.get(s)!)}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded text-revision ${editable ? 'cursor-grab bg-azul-claro hover:bg-[#c9d6ee]' : ''}`}>P</span>
                          ) : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {filas.length > 500 && <div className="px-4 py-3 text-[13px] text-tenue">Se muestran 500 de {filas.length} tareas · filtrá por planta o buscá.</div>}
        </div>
      )}
      {editar && <EditarTarea t={editar.t} fechaSugerida={editar.fecha} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); void recargar() }} onFicha={editar.t.equipo_id ? () => nav(`/equipos/${editar.t.equipo_id}`) : undefined} />}
    </>
  )
}

/** Editar frecuencia y próxima fecha de una tarea del plan */
export function EditarTarea({ t, fechaSugerida, onCerrar, onListo, onFicha }: { t: Tarea & { equipo?: { codigo: string; nombre: string } | null }; fechaSugerida?: string; onCerrar: () => void; onListo: () => void; onFicha?: () => void }) {
  const avisar = useAviso()
  const [valor, setValor] = useState(String(t.frecuencia_valor))
  const [unidad, setUnidad] = useState<Unidad>(t.frecuencia_unidad)
  const [fecha, setFecha] = useState(t.proxima_fecha)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const cambiaFrec = Number(valor) !== t.frecuencia_valor || unidad !== t.frecuencia_unidad
  const cambiaFecha = fecha !== t.proxima_fecha
  // próximas 4 fechas con lo elegido
  const muestra = useMemo(() => {
    const r: string[] = []; let f = fecha; const v = Number(valor)
    if (!f || !v || v < 1) return r
    for (let i = 0; i < 4; i++) { r.push(f); f = sumarFrecuencia(f, v, unidad) }
    return r
  }, [fecha, valor, unidad])

  async function guardar() {
    const v = Number(valor)
    if (!v || v < 1) return avisar('La frecuencia tiene que ser 1 o más.', 'error')
    if (!cambiaFrec && !cambiaFecha) return onCerrar()
    setGuardando(true)
    const { error } = cambiaFrec
      ? await supabase.rpc('mant_ajustar_frecuencia', { p_tarea: t.id, p_valor: v, p_unidad: unidad, p_motivo: motivo.trim() || null, p_proxima: fecha })
      : await supabase.rpc('mant_mover_tarea', { p_tarea: t.id, p_fecha: fecha, p_motivo: motivo.trim() || null })
    setGuardando(false)
    if (error) return avisar(mensajeError(error), 'error')
    avisar(cambiaFrec ? `Ahora ${fmtFrecuencia(v, unidad)} · próxima ${fmtFecha(fecha)}.` : `Próxima ${fmtFecha(fecha)}.`)
    onListo()
  }

  return (
    <Modal abierto titulo={t.descripcion} onCerrar={onCerrar}
      pie={<>{onFicha && <Boton variante="fantasma" className="mr-auto" onClick={onFicha}>Ver ficha del equipo</Boton>}<Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Guardar</Boton></>}>
      <div className="flex flex-col gap-3.5 text-sm">
        {t.equipo && <span className="text-[13px] text-suave">{t.equipo.codigo} · {t.equipo.nombre}</span>}
        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-end gap-2.5">
          <label className="flex flex-col gap-1 text-xs text-suave">Cada
            <input className="campo" type="number" min={1} value={valor} onChange={(e) => setValor(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs text-suave">Unidad
            <select className="campo" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)}>
              {(Object.keys(UNIDADES) as Unidad[]).map((u) => <option key={u} value={u}>{u === 'horas' ? 'horas de marcha' : UNIDADES[u]}</option>)}
            </select></label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-suave">Próxima vez
          <input className="campo max-w-[220px]" type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></label>
        {fechaSugerida && fechaSugerida !== t.proxima_fecha && <button className="self-start text-[13px] text-primario" onClick={() => setFecha(fechaSugerida)}>Pasar la próxima al {fmtFecha(fechaSugerida)}</button>}
        <label className="flex flex-col gap-1 text-xs text-suave">Motivo {cambiaFrec ? '(queda en el historial)' : '(opcional)'}
          <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: en la inspección estaba en buen estado" /></label>
        {muestra.length > 0 && <span className="text-[13px] text-suave">Quedaría: {muestra.map((f) => fmtFecha(f)).join(' · ')}…</span>}
        <span className="text-xs text-tenue">Última vez que se hizo: {fmtFecha(t.ultima_ejecucion)}. Si tiene una OT pendiente sin empezar, se mueve a la nueva fecha.</span>
      </div>
    </Modal>
  )
}

interface Necesidad { articulo_id: string; codigo: string; descripcion: string; unidad: string; stock_actual: number; cantidad_necesaria: number; primera_fecha: string; faltante: number }

function RepuestosPreventivo() {
  const nav = useNavigate()
  const { data, cargando, error } = useDatos(async () => {
    const r = await supabase.from('mant_v_necesidades_preventivo').select('*').order('primera_fecha')
    return { data: (r.data ?? []) as Necesidad[], error: r.error }
  })
  return (
    <Tarjeta titulo="Repuestos que pide el preventivo en las próximas 8 semanas"
      acciones={<Boton variante="secundario" onClick={() => nav('/compras?preventivo=1')}>Armar pedido de compra</Boton>}>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data?.length ? <p className="text-sm text-suave">Ninguna tarea tiene repuestos asociados todavía. Se cargan en la ficha del equipo, en cada tarea.</p> : (
        <table className="tabla -m-4 w-[calc(100%+2rem)]">
          <thead><tr><th>Código</th><th>Repuesto</th><th>Se necesita</th><th>Stock</th><th>Faltante</th><th>Primer uso</th></tr></thead>
          <tbody>
            {data.map((n) => (
              <tr key={n.articulo_id}>
                <td className="font-bold">{n.codigo}</td><td>{n.descripcion}</td>
                <td>{fmtNum(n.cantidad_necesaria, 1)} {n.unidad}</td><td>{fmtNum(n.stock_actual, 1)}</td>
                <td className={n.faltante > 0 ? 'font-bold text-primario' : 'text-aprobado'}>{n.faltante > 0 ? fmtNum(n.faltante, 1) : 'Cubierto'}</td>
                <td>{fmtFecha(n.primera_fecha)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Tarjeta>
  )
}

// ---------------------------------------------------------------------
// Por equipo: tabla de planes, detalle con historial de frecuencias, ajuste y calendario del año
// ---------------------------------------------------------------------
type TareaCrit = Tarea & { codigo: string; nombre: string; clas: Clasificacion | null }
type HistFrec = { id: string; tarea_id: string; valor_anterior: number; unidad_anterior: keyof typeof UNIDADES; valor_nuevo: number; unidad_nueva: keyof typeof UNIDADES; motivo: string | null; creado_en: string; fecha_nueva: string | null }
const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const frecTxt = (t: Tarea) => t.frecuencia_unidad === 'horas' ? `Cada ${fmtNum(t.frecuencia_valor)} h de marcha` : `Cada ${t.frecuencia_valor} ${UNIDADES[t.frecuencia_unidad].replace(/s$/, t.frecuencia_valor === 1 ? '' : 's')}`

function PorEquipo() {
  const avisar = useAviso()
  const { puede } = useSesion()
  const [texto, setTexto] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [editarT, setEditarT] = useState<{ t: TareaCrit; f?: string } | null>(null)
  const { data, cargando, error, recargar } = useDatos(async () => {
    const [t, e] = await Promise.all([
      supabase.from('mant_tareas').select('*').eq('activa', true).not('equipo_id', 'is', null).order('proxima_fecha').limit(2000),
      supabase.from('mant_v_equipos').select('id,codigo,nombre,clasificacion,criticidad')
    ])
    const eq = new Map(((e.data ?? []) as { id: string; codigo: string; nombre: string; clasificacion: Clasificacion; criticidad: number }[]).map((x) => [x.id, x]))
    const filas = ((t.data ?? []) as Tarea[]).map((x) => ({ ...x, codigo: eq.get(x.equipo_id!)?.codigo ?? '—', nombre: eq.get(x.equipo_id!)?.nombre ?? '', clas: eq.get(x.equipo_id!)?.clasificacion ?? null, _c: eq.get(x.equipo_id!)?.criticidad ?? 0 }))
    filas.sort((a, b) => b._c - a._c || a.codigo.localeCompare(b.codigo))
    return { data: filas as TareaCrit[], error: t.error || e.error }
  })
  const { data: hist } = useDatos(async () => {
    if (!sel) return { data: [] as HistFrec[], error: null }
    const r = await supabase.from('mant_tareas_historial').select('*').eq('tarea_id', sel).order('creado_en')
    return { data: (r.data ?? []) as HistFrec[], error: r.error }
  }, [sel])
  const lista = useMemo(() => {
    const q = texto.toLowerCase().trim()
    return (data ?? []).filter((t) => !q || `${t.codigo} ${t.nombre} ${t.descripcion}`.toLowerCase().includes(q))
  }, [data, texto])
  const plan = data?.find((t) => t.id === sel)
  const delEquipo = plan ? (data ?? []).filter((t) => t.equipo_id === plan.equipo_id) : []

  async function aplicar() {
    if (!plan) return
    const v = Number(valor)
    if (!v || v < 1) return avisar('Indicá la nueva frecuencia.', 'error')
    if (!motivo.trim()) return avisar('Contá el motivo del ajuste.', 'error')
    setGuardando(true)
    const { error } = await supabase.rpc('mant_ajustar_frecuencia', { p_tarea: plan.id, p_valor: v, p_unidad: plan.frecuencia_unidad, p_motivo: motivo.trim() })
    setGuardando(false)
    if (error) avisar(mensajeError(error), 'error'); else { avisar('Frecuencia ajustada: el calendario se reprogramó.'); setValor(''); setMotivo(''); void recargar() }
  }

  // Fechas del año de una tarea a partir de su próxima fecha (hacia adelante y hacia atrás)
  const anio = new Date().getFullYear()
  function fechasDelAnio(t: Tarea) {
    if (t.frecuencia_unidad === 'horas') return [t.proxima_fecha]
    const r: string[] = []
    let f = t.proxima_fecha
    for (let i = 0; i < 400 && f.slice(0, 4) >= String(anio); i++) { if (f.slice(0, 4) === String(anio)) r.push(f); f = sumarFrecuencia(f, -t.frecuencia_valor, t.frecuencia_unidad) }
    f = sumarFrecuencia(t.proxima_fecha, t.frecuencia_valor, t.frecuencia_unidad)
    for (let i = 0; i < 400 && f.slice(0, 4) === String(anio); i++) { r.push(f); f = sumarFrecuencia(f, t.frecuencia_valor, t.frecuencia_unidad) }
    return [...new Set(r)].sort()
  }
  const hoyIso = new Date().toISOString().slice(0, 10)
  const lunesHoy = lunesDe(new Date())

  return (
    <>
      <input className="campo-chico max-w-[420px]" placeholder="Buscar equipo o tarea…" value={texto} onChange={(e) => setTexto(e.target.value)} />
      <ErrorBox texto={error} />
      <div className="flex flex-wrap items-start gap-4">
        <section className="tarjeta min-w-0 flex-[3_1_480px] overflow-x-auto">
          {cargando && !data ? <Cargando /> : (
            <table className="tabla min-w-[600px]">
              <thead><tr><th>Equipo</th><th>Tarea</th><th>Frecuencia</th><th>Crit.</th></tr></thead>
              <tbody>
                {lista.slice(0, 300).map((t) => (
                  <tr key={t.id} className={`cursor-pointer ${sel === t.id ? '!bg-rojo-suave' : ''}`} onClick={() => { setSel(t.id); setValor(String(t.frecuencia_valor)) }}>
                    <td className="whitespace-nowrap text-[13px] font-semibold">{t.codigo}</td><td>{t.descripcion}</td>
                    <td className="whitespace-nowrap text-suave">{frecTxt(t)}</td><td className="w-[70px]"><InsCriticidad c={t.clas} corta ancho /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lista.length > 300 && <div className="px-4 py-3 text-[13px] text-tenue">Se muestran 300 de {lista.length} tareas · usá el buscador.</div>}
        </section>
        {plan && (
          <section className="tarjeta flex min-w-0 flex-[2_1_320px] flex-col gap-3.5 p-5">
            <span className="text-xs text-tenue">{plan.codigo} · {plan.nombre}</span>
            <h2 className="m-0 -mt-2 text-[22px] font-semibold">{plan.descripcion}</h2>
            <div className="text-[13px] font-semibold text-suave">Historial de ajustes de frecuencia</div>
            <div className="flex flex-wrap items-center gap-2">
              {(hist ?? []).filter((h) => !h.fecha_nueva).map((h) => <span key={h.id} className="flex items-center gap-2"><Insignia>Cada {h.valor_anterior} {UNIDADES[h.unidad_anterior]}</Insignia><span className="text-[#8c8174]">→</span></span>)}
              <Insignia t="primario">{frecTxt(plan)}</Insignia>
            </div>
            {(hist ?? []).filter((h) => h.motivo && !h.fecha_nueva).slice(-1).map((h) => <p key={h.id} className="m-0 text-sm leading-relaxed text-texto-2">{h.motivo}</p>)}
            <div className="flex gap-3">
              <div className="flex-1 rounded-2xl bg-fondo p-3.5"><div className="text-xs text-suave">Última</div><div className="text-lg font-semibold">{fmtFecha(plan.ultima_ejecucion)}</div></div>
              <div className="flex-1 rounded-2xl bg-fondo p-3.5"><div className="text-xs text-suave">Próxima</div><div className="text-lg font-semibold">{fmtFecha(plan.proxima_fecha)}</div></div>
            </div>
            {puede('referente', 'supervisor') && (
              <div className="flex flex-col gap-2.5 border-t border-linea pt-3.5">
                <span className="text-[13px] font-semibold">Ajustar frecuencia</span>
                <div className="flex flex-wrap items-end gap-2.5">
                  <label className="flex flex-[0_1_130px] flex-col gap-1.5 text-xs text-suave">Cada ({UNIDADES[plan.frecuencia_unidad]})
                    <input className="campo min-h-[42px] rounded-xl" type="number" min={1} value={valor} onChange={(e) => setValor(e.target.value)} /></label>
                  <label className="flex flex-[1_1_180px] flex-col gap-1.5 text-xs text-suave">Motivo
                    <input className="campo min-h-[42px] rounded-xl" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: en la inspección estaba en buen estado" /></label>
                </div>
                <Boton className="self-start" cargando={guardando} onClick={() => void aplicar()}>Aplicar nueva frecuencia</Boton>
                <span className="text-xs text-tenue">Queda registrado en el historial y el calendario se reprograma solo.</span>
              </div>
            )}
          </section>
        )}
      </div>
      {plan ? (
        <Tarjeta className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-col gap-1"><H2 texto={`Plan ${anio} de ${plan.codigo}`} /><span className="text-[13px] text-suave">{plan.nombre} · {delEquipo.reduce((s, t) => s + fechasDelAnio(t).length, 0)} intervenciones en el año</span></div>
            <div className="flex flex-wrap items-center gap-3.5 text-xs text-suave">
              <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-[#8c8174]" />Hecha</span>
              <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-acento" />Esta semana</span>
              <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border-2 border-[#8c8174]" />Programada</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-[860px] flex-col">
              <div className="grid text-xs font-semibold text-suave" style={{ gridTemplateColumns: '220px repeat(12, minmax(0,1fr))' }}><span />{MES.map((m) => <span key={m} className="text-center">{m}</span>)}</div>
              {delEquipo.map((t) => {
                const fechas = fechasDelAnio(t)
                return (
                  <div key={t.id} className="grid items-stretch border-t border-linea-2" style={{ gridTemplateColumns: '220px repeat(12, minmax(0,1fr))' }}>
                    <button className="flex flex-col gap-0.5 py-3.5 pr-3 text-left" disabled={!puede('referente', 'supervisor')} onClick={() => setEditarT({ t })}><span className="text-sm font-semibold">{t.descripcion}</span><span className="text-xs text-tenue">{frecTxt(t)} · próxima {fmtFecha(t.proxima_fecha)}{puede('referente', 'supervisor') && <span className="text-primario"> · editar</span>}</span></button>
                    {MES.map((_, m) => (
                      <span key={m} className="flex flex-wrap items-center justify-center gap-1 border-l border-linea-2">
                        {fechas.filter((f) => Number(f.slice(5, 7)) === m + 1).map((f) => {
                          const estaSemana = f >= lunesHoy && f <= sumarDias(lunesHoy, 6)
                          const futura = f >= hoyIso && f >= t.proxima_fecha
                          return puede('referente', 'supervisor') && futura
                            ? <button key={f} title={`${fmtFecha(f)} · tocá para cambiar la fecha o la frecuencia`} onClick={() => setEditarT({ t, f })} className={`h-3.5 w-3.5 rounded hover:ring-2 hover:ring-primario ${estaSemana ? 'bg-acento' : 'border-2 border-[#8c8174]'}`} />
                            : <span key={f} title={fmtFecha(f)} className={`h-3.5 w-3.5 rounded ${estaSemana ? 'bg-acento' : f < hoyIso ? 'bg-[#8c8174]' : 'border-2 border-[#8c8174]'}`} />
                        })}
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </Tarjeta>
      ) : <div className="rounded-tarjeta border-[1.5px] border-dashed border-borde-campo bg-white px-5 py-4 text-sm text-suave">Tocá un equipo de la tabla para ver el detalle de su plan, el historial de frecuencias y su calendario anual.</div>}
      {editarT && <EditarTarea t={editarT.t} fechaSugerida={editarT.f} onCerrar={() => setEditarT(null)} onListo={() => { setEditarT(null); void recargar() }} />}
    </>
  )
}
