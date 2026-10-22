import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useOperarios } from '@/lib/catalogos'
import { fmtFecha, fmtNum, hoy, lunesDe, numOT, numPedido, sumarDias, useDatos } from '@/lib/util'
import type { ComentarioPedido, Orden, Pedido, Prioridad, Usuario } from '@/lib/tipos'
import { Barra, Boton, Cargando, ErrorBox, ESTADO_EQUIPO, H2, InsEstadoEquipo, InsEstadoPedido, InsPrioridad, OkBox, Pagina, estadoBandeja, useAviso } from '@/components/ui'
import { Foto } from '@/components/selectores'
import { MarcoTelefono, PedidosCelular } from './Solicitante'

/** "Pedidos": la bandeja para mantenimiento; para el resto, su vista de celular */
export function Pedidos() {
  const { puede } = useSesion()
  const [params] = useSearchParams()
  if (puede('referente', 'supervisor', 'director') && !params.get('mios')) return <Bandeja />
  return <MarcoTelefono><PedidosCelular inicial="mis" /></MarcoTelefono>
}

const edad = (iso: string) => {
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000))
  return h < 1 ? 'recién' : h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}
const filaDato = (k: string, v: React.ReactNode) => (
  <div className="grid grid-cols-[170px_minmax(0,1fr)] items-baseline gap-3 border-b border-linea-2 px-3.5 py-2.5 last:border-0">
    <span className="text-[13px] text-tenue">{k}</span><span className="font-medium">{v}</span>
  </div>
)

type FEstado = 'abiertos' | 'nuevos' | 'pendientes' | 'proceso' | 'completados' | 'todos'

function Bandeja() {
  const [params] = useSearchParams()
  const [fPrio, setFPrio] = useState('')
  const [fEstado, setFEstado] = useState<FEstado>('abiertos')
  const [orden, setOrden] = useState<'recientes' | 'antiguos'>('recientes')
  const [abierto, setAbierto] = useState<string | null>(params.get('id'))
  const { data: operarios } = useOperarios()

  const { data, cargando, error, recargar } = useDatos(async () => {
    const lunes = lunesDe(new Date())
    const [p, o] = await Promise.all([
      supabase.from('mant_v_pedidos').select('*').order('creado_en', { ascending: false }).limit(500),
      supabase.from('mant_v_ordenes').select('id,asignado_id,fecha_programada,duracion_estimada_horas,estado,tipo')
        .gte('fecha_programada', lunes).lte('fecha_programada', sumarDias(lunes, 6)).in('estado', ['pendiente', 'en_proceso', 'completada'])
    ])
    return { data: { pedidos: (p.data ?? []) as Pedido[], ots: (o.data ?? []) as Orden[] }, error: p.error || o.error }
  })

  const lista = useMemo(() => {
    let l = data?.pedidos ?? []
    l = l.filter((p) => {
      const [, est] = estadoBandeja(p.estado, p.prioridad)
      if (fEstado === 'abiertos') return est === 'Nuevo' || est === 'Pendiente' || est === 'En proceso'
      if (fEstado === 'nuevos') return est === 'Nuevo'
      if (fEstado === 'pendientes') return est === 'Pendiente'
      if (fEstado === 'proceso') return est === 'En proceso'
      if (fEstado === 'completados') return est === 'Completado'
      return true
    })
    if (fPrio === 'sin') l = l.filter((p) => !p.prioridad)
    else if (fPrio) l = l.filter((p) => (fPrio === 'alta' ? p.prioridad === 'alta' || p.prioridad === 'urgente' : p.prioridad === fPrio))
    return orden === 'antiguos' ? l.slice().reverse() : l
  }, [data, fPrio, fEstado, orden])

  const sel = 'min-h-[40px] rounded-full border border-borde-campo bg-white px-3.5 py-2 text-sm text-texto'
  return (
    <Pagina kicker="Módulo 2 · Correctivo" titulo="Bandeja de pedidos">
      <div className="flex flex-wrap items-center gap-[18px] text-[13px]">
        <label className="flex items-center gap-2"><span className="font-medium text-suave">Prioridad</span>
          <select className={sel} value={fPrio} onChange={(e) => setFPrio(e.target.value)}>
            <option value="">Todas</option><option value="sin">Sin prioridad</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
          </select></label>
        <label className="flex items-center gap-2"><span className="font-medium text-suave">Estado</span>
          <select className={sel} value={fEstado} onChange={(e) => setFEstado(e.target.value as FEstado)}>
            <option value="abiertos">Abiertos</option><option value="nuevos">Nuevos</option><option value="pendientes">Pendientes</option><option value="proceso">En proceso</option><option value="completados">Completados</option><option value="todos">Todos</option>
          </select></label>
        <label className="flex items-center gap-2"><span className="font-medium text-suave">Antigüedad</span>
          <select className={sel} value={orden} onChange={(e) => setOrden(e.target.value as 'recientes' | 'antiguos')}>
            <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option>
          </select></label>
      </div>
      <ErrorBox texto={error} />
      <div className="tarjeta overflow-x-auto">
        <div className="min-w-[940px]">
          <div className="grid grid-cols-[86px_minmax(0,1fr)_200px_100px_130px_120px_36px] gap-3 border-b border-linea px-5 py-3.5 text-xs font-semibold uppercase tracking-[0.05em] text-tenue">
            <span>Pedido</span><span>Detalle</span><span>Equipo</span><span>Antigüedad</span><span>Prioridad</span><span>Estado</span><span />
          </div>
          {cargando && !data ? <Cargando /> : lista.length === 0 ? <div className="p-5 text-sm text-suave">No hay pedidos con esos filtros.</div> : lista.map((p) => (
            <Fragment key={p.id}>
              <button onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                className={`grid w-full grid-cols-[86px_minmax(0,1fr)_200px_100px_130px_120px_36px] items-center gap-3 border-b border-linea-2 px-5 py-3.5 text-left text-texto ${abierto === p.id ? 'bg-rojo-suave' : 'bg-white hover:bg-crema'}`}>
                <span className="text-[13px] font-semibold">{numPedido(p.numero)}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{p.titulo || p.descripcion}</span>
                  <span className="truncate text-xs text-tenue">{[p.area, p.nombre_contacto ?? p.solicitante_nombre].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex flex-col items-start gap-1">
                  <span className="text-[13px]">{p.equipo_nombre ?? p.ubicacion ?? 'Sin equipo'}</span>
                  <InsEstadoEquipo u={p.urgencia_reportada} />
                </span>
                <span className="text-[13px] text-suave">{edad(p.creado_en)}</span>
                <InsPrioridad p={p.prioridad} ancho />
                <InsEstadoPedido e={p.estado} prioridad={p.prioridad} ancho />
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-fondo font-bold text-primario-oscuro">{abierto === p.id ? '−' : '+'}</span>
              </button>
              {abierto === p.id && <DetallePedido p={p} operarios={operarios ?? []} ots={data?.ots ?? []} onCambio={() => void recargar()} />}
            </Fragment>
          ))}
        </div>
      </div>
    </Pagina>
  )
}

const CAPACIDAD_SEMANA = 5   // jornadas por operario (lunes a viernes)

function DetallePedido({ p, operarios, ots, onCambio }: { p: Pedido; operarios: Usuario[]; ots: Orden[]; onCambio: () => void }) {
  const nav = useNavigate()
  const avisar = useAviso()
  const asignado = p.estado === 'en_ot' || p.estado === 'cerrado'
  const [prio, setPrio] = useState<Prioridad | null>(p.prioridad)
  const [plazo, setPlazo] = useState(p.fecha_cierre_estimada ?? sumarDias(hoy(), p.urgencia_reportada === 'alta' ? 1 : p.urgencia_reportada === 'media' ? 3 : 7))
  const [dur, setDur] = useState(String(p.duracion_dias ?? (p.urgencia_reportada === 'baja' ? 0.25 : 0.5)).replace('.', ','))
  const [op, setOp] = useState('')
  const [obs, setObs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const durN = Number(dur.replace(',', '.')) || 0

  // Tiempo libre de cada operario esta semana y hoy (OT programadas, en jornadas de 8 h)
  const recomendados = useMemo(() => {
    const ops = operarios.filter((u) => u.rol === 'operario')
    return (ops.length ? ops : operarios).map((u) => {
      const mias = ots.filter((o) => o.asignado_id === u.id)
      const semana = mias.reduce((s, o) => s + (o.duracion_estimada_horas ?? 8) / 8, 0)
      const deHoy = mias.filter((o) => o.fecha_programada === hoy()).reduce((s, o) => s + (o.duracion_estimada_horas ?? 8) / 8, 0)
      return { u, libre: Math.max(0, CAPACIDAD_SEMANA - semana), libreHoy: Math.max(0, 1 - deHoy) }
    }).sort((a, b) => b.libre - a.libre)
  }, [operarios, ots])
  const mejor = recomendados.find((r) => r.libreHoy >= durN) ?? recomendados[0]
  const elegido = op || mejor?.u.id || ''

  async function fijarPrioridad(v: Prioridad) {
    setPrio(v)
    const { error } = await supabase.from('mant_pedidos').update({ prioridad: v }).eq('id', p.id)
    if (error) avisar(mensajeError(error), 'error'); else onCambio()
  }

  async function convertir() {
    if (!prio) return setError('Elegí la prioridad.')
    if (!plazo) return setError('Elegí el plazo.')
    if (!elegido) return setError('Elegí quién lo hace.')
    setError(null); setGuardando(true)
    const { error } = await supabase.rpc('mant_convertir_pedido', {
      p_pedido: p.id, p_prioridad: prio, p_plazo: plazo, p_duracion_dias: durN || 1, p_operario: elegido, p_dia: hoy(), p_observacion: obs.trim() || null
    })
    setGuardando(false)
    if (error) setError(mensajeError(error))
    else { avisar('Pedido convertido en OT y asignado.'); onCambio() }
  }

  async function rechazar() {
    const motivo = prompt('¿Por qué se descarta este pedido? (lo ve el solicitante)')
    if (motivo === null) return
    const { error } = await supabase.rpc('mant_resolver_pedido', { p_pedido: p.id, p_aprobar: false, p_motivo: motivo || null })
    if (error) avisar(mensajeError(error), 'error'); else onCambio()
  }

  return (
    <div className="mx-4 mb-4 mt-1 flex flex-col overflow-hidden rounded-tarjeta border-2 border-primario">
      <div className="flex flex-col gap-2.5 p-5 text-sm">
        <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-rojo-claro text-[13px] font-bold text-primario-oscuro">1</span><H2 texto="Detalle del pedido" className="text-lg" /></div>
        <div className="overflow-hidden rounded-[14px] border border-linea bg-white">
          {filaDato('Fecha', new Date(p.creado_en).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }))}
          {filaDato('Solicitante', p.nombre_contacto ?? p.solicitante_nombre ?? '—')}
          {filaDato('Área', p.area ?? '—')}
          {filaDato('Equipo', p.equipo_codigo ? `${p.equipo_nombre} (${p.equipo_codigo})` : p.ubicacion ?? '—')}
          {filaDato('Estado del equipo', p.urgencia_reportada ? ESTADO_EQUIPO[p.urgencia_reportada][1] : '—')}
          {p.email_contacto && filaDato('Avisos a', p.email_contacto)}
        </div>
        <div className="rounded-[14px] bg-fondo px-3.5 py-3 leading-relaxed"><span className="mb-1 block text-xs text-tenue">Descripción del solicitante</span><span className="whitespace-pre-wrap">{p.descripcion}</span></div>
        {p.foto_ruta && <Foto ruta={p.foto_ruta} className="h-[220px] w-full max-w-[420px] rounded-[14px]" />}
        {p.motivo_rechazo && <div className="rounded-[14px] bg-beige px-3.5 py-3"><b>Descartado:</b> {p.motivo_rechazo}</div>}
      </div>

      <div className="flex flex-col gap-3.5 border-t border-linea bg-[#faf7f2] p-5">
        <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primario text-[13px] font-bold text-white">2</span><H2 texto="Asignación de la tarea" className="text-lg" /></div>
        {asignado ? (
          <>
            <OkBox>Convertido en <b>{p.orden_numero ? numOT(p.orden_numero) : 'OT'}</b> · asignado a {p.responsable_nombre ?? '—'} · plazo {fmtFecha(p.fecha_cierre_estimada)}. El solicitante ya ve la fecha comprometida.</OkBox>
            <div className="flex flex-wrap gap-2">
              <Boton variante="secundario" onClick={() => nav('/ordenes')}>Ver en la agenda →</Boton>
              {p.orden_id && <Boton variante="secundario" onClick={() => nav(`/ordenes/${p.orden_id}`)}>Abrir la OT</Boton>}
            </div>
            <CambiarPlazo p={p} onCambio={onCambio} />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Prioridad</span>
              <div className="flex gap-1.5">
                {(['alta', 'media', 'baja'] as Prioridad[]).map((v) => (
                  <button key={v} onClick={() => void fijarPrioridad(v)}
                    className={`min-h-[40px] rounded-full border px-4 py-2 text-sm capitalize ${prio === v ? 'border-primario bg-primario font-semibold text-white' : 'border-borde-campo bg-white text-texto-2'}`}>{v}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-[1_1_130px] flex-col gap-1.5 text-[13px] font-semibold">Plazo
                <input type="date" className="campo font-normal" value={plazo} min={hoy()} onChange={(e) => setPlazo(e.target.value)} /></label>
              <label className="flex flex-[1_1_100px] flex-col gap-1.5 text-[13px] font-semibold">Duración (días)
                <input className="campo font-normal" inputMode="decimal" value={dur} onChange={(e) => setDur(e.target.value)} /></label>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Recomendación por tiempo libre</span>
              {recomendados.slice(0, 3).map((r) => {
                const activo = elegido === r.u.id
                return (
                  <button key={r.u.id} onClick={() => setOp(r.u.id)}
                    className={`flex flex-col gap-1.5 rounded-2xl border px-3.5 py-3 text-left ${activo ? 'border-2 border-primario bg-white' : 'border-borde bg-white'}`}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{r.u.nombre} {r.u.turno && <span className="text-xs font-normal text-suave">· turno {r.u.turno.toLowerCase()}</span>}</span>
                      {r === mejor && <span className="rounded-full bg-aprobado px-2.5 py-0.5 text-[11px] font-bold text-white">Recomendado</span>}
                    </span>
                    <span className="text-xs text-suave">Libre {fmtNum(r.libre, 2).replace(/,?0+$/, '')} d en la semana · hoy {fmtNum(r.libreHoy, 2).replace(/,?0+$/, '')} d</span>
                    <Barra pct={(r.libre / CAPACIDAD_SEMANA) * 100} color="#1e6b3a" alto="h-[5px]" />
                  </button>
                )
              })}
              <span className="text-xs text-tenue">Ordena por tiempo libre en la semana y verifica que hoy le alcance para {dur || '—'} días.</span>
            </div>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">O asignar a otro operario
              <select className="campo font-normal" value={elegido} onChange={(e) => setOp(e.target.value)}>
                {operarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.turno ? ` · turno ${u.turno.toLowerCase()}` : ''}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              <span>Observación para el operario <span className="text-xs font-normal text-tenue">Opcional · la ve en el celular junto a la tarea</span></span>
              <textarea className="campo resize-y font-normal" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: llevar guía de 3 m del pañol, avisar a producción antes de cortar el paso" />
            </label>
            <ErrorBox texto={error} />
            <Boton grande className="w-full" cargando={guardando} onClick={() => void convertir()}>Convertir en OT y asignar</Boton>
            {p.estado !== 'rechazado' && <button className="self-start text-[13px] text-tenue underline" onClick={() => void rechazar()}>Descartar el pedido</button>}
          </>
        )}
        <Seguimiento pedidoId={p.id} />
      </div>
    </div>
  )
}

function CambiarPlazo({ p, onCambio }: { p: Pedido; onCambio: () => void }) {
  const avisar = useAviso()
  const [abrir, setAbrir] = useState(false)
  const [fecha, setFecha] = useState(p.fecha_cierre_estimada ?? hoy())
  const [motivo, setMotivo] = useState('')
  if (p.estado === 'cerrado') return null
  if (!abrir) return <button className="self-start text-[13px] font-semibold text-primario-oscuro" onClick={() => setAbrir(true)}>Cambiar la fecha comprometida</button>
  async function guardar() {
    const { error } = await supabase.rpc('mant_cambiar_fecha_cierre', { p_pedido: p.id, p_fecha: fecha, p_motivo: motivo.trim() || null })
    if (error) avisar(mensajeError(error), 'error'); else { setAbrir(false); onCambio() }
  }
  return (
    <div className="flex flex-wrap items-end gap-2.5 rounded-2xl border border-borde bg-white p-3.5">
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">Nueva fecha<input type="date" className="campo font-normal" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      <label className="flex flex-[1_1_220px] flex-col gap-1.5 text-[13px] font-semibold">Motivo (lo ve el solicitante)<input className="campo font-normal" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: falta el repuesto" /></label>
      <Boton onClick={() => void guardar()}>Guardar</Boton>
      <Boton variante="fantasma" onClick={() => setAbrir(false)}>Cancelar</Boton>
    </div>
  )
}

function Seguimiento({ pedidoId }: { pedidoId: string }) {
  const avisar = useAviso()
  const [texto, setTexto] = useState('')
  const { data, recargar } = useDatos(async () => {
    const [c, u] = await Promise.all([
      supabase.from('mant_pedido_comentarios').select('*').eq('pedido_id', pedidoId).order('creado_en'),
      supabase.from('mant_usuarios').select('id,nombre')
    ])
    const n = Object.fromEntries(((u.data ?? []) as { id: string; nombre: string }[]).map((x) => [x.id, x.nombre]))
    return { data: ((c.data ?? []) as ComentarioPedido[]).map((x) => ({ ...x, autor_nombre: x.autor_id ? n[x.autor_id] : 'Sistema' })), error: c.error }
  }, [pedidoId])
  async function agregar() {
    if (!texto.trim()) return
    const { error } = await supabase.from('mant_pedido_comentarios').insert({ pedido_id: pedidoId, texto: texto.trim() })
    if (error) avisar(mensajeError(error), 'error'); else { setTexto(''); void recargar() }
  }
  return (
    <div className="flex flex-col gap-2 border-t border-linea pt-3.5">
      <span className="text-[13px] font-semibold">Seguimiento <span className="font-normal text-tenue">· lo ve el solicitante</span></span>
      {!data?.length ? <span className="text-[13px] text-tenue">Sin novedades todavía.</span> : data.map((c) => (
        <div key={c.id} className="border-l-2 border-borde-campo pl-2.5 text-[13px]">
          <div className="text-[11px] text-tenue">{new Date(c.creado_en).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {c.autor_nombre}</div>{c.texto}
        </div>
      ))}
      <div className="flex gap-2">
        <input className="campo" placeholder="Agregar una novedad…" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void agregar()} />
        <Boton variante="secundario" onClick={() => void agregar()}>Agregar</Boton>
      </div>
    </div>
  )
}

