import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useEquipos } from '@/lib/catalogos'
import { fmtFecha, fmtFechaHora, hoy, numOT, numPedido, subirArchivo, sumarDias } from '@/lib/util'
import { AREAS, DISPONIBILIDADES, RECURSOS, URGENCIAS, type ComentarioPedido, type Disponibilidad, type MaterialPedido, type Pedido, type Prioridad, type Urgencia, type Usuario } from '@/lib/tipos'
import { ESTADOS_TICKET, PLAZOS, PRIO_TXT, diasDesde, dosSemanas, estadoCierre, estadoTicket, tituloTicket, txtDias } from '@/lib/tickets'
import { Boton, Campo, ErrorBox, Tarjeta, useAviso } from './ui'
import { BotonFoto, Foto, SelectorEquipo } from './selectores'

// =====================================================================
// Formulario "Nuevo pedido" (el que usan los usuarios desde el celular)
// =====================================================================
export function FormularioPedido({ equipoInicial, onEnviado, compacto }: { equipoInicial?: string | null; onEnviado?: (numero: number) => void; compacto?: boolean }) {
  const { usuario } = useSesion()
  const avisar = useAviso()
  const { data: equipos } = useEquipos()
  const [equipoId, setEquipoId] = useState<string | null>(null)
  const [sinEquipo, setSinEquipo] = useState(false)
  const [ubicacion, setUbicacion] = useState('')
  const [area, setArea] = useState(usuario?.area && AREAS.includes(usuario.area) ? usuario.area : '')
  const [urgencia, setUrgencia] = useState<Urgencia>('media')
  const [fecha, setFecha] = useState(hoy())
  const [descripcion, setDescripcion] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (equipoInicial && equipos) {
      const e = equipos.find((x) => x.codigo.toUpperCase() === equipoInicial.toUpperCase() || x.id === equipoInicial)
      if (e) setEquipoId(e.id)
    }
  }, [equipoInicial, equipos])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!sinEquipo && !equipoId) { setError('Elegí el equipo o máquina afectada, o marcá que no sabés cuál es.'); return }
    if (!descripcion.trim()) { setError('Contá qué está pasando.'); return }
    setError(null); setEnviando(true)
    try {
      const equipo = equipos?.find((x) => x.id === equipoId)
      const foto_ruta = foto ? await subirArchivo(`pedidos/${usuario!.id}`, foto) : null
      const { data, error } = await supabase.from('mant_pedidos').insert({
        titulo: `Reparación: ${equipo ? equipo.nombre : ubicacion.trim() || 'sin equipo'}`,
        equipo_id: sinEquipo ? null : equipoId,
        ubicacion: sinEquipo ? ubicacion.trim() : null,
        area: area || null,
        descripcion: descripcion.trim(),
        urgencia_reportada: urgencia,
        equipo_detenido: urgencia === 'alta',
        fecha_reporte: fecha || hoy(),
        foto_ruta
      }).select('numero').single()
      if (error) throw error
      avisar(`Pedido ${numPedido(data.numero)} enviado. Podés seguir su estado desde acá.`)
      setEquipoId(null); setSinEquipo(false); setUbicacion(''); setDescripcion(''); setUrgencia('media'); setFecha(hoy()); setFoto(null)
      onEnviado?.(data.numero)
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <ErrorBox texto={error} />
      <Tarjeta titulo="Nuevo pedido" className="border-primario/40">
        {!compacto && <p className="mb-4 text-sm text-suave">Contá qué pasa y dónde. Mantenimiento lo revisa, le asigna prioridad según los recursos disponibles y te avisa la fecha probable de cierre.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tu nombre"><input className="campo" value={usuario?.nombre ?? ''} disabled /></Campo>
          <Campo etiqueta="Área">
            <select className="campo" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Seleccionar área…</option>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Campo>
          <div className="sm:col-span-2">
            <Campo etiqueta="Equipo o máquina afectada">
              {sinEquipo
                ? <input className="campo" placeholder="¿Dónde está? Ej.: Planta de pastas, línea 2, junto a la envasadora" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} />
                : <SelectorEquipo equipos={equipos ?? []} valor={equipoId} onCambio={setEquipoId} placeholder="Buscar por código o nombre… Ej.: Bomba hidráulica P-204" />}
            </Campo>
            <label className="mt-1.5 flex items-center gap-2 text-sm text-suave">
              <input type="checkbox" checked={sinEquipo} onChange={(e) => setSinEquipo(e.target.checked)} /> No sé qué equipo es
            </label>
          </div>
          <Campo etiqueta="¿Qué tan urgente lo ves?">
            <select className="campo" value={urgencia} onChange={(e) => setUrgencia(e.target.value as Urgencia)}>
              {URGENCIAS.map(([v, txt]) => <option key={v} value={v}>{txt}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Fecha del reporte"><input type="date" className="campo" value={fecha} max={hoy()} onChange={(e) => setFecha(e.target.value)} /></Campo>
          <div className="sm:col-span-2">
            <Campo etiqueta="Descripción del problema">
              <textarea className="campo min-h-24" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Describí qué está pasando: qué hace, desde cuándo, si hay ruido, pérdida, olor…" />
            </Campo>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <BotonFoto texto={foto ? 'Cambiar foto' : 'Sacar foto (opcional)'} onArchivo={setFoto} />
            {foto && <span className="truncate text-sm text-suave">{foto.name}</span>}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Boton type="submit" grande className="w-full sm:w-auto" cargando={enviando}>Enviar pedido</Boton>
        </div>
      </Tarjeta>
    </form>
  )
}

// =====================================================================
// Tarjeta del ticket
// =====================================================================
const SELLO: Record<'alta' | 'media' | 'baja' | 'urgente', string> = {
  urgente: 'border-primario text-primario', alta: 'border-[#c1440e] text-[#c1440e]', media: 'border-[#9a7100] text-[#9a7100]', baja: 'border-suave text-suave'
}
const Sello = ({ p }: { p: Prioridad | null }) => p ? (
  <span className={`inline-block -rotate-3 rounded border-2 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-widest ${SELLO[p]}`}>{PRIO_TXT[p]}</span>
) : null

const PILDORA: Record<string, string> = {
  pendiente: 'bg-pendiente/25 text-[#8a5a00]', proceso: 'bg-revision/15 text-revision', completado: 'bg-aprobado/15 text-aprobado', rechazado: 'bg-black/10 text-suave',
  listo: 'bg-[#3b7a3b] text-white', esperando: 'bg-[#9a5a00] text-white', sinmateriales: 'bg-[#8a8370] text-white',
  correctivo: 'bg-[#c1440e] text-white', preventivo: 'bg-[#2e8b7d] text-white'
}
const Pildora = ({ k, children }: { k: string; children: ReactNode }) => (
  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PILDORA[k] ?? PILDORA.pendiente}`}>{children}</span>
)

const Bloque = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <div className="mt-3 border-t border-dashed border-[#b8b09a] pt-2">
    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8a8370]">{titulo}</div>
    {children}
  </div>
)

export interface Detalles { comentarios: Record<string, ComentarioPedido[]>; materiales: Record<string, MaterialPedido[]> }

interface Props {
  t: Pedido
  modo: 'solicitante' | 'mantenimiento'
  detalles: Detalles
  operarios?: Usuario[]
  seleccionado?: boolean
  onSeleccionar?: (v: boolean) => void
  onCambio: () => void
}

/** Tarjeta "papel" del ticket. En modo mantenimiento se edita todo en el lugar. */
export function TarjetaTicket({ t, modo, detalles, operarios = [], seleccionado, onSeleccionar, onCambio }: Props) {
  const { usuario } = useSesion()
  const avisar = useAviso()
  const nav = useNavigate()
  const est = estadoTicket(t.estado)
  const cierre = estadoCierre(t)
  const edita = modo === 'mantenimiento'
  const comentarios = detalles.comentarios[t.id] ?? []
  const materiales = detalles.materiales[t.id] ?? []
  const d = diasDesde(t.fecha_reporte)
  const [comentario, setComentario] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [rechazando, setRechazando] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  async function actualizar(campos: Partial<Pedido>) {
    const { error } = await supabase.from('mant_pedidos').update(campos).eq('id', t.id)
    if (error) avisar(mensajeError(error), 'error')
    onCambio()
  }
  async function rpc(fn: string, args: Record<string, unknown>) {
    setGuardando(true)
    const r = await supabase.rpc(fn, args)
    setGuardando(false)
    if (r.error) { avisar(mensajeError(r.error), 'error'); return { ok: false as const, data: null } }
    onCambio()
    return { ok: true as const, data: r.data as unknown }
  }
  async function cambiarEstado(nuevo: string) {
    if (nuevo === est) return
    if (nuevo === 'completado') {
      // El cierre es por la orden de trabajo, con foto: si no hay OT todavía, se crea y se va a cerrarla
      let ot = t.orden_id && t.orden_estado !== 'cancelada' ? t.orden_id : null
      if (!ot) { const r = await rpc('mant_estado_pedido', { p_pedido: t.id, p_estado: 'proceso' }); if (!r.ok) return; ot = r.data as string }
      avisar('Para completar el ticket cerrá la orden de trabajo con la foto del trabajo terminado.')
      nav(`/ordenes/${ot}`)
      return
    }
    if (nuevo === 'rechazado') { setRechazando(true); return }
    await rpc('mant_estado_pedido', { p_pedido: t.id, p_estado: nuevo })
  }
  async function descartar() {
    if (!motivoRechazo.trim()) return
    await supabase.from('mant_pedidos').update({ motivo_rechazo: motivoRechazo.trim() }).eq('id', t.id)
    const r = await rpc('mant_estado_pedido', { p_pedido: t.id, p_estado: 'rechazado' })
    if (r.ok) setRechazando(false)
  }
  async function agregarComentario() {
    const texto = comentario.trim(); if (!texto) return
    const { error } = await supabase.from('mant_pedido_comentarios').insert({ pedido_id: t.id, texto })
    if (error) { avisar(mensajeError(error), 'error'); return }
    setComentario(''); onCambio()
  }

  return (
    <article className={`relative rounded-lg border border-dashed border-[#b8b09a] bg-[#ece7db] p-4 text-[#2b2822] ${cierre ? `border-l-8 border-l-solid ${cierre.borde}` : ''} ${seleccionado ? 'outline-2 outline-offset-2 outline-pendiente' : ''}`}
      style={cierre ? { borderLeftStyle: 'solid' } : undefined}>
      {/* perforación */}
      <span className="absolute left-3.5 top-3.5 h-3 w-3 rounded-full bg-[#1c1f22] shadow-[inset_0_0_0_2px_#b8b09a]" />
      <div className="ml-6">
        <div className="flex items-start justify-between gap-2">
          {edita ? (
            <select className="rounded border border-[#b8b09a] bg-white px-1.5 py-0.5 text-[11px]" value={t.prioridad ?? 'media'} onChange={(e) => void actualizar({ prioridad: e.target.value as Prioridad })}>
              {(['urgente', 'alta', 'media', 'baja'] as Prioridad[]).map((p) => <option key={p} value={p}>{PRIO_TXT[p]}</option>)}
            </select>
          ) : <Sello p={t.prioridad} />}
          {onSeleccionar && <input type="checkbox" className="h-4 w-4 accent-[#c1440e]" checked={!!seleccionado} onChange={(e) => onSeleccionar(e.target.checked)} />}
        </div>
        <div className="mt-1 font-mono text-[10px] text-[#8a8370]">
          {numPedido(t.numero)}{t.orden_numero && t.orden_estado !== 'cancelada' ? ` · ${numOT(t.orden_numero)}` : ''}
          {edita && t.urgencia_reportada ? ` · urgencia reportada: ${PRIO_TXT[t.urgencia_reportada]}` : ''}
        </div>
        <h3 className="mt-1.5 text-[15px] font-extrabold uppercase leading-tight">{tituloTicket(t)}</h3>
        <div className="mt-0.5 text-xs text-[#5c5748]">
          {t.equipo_codigo ? <><b>{t.equipo_codigo}</b> · {t.equipo_nombre}</> : (t.ubicacion || 'sin equipo asignado')}
          {t.area ? ` · ${t.area}` : ''}{edita && t.solicitante_nombre ? ` · pedido por ${t.solicitante_nombre}` : ''}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[#b8b09a] pt-2.5">
          {edita ? (
            <select className="rounded border border-[#b8b09a] bg-white px-1.5 py-0.5 text-[11px]" value={est} disabled={guardando} onChange={(e) => void cambiarEstado(e.target.value)}>
              <option value="pendiente">Pendiente</option>
              <option value="proceso">En proceso</option>
              <option value="completado">Completado</option>
              <option value="rechazado">Descartado</option>
            </select>
          ) : <Pildora k={est}>{ESTADOS_TICKET[est]}</Pildora>}
          {(edita || materiales.length > 0) && t.recursos && <Pildora k={t.recursos}>{RECURSOS[t.recursos]}</Pildora>}
          {t.equipo_detenido && est !== 'completado' && <Pildora k="correctivo">Equipo parado</Pildora>}
        </div>

        <div className="mt-1.5 text-[11px] text-[#5c5748]">
          {edita ? <>Responsable: <b>{t.responsable_nombre ?? 'sin asignar'}</b></> : <>Reportado por: {t.solicitante_nombre ?? 'sin nombre'}</>}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-[#8a8370]">
          Fecha: {fmtFecha(t.fecha_reporte)}{d != null && est !== 'completado' ? (d <= 0 ? ' · hoy' : ` · hace ${txtDias(d)}`) : ''}
        </div>
        {t.motivo_rechazo && est === 'rechazado' && <div className="mt-1.5 text-xs text-rechazado">Descartado: {t.motivo_rechazo}</div>}
        {rechazando && (
          <div className="mt-2 rounded bg-[#f6d9d0] px-2.5 py-2 text-[11px] text-[#8a2b0e]">
            <div className="mb-1 font-bold">¿Por qué se descarta? Lo va a ver quien lo pidió.</div>
            <div className="flex flex-wrap gap-1.5">
              <input className="min-w-40 flex-1 rounded border border-[#b8b09a] bg-white px-2 py-1 text-[11px] text-[#2b2822]" value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Motivo…" />
              <button type="button" className="rounded bg-rechazado px-2.5 py-1 font-bold text-white" onClick={() => void descartar()}>Descartar</button>
              <button type="button" className="px-2 py-1" onClick={() => setRechazando(false)}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Fecha probable de cierre */}
        {est === 'proceso' && (edita ? <BloqueCierre t={t} cierre={cierre} rpc={rpc} actualizar={actualizar} /> : (
          <Bloque titulo="Fecha probable de cierre">
            {t.fecha_cierre_estimada
              ? <div className="flex flex-wrap items-center gap-2 text-xs font-bold">{fmtFecha(t.fecha_cierre_estimada)} {cierre && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${cierre.clase}`}>{cierre.texto}</span>}</div>
              : <span className="rounded-full bg-[#b8b09a] px-2 py-0.5 text-[10px] font-bold uppercase text-[#3a3626]">Todavía sin definir</span>}
          </Bloque>
        ))}

        {edita && est !== 'completado' && <BloqueAsignacion t={t} operarios={operarios} rpc={rpc} actualizar={actualizar} />}

        <p className="mt-2 text-xs leading-relaxed text-[#4a4638]">{t.descripcion}</p>
        {t.foto_ruta && <div className="mt-2"><Foto ruta={t.foto_ruta} className="h-20 w-20" /></div>}

        {edita && <BloqueMateriales t={t} materiales={materiales} onCambio={onCambio} />}

        {(comentarios.length > 0 || est !== 'rechazado') && (
          <Bloque titulo="Seguimiento">
            {comentarios.map((c) => (
              <div key={c.id} className="mb-1.5 border-l-2 border-[#b8b09a] pl-2 text-[11px] text-[#4a4638]">
                <div className="font-mono text-[9px] text-[#8a8370]">{fmtFechaHora(c.creado_en)} · {c.autor_nombre}</div>
                {c.texto}
              </div>
            ))}
            {est !== 'rechazado' && (
              <div className="mt-1.5 flex gap-1.5">
                <input className="min-w-0 flex-1 rounded border border-[#b8b09a] bg-white px-2 py-1.5 text-[11px]" placeholder={edita ? 'Agregar comentario…' : 'Preguntar o agregar un dato…'}
                  value={comentario} onChange={(e) => setComentario(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void agregarComentario() }} />
                <button type="button" className="rounded border border-[#b8b09a] bg-white px-2.5 py-1 text-[11px] font-bold" onClick={() => void agregarComentario()}>Agregar</button>
              </div>
            )}
          </Bloque>
        )}

        {t.orden_id && t.orden_estado !== 'cancelada' && (edita || t.solicitante_id === usuario?.id || t.asignados_ids.includes(usuario?.id ?? '')) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button type="button" className="rounded border border-[#b8b09a] bg-white px-2.5 py-1 text-[10px] font-bold" onClick={() => nav(`/ordenes/${t.orden_id}`)}>
              {est === 'completado' ? 'Ver orden cerrada' : 'Ver orden de trabajo'}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: boolean; data: unknown }>
type Act = (campos: Partial<Pedido>) => Promise<void>

function BloqueCierre({ t, cierre, rpc, actualizar }: { t: Pedido; cierre: ReturnType<typeof estadoCierre>; rpc: Rpc; actualizar: Act }) {
  const [pendiente, setPendiente] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [falta, setFalta] = useState(false)

  async function elegirPlazo(dias: number) {
    const nueva = sumarDias(hoy(), dias)
    if (t.fecha_cierre_estimada && t.fecha_cierre_estimada !== nueva) { setPendiente(nueva); setMotivo(''); setFalta(false); return }
    await rpc('mant_cambiar_fecha_cierre', { p_pedido: t.id, p_fecha: nueva })
  }
  async function confirmar() {
    if (!motivo.trim()) { setFalta(true); return }
    const r = await rpc('mant_cambiar_fecha_cierre', { p_pedido: t.id, p_fecha: pendiente, p_motivo: motivo.trim() })
    if (r.ok) setPendiente(null)
  }

  if (pendiente) {
    return (
      <div className="-mx-4 -mb-4 mt-3 border-t border-[#d9c896] bg-[#f5e6c8] px-4 pb-4 pl-10 pt-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#8a8370]">Motivo del cambio de fecha</div>
        <div className="mb-1.5 text-[11px] text-[#6b5a30]">Nueva fecha: {fmtFecha(pendiente)} (antes: {fmtFecha(t.fecha_cierre_estimada)})</div>
        <div className="flex flex-wrap gap-1.5">
          <input className={`min-w-40 flex-1 rounded border bg-white px-2 py-1.5 text-[11px] ${falta ? 'border-[#c1440e]' : 'border-[#b8b09a]'}`} placeholder={falta ? 'Hace falta que cuentes el motivo…' : 'Contá por qué se cambia la fecha…'} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button type="button" className="rounded bg-pendiente px-2.5 py-1 text-[11px] font-bold" onClick={() => void confirmar()}>Guardar</button>
          <button type="button" className="rounded px-2 py-1 text-[11px]" onClick={() => setPendiente(null)}>Cancelar</button>
        </div>
      </div>
    )
  }
  const c = t.cambio_fecha
  const asunto = `Cambio de fecha - Pedido ${numPedido(t.numero)}: ${tituloTicket(t)}`
  const cuerpo = c ? `Hola ${t.solicitante_nombre ?? ''},\n\nTe avisamos que la fecha probable de cierre de tu pedido "${tituloTicket(t)}" (${numPedido(t.numero)}) se modificó:\n\n- Fecha anterior: ${c.de ? fmtFecha(c.de) : 'sin fecha'}\n- Fecha nueva: ${fmtFecha(c.a)}\n- Motivo: ${c.motivo}\n\nSaludos,\nEquipo de Mantenimiento - Agrícola Magdalena` : ''
  return (
    <Bloque titulo="Fecha posible de cierre">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {t.fecha_cierre_estimada
          ? <><span className="text-xs font-extrabold">{fmtFecha(t.fecha_cierre_estimada)}</span>{cierre && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${cierre.clase}`}>{cierre.texto}</span>}</>
          : <span className="rounded-full bg-[#b8b09a] px-2 py-0.5 text-[10px] font-bold uppercase text-[#3a3626]">Sin fecha estimada</span>}
      </div>
      <select className="w-full max-w-56 rounded border border-[#b8b09a] bg-white px-2 py-1.5 text-[11px]" value="" onChange={(e) => { if (e.target.value) void elegirPlazo(Number(e.target.value)) }}>
        <option value="">{t.fecha_cierre_estimada ? 'Cambiar plazo…' : 'Elegir plazo…'}</option>
        {PLAZOS.map((p) => <option key={p} value={p}>En {p} días</option>)}
      </select>
      {c && !c.avisado && (
        <div className={`mt-2 flex flex-col items-start gap-1.5 rounded px-2.5 py-2 text-[11px] leading-snug ${t.solicitante_email ? 'bg-[#fbe6cf] text-[#8a4b00]' : 'bg-[#efe9da] text-[#6b6350]'}`}>
          {t.solicitante_email
            ? <>📧 La fecha cambió y el solicitante todavía no fue avisado ({t.solicitante_email}).
              <a className="rounded bg-pendiente px-2.5 py-1 font-bold text-[#2a1f00]" href={`mailto:${encodeURIComponent(t.solicitante_email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`}>Abrir email de aviso</a></>
            : <>La fecha se cambió, pero quien pidió no tiene email cargado: avisale por otro medio (igual lo ve en la app).</>}
          <button type="button" className="rounded border border-current px-2 py-0.5 text-[10px]" onClick={() => void actualizar({ cambio_fecha: { ...c, avisado: true } })}>
            {t.solicitante_email ? 'Marcar como avisado' : 'Listo, ya avisé'}
          </button>
        </div>
      )}
    </Bloque>
  )
}

function BloqueAsignacion({ t, operarios, rpc, actualizar }: { t: Pedido; operarios: Usuario[]; rpc: Rpc; actualizar: Act }) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'warning'; texto: string } | null>(null)
  const [duracion, setDuracion] = useState(t.duracion_dias != null ? String(t.duracion_dias) : '')
  const [detalle, setDetalle] = useState(t.tercerizado_detalle ?? '')
  useEffect(() => setDuracion(t.duracion_dias != null ? String(t.duracion_dias) : ''), [t.duracion_dias])
  const dias = dosSemanas().flatMap((s) => s.dias)

  async function cargarAgenda() {
    const r = await rpc('mant_cargar_agenda', { p_pedido: t.id })
    if (!r.ok) return
    const sobre = (r.data as { nombre: string; dia: string; total: number }[]) ?? []
    const nombres = (t.asignados_nombres ?? []).join(', ')
    setMsg(sobre.length
      ? { tipo: 'warning', texto: `⚠️ Ojo, esto deja sobrecargado a: ${sobre.map((s) => `${s.nombre} el ${fmtFecha(s.dia)} (${Number(s.total)} días en total)`).join('; ')}. La carga ya quedó guardada en la agenda, revisá si hace falta reprogramar.` }
      : { tipo: 'ok', texto: `Se cargó en la agenda semanal para: ${nombres}${t.tercerizado ? ' (+ tercerizado)' : ''}.` })
  }

  return (
    <Bloque titulo="Asignar personal">
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1.5">
        {operarios.map((u) => (
          <label key={u.id} className="flex items-center gap-1 text-[11px] text-[#4a4638]">
            <input type="checkbox" className="accent-[#c1440e]" checked={t.asignados_ids.includes(u.id)}
              onChange={(e) => void actualizar({ asignados_ids: e.target.checked ? [...t.asignados_ids, u.id] : t.asignados_ids.filter((x) => x !== u.id), responsable_id: t.responsable_id ?? (e.target.checked ? u.id : null) })} />
            {u.nombre}
          </label>
        ))}
        <label className="flex items-center gap-1 text-[11px] font-bold text-[#8a5a00]">
          <input type="checkbox" className="accent-[#c1440e]" checked={t.tercerizado} onChange={(e) => void actualizar({ tercerizado: e.target.checked })} /> Tercerizar
        </label>
      </div>
      {t.tercerizado && (
        <input className="mb-2 w-full rounded border border-[#b8b09a] bg-white px-2 py-1.5 text-[11px]" placeholder="Empresa / proveedor tercerizado" value={detalle}
          onChange={(e) => setDetalle(e.target.value)} onBlur={() => { if (detalle !== (t.tercerizado_detalle ?? '')) void actualizar({ tercerizado_detalle: detalle.trim() || null }) }} />
      )}
      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-[10px] uppercase tracking-wide text-[#8a8370]">Responsable
          <select className="mt-1 w-full rounded border border-[#b8b09a] bg-white px-1.5 py-1.5 text-[11px] normal-case tracking-normal text-[#2b2822]" value={t.responsable_id ?? ''} onChange={(e) => void actualizar({ responsable_id: e.target.value || null })}>
            <option value="">Sin asignar</option>
            {operarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wide text-[#8a8370]">Duración estimada (días)
          <input type="number" min={0.5} step={0.5} placeholder="Ej: 1.5" className="mt-1 w-full rounded border border-[#b8b09a] bg-white px-1.5 py-1.5 text-[11px] text-[#2b2822]" value={duracion}
            onChange={(e) => setDuracion(e.target.value)} onBlur={() => { const v = parseFloat(duracion); if ((isNaN(v) ? null : v) !== t.duracion_dias) void actualizar({ duracion_dias: isNaN(v) ? null : v }) }} />
        </label>
        <label className="text-[10px] uppercase tracking-wide text-[#8a8370]">Día de inicio
          <select className="mt-1 w-full rounded border border-[#b8b09a] bg-white px-1.5 py-1.5 text-[11px] normal-case tracking-normal text-[#2b2822]" value={t.fecha_inicio ?? ''} onChange={(e) => void actualizar({ fecha_inicio: e.target.value || null })}>
            <option value="">Elegir día…</option>
            {dias.map((d) => <option key={d.iso} value={d.iso}>{d.etiqueta}</option>)}
            {t.fecha_inicio && !dias.some((d) => d.iso === t.fecha_inicio) && <option value={t.fecha_inicio}>{fmtFecha(t.fecha_inicio)}</option>}
          </select>
        </label>
      </div>
      <button type="button" className="rounded border border-[#b8b09a] bg-white px-2.5 py-1 text-[11px] font-bold" onClick={() => void cargarAgenda()}>Cargar en agenda semanal</button>
      {msg && (
        <div className={`relative mt-2 rounded px-2.5 py-2 pr-7 text-[11px] leading-snug ${msg.tipo === 'ok' ? 'bg-[#dff0e6] text-[#1f5c3a]' : 'bg-[#fbe6cf] text-[#8a4b00]'}`}>
          {msg.texto}
          <button type="button" className="absolute right-1.5 top-1 text-[11px]" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}
    </Bloque>
  )
}

function BloqueMateriales({ t, materiales, onCambio }: { t: Pedido; materiales: MaterialPedido[]; onCambio: () => void }) {
  const avisar = useAviso()
  const [nombre, setNombre] = useState('')
  const [cant, setCant] = useState('')
  const [disp, setDisp] = useState<Disponibilidad>('sin_verificar')

  async function agregar() {
    if (!nombre.trim()) return
    const { error } = await supabase.from('mant_pedido_materiales').insert({ pedido_id: t.id, nombre: nombre.trim(), cantidad: cant.trim() || null, disponibilidad: disp })
    if (error) { avisar(mensajeError(error), 'error'); return }
    setNombre(''); setCant(''); setDisp('sin_verificar'); onCambio()
  }
  async function cambiar(id: string, campos: Partial<MaterialPedido>) {
    const { error } = await supabase.from('mant_pedido_materiales').update(campos).eq('id', id)
    if (error) avisar(mensajeError(error), 'error')
    onCambio()
  }
  async function quitar(id: string) {
    const { error } = await supabase.from('mant_pedido_materiales').delete().eq('id', id)
    if (error) avisar(mensajeError(error), 'error')
    onCambio()
  }
  const sel = 'rounded border border-[#b8b09a] bg-white px-1 py-0.5 text-[10px]'
  return (
    <Bloque titulo="Materiales / recursos necesarios">
      {materiales.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-1.5 py-0.5 text-[11px]">
          <span className="flex-1">{m.nombre}{m.cantidad ? ` × ${m.cantidad}` : ''}</span>
          <select className={sel} value={m.disponibilidad} onChange={(e) => void cambiar(m.id, { disponibilidad: e.target.value as Disponibilidad })}>
            {(Object.keys(DISPONIBILIDADES) as Disponibilidad[]).map((k) => <option key={k} value={k}>{DISPONIBILIDADES[k]}</option>)}
          </select>
          <button type="button" className="px-1 text-sm text-[#a33]" onClick={() => void quitar(m.id)} aria-label="Quitar">×</button>
        </div>
      ))}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <input className="min-w-28 flex-1 rounded border border-[#b8b09a] bg-white px-2 py-1 text-[11px]" placeholder="Material o recurso" value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void agregar() }} />
        <input className="w-14 rounded border border-[#b8b09a] bg-white px-2 py-1 text-[11px]" placeholder="Cant." value={cant} onChange={(e) => setCant(e.target.value)} />
        <select className="rounded border border-[#b8b09a] bg-white px-1.5 py-1 text-[11px]" value={disp} onChange={(e) => setDisp(e.target.value as Disponibilidad)}>
          {(Object.keys(DISPONIBILIDADES) as Disponibilidad[]).map((k) => <option key={k} value={k}>{DISPONIBILIDADES[k]}</option>)}
        </select>
        <button type="button" className="rounded border border-[#b8b09a] bg-white px-2.5 py-1 text-[11px] font-bold" onClick={() => void agregar()}>Agregar</button>
      </div>
    </Bloque>
  )
}
