import { useEffect, useRef, useState } from 'react'
import { mensajeError, supabase } from '@/lib/supabase'
import { subirArchivo, urlFirmada, useDatos } from '@/lib/util'
import { useAviso } from './ui'
import { Foto } from './selectores'

export type TipoAdjunto = 'foto' | 'documento' | 'video' | 'audio'
export interface AdjuntoNuevo { id: string; tipo: TipoAdjunto; archivo: File; duracion?: number }
interface Adjunto { id: string; tipo: TipoAdjunto; ruta: string; nombre: string | null; duracion_seg: number | null; creado_en: string }

const MAX_MB = 45
const ICONO: Record<TipoAdjunto, string> = { foto: '📷', documento: '📄', video: '🎥', audio: '🎤' }
const tam = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Carga de adjuntos en el celular: primero sacar foto; después galería, documento, video y audio */
export function CargarAdjuntos({ lista, onCambio }: { lista: AdjuntoNuevo[]; onCambio: (l: AdjuntoNuevo[]) => void }) {
  const avisar = useAviso()
  const [grabando, setGrabando] = useState(false)
  const [seg, setSeg] = useState(0)
  const grab = useRef<MediaRecorder | null>(null)
  const trozos = useRef<Blob[]>([])
  const inicio = useRef(0)
  const actual = useRef(lista)
  actual.current = lista

  useEffect(() => {
    if (!grabando) return
    const t = setInterval(() => setSeg((Date.now() - inicio.current) / 1000), 500)
    return () => clearInterval(t)
  }, [grabando])

  function agregar(files: FileList | null, tipo: TipoAdjunto) {
    if (!files?.length) return
    const nuevos: AdjuntoNuevo[] = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_MB * 1048576) { avisar(`"${f.name}" pesa ${tam(f.size)}: el máximo es ${MAX_MB} MB${tipo === 'video' ? ' (grabá menos de un minuto)' : ''}.`, 'error'); continue }
      nuevos.push({ id: `${Date.now()}-${Math.random()}`, tipo: tipo === 'documento' && f.type.startsWith('image/') ? 'foto' : tipo, archivo: f })
    }
    onCambio([...actual.current, ...nuevos])
  }

  async function audio() {
    if (grabando) { grab.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const tipo = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const mr = tipo ? new MediaRecorder(stream, { mimeType: tipo }) : new MediaRecorder(stream)
      trozos.current = []; inicio.current = Date.now(); setSeg(0)
      mr.ondataavailable = (e) => e.data.size && trozos.current.push(e.data)
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setGrabando(false)
        const t = mr.mimeType || tipo || 'audio/webm'
        const f = new File(trozos.current, `audio.${t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : 'webm'}`, { type: t })
        onCambio([...actual.current, { id: `${Date.now()}`, tipo: 'audio', archivo: f, duracion: Math.round((Date.now() - inicio.current) / 1000) }])
      }
      mr.start(1000); grab.current = mr; setGrabando(true)
    } catch (e) { avisar(`No se pudo usar el micrófono: ${mensajeError(e)}`, 'error') }
  }

  const boton = 'flex min-h-[48px] cursor-pointer items-center justify-center gap-1.5 rounded-[14px] border border-borde-campo bg-white px-2 text-[13px] font-semibold text-texto'
  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-primario bg-rojo-suave/40 p-3 text-[15px] font-semibold text-primario-oscuro">
        📷 Sacar foto
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { agregar(e.target.files, 'foto'); e.target.value = '' }} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={boton}>🖼️ De la galería
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { agregar(e.target.files, 'foto'); e.target.value = '' }} /></label>
        <label className={boton}>📄 Documento
          <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*,application/pdf" multiple className="hidden" onChange={(e) => { agregar(e.target.files, 'documento'); e.target.value = '' }} /></label>
        <label className={boton}>🎥 Grabar video
          <input type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => { agregar(e.target.files, 'video'); e.target.value = '' }} /></label>
        <button type="button" onClick={() => void audio()} className={grabando ? `${boton} !border-primario !bg-primario !text-white` : boton}>
          {grabando ? `■ Terminar ${mmss(seg)}` : '🎤 Grabar audio'}</button>
      </div>
      {grabando && <span className="text-xs text-primario-oscuro">Grabando… contá qué pasa, dónde y desde cuándo. Tocá "Terminar" al final.</span>}
      {lista.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {lista.map((a) => (
            <div key={a.id} className="flex items-center gap-2.5 rounded-xl bg-fondo p-2">
              {a.tipo === 'foto'
                ? <img src={URL.createObjectURL(a.archivo)} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-xl">{ICONO[a.tipo]}</span>}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium">{a.tipo === 'audio' ? 'Audio grabado' : a.tipo === 'video' ? 'Video' : a.archivo.name}</span>
                <span className="text-xs text-tenue">{a.duracion ? `${mmss(a.duracion)} · ` : ''}{tam(a.archivo.size)}</span>
              </span>
              <button type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-primario-oscuro" onClick={() => onCambio(lista.filter((x) => x.id !== a.id))}>Quitar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Sube los adjuntos de un pedido ya creado. Devuelve cuántos fallaron. */
export async function subirAdjuntos(pedidoId: string, carpeta: string, lista: AdjuntoNuevo[], yaSubida?: { id: string; ruta: string }) {
  let fallas = 0
  for (const a of lista) {
    try {
      const ruta = yaSubida?.id === a.id ? yaSubida.ruta : await subirArchivo(`${carpeta}/${a.tipo}`, a.archivo)
      const { error } = await supabase.from('mant_pedido_adjuntos').insert({ pedido_id: pedidoId, tipo: a.tipo, ruta, nombre: a.archivo.name, tamano: a.archivo.size, duracion_seg: a.duracion ?? null })
      if (error) throw error
    } catch { fallas++ }
  }
  return fallas
}

/** Adjuntos de un pedido, para verlos en la bandeja */
export function VerAdjuntos({ pedidoId, fotoPrincipal }: { pedidoId: string; fotoPrincipal?: string | null }) {
  const { data } = useDatos(async () => {
    const r = await supabase.from('mant_pedido_adjuntos').select('*').eq('pedido_id', pedidoId).order('creado_en')
    return { data: (r.data ?? []) as Adjunto[], error: r.error }
  }, [pedidoId])
  const lista = data ?? []
  const fotos = lista.filter((a) => a.tipo === 'foto')
  const otros = lista.filter((a) => a.tipo !== 'foto')
  // pedidos viejos: solo tienen la foto principal
  if (!lista.length) return fotoPrincipal ? <Foto ruta={fotoPrincipal} className="h-[220px] w-full max-w-[420px] rounded-[14px]" /> : null
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs text-tenue">Adjuntos del solicitante ({lista.length})</span>
      {fotos.length > 0 && <div className="flex flex-wrap gap-2">{fotos.map((f) => <Foto key={f.id} ruta={f.ruta} className="h-[150px] w-[200px] rounded-[14px]" />)}</div>}
      {otros.map((a) => <AdjuntoFila key={a.id} a={a} />)}
    </div>
  )
}

function AdjuntoFila({ a }: { a: Adjunto }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { void urlFirmada(a.ruta).then(setUrl) }, [a.ruta])
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-fondo p-2.5 text-[13px]">
      <span className="text-lg">{ICONO[a.tipo]}</span>
      {a.tipo === 'audio' && url && <audio controls src={url} className="max-w-full" />}
      {a.tipo === 'video' && url && <video controls playsInline src={url} className="max-h-60 rounded-lg" />}
      {a.tipo === 'documento' && <a href={url ?? undefined} target="_blank" rel="noreferrer" className="font-semibold text-primario hover:underline">{a.nombre ?? 'Documento'} ↗</a>}
      {a.duracion_seg ? <span className="text-tenue">{mmss(a.duracion_seg)}</span> : null}
    </div>
  )
}
