import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { usePlantas } from '@/lib/catalogos'
import { fmtFecha, fmtFrecuencia, fmtNum, lunesDe, numOT, semanaISO, sumarDias, sumarFrecuencia, useDatos } from '@/lib/util'
import { UNIDADES, type Clasificacion, type Orden, type Tarea } from '@/lib/tipos'
import { Boton, Cargando, ErrorBox, InsCriticidad, InsEstadoOT, Pagina, Pestanas, Tarjeta, Vacio, useAviso } from '@/components/ui'

type Vista = 'semana' | 'anual' | 'repuestos'
type TareaEq = Tarea & { equipo: { codigo: string; nombre: string; planta_id: string } | null }
const etiq = (t: TareaEq) => t.equipo?.codigo ?? t.unidad ?? 'Ronda'

export function Preventivo() {
  const [vista, setVista] = useState<Vista>('semana')
  return (
    <Pagina titulo="Plan preventivo" subtitulo="Las órdenes se generan solas desde la frecuencia de cada tarea.">
      <Pestanas valor={vista} onCambio={setVista} opciones={[['semana', 'Plan semanal'], ['anual', 'Calendario anual'], ['repuestos', 'Repuestos del preventivo']]} />
      {vista === 'semana' && <PlanSemanal />}
      {vista === 'anual' && <CalendarioAnual />}
      {vista === 'repuestos' && <RepuestosPreventivo />}
    </Pagina>
  )
}

function PlanSemanal() {
  const nav = useNavigate()
  const avisar = useAviso()
  const { puede } = useSesion()
  const [lunes, setLunes] = useState(lunesDe(new Date()))
  const [generando, setGenerando] = useState(false)

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

  async function generar() {
    setGenerando(true)
    const { data: n, error } = await supabase.rpc('mant_generar_semana', { p_lunes: lunes })
    setGenerando(false)
    if (error) avisar(mensajeError(error), 'error')
    else { avisar(n ? `Se generaron ${n} órdenes preventivas.` : 'No había tareas nuevas para generar.'); void recargar() }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Boton variante="secundario" onClick={() => setLunes(sumarDias(lunes, -7))}>‹</Boton>
        <div className="rounded-lg border border-borde bg-white px-4 py-2 text-sm font-bold">S{semanaISO(lunes)} · {fmtFecha(lunes)} al {fmtFecha(sumarDias(lunes, 6))}</div>
        <Boton variante="secundario" onClick={() => setLunes(sumarDias(lunes, 7))}>›</Boton>
        {puede('referente', 'supervisor') && <Boton className="ml-auto" cargando={generando} onClick={() => void generar()}>Generar órdenes de la semana{faltan.length ? ` (${faltan.length})` : ''}</Boton>}
      </div>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data ? null : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Tarjeta titulo={`Órdenes de la semana (${data!.ordenes.length})`} className="lg:col-span-2">
            {!data!.ordenes.length ? <Vacio texto="Todavía no se generaron órdenes para esta semana." /> : (
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
