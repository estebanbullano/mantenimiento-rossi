import { useEffect, useState } from 'react'
import { mensajeError, supabase } from '@/lib/supabase'
import { fmtNum, urlFirmada, useDatos } from '@/lib/util'
import type { Articulo, Orden } from '@/lib/tipos'
import { Boton, H2, Insignia, OkBox, Tarjeta, useAviso } from './ui'
import { Foto, SelectorArticulo } from './selectores'

interface Evento { id: string; tipo: 'inicio' | 'pausa' | 'reanudar' | 'fin'; creado_en: string }
interface FotoOT { id: string; ruta: string; tipo: string; nota: string | null; paso: number | null; creado_en: string; tomada_en: string | null; desfase_seg: number | null }
interface Rep { id: string; texto: string; cantidad: number; articulo_id: string | null; articulo?: { codigo: string; descripcion: string } | null }
interface Medio { id: string; tipo: 'audio' | 'video'; ruta: string; transcripcion: string | null; creado_en: string }
const EV = { inicio: 'Inició', pausa: 'Pausó', reanudar: 'Reanudó', fin: 'Terminó' }
const hora = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

/** Revisión del cierre por el administrador: qué se hizo, cuánto tardó, con qué; y guardarlo como referencia */
export function RevisionCierre({ orden, onCambio }: { orden: Orden; onCambio: () => void }) {
  const avisar = useAviso()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const { data, recargar } = useDatos(async () => {
    const [e, f, h, r, m] = await Promise.all([
      supabase.from('mant_ot_eventos').select('*').eq('orden_id', orden.id).order('creado_en'),
      supabase.from('mant_ot_fotos').select('*').eq('orden_id', orden.id).order('creado_en'),
      supabase.from('mant_ot_herramientas').select('id,texto').eq('orden_id', orden.id),
      supabase.from('mant_ot_repuestos').select('id,texto,cantidad,articulo_id, articulo:mant_articulos(codigo,descripcion)').eq('orden_id', orden.id),
      supabase.from('mant_ot_medios').select('*').eq('orden_id', orden.id).order('creado_en')
    ])
    return { data: { eventos: (e.data ?? []) as Evento[], fotos: (f.data ?? []) as FotoOT[], herr: (h.data ?? []) as { id: string; texto: string }[], reps: (r.data ?? []) as unknown as Rep[], medios: (m.data ?? []) as Medio[] }, error: e.error }
  }, [orden.id, orden.estado])

  if (!data) return null
  const pasos = data.fotos.filter((f) => f.tipo === 'paso')
  const final = data.fotos.filter((f) => f.tipo === 'cierre').at(-1)
  const sinVincular = data.reps.filter((r) => !r.articulo_id).length
  if (!data.eventos.length && !pasos.length && !final && !data.reps.length && !data.medios.length) return null

  async function vincular(r: Rep, a: Articulo) {
    const { error } = await supabase.from('mant_ot_repuestos').update({ articulo_id: a.id }).eq('id', r.id)
    if (error) avisar(mensajeError(error), 'error'); else void recargar()
  }
  async function guardarReferencia() {
    setOcupado('ref')
    const { data: res, error } = await supabase.rpc('mant_aprender_de_ot', { p_orden: orden.id })
    setOcupado(null)
    if (error) return avisar(mensajeError(error), 'error')
    const r = res as { pasos: number; repuestos: number; herramientas: number; horas: number | null }
    avisar(`Guardado como referencia: ${r.pasos} pasos, ${r.repuestos} repuestos, ${r.herramientas} herramientas${r.horas ? `, ${fmtNum(r.horas, 1)} h estimadas` : ''}.`)
    onCambio()
  }
  async function revisar(res: 'aprobada' | 'rehacer') {
    let comentario: string | null = null
    if (res === 'rehacer') { comentario = prompt('¿Qué hay que rehacer? (lo ve el operario)'); if (comentario === null) return }
    setOcupado(res)
    const { error } = await supabase.rpc('mant_revisar_foto', { p_orden: orden.id, p_resultado: res, p_comentario: comentario })
    setOcupado(null)
    if (error) avisar(mensajeError(error), 'error'); else onCambio()
  }

  return (
    <Tarjeta className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H2 texto="Ejecución y cierre" />
        {orden.revision_foto === 'aprobada' ? <Insignia t="verde">Revisada y aprobada</Insignia> : orden.estado === 'completada' ? <Insignia t="amarillo">Por revisar</Insignia> : null}
      </div>

      {data.eventos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {data.eventos.map((e) => <Insignia key={e.id} t={e.tipo === 'pausa' ? 'amarillo' : e.tipo === 'fin' ? 'verde' : 'azul'}>{EV[e.tipo]} {hora(e.creado_en)}</Insignia>)}
          {orden.tiempo_real_min != null && <span className="font-semibold">· tiempo real {orden.tiempo_real_min >= 60 ? `${fmtNum(orden.tiempo_real_min / 60, 1)} h` : `${orden.tiempo_real_min} min`}</span>}
        </div>
      )}

      {pasos.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Pasos con foto ({pasos.length})</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {pasos.map((f) => (
              <div key={f.id} className="flex flex-col gap-1"><Foto ruta={f.ruta} className="aspect-square w-full" /><span className="text-xs text-texto-2"><b>{f.paso}.</b> {f.nota ?? 'sin nota'} <span className="text-tenue">· {hora(f.creado_en).slice(-5)}</span></span></div>
            ))}
          </div>
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

      {data.herr.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-[13px]"><span className="font-semibold">Herramientas:</span>{data.herr.map((h) => <Insignia key={h.id}>{h.texto}</Insignia>)}</div>}

      {data.reps.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Repuestos usados {sinVincular > 0 && <span className="font-normal text-primario-oscuro">· {sinVincular} sin vincular al pañol</span>}</span>
          {data.reps.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-fondo px-3 py-2 text-[13px]">
              <span className="min-w-[180px] flex-1"><b>{fmtNum(r.cantidad)}</b> × {r.texto}</span>
              {r.articulo ? <span className="text-aprobado">✓ {r.articulo.codigo} · descontado del pañol</span>
                : <span className="w-full max-w-[340px]"><SelectorArticulo placeholder="Vincular con el pañol…" onElegir={(a) => void vincular(r, a)} /></span>}
            </div>
          ))}
        </div>
      )}

      {data.medios.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Audios y videos</span>
          {data.medios.map((m) => <MedioFila key={m.id} m={m} />)}
        </div>
      )}
      {orden.comentario_cierre && <div className="rounded-[14px] bg-fondo px-3.5 py-3 text-sm"><span className="mb-1 block text-xs text-tenue">Lo que contó el operario</span>{orden.comentario_cierre}</div>}

      {orden.estado === 'completada' && (
        <div className="flex flex-col gap-2 border-t border-linea pt-3.5">
          {orden.tarea_id
            ? <span className="text-[13px] text-suave">Al guardarla como referencia, los pasos con foto quedan como procedimiento de la tarea, y los repuestos del pañol, las herramientas y el tiempo promedio se usan para predecir la próxima vez.</span>
            : <span className="text-[13px] text-suave">Es una correctiva: queda en el historial de la máquina.</span>}
          <div className="flex flex-wrap gap-2">
            {orden.tarea_id && <Boton cargando={ocupado === 'ref'} onClick={() => void guardarReferencia()}>Aprobar y guardar como referencia</Boton>}
            {orden.revision_foto !== 'aprobada' && <Boton variante={orden.tarea_id ? 'secundario' : 'primario'} cargando={ocupado === 'aprobada'} onClick={() => void revisar('aprobada')}>Aprobar</Boton>}
            <Boton variante="peligro" cargando={ocupado === 'rehacer'} onClick={() => void revisar('rehacer')}>Pedir rehacer</Boton>
          </div>
          {sinVincular > 0 && orden.tarea_id && <span className="text-xs text-tenue">Vinculá los repuestos al pañol antes de guardar la referencia para que entren en la predicción.</span>}
        </div>
      )}
      {orden.revision_foto === 'aprobada' && orden.estado === 'completada' && <OkBox>Revisada.{orden.tarea_id ? ' Podés volver a guardarla como referencia si corregiste algo.' : ''}</OkBox>}
    </Tarjeta>
  )
}

function MedioFila({ m }: { m: Medio }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { void urlFirmada(m.ruta).then(setUrl) }, [m.ruta])
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-fondo p-2.5">
      {url && (m.tipo === 'audio' ? <audio controls src={url} className="max-w-full" /> : <video controls src={url} className="max-h-48 rounded-lg" />)}
      {m.transcripcion && <span className="flex-1 text-[13px] italic text-texto-2">“{m.transcripcion}”</span>}
    </div>
  )
}
