import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useOperarios } from '@/lib/catalogos'
import { useDatos } from '@/lib/util'
import { AREAS, type Pedido, type Prioridad } from '@/lib/tipos'
import { ANTIGUEDADES, cargarDetalles, cumpleAntiguedad, estadoTicket, grupoPrioridad, tituloTicket, type Antiguedad } from '@/lib/tickets'
import { Boton, Cargando, ErrorBox, Pagina, Vacio, useAviso } from '@/components/ui'
import { FormularioPedido, TarjetaTicket, type Detalles } from '@/components/Ticket'

type VistaMant = 'priorizacion' | 'lista' | 'equipo' | 'mios'

/** Tickets de mantenimiento: la vista del solicitante (celular) y el panel de mantenimiento */
export function Pedidos() {
  const { puede } = useSesion()
  const [params] = useSearchParams()
  const esMant = puede('referente', 'supervisor')
  return esMant && !params.get('mios') ? <PanelMantenimiento /> : <VistaSolicitante />
}

/** Tickets (todos, o solo los de un solicitante) con sus comentarios y materiales */
function useTickets(solicitanteId?: string) {
  const [detalles, setDetalles] = useState<Detalles>({ comentarios: {}, materiales: {} })
  const r = useDatos(async () => {
    let q = supabase.from('mant_v_pedidos').select('*').order('creado_en', { ascending: false }).limit(400)
    if (solicitanteId) q = q.eq('solicitante_id', solicitanteId)
    const res = await q
    const data = (res.data ?? []) as Pedido[]
    setDetalles(await cargarDetalles(data.map((t) => t.id)))
    return { data, error: res.error }
  }, [solicitanteId])
  return { ...r, detalles }
}

// ---------------------------------------------------------------------
// Solicitante: formulario + seguimiento de sus pedidos
// ---------------------------------------------------------------------
function VistaSolicitante() {
  const { usuario, puede } = useSesion()
  const [tab, setTab] = useState<'activos' | 'completados'>('activos')
  const [fPrio, setFPrio] = useState('')
  const [fEstado, setFEstado] = useState('')
  const [fAntig, setFAntig] = useState<Antiguedad>('')
  const [mostrarForm, setMostrarForm] = useState(true)
  const { data, cargando, error, recargar, detalles } = useTickets(usuario!.id)

  const lista = useMemo(() => {
    let l = data ?? []
    l = l.filter((t) => fEstado ? estadoTicket(t.estado) === fEstado : (tab === 'completados' ? estadoTicket(t.estado) === 'completado' : estadoTicket(t.estado) !== 'completado'))
    if (fPrio) l = l.filter((t) => grupoPrioridad(t.prioridad) === fPrio)
    l = l.filter((t) => cumpleAntiguedad(t, fAntig))
    const orden = { alta: 0, media: 1, baja: 2 }
    return l.slice().sort((a, b) => orden[grupoPrioridad(a.prioridad)] - orden[grupoPrioridad(b.prioridad)] || b.creado_en.localeCompare(a.creado_en))
  }, [data, tab, fPrio, fEstado, fAntig])

  const sel = 'campo w-auto py-1.5 text-xs'
  return (
    <Pagina titulo="Pedidos de reparación" subtitulo={data ? `${data.length} pedidos tuyos registrados` : 'cargando…'}
      acciones={puede('referente', 'supervisor') ? <Boton variante="secundario" onClick={() => { window.location.hash = '#/pedidos' }}>Vista mantenimiento</Boton> : undefined}>
      {mostrarForm ? <FormularioPedido onEnviado={() => { setTab('activos'); void recargar() }} /> : <Boton onClick={() => setMostrarForm(true)}>+ Nuevo pedido</Boton>}

      <div className="mt-4 rounded-xl border border-borde bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-borde">
            {(['activos', 'completados'] as const).map((v) => (
              <button key={v} onClick={() => setTab(v)} className={`px-3 py-1.5 text-xs font-bold ${tab === v ? 'bg-pendiente text-[#2a1f00]' : 'bg-fondo-2 text-suave'}`}>{v === 'activos' ? 'Activos' : 'Completados'}</button>
            ))}
          </div>
          <select className={sel} value={fPrio} onChange={(e) => setFPrio(e.target.value)}><option value="">Prioridad: todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
          <select className={sel} value={fEstado} onChange={(e) => setFEstado(e.target.value)}><option value="">Estado: todos</option><option value="pendiente">Pendiente</option><option value="proceso">En proceso</option><option value="completado">Completado</option></select>
          <select className={sel} value={fAntig} onChange={(e) => setFAntig(e.target.value as Antiguedad)}>{ANTIGUEDADES.map(([v, txt]) => <option key={v} value={v}>{txt}</option>)}</select>
          <button className="text-xs font-bold text-suave underline" onClick={() => { setFPrio(''); setFEstado(''); setFAntig('') }}>Limpiar filtros</button>
        </div>
      </div>

      <ErrorBox texto={error} />
      {cargando && !data ? <Cargando /> : lista.length === 0 ? (
        <Vacio texto={tab === 'completados' ? 'Todavía no hay pedidos completados' : 'No tenés pedidos activos'}>
          <span className="text-xs">{tab === 'completados' ? 'Acá vas a ver los pedidos una vez que mantenimiento los cierre.' : 'Usá el formulario de arriba para enviar uno.'}</span>
        </Vacio>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((t) => <TarjetaTicket key={t.id} t={t} modo="solicitante" detalles={detalles} onCambio={() => void recargar()} />)}
        </div>
      )}
    </Pagina>
  )
}

// ---------------------------------------------------------------------
// Mantenimiento: priorización, lista, por equipo
// ---------------------------------------------------------------------
function PanelMantenimiento() {
  const avisar = useAviso()
  const [params] = useSearchParams()
  const { data: operarios } = useOperarios()
  const [vista, setVista] = useState<VistaMant>(params.get('busca') ? 'lista' : 'priorizacion')
  const [busca, setBusca] = useState(params.get('busca') ?? '')
  const [fEstado, setFEstado] = useState('')
  const [fPrio, setFPrio] = useState('')
  const [fRec, setFRec] = useState('')
  const [fArea, setFArea] = useState('')
  const [fResp, setFResp] = useState('')
  const [fAntig, setFAntig] = useState<Antiguedad>('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulkPrio, setBulkPrio] = useState('')
  const [bulkCom, setBulkCom] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const { data, cargando, error, recargar, detalles } = useTickets()
  useEffect(() => setSel(new Set()), [vista])

  const stats = useMemo(() => {
    const c = { pendiente: 0, proceso: 0, completado: 0, espera: 0 }
    for (const t of data ?? []) { const e = estadoTicket(t.estado); if (e in c) c[e as keyof typeof c]++; if (t.recursos === 'esperando' && e !== 'completado') c.espera++ }
    return c
  }, [data])

  const lista = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return (data ?? []).filter((t) => {
      const e = estadoTicket(t.estado)
      if (fEstado && e !== fEstado) return false
      if (!fEstado && e === 'rechazado') return false
      if (fPrio && grupoPrioridad(t.prioridad) !== fPrio) return false
      if (fRec && t.recursos !== fRec) return false
      if (fArea && t.area !== fArea) return false
      if (fResp && !(t.responsable_nombre ?? '').toLowerCase().includes(fResp.toLowerCase())) return false
      if (!cumpleAntiguedad(t, fAntig)) return false
      if (q && !`${tituloTicket(t)} ${t.equipo_codigo ?? ''} ${t.equipo_nombre ?? ''} ${t.area ?? ''} ${t.descripcion} ${t.solicitante_nombre ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, busca, fEstado, fPrio, fRec, fArea, fResp, fAntig])

  async function aplicarPrioridad() {
    if (!bulkPrio) return
    const { error } = await supabase.from('mant_pedidos').update({ prioridad: bulkPrio as Prioridad }).in('id', [...sel])
    if (error) avisar(mensajeError(error), 'error')
    setBulkPrio(''); void recargar()
  }
  async function aplicarEstado(estado: string) {
    if (!estado) return
    for (const id of sel) {
      const { error } = await supabase.rpc('mant_estado_pedido', { p_pedido: id, p_estado: estado })
      if (error) { avisar(mensajeError(error), 'error'); break }
    }
    void recargar()
  }
  async function aplicarComentario() {
    const texto = bulkCom.trim(); if (!texto) return
    const { error } = await supabase.from('mant_pedido_comentarios').insert([...sel].map((pedido_id) => ({ pedido_id, texto })))
    if (error) avisar(mensajeError(error), 'error')
    setBulkCom(''); void recargar()
  }

  const tarjeta = (t: Pedido) => (
    <TarjetaTicket key={t.id} t={t} modo="mantenimiento" detalles={detalles} operarios={operarios ?? []}
      seleccionado={sel.has(t.id)} onSeleccionar={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(t.id); else n.delete(t.id); return n })}
      onCambio={() => void recargar()} />
  )
  const grilla = (ts: Pedido[]) => <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{ts.map(tarjeta)}</div>
  const titulo = (txt: string, color = 'text-suave border-borde') => <h2 className={`mb-2.5 mt-5 border-b pb-1.5 text-sm font-extrabold uppercase tracking-wide first:mt-0 ${color}`}>{txt}</h2>

  let contenido: ReactNode
  if (cargando && !data) contenido = <Cargando />
  else if (!data?.length) contenido = <Vacio texto="No hay tickets cargados. Esperá pedidos de las áreas o cargá uno vos." />
  else if (!lista.length) contenido = <Vacio texto="Ningún resultado. Probá ajustar o limpiar los filtros." />
  else if (vista === 'priorizacion') {
    const abiertos = lista.filter((t) => estadoTicket(t.estado) !== 'completado')
    const g = { alta: abiertos.filter((t) => grupoPrioridad(t.prioridad) === 'alta'), media: abiertos.filter((t) => grupoPrioridad(t.prioridad) === 'media'), baja: abiertos.filter((t) => grupoPrioridad(t.prioridad) === 'baja') }
    contenido = abiertos.length ? <>
      {g.alta.length > 0 && <>{titulo(`Prioridad alta (${g.alta.length})`, 'text-[#c1440e] border-[#c1440e]')}{grilla(g.alta)}</>}
      {g.media.length > 0 && <>{titulo(`Prioridad media (${g.media.length})`, 'text-[#9a7100] border-pendiente')}{grilla(g.media)}</>}
      {g.baja.length > 0 && <>{titulo(`Prioridad baja (${g.baja.length})`)}{grilla(g.baja)}</>}
    </> : <Vacio texto="Todo al día. No quedan tickets abiertos con los filtros actuales." />
  } else if (vista === 'equipo') {
    const grupos: Record<string, Pedido[]> = {}
    for (const t of lista) (grupos[t.equipo_codigo ? `${t.equipo_codigo} · ${t.equipo_nombre}` : 'Sin equipo asignado'] ??= []).push(t)
    contenido = Object.keys(grupos).sort().map((k) => <div key={k}>{titulo(`${k} (${grupos[k].length})`)}{grilla(grupos[k])}</div>)
  } else contenido = grilla(lista)

  const selCls = 'campo w-auto py-1.5 text-xs'
  return (
    <Pagina titulo="Panel de mantenimiento" subtitulo={data ? `Datos compartidos con el equipo · ${data.length} tickets registrados` : 'cargando…'}
      acciones={<div className="flex flex-wrap gap-1.5">
        {([['pendiente', 'Pendientes', 'text-[#9a7100]'], ['proceso', 'En proceso', 'text-revision'], ['completado', 'Completadas', 'text-aprobado'], ['espera', 'Esperan material', 'text-[#c1440e]']] as const).map(([k, txt, c]) => (
          <div key={k} className="min-w-[76px] rounded-lg border border-borde bg-white px-3 py-1.5 text-center">
            <div className={`text-xl font-extrabold leading-none ${c}`}>{stats[k]}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-suave">{txt}</div>
          </div>
        ))}
      </div>}>
      <div className="mb-4 rounded-xl border border-borde bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Boton onClick={() => setMostrarForm((v) => !v)}>{mostrarForm ? 'Cerrar formulario' : '+ Nuevo ticket'}</Boton>
          <div className="flex overflow-hidden rounded-lg border border-borde">
            {([['priorizacion', 'Priorización'], ['lista', 'Lista'], ['equipo', 'Por equipo']] as [VistaMant, string][]).map(([v, txt]) => (
              <button key={v} onClick={() => setVista(v)} className={`whitespace-nowrap px-3 py-1.5 text-xs font-bold ${vista === v ? 'bg-pendiente text-[#2a1f00]' : 'bg-fondo-2 text-suave'}`}>{txt}</button>
            ))}
            <a href="#/agenda" className="whitespace-nowrap bg-fondo-2 px-3 py-1.5 text-xs font-bold text-suave">Agenda semanal</a>
          </div>
          <input className="campo min-w-40 flex-1 py-1.5 text-xs" placeholder="Buscar por título, equipo, área o descripción…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className={selCls} value={fEstado} onChange={(e) => setFEstado(e.target.value)}><option value="">Estado: todos</option><option value="pendiente">Pendiente</option><option value="proceso">En proceso</option><option value="completado">Completado</option><option value="rechazado">Descartado</option></select>
          <select className={selCls} value={fPrio} onChange={(e) => setFPrio(e.target.value)}><option value="">Prioridad: todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
          <select className={selCls} value={fRec} onChange={(e) => setFRec(e.target.value)}><option value="">Recursos: todos</option><option value="listo">Listo para hacer</option><option value="esperando">Esperando material</option><option value="sinmateriales">Sin materiales cargados</option></select>
          <select className={selCls} value={fArea} onChange={(e) => setFArea(e.target.value)}><option value="">Área: todas</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select>
          <select className={selCls} value={fAntig} onChange={(e) => setFAntig(e.target.value as Antiguedad)}>{ANTIGUEDADES.map(([v, txt]) => <option key={v} value={v}>{txt}</option>)}</select>
          <input className="campo w-40 py-1.5 text-xs" placeholder="Filtrar por responsable" value={fResp} onChange={(e) => setFResp(e.target.value)} />
          <button className="text-xs font-bold text-suave underline" onClick={() => { setFEstado(''); setFPrio(''); setFRec(''); setFArea(''); setFResp(''); setFAntig(''); setBusca('') }}>Limpiar filtros</button>
        </div>
      </div>

      {mostrarForm && <div className="mb-4"><FormularioPedido compacto onEnviado={() => { setMostrarForm(false); void recargar() }} /></div>}

      {sel.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#c1440e] bg-[#c1440e]/10 px-3 py-2">
          <span className="font-mono text-xs font-bold text-[#c1440e]">{sel.size} seleccionado{sel.size > 1 ? 's' : ''}</span>
          <select className={selCls} value="" onChange={(e) => void aplicarEstado(e.target.value)}><option value="">Cambiar estado a…</option><option value="pendiente">Pendiente</option><option value="proceso">En proceso</option></select>
          <select className={selCls} value={bulkPrio} onChange={(e) => setBulkPrio(e.target.value)}><option value="">Cambiar prioridad a…</option><option value="urgente">Urgente</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
          <Boton variante="secundario" className="py-1.5 text-xs" onClick={() => void aplicarPrioridad()}>Aplicar prioridad</Boton>
          <input className="campo min-w-40 flex-1 py-1.5 text-xs" placeholder="Comentario para todos los seleccionados…" value={bulkCom} onChange={(e) => setBulkCom(e.target.value)} />
          <Boton variante="secundario" className="py-1.5 text-xs" onClick={() => void aplicarComentario()}>Agregar comentario</Boton>
          <button className="text-xs font-bold text-suave underline" onClick={() => setSel(new Set())}>Deseleccionar</button>
        </div>
      )}

      <ErrorBox texto={error} />
      {contenido}
    </Pagina>
  )
}
