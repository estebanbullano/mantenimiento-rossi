import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fmtFecha, fmtNum, numOT, useDatos } from '@/lib/util'
import type { Orden } from '@/lib/tipos'
import { H2, Insignia, InsEstadoOT, Tarjeta } from './ui'
import { Foto } from './selectores'

interface Rep { orden_id: string; texto: string; cantidad: number; articulo_id: string | null }
interface Herr { orden_id: string; texto: string }
interface FotoC { orden_id: string; ruta: string }
const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const horas = (min: number) => min >= 60 ? `${fmtNum(min / 60, 1)} h` : `${Math.round(min)} min`

/** Historial completo de una máquina con tendencias de los últimos 12 meses */
export function HistorialEquipo({ ordenes }: { ordenes: Orden[] }) {
  const nav = useNavigate()
  const cerradas = ordenes.filter((o) => o.estado === 'completada' && o.completada_en)
  const noHechas = ordenes.filter((o) => o.estado === 'no_realizada')
  const ids = cerradas.map((o) => o.id)
  const { data } = useDatos(async () => {
    if (!ids.length) return { data: { reps: [] as Rep[], herr: [] as Herr[], fotos: [] as FotoC[] }, error: null }
    const [r, h, f] = await Promise.all([
      supabase.from('mant_ot_repuestos').select('orden_id,texto,cantidad,articulo_id').in('orden_id', ids),
      supabase.from('mant_ot_herramientas').select('orden_id,texto').in('orden_id', ids),
      supabase.from('mant_ot_fotos').select('orden_id,ruta').in('orden_id', ids).eq('tipo', 'cierre')
    ])
    return { data: { reps: (r.data ?? []) as Rep[], herr: (h.data ?? []) as Herr[], fotos: (f.data ?? []) as FotoC[] }, error: r.error }
  }, [ids.join()])

  const t = useMemo(() => {
    const hoy = new Date()
    const meses = Array.from({ length: 12 }, (_, i) => { const d = new Date(hoy.getFullYear(), hoy.getMonth() - 11 + i, 1); return { k: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, l: MES[d.getMonth()], prev: 0, corr: 0, min: 0 } })
    for (const o of cerradas) {
      const m = meses.find((x) => x.k === o.completada_en!.slice(0, 7))
      if (!m) continue
      if (o.tipo === 'preventiva') m.prev++; else m.corr++
      m.min += o.tiempo_real_min ?? 0
    }
    const corr = cerradas.filter((o) => o.tipo === 'correctiva').sort((a, b) => a.completada_en!.localeCompare(b.completada_en!))
    const gaps = corr.slice(1).map((o, i) => (new Date(o.completada_en!).getTime() - new Date(corr[i].completada_en!).getTime()) / 86400000)
    const mtbf = gaps.length ? gaps.reduce((s, x) => s + x, 0) / gaps.length : null
    const mttr = corr.length ? corr.reduce((s, o) => s + (o.tiempo_real_min ?? 0), 0) / corr.length : null
    const total = cerradas.reduce((s, o) => s + (o.tiempo_real_min ?? 0), 0)
    // tendencia: fallas de los últimos 3 meses contra los 3 anteriores
    const ult = meses.slice(-3).reduce((s, m) => s + m.corr, 0), ant = meses.slice(-6, -3).reduce((s, m) => s + m.corr, 0)
    return { meses, mtbf, mttr, total, corr: corr.length, prev: cerradas.length - corr.length, tendencia: ult - ant, maxN: Math.max(1, ...meses.map((m) => m.prev + m.corr)), maxMin: Math.max(1, ...meses.map((m) => m.min)) }
  }, [cerradas])

  const topRep = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data?.reps ?? []) m.set(r.texto, (m.get(r.texto) ?? 0) + Number(r.cantidad))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [data])
  const topHerr = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of data?.herr ?? []) { const k = h.texto.toLowerCase(); m.set(k, (m.get(k) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [data])

  const dato = (k: string, v: string, sub?: string, color?: string) => (
    <div className="flex flex-col gap-1 rounded-2xl bg-fondo p-3.5">
      <span className="text-xs text-suave">{k}</span>
      <span className="text-[24px] font-semibold leading-none" style={{ color }}>{v}</span>
      {sub && <span className="text-xs text-tenue">{sub}</span>}
    </div>
  )

  return (
    <Tarjeta className="flex flex-col gap-4 lg:col-span-3">
      <H2 texto="Historial y tendencias de la máquina" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {dato('Intervenciones', String(cerradas.length), `${t.prev} preventivas · ${t.corr} correctivas`)}
        {dato('Fallas (correctivas)', String(t.corr), t.tendencia > 0 ? `↑ ${t.tendencia} más que el trimestre anterior` : t.tendencia < 0 ? `↓ ${-t.tendencia} menos que el trimestre anterior` : 'estable', t.tendencia > 0 ? '#b3141a' : t.tendencia < 0 ? '#1e6b3a' : undefined)}
        {dato('Tiempo entre fallas', t.mtbf != null ? `${fmtNum(t.mtbf)} d` : '—', 'MTBF promedio')}
        {dato('Tiempo de reparación', t.mttr != null ? horas(t.mttr) : '—', 'MTTR promedio')}
        {dato('Horas de mantenimiento', horas(t.total), 'tiempo real acumulado')}
        {dato('Preventivo', cerradas.length ? `${Math.round((t.prev / cerradas.length) * 100)}%` : '—', 'de las intervenciones', '#24508f')}
        {dato('No realizadas', String(noHechas.length), noHechas.length ? `${noHechas.filter((o) => o.no_realizada_motivo === 'maquina_parada').length} por máquina parada` : 'ninguna', noHechas.length ? '#8a5a00' : undefined)}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-2">
          <span className="text-[13px] font-semibold">Intervenciones por mes · últimos 12 meses</span>
          <div className="grid h-[150px] grid-cols-12 items-end gap-1.5">
            {t.meses.map((m) => (
              <div key={m.k} className="flex h-full flex-col items-center justify-end gap-1" title={`${m.l}: ${m.prev} preventivas, ${m.corr} correctivas, ${horas(m.min)}`}>
                <span className="text-[11px] font-semibold">{m.prev + m.corr || ''}</span>
                <span className="flex w-full max-w-[34px] flex-col-reverse overflow-hidden rounded-t-lg" style={{ height: `${((m.prev + m.corr) / t.maxN) * 110}px` }}>
                  <span style={{ height: `${m.prev + m.corr ? (m.prev / (m.prev + m.corr)) * 100 : 0}%`, background: '#5b84c4' }} />
                  <span style={{ height: `${m.prev + m.corr ? (m.corr / (m.prev + m.corr)) * 100 : 0}%`, background: '#d9a21b' }} />
                </span>
                <span className="text-[11px] text-suave">{m.l}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3.5 text-xs text-suave">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-azul" />Preventivas</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-ambar" />Correctivas (fallas)</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Repuestos que más usa</span>
            {topRep.length === 0 ? <span className="text-[13px] text-tenue">Todavía sin datos.</span> : topRep.map(([n, c]) => (
              <span key={n} className="flex justify-between gap-2 border-b border-linea-2 pb-1 text-[13px]"><span className="truncate">{n}</span><b>{fmtNum(c)}</b></span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Herramientas que se usan</span>
            {topHerr.length === 0 ? <span className="text-[13px] text-tenue">Todavía sin datos.</span> : <span className="flex flex-wrap gap-1.5">{topHerr.map(([n, c]) => <Insignia key={n}>{n} · {c}</Insignia>)}</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Todas las intervenciones ({ordenes.length})</span>
        {ordenes.length === 0 && <span className="text-sm text-suave">Sin órdenes todavía.</span>}
        {ordenes.map((o) => {
          const foto = data?.fotos.filter((f) => f.orden_id === o.id).at(-1)
          const reps = data?.reps.filter((r) => r.orden_id === o.id) ?? []
          const herr = data?.herr.filter((h) => h.orden_id === o.id) ?? []
          return (
            <button key={o.id} onClick={() => nav(`/ordenes/${o.id}`)} className="flex gap-3 rounded-2xl border border-linea bg-white p-3 text-left hover:bg-crema">
              {foto ? <Foto ruta={foto.ruta} sinEnlace className="h-[72px] w-[72px] shrink-0" /> : <span className="rayado h-[72px] w-[72px] shrink-0 rounded-[14px]" />}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-xs text-tenue">
                  <span>{fmtFecha(o.completada_en?.slice(0, 10) ?? o.fecha_programada)} · {numOT(o.numero)}</span>
                  <Insignia t={o.tipo === 'preventiva' ? 'azul' : 'amarillo'}>{o.tipo === 'preventiva' ? 'Preventiva' : 'Correctiva'}</Insignia>
                  <InsEstadoOT e={o.estado} vencida={o.vencida} motivo={o.no_realizada_motivo} />
                </span>
                <span className="text-[15px] font-semibold leading-snug">{o.titulo}</span>
                <span className="text-[13px] text-suave">{o.asignado_nombre ?? '—'}{o.tiempo_real_min ? ` · ${horas(o.tiempo_real_min)}` : ''}{reps.length ? ` · ${reps.map((r) => `${fmtNum(r.cantidad)} × ${r.texto}`).join(', ')}` : ''}{herr.length ? ` · ${herr.map((h) => h.texto).join(', ')}` : ''}</span>
                {o.comentario_cierre && <span className={`line-clamp-2 text-[13px] italic ${o.estado === 'no_realizada' ? 'text-pendiente' : 'text-texto-2'}`}>“{o.comentario_cierre}”</span>}
              </span>
            </button>
          )
        })}
      </div>
    </Tarjeta>
  )
}
