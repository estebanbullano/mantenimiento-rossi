import { useEffect, useState } from 'react'
import { mensajeError, supabase } from '@/lib/supabase'
import { fmtNum, urlFirmada, useDatos } from '@/lib/util'
import type { Articulo, Orden } from '@/lib/tipos'
import { Boton, H2, Insignia, OkBox, Tarjeta, useAviso } from './ui'
import { Foto, SelectorArticulo } from './selectores'

interface Evento { id: string; tipo: 'inicio' | 'pausa' | 'reanudar' | 'fin'; creado_en: string }
interface FotoOT { id: string; ruta: string; tipo: string; nota: string | null; paso: number | null; creado_en: string; tomada_en: string | null; desfase_seg: number | null }
interface Rep { id: string; texto: string; cantidad: number; articulo_id: string | null; articulo?: { codigo: string; descripcion: string } | null }
interface Medio { id: string; tipo: 'audio' | 'video'; ruta: string; duracion_seg: number | null; transcripcion: string | null; creado_en: string }
interface PasoEd { k: string; texto: string; foto_ruta: string | null }
const EV = { inicio: 'Inició', pausa: 'Pausó', reanudar: 'Reanudó', fin: 'Terminó' }
const hora = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
let sec = 0
const clave = () => `p${++sec}`

/** Revisión del cierre por el administrador: escucha los audios, escribe el informe,
 *  arma los pasos del procedimiento y lo carga al plan */
export function RevisionCierre({ orden, onCambio }: { orden: Orden; onCambio: () => void }) {
  const avisar = useAviso()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [informe, setInforme] = useState(orden.comentario_cierre ?? '')
  const [pasosEd, setPasosEd] = useState<PasoEd[] | null>(null)
  const { data, recargar } = useDatos(async () => {
    const [e, f, h, r, m, tp] = await Promise.all([
      supabase.from('mant_ot_eventos').select('*').eq('orden_id', orden.id).order('creado_en'),
      supabase.from('mant_ot_fotos').select('*').eq('orden_id', orden.id).order('creado_en'),
      supabase.from('mant_ot_herramientas').select('id,texto').eq('orden_id', orden.id),
      supabase.from('mant_ot_repuestos').select('id,texto,cantidad,articulo_id, articulo:mant_articulos(codigo,descripcion)').eq('orden_id', orden.id),
      supabase.from('mant_ot_medios').select('*').eq('orden_id', orden.id).order('creado_en'),
      orden.tarea_id ? supabase.from('mant_tarea_pasos').select('orden,texto,foto_ruta').eq('tarea_id', orden.tarea_id).order('orden') : Promise.resolve({ data: [] })
    ])
    return {
      data: {
        eventos: (e.data ?? []) as Evento[], fotos: (f.data ?? []) as FotoOT[], herr: (h.data ?? []) as { id: string; texto: string }[],
        reps: (r.data ?? []) as unknown as Rep[], medios: (m.data ?? []) as Medio[],
        procActual: (tp.data ?? []) as { orden: number; texto: string | null; foto_ruta: string | null }[]
      }, error: e.error
    }
  }, [orden.id, orden.estado])

  useEffect(() => setInforme(orden.comentario_cierre ?? ''), [orden.comentario_cierre])
  // Pasos para editar: los de las fotos de esta OT; si no hay, el procedimiento que ya tiene la tarea
  useEffect(() => {
    if (!data || pasosEd) return
    const deFotos = data.fotos.filter((f) => f.tipo === 'paso').map((f) => ({ k: clave(), texto: f.nota ?? '', foto_ruta: f.ruta }))
    setPasosEd(deFotos.length ? deFotos : data.procActual.map((p) => ({ k: clave(), texto: p.texto ?? '', foto_ruta: p.foto_ruta })))
  }, [data, pasosEd])

  if (!data) return null
  const pasos = data.fotos.filter((f) => f.tipo === 'paso')
  const final = data.fotos.filter((f) => f.tipo === 'cierre').at(-1)
  const sinVincular = data.reps.filter((r) => !r.articulo_id).length
  const cerrada = orden.estado === 'completada'
  if (!cerrada && !data.eventos.length && !pasos.length && !final && !data.reps.length && !data.medios.length) return null

  async function vincular(r: Rep, a: Articulo) {
    const { error } = await supabase.from('mant_ot_repuestos').update({ articulo_id: a.id }).eq('id', r.id)
    if (error) avisar(mensajeError(error), 'error'); else void recargar()
  }
  async function guardarInforme() {
    setOcupado('inf')
    const { error } = await supabase.from('mant_ordenes').update({ comentario_cierre: informe.trim() || null }).eq('id', orden.id)
    setOcupado(null)
    if (error) avisar(mensajeError(error), 'error'); else { avisar('Informe guardado.'); onCambio() }
  }
  async function guardarReferencia() {
    setOcupado('ref')
    if (informe !== (orden.comentario_cierre ?? '')) await supabase.from('mant_ordenes').update({ comentario_cierre: informe.trim() || null }).eq('id', orden.id)
    const lista = (pasosEd ?? []).filter((p) => p.texto.trim() || p.foto_ruta).map((p) => ({ texto: p.texto.trim(), foto_ruta: p.foto_ruta }))
    const { data: res, error } = await supabase.rpc('mant_aprender_de_ot', { p_orden: orden.id, p_pasos: lista.length ? lista : null })
    setOcupado(null)
    if (error) return avisar(mensajeError(error), 'error')
    const r = res as { pasos: number; repuestos: number; herramientas: number; horas: number | null }
    avisar(`Cargado al plan: ${r.pasos} pasos, ${r.repuestos} repuestos, ${r.herramientas} herramientas${r.horas ? `, ${fmtNum(r.horas, 1)} h estimadas` : ''}.`)
    onCambio()
  }
  async function revisar(res: 'aprobada' | 'rehacer') {
    let comentario: string | null = null
    if (res === 'rehacer') { comentario = prompt('¿Qué hay que rehacer? (lo ve el operario)'); if (comentario === null) return }
    setOcupado(res)
    if (res === 'aprobada' && informe !== (orden.comentario_cierre ?? '')) await supabase.from('mant_ordenes').update({ comentario_cierre: informe.trim() || null }).eq('id', orden.id)
    const { error } = await supabase.rpc('mant_revisar_foto', { p_orden: orden.id, p_resultado: res, p_comentario: comentario })
    setOcupado(null)
    if (error) avisar(mensajeError(error), 'error'); else onCambio()
  }

  const cambiarPaso = (k: string, texto: string) => setPasosEd((l) => l!.map((p) => p.k === k ? { ...p, texto } : p))
  const moverPaso = (i: number, d: -1 | 1) => setPasosEd((l) => { const n = [...l!]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n })
  const quitarPaso = (k: string) => setPasosEd((l) => l!.filter((p) => p.k !== k))
  const agregarPaso = (texto = '') => setPasosEd((l) => [...(l ?? []), { k: clave(), texto, foto_ruta: null }])
  const textosAudios = data.medios.map((m) => m.transcripcion?.trim()).filter(Boolean) as string[]

  return (
    <Tarjeta className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H2 texto="Ejecución y cierre" />
        {orden.revision_foto === 'aprobada' ? <Insignia t="verde">Revisada y aprobada</Insignia> : cerrada ? <Insignia t="amarillo">Por revisar</Insignia> : null}
      </div>

      {data.eventos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {data.eventos.map((e) => <Insignia key={e.id} t={e.tipo === 'pausa' ? 'amarillo' : e.tipo === 'fin' ? 'verde' : 'azul'}>{EV[e.tipo]} {hora(e.creado_en)}</Insignia>)}
          {orden.tiempo_real_min != null && <span className="font-semibold">· tiempo real {orden.tiempo_real_min >= 60 ? `${fmtNum(orden.tiempo_real_min / 60, 1)} h` : `${orden.tiempo_real_min} min`}</span>}
        </div>
      )}

      {final && (
        <div className="flex flex-wrap items-start gap-3">
          <Foto ruta={final.ruta} className="h-[180px] w-[240px]" />
          <div className="flex flex-col gap-1 text-[13px]">
            <span className="font-semibold">Foto final</span>
            <span>Hora del celular: {final.tomada_en ? hora(final.tomada_en) : '—'}</span>
            <span>Hora del servidor: {hora(final.creado_en)}</span>
            {final.desfase_seg != null && (Math.abs(final.desfase_seg) > 120
              ? <Insignia t="rojo">Diferencia de {Math.round(Math.abs(final.desfase_seg) / 60)} min entre celular y servidor</Insignia>
              : <Insignia t="verde">Sacada en el momento</Insignia>)}
          </div>
        </div>
      )}

      {/* 1. Escuchar y pasar a texto */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">{orden.tarea_id ? '1 · ' : ''}Audios y videos del operario {data.medios.length === 0 && <span className="font-normal text-tenue">· no grabó ninguno</span>}</span>
        {data.medios.map((m) => <MedioRevision key={m.id} m={m} onGuardado={() => void recargar()} onPaso={(t) => agregarPaso(t)} />)}
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold">
          <span>Informe del trabajo <span className="font-normal text-tenue">· queda en el historial de la máquina</span></span>
          {textosAudios.length > 0 && <button className="text-xs font-medium text-primario" onClick={() => setInforme(textosAudios.join('\n'))}>Usar el texto de los audios</button>}
        </span>
        <textarea className="campo min-h-[90px] resize-y" value={informe} onChange={(e) => setInforme(e.target.value)} placeholder="Qué se hizo, qué se encontró y qué quedó pendiente." />
        {informe !== (orden.comentario_cierre ?? '') && <Boton variante="secundario" className="self-start" cargando={ocupado === 'inf'} onClick={() => void guardarInforme()}>Guardar informe</Boton>}
      </div>

      {/* 2. Pasos del procedimiento */}
      {orden.tarea_id && pasosEd && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">2 · Pasos del procedimiento <span className="font-normal text-tenue">· así lo va a ver el próximo operario</span></span>
          {pasosEd.length === 0 && <span className="text-[13px] text-tenue">Sin pasos todavía. Agregalos escuchando el audio.</span>}
          {pasosEd.map((p, i) => (
            <div key={p.k} className="flex items-start gap-2 rounded-xl bg-fondo p-2">
              <span className="mt-2.5 w-6 shrink-0 text-center text-sm font-semibold">{i + 1}</span>
              {p.foto_ruta ? <Foto ruta={p.foto_ruta} className="h-16 w-16 shrink-0" /> : null}
              <textarea className="campo min-h-[44px] flex-1 resize-y py-2" rows={1} value={p.texto} placeholder="Qué hay que hacer en este paso" onChange={(e) => cambiarPaso(p.k, e.target.value)} />
              <span className="flex shrink-0 flex-col">
                <button aria-label="Subir" className="h-6 w-7 rounded text-suave hover:bg-white disabled:opacity-30" disabled={i === 0} onClick={() => moverPaso(i, -1)}>↑</button>
                <button aria-label="Bajar" className="h-6 w-7 rounded text-suave hover:bg-white disabled:opacity-30" disabled={i === pasosEd.length - 1} onClick={() => moverPaso(i, 1)}>↓</button>
              </span>
              <button aria-label="Quitar paso" className="mt-1.5 h-7 w-7 shrink-0 rounded-full text-primario-oscuro hover:bg-white" onClick={() => quitarPaso(p.k)}>×</button>
            </div>
          ))}
          <Boton variante="contorno" className="self-start" onClick={() => agregarPaso()}>+ Agregar paso</Boton>
        </div>
      )}

      {data.herr.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-[13px]"><span className="font-semibold">Herramientas:</span>{data.herr.map((h) => <Insignia key={h.id}>{h.texto}</Insignia>)}</div>}

      {data.reps.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">{orden.tarea_id ? '3 · ' : ''}Repuestos usados {sinVincular > 0 && <span className="font-normal text-primario-oscuro">· {sinVincular} sin vincular al pañol</span>}</span>
          {data.reps.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-fondo px-3 py-2 text-[13px]">
              <span className="min-w-[180px] flex-1"><b>{fmtNum(r.cantidad)}</b> × {r.texto}</span>
              {r.articulo ? <span className="text-aprobado">✓ {r.articulo.codigo} · descontado del pañol</span>
                : <span className="w-full max-w-[340px]"><SelectorArticulo placeholder="Vincular con el pañol…" onElegir={(a) => void vincular(r, a)} /></span>}
            </div>
          ))}
        </div>
      )}

      {cerrada && (
        <div className="flex flex-col gap-2 border-t border-linea pt-3.5">
          {orden.tarea_id
            ? <span className="text-[13px] text-suave">Al cargarla al plan, estos pasos quedan como procedimiento de la tarea, y los repuestos del pañol, las herramientas y el tiempo promedio se usan para predecir la próxima vez.</span>
            : <span className="text-[13px] text-suave">{orden.tipo === 'correctiva' ? 'Es una correctiva' : 'No viene de una tarea del plan'}: queda en el historial de la máquina.</span>}
          <div className="flex flex-wrap gap-2">
            {orden.tarea_id && <Boton cargando={ocupado === 'ref'} onClick={() => void guardarReferencia()}>Aprobar y cargar al plan</Boton>}
            {orden.revision_foto !== 'aprobada' && <Boton variante={orden.tarea_id ? 'secundario' : 'primario'} cargando={ocupado === 'aprobada'} onClick={() => void revisar('aprobada')}>Aprobar</Boton>}
            <Boton variante="peligro" cargando={ocupado === 'rehacer'} onClick={() => void revisar('rehacer')}>Pedir rehacer</Boton>
          </div>
          {sinVincular > 0 && orden.tarea_id && <span className="text-xs text-tenue">Vinculá los repuestos al pañol antes de cargar al plan para que entren en la predicción.</span>}
        </div>
      )}
      {orden.revision_foto === 'aprobada' && cerrada && <OkBox>Revisada.{orden.tarea_id ? ' Podés volver a cargarla al plan si corregiste algo.' : ''}</OkBox>}
    </Tarjeta>
  )
}

/** Un audio o video con su texto, que escribe el administrador escuchándolo */
function MedioRevision({ m, onGuardado, onPaso }: { m: Medio; onGuardado: () => void; onPaso: (t: string) => void }) {
  const avisar = useAviso()
  const [url, setUrl] = useState<string | null>(null)
  const [texto, setTexto] = useState(m.transcripcion ?? '')
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { void urlFirmada(m.ruta).then(setUrl) }, [m.ruta])
  useEffect(() => setTexto(m.transcripcion ?? ''), [m.transcripcion])

  async function guardar() {
    setGuardando(true)
    const { error } = await supabase.from('mant_ot_medios').update({ transcripcion: texto.trim() || null }).eq('id', m.id)
    setGuardando(false)
    if (error) avisar(mensajeError(error), 'error'); else { avisar('Texto guardado.'); onGuardado() }
  }
  // cada renglón del texto se puede pasar como un paso
  const renglones = texto.split(/\n+/).map((x) => x.trim()).filter(Boolean)

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-fondo p-2.5">
      <span className="text-xs text-tenue">{m.tipo === 'audio' ? 'Audio' : 'Video'} · {hora(m.creado_en)}{m.duracion_seg ? ` · ${Math.floor(m.duracion_seg / 60)}:${String(m.duracion_seg % 60).padStart(2, '0')}` : ''}</span>
      <div className="flex flex-wrap items-start gap-3">
        {url && (m.tipo === 'audio' ? <audio controls src={url} className="w-full max-w-[360px]" /> : <video controls playsInline src={url} className="max-h-56 rounded-lg" />)}
        <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
          <textarea className="campo min-h-[80px] resize-y" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Escuchalo y escribí lo que dice. Un renglón por cada paso si querés pasarlos al procedimiento." />
          <div className="flex flex-wrap gap-2">
            {texto !== (m.transcripcion ?? '') && <Boton variante="secundario" cargando={guardando} onClick={() => void guardar()}>Guardar texto</Boton>}
            {renglones.length > 0 && <Boton variante="contorno" onClick={() => renglones.forEach(onPaso)}>Pasar {renglones.length === 1 ? 'como paso' : `${renglones.length} renglones como pasos`}</Boton>}
          </div>
        </div>
      </div>
    </div>
  )
}
