import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { estamparFoto, fmtNum, fmtReloj, numOT, subirArchivo, urlFirmada, useDatos } from '@/lib/util'
import type { Articulo, Orden, OtItem } from '@/lib/tipos'
import { Boton, Cargando, ErrorBox, OkBox, useAviso } from '@/components/ui'
import { PantallaCelular } from '@/components/Celular'
import { Foto } from '@/components/selectores'
import { MarcoTelefono } from './Solicitante'
import { CritTipo, durTxt } from './Operario'

type Reloj = 'sin_iniciar' | 'corriendo' | 'pausada' | 'terminada'
interface FotoOT { id: string; ruta: string; tipo: string; nota: string | null; paso: number | null; creado_en: string; desfase_seg: number | null }
interface Herr { id: string; texto: string }
interface Rep { id: string; texto: string; cantidad: number; articulo_id: string | null }
interface Medio { id: string; tipo: 'audio' | 'video'; ruta: string; transcripcion: string | null; creado_en: string }
interface Paso { id: string; orden: number; texto: string | null; foto_ruta: string | null }
interface Prediccion { ejecuciones: number; minutos_promedio: number | null }

const sec = (titulo: ReactNode, hijos: ReactNode, extra?: ReactNode) => (
  <div className="flex flex-col gap-2">
    <span className="flex flex-wrap items-baseline gap-x-1 text-[13px] font-semibold">{titulo}{extra}</span>
    {hijos}
  </div>
)
const horasTxt = (min: number) => min >= 60 ? `${fmtNum(min / 60, 1)} h` : `${min} min`

/** Botón que abre la cámara (o la galería si se permite) y devuelve el archivo */
function BotonCamara({ texto, onArchivo, video, soloCamara, cargando, clase = '' }:
  { texto: string; onArchivo: (f: File) => void; video?: boolean; soloCamara?: boolean; cargando?: boolean; clase?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept={video ? 'video/*' : 'image/*'} capture={soloCamara ? 'environment' : undefined} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onArchivo(f); e.target.value = '' }} />
      <button type="button" disabled={cargando} onClick={() => ref.current?.click()}
        className={`min-h-[46px] rounded-[14px] bg-white px-3 py-2.5 text-sm font-semibold disabled:opacity-50 ${clase || 'border-[1.5px] border-dashed border-primario text-primario-oscuro'}`}>
        {cargando ? 'Subiendo…' : texto}
      </button>
    </>
  )
}

export function TareaCelular() {
  const { id } = useParams()
  const nav = useNavigate()
  const avisar = useAviso()
  const { usuario } = useSesion()

  const { data, cargando, error, recargar, setData } = useDatos(async () => {
    const o = await supabase.from('mant_v_ordenes').select('*').eq('id', id!).maybeSingle()
    const orden = o.data as Orden | null
    const tareaId = orden?.tarea_id
    const [f, it, h, r, m, rel, min, pasos, pred, trep, therr] = await Promise.all([
      supabase.from('mant_ot_fotos').select('*').eq('orden_id', id!).order('creado_en'),
      supabase.from('mant_ot_items').select('*').eq('orden_id', id!).order('orden'),
      supabase.from('mant_ot_herramientas').select('id,texto').eq('orden_id', id!).order('creado_en'),
      supabase.from('mant_ot_repuestos').select('id,texto,cantidad,articulo_id').eq('orden_id', id!).order('creado_en'),
      supabase.from('mant_ot_medios').select('*').eq('orden_id', id!).order('creado_en'),
      supabase.rpc('mant_ot_reloj', { p_orden: id }),
      supabase.rpc('mant_ot_minutos', { p_orden: id }),
      tareaId ? supabase.from('mant_tarea_pasos').select('id,orden,texto,foto_ruta').eq('tarea_id', tareaId).order('orden') : Promise.resolve({ data: [] }),
      tareaId ? supabase.from('mant_v_tarea_prediccion').select('ejecuciones,minutos_promedio').eq('tarea_id', tareaId).maybeSingle() : Promise.resolve({ data: null }),
      tareaId ? supabase.from('mant_tarea_repuestos').select('cantidad, articulo:mant_articulos(id,codigo,descripcion,stock_actual)').eq('tarea_id', tareaId) : Promise.resolve({ data: [] }),
      tareaId ? supabase.from('mant_tarea_herramientas').select('herramienta:mant_herramientas(id,nombre)').eq('tarea_id', tareaId) : Promise.resolve({ data: [] })
    ])
    return {
      data: {
        orden, fotos: (f.data ?? []) as FotoOT[], items: (it.data ?? []) as OtItem[], herr: (h.data ?? []) as Herr[], reps: (r.data ?? []) as Rep[],
        medios: (m.data ?? []) as Medio[], reloj: (rel.data ?? 'sin_iniciar') as Reloj, minutos: Number(min.data ?? 0), cargadoEn: Date.now(),
        pasos: (pasos.data ?? []) as Paso[], pred: pred.data as Prediccion | null,
        tRep: ((trep.data ?? []) as unknown as { cantidad: number; articulo: Pick<Articulo, 'id' | 'codigo' | 'descripcion' | 'stock_actual'> | null }[]).filter((x) => x.articulo),
        tHerr: ((therr.data ?? []) as unknown as { herramienta: { id: string; nombre: string } | null }[]).map((x) => x.herramienta).filter(Boolean) as { id: string; nombre: string }[]
      },
      error: o.error
    }
  }, [id])

  // Cronómetro: base del servidor + lo que corrió desde que se cargó
  const [ahora, setAhora] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t) }, [])
  const segundos = data ? data.minutos * 60 + (data.reloj === 'corriendo' ? (ahora - data.cargadoEn) / 1000 : 0) : 0

  const [ocupado, setOcupado] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [verProc, setVerProc] = useState(false)
  const [fotoPendiente, setFotoPendiente] = useState<File | null>(null)
  const [notaPaso, setNotaPaso] = useState('')
  const [herrTxt, setHerrTxt] = useState('')
  const [repQ, setRepQ] = useState('1')
  const [repN, setRepN] = useState('')
  const [sugeridos, setSugeridos] = useState<Articulo[]>([])
  const [catalogoHerr, setCatalogoHerr] = useState<string[]>([])
  const [informe, setInforme] = useState('')
  const [informeIni, setInformeIni] = useState(false)

  const o = data?.orden
  const abierta = !!o && (o.estado === 'pendiente' || o.estado === 'en_proceso')
  const puede = abierta && (o.asignado_id === usuario?.id || ['referente', 'supervisor', 'admin'].includes(usuario?.rol ?? ''))
  const fotosPaso = data?.fotos.filter((f) => f.tipo === 'paso') ?? []
  const fotoFinal = data?.fotos.filter((f) => f.tipo === 'cierre').at(-1)
  const iniciada = data?.reloj === 'corriendo' || data?.reloj === 'pausada'

  useEffect(() => { if (o && !informeIni) { setInforme(o.comentario_cierre ?? ''); setInformeIni(true) } }, [o, informeIni])
  useEffect(() => { void supabase.from('mant_herramientas').select('nombre').eq('activo', true).order('nombre').limit(500).then((r) => setCatalogoHerr(((r.data ?? []) as { nombre: string }[]).map((x) => x.nombre))) }, [])
  useEffect(() => {
    const t = repN.trim()
    if (t.length < 3) { setSugeridos([]); return }
    const h = setTimeout(async () => {
      const r = await supabase.from('mant_articulos').select('*').eq('activo', true).ilike('descripcion', `%${t}%`).limit(12)
      setSugeridos((r.data ?? []) as Articulo[])
    }, 250)
    return () => clearTimeout(h)
  }, [repN])

  async function hacer(clave: string, fn: () => PromiseLike<{ error: unknown }>, ok?: string) {
    setOcupado(clave); setErr(null)
    const { error } = await fn()
    setOcupado(null)
    if (error) { setErr(mensajeError(error)); return false }
    if (ok) avisar(ok)
    await recargar(); return true
  }
  const marcar = (tipo: 'inicio' | 'pausa' | 'reanudar') =>
    hacer(tipo, () => supabase.rpc('mant_ot_marcar', { p_orden: id, p_tipo: tipo }), tipo === 'inicio' ? 'Actividad iniciada: el tiempo corre.' : undefined)

  async function tildar(item: OtItem, hecho: boolean) {
    setData((d) => d ? { ...d, items: d.items.map((x) => (x.id === item.id ? { ...x, hecho } : x)) } : d)
    const { error } = await supabase.from('mant_ot_items').update({ hecho }).eq('id', item.id)
    if (error) { avisar(mensajeError(error), 'error'); void recargar() }
  }

  async function guardarPaso() {
    if (!fotoPendiente) return
    setOcupado('paso')
    try {
      const ruta = await subirArchivo(`ot/${id}/pasos`, fotoPendiente)
      const { error } = await supabase.from('mant_ot_fotos').insert({ orden_id: id, ruta, tipo: 'paso', nota: notaPaso.trim() || null, desde_camara: true, tomada_en: new Date(fotoPendiente.lastModified || Date.now()).toISOString() })
      if (error) throw error
      setFotoPendiente(null); setNotaPaso(''); await recargar()
    } catch (e) { setErr(mensajeError(e)) }
    setOcupado(null)
  }

  async function fotoFinalTomada(f: File) {
    // Tiene que ser una foto recién sacada con la cámara, no una vieja de la galería
    const edadMin = (Date.now() - (f.lastModified || 0)) / 60000
    if (!f.lastModified || edadMin > 5) { setErr('La foto final se saca en este momento con la cámara, no desde la galería.'); return }
    setOcupado('final'); setErr(null)
    try {
      const fecha = new Date(f.lastModified)
      const sello = await estamparFoto(f, [
        `${fecha.toLocaleDateString('es-AR')} ${fecha.toLocaleTimeString('es-AR', { hour12: false })}`,
        `${numOT(o!.numero)} · ${o!.equipo_codigo ?? ''} · ${usuario?.nombre ?? ''}`,
        o!.titulo.slice(0, 60)
      ])
      const ruta = await subirArchivo(`ot/${id}/cierre`, sello)
      const { error } = await supabase.from('mant_ot_fotos').insert({ orden_id: id, ruta, tipo: 'cierre', desde_camara: true, tomada_en: fecha.toISOString() })
      if (error) throw error
      await recargar()
    } catch (e) { setErr(mensajeError(e)) }
    setOcupado(null)
  }

  async function agregarHerr(texto = herrTxt) {
    if (!texto.trim()) return
    if (await hacer('herr', () => supabase.from('mant_ot_herramientas').insert({ orden_id: id, texto: texto.trim() }))) setHerrTxt('')
  }
  async function agregarRep(texto = repN, cant = repQ, articuloId?: string | null) {
    if (!texto.trim()) return
    const art = articuloId ?? sugeridos.find((a) => a.descripcion.toLowerCase() === texto.trim().toLowerCase())?.id ?? null
    if (await hacer('rep', () => supabase.from('mant_ot_repuestos').insert({ orden_id: id, texto: texto.trim(), cantidad: Number(cant.replace(',', '.')) || 1, articulo_id: art }))) { setRepN(''); setRepQ('1') }
  }

  async function guardarInforme(texto: string) {
    setInforme(texto)
    await supabase.from('mant_ordenes').update({ comentario_cierre: texto.trim() || null }).eq('id', id!)
  }

  async function terminar() {
    setOcupado('fin'); setErr(null)
    const { data: m, error } = await supabase.rpc('mant_ot_terminar', { p_orden: id, p_informe: informe.trim() || null })
    setOcupado(null)
    if (error) setErr(mensajeError(error))
    else { avisar(`Tarea cerrada · tiempo real ${horasTxt(Number(m))}.`); void recargar() }
  }

  const prediccion = useMemo(() => {
    if (!data?.pred?.ejecuciones || !data.pred.minutos_promedio) return null
    return `Se hace en ~${horasTxt(data.pred.minutos_promedio)} (promedio de ${data.pred.ejecuciones} ${data.pred.ejecuciones === 1 ? 'vez' : 'veces'})`
  }, [data])

  if (cargando && !data) return <MarcoTelefono><Cargando /></MarcoTelefono>
  if (!o || !data) return <MarcoTelefono><div className="p-5"><ErrorBox texto={error ?? 'La tarea no existe o no tenés acceso.'} /></div></MarcoTelefono>

  return (
    <MarcoTelefono>
      <PantallaCelular titulo="Mis tareas de hoy" derecha={o.turno ? <span className="rounded-full bg-fondo px-2.5 py-1 text-xs font-medium">Turno {o.turno.toLowerCase()}</span> : undefined}>
        <div className="flex flex-col gap-4">
          <button onClick={() => nav('/tareas')} className="self-start rounded-full bg-fondo px-3.5 py-2 text-[13px] font-medium text-texto">← Mis tareas</button>
          <div className="flex flex-col gap-1.5">
            <span><CritTipo o={o} /></span>
            <div className="text-xl font-semibold leading-tight">{o.titulo}</div>
            <div className="text-[13px] text-suave">{o.equipo_codigo ?? 'Sin equipo'} · {numOT(o.numero)} · estimado {durTxt(o.duracion_estimada_horas)}</div>
            {prediccion && <div className="text-[13px] font-medium text-revision">{prediccion}</div>}
          </div>

          {/* Cronómetro */}
          <div className={`flex flex-col gap-3 rounded-[18px] p-4 ${data.reloj === 'corriendo' ? 'bg-verde-claro' : data.reloj === 'pausada' ? 'bg-ambar-claro' : 'bg-fondo'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-suave">{data.reloj === 'corriendo' ? 'Trabajando' : data.reloj === 'pausada' ? 'En pausa' : o.estado === 'completada' ? 'Tiempo real' : 'Tiempo de trabajo'}</span>
              <span className={`font-mono text-[30px] font-semibold tabular-nums ${data.reloj === 'corriendo' ? 'text-aprobado' : 'text-texto'}`}>{fmtReloj(o.estado === 'completada' && o.tiempo_real_min ? o.tiempo_real_min * 60 : segundos)}</span>
            </div>
            {puede && (data.reloj === 'sin_iniciar' || data.reloj === 'terminada') && <Boton grande className="w-full" cargando={ocupado === 'inicio'} onClick={() => void marcar('inicio')}>▶ Iniciar actividad</Boton>}
            {puede && data.reloj === 'corriendo' && <Boton grande variante="secundario" className="w-full" cargando={ocupado === 'pausa'} onClick={() => void marcar('pausa')}>❚❚ Pausar</Boton>}
            {puede && data.reloj === 'pausada' && <Boton grande variante="verde" className="w-full" cargando={ocupado === 'reanudar'} onClick={() => void marcar('reanudar')}>▶ Reanudar</Boton>}
            {puede && data.reloj === 'sin_iniciar' && <span className="text-xs text-tenue">Tocá al empezar el trabajo: el tiempo real se calcula solo, descontando las pausas.</span>}
          </div>

          {/* Cómo se hace: procedimiento y lo que se va a necesitar */}
          {(data.pasos.length > 0 || data.tRep.length > 0 || data.tHerr.length > 0) && (
            <div className="flex flex-col gap-2.5 rounded-[18px] border border-[#c9d6ee] bg-azul-claro/50 p-3.5">
              <button className="flex items-center justify-between text-left text-sm font-semibold text-revision" onClick={() => setVerProc(!verProc)}>
                <span>Cómo se hace · {data.pasos.length} pasos{data.tRep.length ? ` · ${data.tRep.length} repuestos` : ''}{data.tHerr.length ? ` · ${data.tHerr.length} herramientas` : ''}</span><span>{verProc ? '−' : '+'}</span>
              </button>
              {verProc && <>
                {data.tHerr.length > 0 && <div className="text-[13px]"><b>Herramientas:</b> {data.tHerr.map((h) => h.nombre).join(' · ')}</div>}
                {data.tRep.length > 0 && <div className="text-[13px]"><b>Repuestos:</b> {data.tRep.map((r) => `${fmtNum(r.cantidad)} × ${r.articulo!.descripcion} (stock ${fmtNum(r.articulo!.stock_actual)})`).join(' · ')}</div>}
                {data.pasos.map((p) => (
                  <div key={p.id} className="flex gap-2.5 rounded-xl bg-white p-2">
                    {p.foto_ruta && <Foto ruta={p.foto_ruta} className="h-20 w-20 shrink-0" />}
                    <span className="text-[13px]"><b>Paso {p.orden}.</b> {p.texto ?? ''}</span>
                  </div>
                ))}
              </>}
            </div>
          )}

          {data.items.length > 0 && sec(`Checklist · ${data.items.filter((i) => i.hecho).length} de ${data.items.length}`, data.items.map((c) => (
            <label key={c.id} className="flex items-start gap-2.5 rounded-[14px] bg-fondo px-3 py-[11px] text-sm leading-snug">
              <input type="checkbox" className="m-0 h-5 w-5 shrink-0 accent-primario" checked={c.hecho} disabled={!puede} onChange={(e) => void tildar(c, e.target.checked)} />
              <span>{c.descripcion}{c.detalle && <span className="block text-xs text-tenue">{c.detalle}</span>}</span>
            </label>
          )))}

          {(o.observacion || (o.tipo === 'correctiva' && o.descripcion)) && sec(o.observacion ? 'Observación de quien asignó' : 'Lo que reportaron',
            <div className="whitespace-pre-wrap rounded-[14px] border border-[#f1d49a] bg-[#fff6e5] px-3.5 py-3 text-sm leading-relaxed">{o.observacion ?? o.descripcion}</div>)}

          {/* Fotos durante el trabajo */}
          {sec(<>Fotos del trabajo <span className="font-normal text-tenue">· arman el procedimiento</span></>, <>
            {fotosPaso.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {fotosPaso.map((f) => (
                  <div key={f.id} className="flex flex-col gap-1">
                    <Foto ruta={f.ruta} className="aspect-square w-full" />
                    <span className="text-[11px] leading-tight text-suave"><b>{f.paso}.</b> {f.nota ?? ''}</span>
                  </div>
                ))}
              </div>
            )}
            {puede && (fotoPendiente ? (
              <div className="flex flex-col gap-2 rounded-[14px] bg-fondo p-2.5">
                <img src={URL.createObjectURL(fotoPendiente)} alt="Paso" className="h-36 w-full rounded-xl object-cover" />
                <input className="campo" placeholder="¿Qué se ve o qué hiciste? Ej.: aflojar los 4 bulones de la tapa" value={notaPaso} onChange={(e) => setNotaPaso(e.target.value)} />
                <div className="flex gap-2">
                  <Boton className="flex-1" cargando={ocupado === 'paso'} onClick={() => void guardarPaso()}>Guardar paso {fotosPaso.length + 1}</Boton>
                  <Boton variante="fantasma" onClick={() => { setFotoPendiente(null); setNotaPaso('') }}>Descartar</Boton>
                </div>
              </div>
            ) : <BotonCamara texto={`+ Foto del paso ${fotosPaso.length + 1}`} soloCamara onArchivo={setFotoPendiente} />)}
          </>)}

          {/* Herramientas */}
          {sec('Herramientas que usé', <>
            {data.herr.length > 0 && <div className="flex flex-wrap gap-1.5">{data.herr.map((h) => (
              <span key={h.id} className="flex items-center gap-1 rounded-full bg-fondo py-1 pl-3 pr-1 text-[13px]">{h.texto}
                {puede && <button aria-label="Quitar" className="h-6 w-6 rounded-full text-primario-oscuro" onClick={() => void hacer('herr', () => supabase.from('mant_ot_herramientas').delete().eq('id', h.id))}>×</button>}
              </span>))}</div>}
            {puede && <>
              {data.tHerr.filter((t) => !data.herr.some((h) => h.texto.toLowerCase() === t.nombre.toLowerCase())).length > 0 && (
                <div className="flex flex-wrap gap-1.5">{data.tHerr.filter((t) => !data.herr.some((h) => h.texto.toLowerCase() === t.nombre.toLowerCase())).map((t) => (
                  <button key={t.id} className="rounded-full border border-dashed border-azul px-2.5 py-1 text-xs text-revision" onClick={() => void agregarHerr(t.nombre)}>+ {t.nombre}</button>))}</div>
              )}
              <div className="flex gap-2">
                <input className="campo" list="herr-catalogo" placeholder="Ej.: llave de 19, extractor…" value={herrTxt} onChange={(e) => setHerrTxt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void agregarHerr()} />
                <Boton variante="secundario" cargando={ocupado === 'herr'} onClick={() => void agregarHerr()}>Agregar</Boton>
              </div>
              <datalist id="herr-catalogo">{catalogoHerr.map((n) => <option key={n} value={n} />)}</datalist>
            </>}
          </>)}

          {/* Repuestos */}
          {sec('Repuestos usados', <>
            {data.reps.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-fondo px-3 py-2 text-[13px]">
                <span><b>{fmtNum(r.cantidad)}</b> × {r.texto} {r.articulo_id ? <span className="text-aprobado">· del pañol</span> : <span className="text-tenue">· a vincular</span>}</span>
                {puede && <button aria-label="Quitar" className="h-7 w-7 rounded-full bg-white text-primario-oscuro" onClick={() => void hacer('rep', () => supabase.from('mant_ot_repuestos').delete().eq('id', r.id))}>×</button>}
              </div>
            ))}
            {puede && <>
              {data.tRep.filter((t) => !data.reps.some((r) => r.articulo_id === t.articulo!.id)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">{data.tRep.filter((t) => !data.reps.some((r) => r.articulo_id === t.articulo!.id)).map((t) => (
                  <button key={t.articulo!.id} className="rounded-full border border-dashed border-azul px-2.5 py-1 text-xs text-revision"
                    onClick={() => void agregarRep(t.articulo!.descripcion, String(t.cantidad), t.articulo!.id)}>+ {fmtNum(t.cantidad)} × {t.articulo!.descripcion}</button>))}</div>
              )}
              <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-1.5">
                <input className="campo min-h-[44px] rounded-xl px-2 text-center" type="number" min="0" value={repQ} aria-label="Cantidad" onChange={(e) => setRepQ(e.target.value)} />
                <input className="campo min-h-[44px] rounded-xl" list="rep-panol" placeholder="Nombre del repuesto" value={repN} aria-label="Repuesto" onChange={(e) => setRepN(e.target.value)} />
                <Boton variante="secundario" cargando={ocupado === 'rep'} onClick={() => void agregarRep()}>+</Boton>
              </div>
              <datalist id="rep-panol">{sugeridos.map((a) => <option key={a.id} value={a.descripcion}>{a.codigo} · stock {a.stock_actual}</option>)}</datalist>
            </>}
          </>)}

          {/* Informe: dictado, audio y video */}
          <Informe orden={o} puede={puede} medios={data.medios} informe={informe} onInforme={(t) => void guardarInforme(t)} onCambio={() => void recargar()} />

          {/* Foto final */}
          {sec(<>Foto final del trabajo terminado <span className="text-primario-oscuro">· obligatoria</span></>, <>
            {fotoFinal && <div className="relative"><Foto ruta={fotoFinal.ruta} className="h-[200px] w-full" /><span className="absolute left-2 top-2 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold">Hora del servidor {new Date(fotoFinal.creado_en).toLocaleTimeString('es-AR', { hour12: false })}</span></div>}
            {puede && <BotonCamara texto={fotoFinal ? 'Sacar de nuevo' : 'Sacar foto final con la cámara'} soloCamara cargando={ocupado === 'final'} onArchivo={(f) => void fotoFinalTomada(f)} />}
            {puede && <span className="text-xs text-tenue">Se saca en el momento con la cámara; queda con fecha, hora, OT y tu nombre impresos.</span>}
          </>)}

          <ErrorBox texto={err} />
          {abierta ? puede && <>
            <Boton grande className="w-full" disabled={!fotoFinal || !iniciada} cargando={ocupado === 'fin'} onClick={() => void terminar()}>■ Terminar y cerrar tarea</Boton>
            {!iniciada && <div className="text-center text-xs text-tenue">Primero tocá "Iniciar actividad".</div>}
            {iniciada && !fotoFinal && <div className="text-center text-xs text-tenue">Sin foto final no se cierra.</div>}
          </> : (
            <OkBox>Tarea cerrada · tiempo real {o.tiempo_real_min ? horasTxt(o.tiempo_real_min) : '—'}. {o.revision_foto === 'aprobada' ? 'El supervisor la aprobó.' : 'Queda para revisión del supervisor.'}</OkBox>
          )}
        </div>
      </PantallaCelular>
    </MarcoTelefono>
  )
}

// ---------------------------------------------------------------------
// Informe de lo que se hizo: dictado a texto, audio y video
// ---------------------------------------------------------------------
type Reconocedor = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
const crearReconocedor = (): Reconocedor | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor }
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!C) return null
  const r = new C(); r.lang = 'es-AR'; r.continuous = true; r.interimResults = true
  return r
}

function Informe({ orden, puede, medios, informe, onInforme, onCambio }:
  { orden: Orden; puede: boolean; medios: Medio[]; informe: string; onInforme: (t: string) => void; onCambio: () => void }) {
  const avisar = useAviso()
  const [texto, setTexto] = useState(informe)
  const [dictando, setDictando] = useState(false)
  const [parcial, setParcial] = useState('')
  const [grabando, setGrabando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const rec = useRef<Reconocedor | null>(null)
  const grab = useRef<MediaRecorder | null>(null)
  const trozos = useRef<Blob[]>([])
  const textoGrab = useRef('')
  const inicioGrab = useRef(0)
  useEffect(() => setTexto(informe), [informe])
  const hayDictado = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

  function escuchar(onFinal: (t: string) => void) {
    const r = crearReconocedor()
    if (!r) { avisar('Este celular no permite dictado: escribilo a mano.', 'error'); return null }
    r.onresult = (e) => {
      let interino = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) onFinal(t.trim()); else interino += t
      }
      setParcial(interino)
    }
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') avisar(`Dictado: ${e.error}`, 'error') }
    r.onend = () => { setDictando(false); setParcial('') }
    r.start()
    return r
  }

  function dictar() {
    if (dictando) { rec.current?.stop(); return }
    rec.current = escuchar((t) => setTexto((x) => { const n = (x ? x.trimEnd() + ' ' : '') + t; onInforme(n); return n }))
    if (rec.current) setDictando(true)
  }

  async function grabarAudio() {
    if (grabando) { grab.current?.stop(); rec.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const tipo = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mr = new MediaRecorder(stream, { mimeType: tipo })
      trozos.current = []; textoGrab.current = ''; inicioGrab.current = Date.now()
      mr.ondataavailable = (e) => e.data.size && trozos.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setGrabando(false)
        const archivo = new File(trozos.current, `audio.${tipo.includes('webm') ? 'webm' : 'm4a'}`, { type: tipo })
        await subirMedio(archivo, 'audio', Math.round((Date.now() - inicioGrab.current) / 1000), textoGrab.current.trim())
      }
      mr.start(); grab.current = mr; setGrabando(true)
      // a la vez, pasa a texto lo que se dice (si el celular lo permite)
      rec.current = escuchar((t) => { textoGrab.current += ' ' + t })
    } catch (e) { avisar(mensajeError(e), 'error') }
  }

  async function subirMedio(f: File, tipo: 'audio' | 'video', duracion: number | null, transcripcion: string) {
    if (f.size > 45 * 1024 * 1024) { avisar('El video es muy largo: grabá menos de un minuto.', 'error'); return }
    setSubiendo(true)
    try {
      const ruta = await subirArchivo(`ot/${orden.id}/${tipo}`, f)
      const { error } = await supabase.from('mant_ot_medios').insert({ orden_id: orden.id, tipo, ruta, duracion_seg: duracion, transcripcion: transcripcion || null })
      if (error) throw error
      if (transcripcion) { const n = (texto ? texto.trimEnd() + '\n' : '') + transcripcion; setTexto(n); onInforme(n) }
      onCambio()
    } catch (e) { avisar(mensajeError(e), 'error') }
    setSubiendo(false)
  }

  return sec('Qué se hizo', <>
    <textarea className="campo min-h-[96px] resize-y" disabled={!puede} value={texto + (parcial ? ` ${parcial}…` : '')} placeholder="Contá qué hiciste, qué encontraste y qué quedó pendiente. Podés dictarlo."
      onChange={(e) => setTexto(e.target.value)} onBlur={() => texto !== informe && onInforme(texto)} />
    {puede && (
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={dictar} disabled={!hayDictado || grabando}
          className={`min-h-[46px] rounded-[14px] border px-2 text-[13px] font-semibold ${dictando ? 'border-primario bg-primario text-white' : 'border-borde-campo bg-white text-texto'}`}>{dictando ? '■ Parar' : '🎤 Dictar'}</button>
        <button type="button" onClick={() => void grabarAudio()} disabled={dictando || subiendo}
          className={`min-h-[46px] rounded-[14px] border px-2 text-[13px] font-semibold ${grabando ? 'border-primario bg-primario text-white' : 'border-borde-campo bg-white text-texto'}`}>{grabando ? '■ Terminar audio' : '● Grabar audio'}</button>
        <BotonCamara texto="▶ Video" video soloCamara cargando={subiendo} clase="border border-borde-campo text-[13px] text-texto" onArchivo={(f) => void subirMedio(f, 'video', null, '')} />
      </div>
    )}
    {grabando && <span className="text-xs text-primario-oscuro">Grabando… hablá normal, se va pasando a texto.</span>}
    {medios.map((m) => <MedioFila key={m.id} m={m} />)}
  </>)
}

function MedioFila({ m }: { m: Medio }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { void urlFirmada(m.ruta).then(setUrl) }, [m.ruta])
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-fondo p-2.5">
      <span className="text-xs text-tenue">{m.tipo === 'audio' ? 'Audio' : 'Video'} · {new Date(m.creado_en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      {url && (m.tipo === 'audio' ? <audio controls src={url} className="w-full" /> : <video controls src={url} className="max-h-48 w-full rounded-lg" />)}
      {m.transcripcion && <span className="text-[13px] italic text-texto-2">“{m.transcripcion}”</span>}
    </div>
  )
}
