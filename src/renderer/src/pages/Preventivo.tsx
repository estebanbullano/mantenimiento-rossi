import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { usePlantas } from '@/lib/catalogos'
import { fmtFecha, fmtFrecuencia, fmtNum, lunesDe, numOT, semanaISO, sumarDias, sumarFrecuencia, useDatos } from '@/lib/util'
import { UNIDADES, type Clasificacion, type Orden, type Tarea } from '@/lib/tipos'
import { Boton, Cargando, ErrorBox, H2, Insignia, InsCriticidad, InsEstadoOT, Pagina, Pestanas, Tarjeta, Vacio, useAviso } from '@/components/ui'

type Vista = 'equipo' | 'anual' | 'semana' | 'repuestos'
type TareaEq = Tarea & { equipo: { codigo: string; nombre: string; planta_id: string } | null }
const etiq = (t: TareaEq) => t.equipo?.codigo ?? t.unidad ?? 'Ronda'

export function Preventivo() {
  const [vista, setVista] = useState<Vista>('equipo')
  return (
    <Pagina kicker="Módulo 1 · Planificación" titulo="Planes preventivos"
      acciones={<Pestanas valor={vista} onCambio={setVista} opciones={[['equipo', 'Por equipo'], ['anual', 'Calendario anual'], ['semana', 'Semana'], ['repuestos', 'Repuestos']]} />}>
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

  const { data, cargando, error } = useDatos(async () => {
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
                    <b>{etiq(t)}</b> · {t.descripcion}
                    <div className="text-xs capitalize text-suave">{fmtFrecuencia(t.frecuencia_valor, t.frecuencia_unidad)} · vence {fmtFecha(t.proxima_fecha)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>
      )}
    </>
  )
}

/** Vista equivalente a la planilla RG MA 01: una fila por tarea, una columna por semana */
function CalendarioAnual() {
  const nav = useNavigate()
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [planta, setPlanta] = useState('')
  const { data: pl } = usePlantas()
  const { data, cargando, error } = useDatos(async () => {
    const [t, o, e] = await Promise.all([
      supabase.from('mant_tareas').select('*, equipo:mant_equipos(codigo, nombre, planta_id)').eq('activa', true),
      supabase.from('mant_ordenes').select('tarea_id, semana, estado, completada_en').eq('tipo', 'preventiva')
        .gte('semana', `${anio - 1}-12-25`).lte('semana', `${anio}-12-31`),
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
  const filas = useMemo(() => (data?.tareas ?? []).filter((t) => !planta || t.equipo?.planta_id === planta).map((t) => {
    // Semanas planificadas: proyección desde la próxima fecha según la frecuencia
    const plan = new Set<number>()
    let f = t.proxima_fecha
    for (let i = 0; i < 400 && f <= `${anio}-12-31`; i++) {
      if (f >= `${anio}-01-01`) plan.add(semanaISO(f))
      f = sumarFrecuencia(f, t.frecuencia_valor, t.frecuencia_unidad)
    }
    const hechas = new Set<number>()
    for (const o of data!.ordenes) if (o.tarea_id === t.id && o.estado === 'completada' && o.completada_en?.startsWith(String(anio))) hechas.add(semanaISO(o.completada_en.slice(0, 10)))
    return { t, plan, hechas }
  }), [data, planta, anio])
  const actual = new Date().getFullYear() === anio ? semanaISO(lunesDe(new Date())) : 0

  return (
    <>
      <div className="no-imprimir mb-3 flex flex-wrap items-center gap-2">
        <Boton variante="secundario" onClick={() => setAnio(anio - 1)}>‹</Boton>
        <span className="font-extrabold">{anio}</span>
        <Boton variante="secundario" onClick={() => setAnio(anio + 1)}>›</Boton>
        <select className="campo w-auto" value={planta} onChange={(e) => setPlanta(e.target.value)}>
          <option value="">Todas las plantas y rondas</option>{(pl?.plantas ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
        </select>
        <span className="ml-2 text-xs text-suave"><b className="text-revision">P</b> planificada · <b className="text-aprobado">✓</b> hecha</span>
        <Boton variante="secundario" className="ml-auto" onClick={() => window.print()}>Imprimir</Boton>
      </div>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !filas.length ? <Vacio texto="No hay tareas preventivas cargadas. Se cargan desde la ficha de cada equipo." /> : (
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
              {filas.map(({ t, plan, hechas }) => (
                <tr key={t.id} className="hover:bg-fondo-2/60">
                  <td className="sticky left-0 z-10 border-b border-borde bg-white p-1.5">
                    <button className="text-left" onClick={() => t.equipo_id && nav(`/equipos/${t.equipo_id}`)}>
                      <b>{etiq(t)}</b> {t.equipo_id && <InsCriticidad c={data!.crit.get(t.equipo_id)?.clasificacion} />}{t.turno && !t.equipo_id && <span className="ml-1 text-suave">· {t.turno}</span>}
                      <div className="text-suave">{t.descripcion}</div>
                    </button>
                  </td>
                  <td className="whitespace-nowrap border-b border-borde px-1 text-suave">{t.frecuencia_valor} {UNIDADES[t.frecuencia_unidad].slice(0, 3)}</td>
                  {semanas.map((s) => (
                    <td key={s} className={`border-b border-l border-borde text-center font-bold ${s === actual ? 'bg-primario/5' : ''}`}>
                      {hechas.has(s) ? <span className="text-aprobado">✓</span> : plan.has(s) ? <span className="text-revision">P</span> : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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
type HistFrec = { id: string; tarea_id: string; valor_anterior: number; unidad_anterior: keyof typeof UNIDADES; valor_nuevo: number; unidad_nueva: keyof typeof UNIDADES; motivo: string | null; creado_en: string }
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
              {(hist ?? []).map((h) => <span key={h.id} className="flex items-center gap-2"><Insignia>Cada {h.valor_anterior} {UNIDADES[h.unidad_anterior]}</Insignia><span className="text-[#8c8174]">→</span></span>)}
              <Insignia t="primario">{frecTxt(plan)}</Insignia>
            </div>
            {(hist ?? []).filter((h) => h.motivo).slice(-1).map((h) => <p key={h.id} className="m-0 text-sm leading-relaxed text-texto-2">{h.motivo}</p>)}
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
                    <span className="flex flex-col gap-0.5 py-3.5 pr-3"><span className="text-sm font-semibold">{t.descripcion}</span><span className="text-xs text-tenue">{frecTxt(t)}</span></span>
                    {MES.map((_, m) => (
                      <span key={m} className="flex flex-wrap items-center justify-center gap-1 border-l border-linea-2">
                        {fechas.filter((f) => Number(f.slice(5, 7)) === m + 1).map((f) => {
                          const estaSemana = f >= lunesHoy && f <= sumarDias(lunesHoy, 6)
                          return <span key={f} title={fmtFecha(f)} className={`h-3.5 w-3.5 rounded ${estaSemana ? 'bg-acento' : f < hoyIso ? 'bg-[#8c8174]' : 'border-2 border-[#8c8174]'}`} />
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
    </>
  )
}
