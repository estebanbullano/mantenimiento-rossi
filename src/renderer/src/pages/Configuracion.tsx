import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useDatos } from '@/lib/util'
import type { Config, Equipo } from '@/lib/tipos'
import { Boton, Cargando, ErrorBox, Pagina, useAviso } from '@/components/ui'
import { calcularCriticidad, useConfig } from './Equipos'

/** Matriz de criticidad configurable: al cambiar un valor, la criticidad de todos los equipos se recalcula sola */
export function Configuracion() {
  const avisar = useAviso()
  const nav = useNavigate()
  const { data, cargando, error, recargar } = useConfig()
  const { data: equipos } = useDatos(async () => {
    const r = await supabase.from('mant_v_equipos').select('id,io,fo,isa,cm_manual,costo_falla_usd,clasificacion_manual').eq('activo', true)
    return { data: (r.data ?? []) as Equipo[], error: r.error }
  })
  const [f, setF] = useState<Config | null>(null)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => setF(data), [data])

  // Vista previa: cómo quedan los equipos con los valores que se están editando
  const conteo = useMemo(() => {
    const c = { C: 0, MC: 0, NC: 0 }
    if (!f) return c
    for (const e of equipos ?? []) { const r = calcularCriticidad(e, f); const cl = e.clasificacion_manual ?? r?.clasificacion; if (cl) c[cl]++ }
    return c
  }, [equipos, f])

  async function guardar() {
    if (!f) return
    setGuardando(true)
    const { error } = await supabase.from('mant_config').update({
      corte_costo_usd: f.corte_costo_usd, cm_supera_corte: f.cm_supera_corte, cm_no_supera_corte: f.cm_no_supera_corte,
      umbral_mc: f.umbral_mc, umbral_c: f.umbral_c, actualizado_en: new Date().toISOString()
    }).eq('id', 1)
    setGuardando(false)
    if (error) avisar(mensajeError(error), 'error'); else { avisar('Matriz actualizada: la criticidad se recalculó.'); void recargar() }
  }

  if (cargando || !f) return <Cargando />
  const fila = (t: string, k: keyof Config) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{t}</span>
      <input className="campo w-[90px] text-center" type="number" value={f[k] as number} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
    </label>
  )
  const tarjeta = (titulo: string, sub: string, hijos: React.ReactNode) => (
    <section className="tarjeta flex flex-[1_1_240px] flex-col gap-3.5 p-5">
      <div><h2 className="m-0 text-lg font-semibold">{titulo}</h2><p className="m-0 mt-1 text-[13px] text-suave">{sub}</p></div>
      {hijos}
    </section>
  )
  return (
    <Pagina kicker="Módulo 1 · Planificación" titulo="Matriz de criticidad">
      <ErrorBox texto={error} />
      <div className="rounded-2xl bg-rojo-claro px-4 py-3 text-sm font-medium text-primario-oscuro">
        La criticidad se recalcula sola: cambiá un valor y mirá cómo se mueven los equipos. Con estos valores: {conteo.C} críticos · {conteo.MC} de media · {conteo.NC} no críticos.
      </div>
      <div className="flex flex-wrap items-stretch gap-4">
        {tarjeta('C = (IO × FO) + CM + ISA', 'Fórmula de la matriz RG MA 03', <>
          <p className="m-0 text-sm leading-relaxed text-texto-2"><b>IO</b> impacto operativo, <b>FO</b> frecuencia de falla e <b>ISA</b> seguridad y ambiente se puntúan en la ficha de cada equipo con la escala de la planilla.</p>
          <p className="m-0 text-sm leading-relaxed text-texto-2">Acá se define el costo de mantenimiento y desde qué puntaje un equipo es crítico.</p>
        </>)}
        {tarjeta('CM · Costo de mantenimiento', 'Puntaje según el corte de costo', <>
          {fila('Corte de costo (USD)', 'corte_costo_usd')}
          {fila('Por encima del corte', 'cm_supera_corte')}
          {fila('Por debajo del corte', 'cm_no_supera_corte')}
        </>)}
        {tarjeta('Clasificación', 'Puntaje desde el que cambia la criticidad', <>
          {fila('MC · Media desde', 'umbral_mc')}
          {fila('C · Crítico desde', 'umbral_c')}
          <span className="text-xs text-tenue">Por debajo de MC el equipo es NC. Los críticos se programan primero (prioridad alta), los MC con media y los NC con baja.</span>
        </>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Boton cargando={guardando} onClick={() => void guardar()}>Guardar cambios</Boton>
        <Boton variante="secundario" onClick={() => nav('/equipos')}>Ver equipos recalculados →</Boton>
      </div>
    </Pagina>
  )
}
