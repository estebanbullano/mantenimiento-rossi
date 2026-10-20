import { supabase } from '@/lib/supabase'
import { fmtFecha, fmtMin, lunesDe, semanaISO, sumarDias, useDatos } from '@/lib/util'
import { Cargando, ErrorBox, Kpi, Pagina, Tarjeta } from '@/components/ui'

interface Semana { semana: string; preventivas: number; preventivas_ok: number; correctivas: number; correctivas_ok: number; mttr_min: number | null }
interface Top { equipo_codigo: string; equipo_nombre: string; n: number; minutos: number }

/** Tablero básico: cumplimiento del preventivo, correctivos, tiempo medio de reparación */
export function Indicadores() {
  const desde = sumarDias(lunesDe(new Date()), -7 * 11)
  const { data, cargando, error } = useDatos(async () => {
    const [s, c] = await Promise.all([
      supabase.from('mant_v_indicadores_semana').select('*').gte('semana', desde).order('semana'),
      supabase.from('mant_v_ordenes').select('equipo_codigo, equipo_nombre, tiempo_real_min').eq('tipo', 'correctiva').eq('estado', 'completada')
        .gte('completada_en', new Date(Date.now() - 90 * 86400000).toISOString()).not('equipo_codigo', 'is', null)
    ])
    const m = new Map<string, Top>()
    for (const o of (c.data ?? []) as { equipo_codigo: string; equipo_nombre: string; tiempo_real_min: number | null }[]) {
      const v = m.get(o.equipo_codigo) ?? { equipo_codigo: o.equipo_codigo, equipo_nombre: o.equipo_nombre, n: 0, minutos: 0 }
      v.n++; v.minutos += o.tiempo_real_min ?? 0; m.set(o.equipo_codigo, v)
    }
    // completa semanas sin datos para que el gráfico no salte
    const porSemana = new Map(((s.data ?? []) as Semana[]).map((x) => [x.semana.slice(0, 10), x]))
    const semanas = Array.from({ length: 12 }, (_, i) => sumarDias(desde, i * 7)).map((d) =>
      porSemana.get(d) ?? { semana: d, preventivas: 0, preventivas_ok: 0, correctivas: 0, correctivas_ok: 0, mttr_min: null })
    return { data: { semanas, top: [...m.values()].sort((a, b) => b.n - a.n).slice(0, 10) }, error: s.error || c.error }
  })

  if (cargando) return <Cargando />
  const sem = data?.semanas ?? []
  const ultimas4 = sem.slice(-4)
  const prev = ultimas4.reduce((a, s) => [a[0] + s.preventivas, a[1] + s.preventivas_ok], [0, 0])
  const corr = ultimas4.reduce((a, s) => a + s.correctivas, 0)
  const mttrs = ultimas4.filter((s) => s.mttr_min != null)
  const mttr = mttrs.length ? Math.round(mttrs.reduce((a, s) => a + Number(s.mttr_min), 0) / mttrs.length) : null
  const maxCorr = Math.max(1, ...sem.map((s) => s.correctivas))

  return (
    <Pagina titulo="Indicadores" subtitulo="Últimas 12 semanas. Los datos salen de las órdenes cerradas en la plataforma.">
      <ErrorBox texto={error} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Cumplimiento preventivo (4 sem.)" valor={prev[0] ? `${Math.round((prev[1] / prev[0]) * 100)}%` : '—'} detalle={`${prev[1]} de ${prev[0]} órdenes`} />
        <Kpi titulo="Correctivos (4 sem.)" valor={corr} />
        <Kpi titulo="Tiempo medio de reparación" valor={fmtMin(mttr)} detalle="Correctivos cerrados, últimas 4 semanas" />
        <Kpi titulo="Relación prev. / corr." valor={corr ? (prev[0] / corr).toFixed(1) : '—'} detalle="Más alto es mejor" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Cumplimiento del preventivo por semana">
          <div className="flex h-48 items-end gap-1.5">
            {sem.map((s) => {
              const pct = s.preventivas ? (s.preventivas_ok / s.preventivas) * 100 : 0
              return (
                <div key={s.semana} className="flex flex-1 flex-col items-center gap-1" title={`S${semanaISO(s.semana)} (${fmtFecha(s.semana)}): ${s.preventivas_ok}/${s.preventivas}`}>
                  <span className="text-[10px] font-bold">{s.preventivas ? `${Math.round(pct)}%` : ''}</span>
                  <div className="flex w-full flex-1 items-end rounded bg-fondo-2"><div className={`w-full rounded ${pct >= 90 ? 'bg-aprobado' : pct >= 70 ? 'bg-pendiente' : 'bg-primario'}`} style={{ height: `${pct}%` }} /></div>
                  <span className="text-[10px] text-suave">S{semanaISO(s.semana)}</span>
                </div>
              )
            })}
          </div>
        </Tarjeta>
        <Tarjeta titulo="Correctivos por semana">
          <div className="flex h-48 items-end gap-1.5">
            {sem.map((s) => (
              <div key={s.semana} className="flex flex-1 flex-col items-center gap-1" title={`S${semanaISO(s.semana)}: ${s.correctivas} correctivos`}>
                <span className="text-[10px] font-bold">{s.correctivas || ''}</span>
                <div className="flex w-full flex-1 items-end"><div className="w-full rounded bg-revision/80" style={{ height: `${(s.correctivas / maxCorr) * 100}%` }} /></div>
                <span className="text-[10px] text-suave">S{semanaISO(s.semana)}</span>
              </div>
            ))}
          </div>
        </Tarjeta>
        <Tarjeta titulo="Equipos con más correctivos (90 días)" className="lg:col-span-2">
          {!data?.top.length ? <p className="text-sm text-suave">Sin correctivos cerrados en los últimos 90 días.</p> : (
            <table className="tabla -m-4 w-[calc(100%+2rem)]">
              <thead><tr><th>Equipo</th><th>Nombre</th><th>Correctivos</th><th>Horas de reparación</th><th>Tiempo medio</th></tr></thead>
              <tbody>
                {data.top.map((t) => (
                  <tr key={t.equipo_codigo}><td className="font-bold">{t.equipo_codigo}</td><td>{t.equipo_nombre}</td><td>{t.n}</td><td>{(t.minutos / 60).toFixed(1)}</td><td>{fmtMin(Math.round(t.minutos / t.n))}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
      </div>
    </Pagina>
  )
}
