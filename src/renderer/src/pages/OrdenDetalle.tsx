import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { TURNOS, useOperarios } from '@/lib/catalogos'
import { fmtFecha, fmtFechaHora, fmtMin, fmtNum, lunesDe, numOT, numPedido, subirArchivo, useDatos } from '@/lib/util'
import { PRIORIDADES, type Articulo, type Orden, type OtItem, type Prioridad } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, Insignia, InsEstadoOT, InsPrioridad, Modal, Pagina, Tarjeta, useAviso } from '@/components/ui'
import { BotonFoto, Foto, SelectorArticulo } from '@/components/selectores'
import { RevisionCierre } from '@/components/RevisionCierre'
import { pedirTexto } from '@/components/Pregunta'

interface FotoOT { id: string; ruta: string; tipo: 'antes' | 'cierre' | 'paso' | 'rechazada'; creado_en: string }
interface RepuestoOT { id: string; texto: string; cantidad: number; articulo_id: string | null; articulo?: { codigo: string; descripcion: string; unidad: string } | null }

export function OrdenDetalle() {
  const { id } = useParams()
  const nav = useNavigate()
  const avisar = useAviso()
  const { usuario, puede } = useSesion()
  const esMant = puede('referente', 'supervisor')

  const { data, cargando, error, recargar, setData } = useDatos(async () => {
    const [o, f, r, it] = await Promise.all([
      supabase.from('mant_v_ordenes').select('*').eq('id', id!).maybeSingle(),
      supabase.from('mant_ot_fotos').select('*').eq('orden_id', id!).order('creado_en'),
      supabase.from('mant_ot_repuestos').select('*, articulo:mant_articulos(codigo, descripcion, unidad)').eq('orden_id', id!).order('creado_en'),
      supabase.from('mant_ot_items').select('*').eq('orden_id', id!).order('orden')
    ])
    return { data: { orden: o.data as Orden | null, fotos: (f.data ?? []) as FotoOT[], repuestos: (r.data ?? []) as RepuestoOT[], items: (it.data ?? []) as OtItem[] }, error: o.error || f.error || r.error }
  }, [id])

  const o = data?.orden
  const abierta = o && (o.estado === 'pendiente' || o.estado === 'en_proceso')
  const puedeOperar = !!o && abierta && (esMant || (o.asignado_id === usuario?.id && puede('operario')))
  const fotosCierre = data?.fotos.filter((f) => f.tipo === 'cierre') ?? []

  // ---------- Acciones ----------
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [cerrar, setCerrar] = useState(false)
  const [editar, setEditar] = useState(false)

  async function hacer(clave: string, fn: () => PromiseLike<{ error: unknown }>, ok?: string) {
    setOcupado(clave)
    const { error } = await fn()
    setOcupado(null)
    if (error) avisar(mensajeError(error), 'error')
    else { if (ok) avisar(ok); await recargar() }
  }

  async function tildar(item: OtItem, hecho: boolean) {
    setData((d) => d ? { ...d, items: d.items.map((x) => (x.id === item.id ? { ...x, hecho } : x)) } : d)
    const { error } = await supabase.from('mant_ot_items').update({ hecho }).eq('id', item.id)
    if (error) { avisar(mensajeError(error), 'error'); void recargar() }
  }
  async function observar(item: OtItem, observacion: string) {
    const { error } = await supabase.from('mant_ot_items').update({ observacion: observacion.trim() || null }).eq('id', item.id)
    if (error) avisar(mensajeError(error), 'error')
  }

  async function subirFoto(f: File) {
    setOcupado('foto')
    try {
      const ruta = await subirArchivo(`ot/${id}`, f)
      const { error } = await supabase.from('mant_ot_fotos').insert({ orden_id: id, ruta, tipo: 'cierre' })
      if (error) throw error
      await recargar()
    } catch (e) { avisar(mensajeError(e), 'error') }
    setOcupado(null)
  }

  const iniciar = () => hacer('iniciar', () => supabase.from('mant_ordenes').update({ estado: 'en_proceso' }).eq('id', id!), 'Tarea iniciada.')

  // Repuestos usados
  const [repTexto, setRepTexto] = useState('')
  const [repCant, setRepCant] = useState('1')
  const [repArt, setRepArt] = useState<Articulo | null>(null)
  async function agregarRepuesto() {
    const texto = repTexto.trim() || repArt?.descripcion
    if (!texto) return
    await hacer('rep', () => supabase.from('mant_ot_repuestos').insert({
      orden_id: id, texto, cantidad: Number(repCant.replace(',', '.')) || 1, articulo_id: repArt?.id ?? null
    }))
    setRepTexto(''); setRepCant('1'); setRepArt(null)
  }

  async function noRealizada() {
    const det = await pedirTexto({ titulo: 'No se hizo · máquina parada', mensaje: 'Queda asentado en el historial de la máquina que el mantenimiento no se hizo porque la máquina estuvo parada.', etiqueta: 'Detalle (opcional, ej.: bajó la producción de legumbres)', aceptar: 'Registrar' })
    if (det === null) return
    const { data: prox, error } = await supabase.rpc('mant_ot_no_realizada', { p_orden: id, p_motivo: 'maquina_parada', p_detalle: det.trim() || null })
    if (error) return avisar(mensajeError(error), 'error')
    avisar(`Asentado: no realizada por máquina parada${prox ? `. Vuelve a tocar el ${String(prox).split('-').reverse().join('/')}` : ''}.`)
    void recargar()
  }

  if (cargando) return <Cargando />
  if (!o) return <Pagina titulo="Orden no encontrada"><ErrorBox texto={error ?? 'No existe o no tenés acceso.'} /></Pagina>

  return (
    <Pagina titulo={o.titulo}
      subtitulo={<span className="flex flex-wrap items-center gap-2">{numOT(o.numero)} <InsEstadoOT e={o.estado} motivo={o.no_realizada_motivo} /> <InsPrioridad p={o.prioridad} />
        <Insignia t={o.tipo === 'preventiva' ? 'azul' : 'gris'}>{o.tipo === 'preventiva' ? 'Preventivo' : 'Correctivo'}</Insignia>
        {o.vencida && <Insignia t="rojo">Vencida</Insignia>}</span>}
      acciones={<>
        <Boton variante="fantasma" onClick={() => nav(-1)}>← Volver</Boton>
        {esMant && abierta && <Boton variante="secundario" onClick={() => setEditar(true)}>Reasignar / editar</Boton>}
        {esMant && abierta && o.tipo === 'preventiva' && <Boton variante="secundario" onClick={() => void noRealizada()}>No se hizo (máquina parada)</Boton>}
        {puede('referente', 'supervisor', 'panolero') && <Boton variante="secundario" onClick={() => nav(`/compras?orden=${o.id}`)}>Pedir compra</Boton>}
      </>}>
      <ErrorBox texto={error} />
      {esMant && <RevisionCierre orden={o} onCambio={() => void recargar()} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Tarjeta titulo="Detalle">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Dato t="Equipo" v={o.equipo_codigo ? <button className="font-bold text-primario" onClick={() => esMant && nav(`/equipos/${o.equipo_id}`)}>{o.equipo_codigo}</button> : o.tarea_unidad ?? '—'} />
              <Dato t="Nombre" v={o.equipo_nombre ?? '—'} />
              <Dato t="Asignado a" v={o.asignado_nombre ?? 'Sin asignar'} />
              <Dato t="Turno" v={o.turno ?? '—'} />
              <Dato t="Programada" v={fmtFecha(o.fecha_programada)} />
              <Dato t="Comprometida" v={fmtFecha(o.fecha_comprometida)} />
              <Dato t="Duración estimada" v={o.duracion_estimada_horas ? `${fmtNum(o.duracion_estimada_horas, 1)} h` : '—'} />
              <Dato t="Iniciada" v={fmtFechaHora(o.iniciada_en)} />
              <Dato t="Completada" v={fmtFechaHora(o.completada_en)} />
              {o.pedido_numero && <Dato t="Pedido de origen" v={`${numPedido(o.pedido_numero)} · ${o.pedido_area ?? ''}`} />}
              {o.tiempo_real_min != null && <Dato t="Tiempo real" v={fmtMin(o.tiempo_real_min)} />}
            </dl>
            {o.descripcion && o.descripcion !== o.titulo && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-fondo-2 p-3 text-sm">{o.descripcion}</p>}
            {o.estado === 'no_realizada' && <p className="mt-3 whitespace-pre-wrap rounded-lg border border-[#f1d49a] bg-[#fff6e5] p-3 text-sm"><b>No realizada{o.no_realizada_motivo === 'maquina_parada' ? ' · máquina parada' : ''}:</b> {o.comentario_cierre ?? '—'}</p>}
            {o.comentario_cierre && !esMant && o.estado !== 'no_realizada' && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-aprobado/10 p-3 text-sm"><b>Informe:</b> {o.comentario_cierre}</p>}
          </Tarjeta>

          {data.items.length > 0 && (
            <Tarjeta titulo={`Puntos de control · ${data.items.filter((i) => i.hecho).length} de ${data.items.length}`}>
              <ul className="-my-2 divide-y divide-borde">
                {data.items.map((i) => (
                  <li key={i.id} className="py-2.5">
                    <label className={`flex items-start gap-3 ${puedeOperar ? 'cursor-pointer' : ''}`}>
                      <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-aprobado" checked={i.hecho} disabled={!puedeOperar} onChange={(e) => void tildar(i, e.target.checked)} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${i.hecho ? 'text-suave line-through' : 'font-bold'}`}>{i.descripcion}</span>
                        {i.detalle && <span className="block text-xs text-suave">{i.detalle}</span>}
                      </span>
                    </label>
                    {(puedeOperar || i.observacion) && (
                      <input className="campo mt-1.5 ml-9 w-[calc(100%-2.25rem)] py-1 text-xs" placeholder="Observación (opcional)" disabled={!puedeOperar}
                        defaultValue={i.observacion ?? ''} onBlur={(e) => e.target.value !== (i.observacion ?? '') && void observar(i, e.target.value)} />
                    )}
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          <Tarjeta titulo={`Repuestos usados (${data.repuestos.length})`}>
            {data.repuestos.length > 0 && (
              <ul className="mb-3 divide-y divide-borde">
                {data.repuestos.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <b>{r.cantidad}</b> × {r.texto}
                      {r.articulo ? <span className="ml-2 text-xs text-aprobado">✓ {r.articulo.codigo} (descontado del pañol)</span>
                        : <span className="ml-2 text-xs text-suave">sin vincular al catálogo</span>}
                    </span>
                    {puedeOperar && <button className="text-xs font-bold text-rechazado" onClick={() => void hacer('rep', () => supabase.from('mant_ot_repuestos').delete().eq('id', r.id))}>Quitar</button>}
                  </li>
                ))}
              </ul>
            )}
            {puedeOperar && (
              <div className="space-y-2 rounded-lg bg-fondo-2 p-3">
                {repArt ? (
                  <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                    <span><b>{repArt.codigo}</b> · {repArt.descripcion} <span className="text-suave">(stock {repArt.stock_actual})</span></span>
                    <button className="font-bold text-primario" onClick={() => setRepArt(null)}>Cambiar</button>
                  </div>
                ) : <SelectorArticulo onElegir={setRepArt} placeholder="Buscar en el pañol (opcional)…" />}
                <div className="flex gap-2">
                  <input className="campo w-20" inputMode="decimal" value={repCant} onChange={(e) => setRepCant(e.target.value)} aria-label="Cantidad" />
                  <input className="campo flex-1" placeholder={repArt ? 'Detalle (opcional)' : 'Qué repuesto usaste'} value={repTexto} onChange={(e) => setRepTexto(e.target.value)} />
                  <Boton variante="secundario" cargando={ocupado === 'rep'} disabled={!repTexto.trim() && !repArt} onClick={() => void agregarRepuesto()}>Agregar</Boton>
                </div>
                <p className="text-xs text-suave">Si no lo encontrás en el catálogo, escribilo igual: el pañolero lo vincula después.</p>
              </div>
            )}
            {!puedeOperar && data.repuestos.length === 0 && <p className="text-sm text-suave">No se cargaron repuestos.</p>}
          </Tarjeta>
        </div>

        <div className="space-y-4">
          <Tarjeta titulo="Fotos">
            {data.fotos.length > 0 && (
              <div className="mb-3 grid grid-cols-3 gap-2">
                {data.fotos.map((f) => (
                  <div key={f.id} className="relative">
                    <Foto ruta={f.ruta} className="aspect-square w-full" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">{f.tipo === 'antes' ? 'Pedido' : f.tipo === 'paso' ? 'Paso' : f.tipo === 'rechazada' ? 'Rechazada' : 'Cierre'}</span>
                  </div>
                ))}
              </div>
            )}
            {puedeOperar && <div className="hidden md:block"><BotonFoto texto={fotosCierre.length ? 'Agregar otra foto' : 'Sacar foto del trabajo'} cargando={ocupado === 'foto'} onArchivo={(f) => void subirFoto(f)} /></div>}
            {!data.fotos.length && !puedeOperar && <p className="text-sm text-suave">Sin fotos.</p>}
            {puedeOperar && fotosCierre.length === 0 && <p className="mt-2 text-xs text-suave">Sin foto no se puede cerrar la tarea.</p>}
          </Tarjeta>

          {puedeOperar && (
            <div className="hidden space-y-2 md:block">
              {o.estado === 'pendiente' && (
                <Boton grande variante="secundario" className="w-full" cargando={ocupado === 'iniciar'} onClick={() => void iniciar()}>▶ Empezar tarea</Boton>
              )}
              <Boton grande className="w-full" disabled={!fotosCierre.length} onClick={() => setCerrar(true)}>✓ Terminar y cerrar</Boton>
            </div>
          )}
        </div>
      </div>

      {/* Celular: acciones siempre a mano, arriba de la barra inferior */}
      {puedeOperar && (
        <div className="fixed inset-x-0 bottom-[60px] z-20 flex gap-2 border-t border-borde bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] md:hidden">
          <BotonFoto texto={fotosCierre.length ? `Foto (${fotosCierre.length})` : 'Foto'} cargando={ocupado === 'foto'} onArchivo={(f) => void subirFoto(f)} />
          {o.estado === 'pendiente'
            ? <Boton grande variante="secundario" className="flex-1" cargando={ocupado === 'iniciar'} onClick={() => void iniciar()}>▶ Empezar</Boton>
            : <Boton grande className="flex-1" disabled={!fotosCierre.length} onClick={() => setCerrar(true)}>{fotosCierre.length ? '✓ Terminar' : 'Falta la foto'}</Boton>}
        </div>
      )}
      {puedeOperar && <div className="h-20 md:hidden" />}

      {cerrar && <Cierre orden={o} onCerrar={() => setCerrar(false)} onListo={() => { setCerrar(false); avisar('Tarea cerrada.'); void recargar() }} />}
      {editar && <Editar orden={o} onCerrar={() => setEditar(false)} onListo={() => { setEditar(false); void recargar() }} />}
    </Pagina>
  )
}

const Dato = ({ t, v }: { t: string; v: React.ReactNode }) => (
  <div><dt className="text-xs font-bold uppercase tracking-wide text-suave">{t}</dt><dd className="mt-0.5">{v}</dd></div>
)

function Cierre({ orden, onCerrar, onListo }: { orden: Orden; onCerrar: () => void; onListo: () => void }) {
  const desdeInicio = orden.iniciada_en ? Math.max(1, Math.round((Date.now() - new Date(orden.iniciada_en).getTime()) / 60000)) : null
  const [horas, setHoras] = useState(desdeInicio ? String(Math.floor(desdeInicio / 60)) : orden.duracion_estimada_horas ? String(Math.floor(orden.duracion_estimada_horas)) : '0')
  const [minutos, setMinutos] = useState(desdeInicio ? String(desdeInicio % 60) : '30')
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  async function guardar() {
    const total = (Number(horas) || 0) * 60 + (Number(minutos) || 0)
    if (total <= 0) { setError('Indicá cuánto tiempo llevó.'); return }
    setGuardando(true)
    const { error } = await supabase.from('mant_ordenes').update({
      estado: 'completada', tiempo_real_min: total, comentario_cierre: comentario.trim() || null
    }).eq('id', orden.id)
    setGuardando(false)
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <Modal abierto titulo="Cerrar tarea" onCerrar={onCerrar}
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Cerrar tarea</Boton></>}>
      <ErrorBox texto={error} />
      <span className="etiqueta">Tiempo real</span>
      <div className="mb-4 flex items-center gap-2">
        <input className="campo w-20 text-center text-lg" inputMode="numeric" value={horas} onChange={(e) => setHoras(e.target.value)} /> h
        <input className="campo w-20 text-center text-lg" inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} /> min
      </div>
      <Campo etiqueta="Comentario (qué se hizo, qué quedó pendiente)">
        <textarea className="campo min-h-24" value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </Campo>
    </Modal>
  )
}

function Editar({ orden, onCerrar, onListo }: { orden: Orden; onCerrar: () => void; onListo: () => void }) {
  const { data: operarios } = useOperarios()
  const [f, setF] = useState({
    asignado_id: orden.asignado_id ?? '', turno: orden.turno ?? '', prioridad: orden.prioridad,
    fecha_programada: orden.fecha_programada ?? '', fecha_comprometida: orden.fecha_comprometida ?? '',
    duracion_estimada_horas: orden.duracion_estimada_horas?.toString() ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => setError(null), [f])
  async function guardar(cancelar = false) {
    setGuardando(true)
    const { error } = await supabase.from('mant_ordenes').update(cancelar ? { estado: 'cancelada' } : {
      asignado_id: f.asignado_id || null, turno: f.turno || null, prioridad: f.prioridad,
      fecha_programada: f.fecha_programada || null, semana: f.fecha_programada ? lunesDe(f.fecha_programada) : orden.semana, fecha_comprometida: f.fecha_comprometida || null,
      duracion_estimada_horas: f.duracion_estimada_horas ? Number(f.duracion_estimada_horas.replace(',', '.')) : null
    }).eq('id', orden.id)
    setGuardando(false)
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <Modal abierto titulo={`Editar ${numOT(orden.numero)}`} onCerrar={onCerrar}
      pie={<>
        <Boton variante="peligro" className="mr-auto" onClick={() => confirm('¿Cancelar esta orden de trabajo?') && void guardar(true)}>Cancelar OT</Boton>
        <Boton variante="fantasma" onClick={onCerrar}>Volver</Boton>
        <Boton cargando={guardando} onClick={() => void guardar()}>Guardar</Boton>
      </>}>
      <ErrorBox texto={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Asignado a">
          <select className="campo" value={f.asignado_id} onChange={(e) => setF({ ...f, asignado_id: e.target.value })}>
            <option value="">Sin asignar</option>
            {(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.turno ? ` · ${u.turno}` : ''}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Turno">
          <select className="campo" value={f.turno} onChange={(e) => setF({ ...f, turno: e.target.value })}>
            <option value="">—</option>{TURNOS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Prioridad">
          <select className="campo" value={f.prioridad} onChange={(e) => setF({ ...f, prioridad: e.target.value as Prioridad })}>
            {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Duración estimada (h)"><input className="campo" inputMode="decimal" value={f.duracion_estimada_horas} onChange={(e) => setF({ ...f, duracion_estimada_horas: e.target.value })} /></Campo>
        <Campo etiqueta="Fecha programada"><input type="date" className="campo" value={f.fecha_programada} onChange={(e) => setF({ ...f, fecha_programada: e.target.value })} /></Campo>
        <Campo etiqueta="Fecha comprometida"><input type="date" className="campo" value={f.fecha_comprometida} onChange={(e) => setF({ ...f, fecha_comprometida: e.target.value })} /></Campo>
      </div>
    </Modal>
  )
}
