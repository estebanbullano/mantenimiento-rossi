import { useEffect, useState } from 'react'
import { mensajeError, supabase } from '@/lib/supabase'
import type { Config } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, Pagina, Tarjeta, useAviso } from '@/components/ui'
import { useConfig } from './Equipos'

/** Matriz de criticidad configurable: al cambiar un valor, la criticidad de todos los equipos se recalcula sola */
export function Configuracion() {
  const avisar = useAviso()
  const { data, cargando, error, recargar } = useConfig()
  const [f, setF] = useState<Config | null>(null)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => setF(data), [data])

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
  const n = (k: keyof Config) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) })
  return (
    <Pagina titulo="Configuración" subtitulo="Matriz de criticidad (RG MA 03).">
      <ErrorBox texto={error} />
      <Tarjeta titulo="C = (IO × FO) + CM + ISA" className="max-w-2xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Corte de costo (USD)" ayuda="Si el costo de falla lo supera, el CM toma el puntaje alto."><input className="campo" type="number" value={f.corte_costo_usd} onChange={n('corte_costo_usd')} /></Campo>
          <div />
          <Campo etiqueta="CM si supera el corte"><input className="campo" type="number" value={f.cm_supera_corte} onChange={n('cm_supera_corte')} /></Campo>
          <Campo etiqueta="CM si no supera el corte"><input className="campo" type="number" value={f.cm_no_supera_corte} onChange={n('cm_no_supera_corte')} /></Campo>
          <Campo etiqueta="Desde este valor: MC (medio)"><input className="campo" type="number" value={f.umbral_mc} onChange={n('umbral_mc')} /></Campo>
          <Campo etiqueta="Desde este valor: C (crítico)"><input className="campo" type="number" value={f.umbral_c} onChange={n('umbral_c')} /></Campo>
        </div>
        <p className="mt-4 text-xs text-suave">Por debajo del umbral MC el equipo es NC. Los críticos se programan primero en el plan semanal (prioridad alta), los MC con prioridad media y los NC con baja.</p>
        <div className="mt-4"><Boton cargando={guardando} onClick={() => void guardar()}>Guardar</Boton></div>
      </Tarjeta>
    </Pagina>
  )
}
