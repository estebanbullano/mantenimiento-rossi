import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { fmtNum, hoy, numOT, subirArchivo, urlFirmada, useDatos } from '@/lib/util'
import type { Articulo, Orden, OtItem } from '@/lib/tipos'
import { Boton, Cargando, CRIT, ErrorBox, Insignia, InsEstadoOT, OkBox, Vacio, useAviso } from '@/components/ui'
import { CargaFoto, PantallaCelular } from '@/components/Celular'
import { MarcoTelefono } from './Solicitante'

const PESO = { urgente: 0, alta: 1, media: 2, baja: 3 }
const durTxt = (h?: number | null) => h ? `${fmtNum(h / 8, h % 8 ? 2 : 0).replace(/,?0+$/, '')} día${h / 8 === 1 ? '' : 's'}` : 'sin estimar'

export function CritTipo({ o }: { o: Orden }) {
  const c = o.equipo_clasificacion
  const tipo = o.tipo === 'preventiva' ? 'Preventiva' : 'Correctiva'
  return c ? <Insignia t={CRIT[c][0]}>{CRIT[c][1]} · {tipo}</Insignia> : <Insignia t={o.tipo === 'preventiva' ? 'azul' : 'amarillo'}>{tipo}</Insignia>
}

/** Celular del operario: solo sus tareas abiertas, primero las de hoy */
export function MisTareas() {
  const { usuario } = useSesion()
  const nav = useNavigate()
  const { data, cargando, error } = useDatos(async () => {
    const r = await supabase.from('mant_v_ordenes').select('*').eq('asignado_id', usuario!.id)
      .in('estado', ['pendiente', 'en_proceso']).order('fecha_programada')
    return { data: (r.data ?? []) as Orden[], error: r.error }
  }, [usuario?.id])

  const orden = (a: Orden, b: Orden) => PESO[a.prioridad] - PESO[b.prioridad] || (a.fecha_programada ?? '').localeCompare(b.fecha_programada ?? '')
  const deHoy = (data ?? []).filter((o) => !o.fecha_programada || o.fecha_programada <= hoy()).sort(orden)
  const proximas = (data ?? []).filter((o) => o.fecha_programada && o.fecha_programada > hoy()).sort(orden)
  const fecha = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  const tarjeta = (o: Orden) => (
    <button key={o.id} onClick={() => nav(`/ordenes/${o.id}`)} className="flex flex-col gap-2 rounded-[18px] border border-borde bg-white p-3.5 text-left text-texto active:scale-[0.99]">
      <span className="flex w-full justify-between gap-2"><CritTipo o={o} /><InsEstadoOT e={o.estado} vencida={!!o.fecha_programada && o.fecha_programada < hoy()} /></span>
      <span className="text-base font-semibold leading-snug">{o.titulo}</span>
      <span className="text-[13px] text-suave">{o.equipo_codigo ?? o.tarea_unidad ?? 'Sin equipo'} · {numOT(o.numero)} · {durTxt(o.duracion_estimada_horas)}</span>
    </button>
  )

  return (
    <MarcoTelefono>
      <PantallaCelular titulo="Mis tareas de hoy"
        derecha={usuario?.turno ? <span className="rounded-full bg-fondo px-2.5 py-1 text-xs font-medium">Turno {usuario.turno.toLowerCase()}</span> : undefined}
        sub={`${usuario?.nombre?.split(' ')[0] ?? ''} · ${fecha}`}>
        <ErrorBox texto={error} />
        {cargando && !data ? <Cargando /> : (
          <div className="flex flex-col gap-3">
            {deHoy.length === 0 && <Vacio texto="No tenés tareas para hoy." />}
            {deHoy.map(tarjeta)}
            {proximas.length > 0 && <div className="pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-tenue">Próximos días</div>}
            {proximas.map(tarjeta)}
            <div className="pt-1 text-center text-xs text-tenue">Solo ves las tareas de tu turno.</div>
          </div>
        )}
      </PantallaCelular>
    </MarcoTelefono>
  )
}

interface FotoOT { id: string; ruta: string; tipo: string }
interface Fila { q: string; n: string }

/** Detalle de la tarea en el celular: checklist, foto obligatoria, tiempo real y repuestos */
export function TareaCelular() {
  const { id } = useParams()
  const nav = useNavigate()
  const avisar = useAviso()
  const { usuario } = useSesion()
  const { data, cargando, error, recargar, setData } = useDatos(async () => {
    const [o, f, it] = await Promise.all([
      supabase.from('mant_v_ordenes').select('*').eq('id', id!).maybeSingle(),
      supabase.from('mant_ot_fotos').select('*').eq('orden_id', id!).eq('tipo', 'cierre').order('creado_en'),
      supabase.from('mant_ot_items').select('*').eq('orden_id', id!).order('orden')
    ])
    return { data: { orden: o.data as Orden | null, fotos: (f.data ?? []) as FotoOT[], items: (it.data ?? []) as OtItem[] }, error: o.error || f.error }
  }, [id])
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [tReal, setTReal] = useState('')
  const [filas, setFilas] = useState<Fila[]>([{ q: '1', n: '' }])
  const [sugeridos, setSugeridos] = useState<Articulo[]>([])
  const [cerrando, setCerrando] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const o = data?.orden
  const abierta = !!o && (o.estado === 'pendiente' || o.estado === 'en_proceso')
  const puede = abierta && (o.asignado_id === usuario?.id || ['referente', 'supervisor', 'admin'].includes(usuario?.rol ?? ''))
  const foto = data?.fotos.at(-1)

  useEffect(() => { if (foto) void urlFirmada(foto.ruta).then(setFotoUrl); else setFotoUrl(null) }, [foto])
  useEffect(() => { if (o && !tReal) setTReal(o.tiempo_real_min ? String(Math.round(o.tiempo_real_min / 6) / 10).replace('.', ',') : o.duracion_estimada_horas ? String(o.duracion_estimada_horas).replace('.', ',') : '') }, [o]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sugerencias del pañol para el último repuesto que se está escribiendo
  const buscando = filas.at(-1)?.n ?? ''
  useEffect(() => {
    const t = buscando.trim()
    if (t.length < 3) { setSugeridos([]); return }
    const h = setTimeout(async () => {
      const r = await supabase.from('mant_articulos').select('*').eq('activo', true).ilike('descripcion', `%${t}%`).limit(12)
      setSugeridos((r.data ?? []) as Articulo[])
    }, 250)
    return () => clearTimeout(h)
  }, [buscando])
  const porNombre = useMemo(() => new Map(sugeridos.map((a) => [a.descripcion.toLowerCase(), a])), [sugeridos])

  async function tildar(item: OtItem, hecho: boolean) {
    setData((d) => d ? { ...d, items: d.items.map((x) => (x.id === item.id ? { ...x, hecho } : x)) } : d)
    const { error } = await supabase.from('mant_ot_items').update({ hecho }).eq('id', item.id)
    if (error) { avisar(mensajeError(error), 'error'); void recargar() }
  }

  async function subirFoto(f: File) {
    setSubiendo(true)
    try {
      const ruta = await subirArchivo(`ot/${id}`, f)
      const { error } = await supabase.from('mant_ot_fotos').insert({ orden_id: id, ruta, tipo: 'cierre' })
      if (error) throw error
      await recargar()
    } catch (e) { avisar(mensajeError(e), 'error') }
    setSubiendo(false)
  }
  async function quitarFoto() {
    if (!foto) return
    const { error } = await supabase.from('mant_ot_fotos').delete().eq('id', foto.id)
    if (error) avisar(mensajeError(error), 'error'); else void recargar()
  }

  async function cerrar() {
    const horas = Number(tReal.replace(',', '.'))
    if (!horas || horas <= 0) return setErr('Indicá el tiempo real en horas (ej.: 1,5).')
    setErr(null); setCerrando(true)
    try {
      const reps = filas.filter((f) => f.n.trim())
      if (reps.length) {
        const { error } = await supabase.from('mant_ot_repuestos').insert(reps.map((f) => ({
          orden_id: id, texto: f.n.trim(), cantidad: Number(f.q.replace(',', '.')) || 1,
          articulo_id: porNombre.get(f.n.trim().toLowerCase())?.id ?? null
        })))
        if (error) throw error
      }
      const { error } = await supabase.from('mant_ordenes').update({ estado: 'completada', tiempo_real_min: Math.round(horas * 60) }).eq('id', id!)
      if (error) throw error
      setFilas([{ q: '1', n: '' }])
      await recargar()
    } catch (e) { setErr(mensajeError(e)) }
    setCerrando(false)
  }

  if (cargando && !data) return <MarcoTelefono><Cargando /></MarcoTelefono>
  if (!o) return <MarcoTelefono><div className="p-5"><ErrorBox texto={error ?? 'La tarea no existe o no tenés acceso.'} /></div></MarcoTelefono>

  return (
    <MarcoTelefono>
      <PantallaCelular titulo="Mis tareas de hoy" derecha={o.turno ? <span className="rounded-full bg-fondo px-2.5 py-1 text-xs font-medium">Turno {o.turno.toLowerCase()}</span> : undefined}>
        <div className="flex flex-col gap-3.5">
          <button onClick={() => nav('/tareas')} className="self-start rounded-full bg-fondo px-3.5 py-2 text-[13px] font-medium text-texto">← Mis tareas</button>
          <div className="flex flex-col gap-1.5">
            <span><CritTipo o={o} /></span>
            <div className="text-xl font-semibold leading-tight">{o.titulo}</div>
            <div className="text-[13px] text-suave">{o.equipo_codigo ?? 'Sin equipo'} · {numOT(o.numero)} · estimado {durTxt(o.duracion_estimada_horas)}</div>
          </div>

          {data.items.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Checklist</span>
              {data.items.map((c) => (
                <label key={c.id} className="flex items-start gap-2.5 rounded-[14px] bg-fondo px-3 py-[11px] text-sm leading-snug">
                  <input type="checkbox" className="m-0 h-5 w-5 shrink-0 accent-primario" checked={c.hecho} disabled={!puede} onChange={(e) => void tildar(c, e.target.checked)} />
                  <span>{c.descripcion}{c.detalle && <span className="block text-xs text-tenue">{c.detalle}</span>}</span>
                </label>
              ))}
            </div>
          )}

          {(o.observacion || (o.tipo === 'correctiva' && o.descripcion)) && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">{o.observacion ? 'Observación de quien asignó' : 'Lo que reportaron'}</span>
              <div className="whitespace-pre-wrap rounded-[14px] border border-[#f1d49a] bg-[#fff6e5] px-3.5 py-3 text-sm leading-relaxed">{o.observacion ?? o.descripcion}</div>
              {o.tipo === 'correctiva' && <span className="text-xs leading-snug text-tenue">Los correctivos no tienen checklist fijo porque cada falla es distinta.</span>}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Foto del trabajo terminado <span className="text-primario-oscuro">· obligatoria</span></span>
            {subiendo ? <Cargando texto="Subiendo la foto…" />
              : <CargaFoto archivo={null} url={fotoUrl ?? (foto ? '' : null)} alto="h-[150px]" onArchivo={(f) => void subirFoto(f)} onQuitar={() => void quitarFoto()} />}
          </div>

          {abierta ? (
            <>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">Tiempo real (horas)
                <input className="campo font-normal" inputMode="decimal" value={tReal} onChange={(e) => setTReal(e.target.value)} placeholder="Ej.: 1,5" disabled={!puede} />
              </label>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold">Repuestos usados</span>
                <div className="grid grid-cols-[64px_minmax(0,1fr)_36px] gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-tenue"><span>Cant.</span><span>Repuesto</span><span /></div>
                {filas.map((f, i) => (
                  <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)_36px] items-center gap-1.5">
                    <input className="campo min-h-[44px] rounded-xl px-2 text-center" type="number" min="0" value={f.q} disabled={!puede} aria-label="Cantidad"
                      onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
                    <input className="campo min-h-[44px] rounded-xl" list="rep-pañol" placeholder="Nombre del repuesto" value={f.n} disabled={!puede} aria-label="Nombre del repuesto"
                      onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))} />
                    <button type="button" aria-label="Quitar repuesto" disabled={!puede} className="h-9 w-9 rounded-full bg-fondo text-base text-primario-oscuro"
                      onClick={() => setFilas(filas.length > 1 ? filas.filter((_, j) => j !== i) : [{ q: '1', n: '' }])}>×</button>
                  </div>
                ))}
                <datalist id="rep-pañol">{sugeridos.map((a) => <option key={a.id} value={a.descripcion}>{a.codigo} · stock {a.stock_actual}</option>)}</datalist>
                {puede && <button type="button" className="min-h-[40px] self-start rounded-full border border-dashed border-primario bg-white px-3.5 py-2 text-[13px] font-semibold text-primario-oscuro" onClick={() => setFilas([...filas, { q: '1', n: '' }])}>+ Agregar repuesto</button>}
                <span className="text-xs text-tenue">Si está en el pañol se descuenta solo; si no, el pañolero lo vincula después.</span>
              </div>
              <ErrorBox texto={err} />
              {puede && <Boton grande className="w-full" disabled={!foto || subiendo} cargando={cerrando} onClick={() => void cerrar()}>Cerrar tarea</Boton>}
              {!foto && <div className="text-center text-xs text-tenue">Sin foto no se cierra: subí la foto para habilitar el botón.</div>}
            </>
          ) : (
            <OkBox>Tarea cerrada. {o.tiempo_real_min ? `Tiempo real ${fmtNum(o.tiempo_real_min / 60, 1)} h.` : ''} {o.revision_foto === 'aprobada' ? 'El supervisor aprobó la foto.' : 'La foto queda para revisión del supervisor.'}</OkBox>
          )}
        </div>
      </PantallaCelular>
    </MarcoTelefono>
  )
}
