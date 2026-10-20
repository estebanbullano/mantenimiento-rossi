import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { TURNOS, useOperarios } from '@/lib/catalogos'
import { fmtFecha, fmtFechaHora, hoy, numPedido, sumarDias, useDatos } from '@/lib/util'
import { PRIORIDADES, type Pedido, type Prioridad } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, Insignia, InsEstadoPedido, InsPrioridad, Modal, Pagina, Pestanas, Vacio, useAviso } from '@/components/ui'
import { Foto } from '@/components/selectores'

type Vista = 'priorizar' | 'todos' | 'mios'

const PLAZO: Record<Prioridad, number> = { urgente: 0, alta: 1, media: 3, baja: 7 }

export function Pedidos() {
  const { usuario, puede } = useSesion()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const esMant = puede('referente', 'supervisor')
  const [vista, setVista] = useState<Vista>(params.get('mios') || !esMant ? 'mios' : 'priorizar')
  const [resolviendo, setResolviendo] = useState<Pedido | null>(null)

  const { data, cargando, error, recargar } = useDatos(async () => {
    let q = supabase.from('mant_v_pedidos').select('*').order('creado_en', { ascending: false }).limit(300)
    if (vista === 'priorizar') q = q.eq('estado', 'nuevo')
    if (vista === 'mios') q = q.eq('solicitante_id', usuario!.id)
    const r = await q
    return { data: (r.data ?? []) as Pedido[], error: r.error }
  }, [vista])

  const nuevos = vista === 'priorizar' ? data?.length : undefined
  const opciones: [Vista, string, number?][] = esMant
    ? [['priorizar', 'Por priorizar', nuevos], ['todos', 'Todos'], ['mios', 'Mis pedidos']]
    : [['mios', 'Mis pedidos']]

  return (
    <Pagina titulo="Pedidos de reparación" acciones={<Boton onClick={() => nav('/pedido/nuevo')}>+ Nuevo pedido</Boton>}>
      {opciones.length > 1 && <Pestanas valor={vista} opciones={opciones} onCambio={setVista} />}
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data?.length ? (
        <Vacio texto={vista === 'priorizar' ? 'No hay pedidos nuevos para priorizar.' : 'No hay pedidos.'} />
      ) : (
        <div className="grid gap-3">
          {data.map((p) => (
            <div key={p.id} className={`rounded-xl border bg-white p-4 ${p.equipo_detenido && p.estado === 'nuevo' ? 'border-primario' : 'border-borde'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-suave">{numPedido(p.numero)}</span>
                    <InsEstadoPedido e={p.estado} />
                    <InsPrioridad p={p.prioridad} />
                    {p.equipo_detenido && <Insignia t="primario">Equipo parado</Insignia>}
                  </div>
                  <p className="mt-1.5 font-bold">{p.descripcion}</p>
                  <p className="mt-1 text-sm text-suave">
                    {p.equipo_codigo ? <><b className="text-texto">{p.equipo_codigo}</b> · {p.equipo_nombre}</> : p.ubicacion}
                    {' · '}{p.area ?? 'Sin área'} · {p.solicitante_nombre} · {fmtFechaHora(p.creado_en)}
                  </p>
                  {p.fecha_comprometida && <p className="mt-1 text-sm">Fecha comprometida: <b>{fmtFecha(p.fecha_comprometida)}</b></p>}
                  {p.motivo_rechazo && <p className="mt-1 text-sm text-rechazado">Motivo: {p.motivo_rechazo}</p>}
                </div>
                {p.foto_ruta && <Foto ruta={p.foto_ruta} className="h-20 w-20" />}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.estado === 'nuevo' && esMant && <Boton onClick={() => setResolviendo(p)}>Priorizar y asignar</Boton>}
                {p.orden_id && (esMant || puede('operario') || p.solicitante_id === usuario?.id) &&
                  <Boton variante="secundario" onClick={() => nav(`/ordenes/${p.orden_id}`)}>Ver orden de trabajo</Boton>}
              </div>
            </div>
          ))}
        </div>
      )}
      {resolviendo && <Resolver pedido={resolviendo} onCerrar={() => setResolviendo(null)} onListo={() => { setResolviendo(null); void recargar() }} />}
    </Pagina>
  )
}

function Resolver({ pedido, onCerrar, onListo }: { pedido: Pedido; onCerrar: () => void; onListo: () => void }) {
  const avisar = useAviso()
  const { data: operarios } = useOperarios()
  const [prioridad, setPrioridad] = useState<Prioridad>(pedido.equipo_detenido ? 'urgente' : 'media')
  const [fecha, setFecha] = useState(sumarDias(hoy(), PLAZO[pedido.equipo_detenido ? 'urgente' : 'media']))
  const [asignado, setAsignado] = useState('')
  const [turno, setTurno] = useState('')
  const [rechazar, setRechazar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true); setError(null)
    const { error } = await supabase.rpc('mant_resolver_pedido', {
      p_pedido: pedido.id, p_aprobar: !rechazar, p_prioridad: prioridad,
      p_fecha_comprometida: fecha || null, p_asignado: asignado || null, p_turno: turno || null,
      p_motivo: rechazar ? motivo : null
    })
    setGuardando(false)
    if (error) { setError(mensajeError(error)); return }
    avisar(rechazar ? 'Pedido rechazado.' : 'Se creó la orden de trabajo.')
    onListo()
  }

  return (
    <Modal abierto titulo={`Pedido ${numPedido(pedido.numero)}`} onCerrar={onCerrar}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        {rechazar
          ? <Boton variante="peligro" cargando={guardando} disabled={!motivo.trim()} onClick={() => void guardar()}>Rechazar pedido</Boton>
          : <Boton cargando={guardando} onClick={() => void guardar()}>Crear orden de trabajo</Boton>}
      </>}>
      <ErrorBox texto={error} />
      <p className="mb-4 rounded-lg bg-fondo-2 p-3 text-sm">{pedido.descripcion}</p>
      <div className="mb-4 flex gap-2">
        <Boton variante={rechazar ? 'secundario' : 'primario'} onClick={() => setRechazar(false)}>Aprobar</Boton>
        <Boton variante={rechazar ? 'peligro' : 'secundario'} onClick={() => setRechazar(true)}>Rechazar</Boton>
      </div>
      {rechazar ? (
        <Campo etiqueta="Motivo del rechazo"><textarea className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Prioridad">
            <select className="campo" value={prioridad} onChange={(e) => { const p = e.target.value as Prioridad; setPrioridad(p); setFecha(sumarDias(hoy(), PLAZO[p])) }}>
              {PRIORIDADES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Fecha comprometida"><input type="date" className="campo" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
          <Campo etiqueta="Asignar a">
            <select className="campo" value={asignado} onChange={(e) => setAsignado(e.target.value)}>
              <option value="">Sin asignar todavía</option>
              {(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.turno ? ` · ${u.turno}` : ''}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Turno">
            <select className="campo" value={turno} onChange={(e) => setTurno(e.target.value)}>
              <option value="">—</option>
              {TURNOS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Campo>
        </div>
      )}
    </Modal>
  )
}

