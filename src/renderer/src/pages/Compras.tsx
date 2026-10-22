import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useProveedores } from '@/lib/catalogos'
import { fmtFecha, fmtFechaHora, fmtNum, numCompra, numOT, subirArchivo, urlFirmada, useDatos } from '@/lib/util'
import type { Compra } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, Insignia, InsEstadoCompra, Modal, Pagina, Pestanas, Tarjeta, Vacio, useAviso } from '@/components/ui'
import { BotonFoto, SelectorArticulo } from '@/components/selectores'

type CompraV = Compra & { orden: { id: string; numero: number; titulo: string } | null; solicitante: { nombre: string } | null; decisor: { nombre: string } | null }
interface Item { id?: string; articulo_id: string | null; codigo?: string; descripcion: string; cantidad: number; precio_unit: number | null }
type Filtro = 'todas' | 'preventivo'
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const k = (n: number) => n >= 1000 ? `${fmtNum(n / 1000, 1)} k` : fmtNum(n)

export function Compras() {
  const [params] = useSearchParams()
  const avisar = useAviso()
  const { puede, usuario } = useSesion()
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [abierta, setAbierta] = useState<string | 'nueva' | null>(params.get('orden') || params.get('preventivo') ? 'nueva' : null)
  const puedeCrear = puede('referente', 'supervisor', 'panolero', 'compras')

  const { data, cargando, error, recargar } = useDatos(async () => {
    const [c, g, p, r] = await Promise.all([
      supabase.from('mant_compras').select('*, orden:mant_ordenes(id, numero, titulo), solicitante:mant_usuarios!mant_compras_solicitado_por_fkey(nombre), decisor:mant_usuarios!mant_compras_decidido_por_fkey(nombre)')
        .order('creado_en', { ascending: false }).limit(300),
      supabase.from('mant_v_gasto_mensual').select('*').order('mes', { ascending: false }).limit(6),
      supabase.from('mant_plantas').select('id,nombre').order('nombre'),
      supabase.from('mant_usuarios').select('id,nombre,limite_aprobacion_usd').eq('rol', 'referente').eq('activo', true).order('limite_aprobacion_usd', { ascending: false }).limit(1)
    ])
    return {
      data: {
        compras: (c.data ?? []) as unknown as CompraV[],
        meses: ((g.data ?? []) as { mes: string; total_usd: number | null }[]).reverse(),
        plantas: (p.data ?? []) as { id: string; nombre: string }[],
        referente: ((r.data ?? []) as { nombre: string; limite_aprobacion_usd: number }[])[0]
      },
      error: c.error
    }
  })

  const hoyD = new Date()
  const delMes = (data?.compras ?? []).filter((c) => ['aprobada', 'comprada', 'recibida'].includes(c.estado) && (c.decidido_en ?? c.creado_en).slice(0, 7) === `${hoyD.getFullYear()}-${String(hoyD.getMonth() + 1).padStart(2, '0')}`)
  const porCC = (data?.plantas ?? []).map((p) => ({ l: p.nombre, v: delMes.filter((c) => c.planta_id === p.id).reduce((s, c) => s + Number(c.monto_usd ?? 0), 0) }))
  const sinCC = delMes.filter((c) => !c.planta_id).reduce((s, c) => s + Number(c.monto_usd ?? 0), 0)
  if (sinCC) porCC.push({ l: 'Sin centro de costo', v: sinCC })
  porCC.sort((a, b) => b.v - a.v)
  const maxCC = Math.max(1, ...porCC.map((x) => x.v))
  const totalMes = delMes.reduce((s, c) => s + Number(c.monto_usd ?? 0), 0)
  const maxMes = Math.max(1, ...(data?.meses ?? []).map((m) => Number(m.total_usd ?? 0)))
  const lista = (data?.compras ?? []).filter((c) => filtro === 'todas' || c.tarea_id || (c.comentario ?? '').toLowerCase().includes('preventivo'))
  const ref = data?.referente
  const ccNombre = (id?: string | null) => data?.plantas.find((p) => p.id === id)?.nombre ?? '—'

  async function aprobar(c: CompraV) {
    const { error } = await supabase.rpc('mant_decidir_compra', { p_compra: c.id, p_aprobar: true, p_comentario: null })
    if (error) avisar(mensajeError(error), 'error'); else { avisar('Compra aprobada.'); void recargar() }
  }

  return (
    <Pagina kicker="Módulo 3 · Compras" titulo="Compras de mantenimiento"
      acciones={puedeCrear && <Boton onClick={() => setAbierta('nueva')}>+ Nueva compra</Boton>}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 text-sm text-texto-2">
        <span className="text-xl font-light"><b className="font-bold">Tablero</b> de gasto</span>
        <span className="text-suave">Se arma con lo cargado en el listado de abajo: {delMes.length} compras aprobadas este mes · USD {fmtNum(totalMes)} en {MESES_L[hoyD.getMonth()]}.</span>
      </div>
      <ErrorBox texto={error} />
      {cargando && !data ? <Cargando /> : data && <>
        <div className="flex flex-wrap gap-4">
          <Tarjeta className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
            <h2 className="m-0 text-lg font-semibold">Gasto de {MESES_L[hoyD.getMonth()]} por centro de costo · USD</h2>
            {porCC.map((b) => (
              <div key={b.l} className="grid grid-cols-[150px_minmax(0,1fr)_70px] items-center gap-2.5 text-[13px]">
                <span className="truncate">{b.l}</span>
                <span className="block h-3.5 overflow-hidden rounded-full bg-fondo"><span className="block h-full rounded-full" style={{ width: `${Math.max(b.v ? 3 : 0, (b.v / maxCC) * 100)}%`, background: b === porCC[0] && b.v ? '#8c8174' : '#8c8174' }} /></span>
                <span className="text-right font-semibold">{fmtNum(b.v)}</span>
              </div>
            ))}
          </Tarjeta>
          <Tarjeta className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
            <h2 className="m-0 text-lg font-semibold">Gasto total por mes · USD</h2>
            {!data.meses.length ? <span className="text-sm text-suave">Sin compras aprobadas todavía.</span> : (
              <div className="grid h-[200px] items-end gap-3" style={{ gridTemplateColumns: `repeat(${data.meses.length}, minmax(0,1fr))` }}>
                {data.meses.map((m, i) => (
                  <div key={m.mes} className="flex h-full flex-col items-center justify-end gap-1.5">
                    <span className="text-xs font-semibold">{k(Number(m.total_usd ?? 0))}</span>
                    <span className="block w-full max-w-[46px] rounded-t-xl" style={{ height: `${Math.max(2, (Number(m.total_usd ?? 0) / maxMes) * 140)}px`, background: i === data.meses.length - 1 ? '#e31e24' : '#c9bfb1' }} />
                    <span className="text-xs text-suave">{MESES[Number(m.mes.slice(5, 7)) - 1]}</span>
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-light"><b className="font-bold">Listado</b> de compras</h2>
          <Pestanas valor={filtro} onCambio={setFiltro} opciones={[['todas', 'Todas las compras'], ['preventivo', 'Solo preventivo']]} />
        </div>
        {ref && <div className="rounded-2xl border border-borde bg-white px-4 py-3 text-sm text-texto-2">Aprobación por monto: <b>{ref.nombre} hasta USD {fmtNum(ref.limite_aprobacion_usd)}</b> · por encima pasa a <b>Director</b>.</div>}
        {!lista.length ? <Vacio texto="No hay compras." /> : (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla min-w-[1080px]">
              <thead><tr><th>Pedido</th><th>Detalle</th><th>Centro de costo</th><th>Costo</th><th>Estado</th><th>Docs · llegada</th><th>Acción</th></tr></thead>
              <tbody>
                {lista.map((c) => {
                  const limite = usuario?.rol === 'referente' ? usuario.limite_aprobacion_usd : Infinity
                  const puedeAprobar = c.estado === 'pendiente' && puede('referente', 'director') && (usuario?.rol !== 'referente' || Number(c.monto_usd ?? 0) <= limite)
                  return (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap text-[13px] font-semibold">{numCompra(c.numero)}</td>
                      <td><div className="font-medium">{c.descripcion}</div><div className="text-xs text-tenue">{[c.proveedor, c.orden ? numOT(c.orden.numero) : c.tarea_id ? 'Preventivo' : null].filter(Boolean).join(' · ') || '—'}</div></td>
                      <td className="text-[13px]">{ccNombre(c.planta_id)}</td>
                      <td className="whitespace-nowrap text-[13px] font-semibold">{c.estado === 'pendiente' || c.estado === 'borrador' ? 'Cotizado ' : ''}{c.moneda === 'USD' ? 'USD' : '$'} {fmtNum(c.monto)}</td>
                      <td className="w-[170px]"><InsEstadoCompra e={c.estado} ancho /></td>
                      <td><span className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-suave">{c.adjunto_ruta ? '1 doc' : 'sin docs'}</span>
                        {c.estado === 'comprada' ? <Insignia t="azul">En camino</Insignia> : c.estado === 'recibida' ? <Insignia t="verde">Llegó</Insignia> : <Insignia>—</Insignia>}</span></td>
                      <td><span className="flex items-center gap-2">
                        <Boton chico variante="secundario" onClick={() => setAbierta(c.id)}>Editar</Boton>
                        {puedeAprobar ? <Boton chico onClick={() => void aprobar(c)}>Aprobar ({usuario?.nombre.split(' ')[0]})</Boton>
                          : c.estado === 'pendiente' ? <span className="text-[13px] text-suave">Espera al Director</span>
                          : ['aprobada', 'comprada', 'recibida'].includes(c.estado) ? <span className="text-[13px] text-suave">OC emitida</span> : null}
                      </span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </>}
      {abierta && <DetalleCompra id={abierta === 'nueva' ? null : abierta} ordenInicial={params.get('orden')} desdePreventivo={!!params.get('preventivo')}
        onCerrar={() => setAbierta(null)} onCambio={() => void recargar()} />}
    </Pagina>
  )
}

function DetalleCompra({ id, ordenInicial, desdePreventivo, onCerrar, onCambio }:
  { id: string | null; ordenInicial: string | null; desdePreventivo: boolean; onCerrar: () => void; onCambio: () => void }) {
  const avisar = useAviso()
  const nav = useNavigate()
  const { usuario, puede } = useSesion()
  const { data: proveedores } = useProveedores()
  const [f, setF] = useState<Partial<CompraV>>({ moneda: 'ARS', monto: 0, estado: 'borrador', orden_id: ordenInicial })
  const [items, setItems] = useState<Item[]>([])
  const idsPrevios = useRef<string[]>([])
  const [cargando, setCargando] = useState(!!id || desdePreventivo)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [comentario, setComentario] = useState('')
  const editable = f.estado === 'borrador' || !f.id

  useEffect(() => {
    void (async () => {
      if (id) {
        const [c, i] = await Promise.all([
          supabase.from('mant_compras').select('*, orden:mant_ordenes(id, numero, titulo), solicitante:mant_usuarios!mant_compras_solicitado_por_fkey(nombre), decisor:mant_usuarios!mant_compras_decidido_por_fkey(nombre)').eq('id', id).single(),
          supabase.from('mant_compra_items').select('*, articulo:mant_articulos(codigo)').eq('compra_id', id)
        ])
        if (c.data) setF(c.data as unknown as CompraV)
        const prev = ((i.data ?? []) as (Item & { articulo: { codigo: string } | null })[])
        idsPrevios.current = prev.map((x) => x.id!).filter(Boolean)
        setItems(prev.map((x) => ({ ...x, codigo: x.articulo?.codigo })))
      } else if (desdePreventivo) {
        const { data } = await supabase.from('mant_v_necesidades_preventivo').select('*').gt('faltante', 0)
        setItems((data ?? []).map((n) => ({ articulo_id: n.articulo_id, codigo: n.codigo, descripcion: n.descripcion, cantidad: Number(n.faltante), precio_unit: null })))
        setF((x) => ({ ...x, descripcion: 'Repuestos para el plan preventivo (próximas 8 semanas)' }))
      } else if (ordenInicial) {
        const { data } = await supabase.from('mant_ordenes').select('id, numero, titulo').eq('id', ordenInicial).single()
        if (data) setF((x) => ({ ...x, orden: data, descripcion: `Para ${numOT(data.numero)}: ${data.titulo}` }))
      }
      setCargando(false)
    })()
  }, [id, ordenInicial, desdePreventivo])

  const set = (k: keyof Compra, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  const totalItems = items.reduce((s, i) => s + (i.precio_unit ?? 0) * i.cantidad, 0)
  const n = (s: string) => (s === '' ? null : Number(s.replace(/\./g, '').replace(',', '.')))

  async function guardar(enviar = false) {
    if (!f.descripcion?.trim()) { setError('Poné una descripción.'); return null }
    if (f.moneda === 'ARS' && !f.tipo_cambio && enviar) { setError('Cargá el tipo de cambio: la aprobación se decide en USD.'); return null }
    setOcupado('guardar'); setError(null)
    const fila = { descripcion: f.descripcion.trim(), proveedor: f.proveedor || null, moneda: f.moneda, monto: f.monto || totalItems || 0,
      tipo_cambio: f.tipo_cambio || null, orden_id: f.orden_id || null, adjunto_ruta: f.adjunto_ruta || null,
      tarea_id: f.tarea_id ?? (desdePreventivo && !f.id ? await primeraTareaPreventivo() : null) }
    const r = f.id ? await supabase.from('mant_compras').update(fila).eq('id', f.id).select('id').single()
                   : await supabase.from('mant_compras').insert(fila).select('id').single()
    if (r.error) { setOcupado(null); setError(mensajeError(r.error)); return null }
    const cid = r.data.id
    if (items.length) {
      const ri = await supabase.from('mant_compra_items').insert(items.map((i) => ({ compra_id: cid, articulo_id: i.articulo_id, descripcion: i.descripcion, cantidad: i.cantidad, precio_unit: i.precio_unit })))
      if (ri.error) { setOcupado(null); setError(mensajeError(ri.error)); return null }
    }
    // recién ahora se borran los ítems previos (si el insert falló, quedan los anteriores)
    if (idsPrevios.current.length) await supabase.from('mant_compra_items').delete().in('id', idsPrevios.current)
    idsPrevios.current = []
    if (enviar) {
      const re = await supabase.from('mant_compras').update({ estado: 'pendiente' }).eq('id', cid)
      if (re.error) { setOcupado(null); setError(mensajeError(re.error)); return null }
    }
    setOcupado(null)
    avisar(enviar ? 'Enviada a aprobación.' : 'Guardada.')
    onCambio(); onCerrar()
    return cid
  }

  async function accion(clave: string, fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setOcupado(clave)
    const { error } = await fn()
    setOcupado(null)
    if (error) { setError(mensajeError(error)); return }
    avisar(ok); onCambio(); onCerrar()
  }

  async function adjuntar(file: File) {
    setOcupado('adj')
    try { set('adjunto_ruta', await subirArchivo('compras', file)) } catch (e) { setError(mensajeError(e)) }
    setOcupado(null)
  }

  const puedeDecidir = f.estado === 'pendiente' && puede('referente', 'director')
  const avisoLimite = puedeDecidir && usuario?.rol === 'referente' && f.monto_usd != null && f.monto_usd > usuario.limite_aprobacion_usd

  return (
    <Modal abierto titulo={f.id ? `${numCompra(f.numero!)} · ${f.descripcion ?? ''}` : 'Nueva compra'} onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<>
        {editable && <Boton variante="secundario" cargando={ocupado === 'guardar'} onClick={() => void guardar(false)}>Guardar borrador</Boton>}
        {editable && <Boton cargando={ocupado === 'guardar'} onClick={() => void guardar(true)}>Enviar a aprobación</Boton>}
        {puedeDecidir && <>
          <Boton variante="peligro" cargando={ocupado === 'rech'} onClick={() => void accion('rech', () => supabase.rpc('mant_decidir_compra', { p_compra: f.id, p_aprobar: false, p_comentario: comentario || null }), 'Compra rechazada.')}>Rechazar</Boton>
          <Boton cargando={ocupado === 'apr'} disabled={avisoLimite} onClick={() => void accion('apr', () => supabase.rpc('mant_decidir_compra', { p_compra: f.id, p_aprobar: true, p_comentario: comentario || null }), 'Compra aprobada.')}>Aprobar</Boton>
        </>}
        {f.estado === 'rechazada' && puede('referente', 'supervisor', 'panolero', 'compras') && <Boton variante="secundario" onClick={() => void accion('bor', () => supabase.from('mant_compras').update({ estado: 'borrador' }).eq('id', f.id!), 'Volvió a borrador.')}>Corregir y reenviar</Boton>}
        {f.estado === 'aprobada' && puede('compras', 'referente', 'supervisor', 'panolero') && <Boton cargando={ocupado === 'com'} onClick={() => void accion('com', () => supabase.from('mant_compras').update({ estado: 'comprada' }).eq('id', f.id!), 'Marcada como comprada.')}>Marcar comprada</Boton>}
        {f.estado === 'comprada' && puede('panolero', 'compras', 'referente', 'supervisor') && <Boton cargando={ocupado === 'rec'} onClick={() => void accion('rec', () => supabase.from('mant_compras').update({ estado: 'recibida' }).eq('id', f.id!), 'Recibida: los artículos entraron al pañol.')}>Recibida en pañol</Boton>}
      </>}>
      {cargando ? <Cargando /> : (
        <>
          <ErrorBox texto={error} />
          {f.id && <div className="mb-3 flex flex-wrap items-center gap-2 text-sm"><InsEstadoCompra e={f.estado!} />
            <span className="text-suave">Pidió {f.solicitante?.nombre ?? '—'} el {fmtFecha(f.creado_en?.slice(0, 10))}</span>
            {f.decisor && <span className="text-suave">· Decidió {f.decisor.nombre} el {fmtFechaHora(f.decidido_en)}</span>}</div>}
          {avisoLimite && <div className="mb-3 rounded-lg bg-pendiente/20 p-3 text-sm">Supera tu límite de aprobación (USD {fmtNum(usuario!.limite_aprobacion_usd)}): la aprueba el director.</div>}
          {f.comentario && <p className="mb-3 rounded-lg bg-fondo-2 p-3 text-sm"><b>Comentario:</b> {f.comentario}</p>}
          <div className="grid gap-3 sm:grid-cols-4">
            <Campo etiqueta="Descripción" className="sm:col-span-4"><input className="campo" disabled={!editable} value={f.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value)} /></Campo>
            <Campo etiqueta="Proveedor" className="sm:col-span-2">
              <input className="campo" list="lista-proveedores" disabled={!editable} value={f.proveedor ?? ''} onChange={(e) => set('proveedor', e.target.value)} placeholder="Elegir o escribir…" />
              <datalist id="lista-proveedores">{(proveedores ?? []).map((p) => <option key={p.id} value={p.nombre}>{[p.rubro, p.localidad].filter(Boolean).join(' · ')}</option>)}</datalist>
            </Campo>
            <Campo etiqueta="Orden de trabajo">
              {f.orden ? <button className="campo text-left font-bold text-primario" onClick={() => nav(`/ordenes/${f.orden!.id}`)}>{numOT(f.orden.numero)}</button> : <input className="campo" disabled value="—" />}
            </Campo>
            <Campo etiqueta="Moneda">
              <select className="campo" disabled={!editable} value={f.moneda} onChange={(e) => set('moneda', e.target.value)}><option>ARS</option><option>USD</option></select>
            </Campo>
            <Campo etiqueta="Monto total" ayuda={totalItems && !f.monto ? `Suma de ítems: ${fmtNum(totalItems, 2)}` : undefined}>
              <input className="campo" disabled={!editable} inputMode="decimal" value={f.monto || ''} onChange={(e) => set('monto', n(e.target.value) ?? 0)} />
            </Campo>
            {f.moneda === 'ARS' && <Campo etiqueta="Tipo de cambio (ARS por USD)"><input className="campo" disabled={!editable} inputMode="decimal" value={f.tipo_cambio ?? ''} onChange={(e) => set('tipo_cambio', n(e.target.value))} /></Campo>}
            <Campo etiqueta="Equivale a">
              <div className="campo bg-fondo-2 font-bold">USD {f.moneda === 'USD' ? fmtNum(f.monto, 2) : f.tipo_cambio ? fmtNum((f.monto || 0) / f.tipo_cambio, 2) : '—'}</div>
            </Campo>
            <div className="flex items-end gap-2 sm:col-span-4">
              {editable && <BotonFoto aceptar="image/*,application/pdf" texto={f.adjunto_ruta ? 'Cambiar presupuesto' : 'Adjuntar presupuesto (PDF o foto)'} cargando={ocupado === 'adj'} onArchivo={(file) => void adjuntar(file)} />}
              {f.adjunto_ruta && <Boton variante="secundario" onClick={() => void urlFirmada(f.adjunto_ruta!).then((u) => u && window.open(u, '_blank'))}>Ver presupuesto</Boton>}
            </div>
          </div>

          <div className="mt-5">
            <span className="etiqueta">Ítems</span>
            {items.length > 0 && (
              <table className="tabla mb-2">
                <thead><tr><th>Cant.</th><th>Descripción</th><th>Precio unit.</th><th>Subtotal</th><th></th></tr></thead>
                <tbody>
                  {items.map((i, k) => (
                    <tr key={k}>
                      <td className="w-24"><input className="campo py-1" disabled={!editable} inputMode="decimal" value={i.cantidad} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, cantidad: n(e.target.value) ?? 0 } : x))} /></td>
                      <td>{i.codigo && <b>{i.codigo} · </b>}{i.descripcion}{!i.articulo_id && <span className="ml-1 text-xs text-suave">(no entra al pañol)</span>}</td>
                      <td className="w-32"><input className="campo py-1" disabled={!editable} inputMode="decimal" value={i.precio_unit ?? ''} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, precio_unit: n(e.target.value) } : x))} /></td>
                      <td className="whitespace-nowrap">{i.precio_unit ? fmtNum(i.precio_unit * i.cantidad, 2) : '—'}</td>
                      <td>{editable && <button className="font-bold text-rechazado" onClick={() => setItems(items.filter((_, j) => j !== k))}>×</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {editable && (
              <div className="grid gap-2 sm:grid-cols-2">
                <SelectorArticulo placeholder="Agregar artículo del pañol…" onElegir={(a) => setItems([...items, { articulo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, cantidad: 1, precio_unit: null }])} />
                <ItemLibre onAgregar={(d) => setItems([...items, { articulo_id: null, descripcion: d, cantidad: 1, precio_unit: null }])} />
              </div>
            )}
          </div>
          {puedeDecidir && <Campo etiqueta="Comentario de la decisión" className="mt-4"><input className="campo" value={comentario} onChange={(e) => setComentario(e.target.value)} /></Campo>}
        </>
      )}
    </Modal>
  )
}

async function primeraTareaPreventivo() {
  const { data } = await supabase.from('mant_tareas').select('id').eq('activa', true).lte('proxima_fecha', new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10)).limit(1).maybeSingle()
  return data?.id ?? null
}

function ItemLibre({ onAgregar }: { onAgregar: (d: string) => void }) {
  const [t, setT] = useState('')
  return (
    <div className="flex gap-1">
      <input className="campo" placeholder="O escribir un ítem / servicio…" value={t} onChange={(e) => setT(e.target.value)} />
      <Boton variante="secundario" disabled={!t.trim()} onClick={() => { onAgregar(t.trim()); setT('') }}>+</Boton>
    </div>
  )
}
