import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useProveedores } from '@/lib/catalogos'
import { fmtFechaHora, fmtNum, numOT, useDatos } from '@/lib/util'
import type { Articulo } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, Insignia, Modal, OkBox, Pagina, Pestanas, Tarjeta, Vacio, useAviso } from '@/components/ui'
import { numCompra } from '@/lib/util'
import { SelectorArticulo } from '@/components/selectores'

type Vista = 'alertas' | 'catalogo' | 'movimientos' | 'vincular'

export function Panol() {
  const [params] = useSearchParams()
  const [vista, setVista] = useState<Vista>(params.get('bajo') ? 'catalogo' : 'alertas')
  const { data: sinVincular, recargar } = useDatos(async () => {
    const r = await supabase.from('mant_ot_repuestos').select('id', { count: 'exact', head: true }).is('articulo_id', null)
    return { data: r.count ?? 0, error: r.error }
  })
  return (
    <Pagina kicker="Módulo 3 · Pañol" titulo="Pañol de repuestos"
      acciones={<Pestanas valor={vista} onCambio={setVista} opciones={[['alertas', 'Alertas'], ['movimientos', 'Registro de movimientos'], ['catalogo', 'Listado de repuestos'], ['vincular', 'Sin vincular', sinVincular ?? 0]]} />}>
      {vista === 'alertas' && <Alertas />}
      {vista === 'catalogo' && <Catalogo soloBajo={!!params.get('bajo')} />}
      {vista === 'movimientos' && <Movimientos />}
      {vista === 'vincular' && <SinVincular onCambio={() => void recargar()} />}
    </Pagina>
  )
}

function Catalogo({ soloBajo }: { soloBajo: boolean }) {
  const { puede } = useSesion()
  const editable = puede('panolero', 'referente')
  const [texto, setTexto] = useState('')
  const [bajo, setBajo] = useState(soloBajo)
  const [familia, setFamilia] = useState('')
  const [editando, setEditando] = useState<Partial<Articulo> | null>(null)
  const [movimiento, setMovimiento] = useState<Articulo | null>(null)
  const [importar, setImportar] = useState(false)

  const { data, cargando, error, recargar } = useDatos(async () => {
    let q = supabase.from('mant_v_stock').select('*').order('codigo').limit(500)
    const t = texto.trim().replace(/[%,()"{}\\]/g, ' ').replace(/\s+/g, ' ').trim()
    if (t) q = q.or(`codigo.ilike.%${t}%,descripcion.ilike.%${t}%,alias.cs.{"${t.toLowerCase()}"}`)
    if (bajo) q = q.eq('bajo_minimo', true)
    if (familia) q = q.eq('familia', familia)
    const r = await q
    return { data: (r.data ?? []) as Articulo[], error: r.error }
  }, [texto, bajo, familia])
  const { data: familias } = useDatos(async () => {
    const r = await supabase.from('mant_articulos').select('familia').not('familia', 'is', null).limit(5000)
    return { data: [...new Set((r.data ?? []).map((x) => x.familia as string))].sort(), error: r.error }
  })

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="campo max-w-xs" placeholder="Buscar código, descripción o alias…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select className="campo w-auto" value={familia} onChange={(e) => setFamilia(e.target.value)}>
          <option value="">Todas las familias</option>{(familias ?? []).map((f) => <option key={f}>{f}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} /> Solo bajo mínimo</label>
        {editable && <div className="ml-auto flex gap-2">
          <Boton variante="secundario" onClick={() => setImportar(true)}>Importar padrón</Boton>
          <Boton onClick={() => setEditando({ unidad: 'un', stock_minimo: 0, alias: [], activo: true })}>+ Artículo</Boton>
        </div>}
      </div>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data?.length ? <Vacio texto="No hay artículos con ese filtro." /> : (
        <Tarjeta className="overflow-x-auto" titulo={data.length === 500 ? 'Primeros 500 resultados: afiná la búsqueda' : `${data.length} artículos`}>
          <table className="tabla -m-4 w-[calc(100%+2rem)]">
            <thead><tr><th>Código</th><th>Descripción</th><th>Familia</th><th>Ubic.</th><th>Stock</th><th>Mín.</th><th>Sug.</th><th>Eq.</th><th></th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className={a.activo ? '' : 'opacity-50'}>
                  <td className="whitespace-nowrap font-bold">{a.codigo}</td>
                  <td>{a.descripcion}{a.alias.length > 0 && <div className="text-xs text-suave">También: {a.alias.join(', ')}</div>}</td>
                  <td>{a.familia ?? '—'}</td><td>{a.ubicacion ?? '—'}</td>
                  <td className={`whitespace-nowrap font-bold ${a.bajo_minimo ? 'text-primario' : ''}`}>{fmtNum(a.stock_actual, 1)} {a.unidad}</td>
                  <td>{fmtNum(a.stock_minimo, 1)}</td>
                  <td>{a.stock_sugerido != null ? <span className={a.bajo_sugerido ? 'text-[#8a5a00]' : ''}>{fmtNum(a.stock_sugerido, 1)}</span> : '—'}</td>
                  <td>{a.equipos_que_lo_usan || '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {editable && <div className="flex justify-end gap-1">
                      <Boton variante="secundario" onClick={() => setMovimiento(a)}>Mov.</Boton>
                      <Boton variante="fantasma" onClick={() => setEditando(a)}>Editar</Boton>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
      {editando && <FormArticulo articulo={editando} onCerrar={() => setEditando(null)} onListo={() => { setEditando(null); void recargar() }} />}
      {movimiento && <FormMovimiento articulo={movimiento} onCerrar={() => setMovimiento(null)} onListo={() => { setMovimiento(null); void recargar() }} />}
      {importar && <Importar onCerrar={() => setImportar(false)} onListo={() => { setImportar(false); void recargar() }} />}
    </>
  )
}

function FormArticulo({ articulo, onCerrar, onListo }: { articulo: Partial<Articulo>; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState(articulo)
  const [alias, setAlias] = useState((articulo.alias ?? []).join(', '))
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const set = (k: keyof Articulo, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  const n = (v: string) => (v === '' ? null : Number(v.replace(',', '.')))
  async function guardar() {
    if (!f.codigo?.trim() || !f.descripcion?.trim()) { setError('Código y descripción son obligatorios.'); return }
    setGuardando(true)
    const fila = {
      codigo: f.codigo.trim().toUpperCase(), descripcion: f.descripcion.trim(), familia: f.familia || null, unidad: f.unidad || 'un',
      ubicacion: f.ubicacion || null, stock_minimo: f.stock_minimo ?? 0, stock_sugerido: f.stock_sugerido ?? null,
      costo_unit_usd: f.costo_unit_usd ?? null, activo: f.activo ?? true,
      alias: alias.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
    }
    const { error } = f.id ? await supabase.from('mant_articulos').update(fila).eq('id', f.id) : await supabase.from('mant_articulos').insert(fila)
    setGuardando(false)
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <Modal abierto titulo={f.id ? `Editar ${f.codigo}` : 'Nuevo artículo'} onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Guardar</Boton></>}>
      <ErrorBox texto={error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Código"><input className="campo" value={f.codigo ?? ''} onChange={(e) => set('codigo', e.target.value)} placeholder="ROD-6205-2RS" /></Campo>
        <Campo etiqueta="Descripción" className="sm:col-span-2"><input className="campo" value={f.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value)} /></Campo>
        <Campo etiqueta="Familia"><input className="campo" value={f.familia ?? ''} onChange={(e) => set('familia', e.target.value)} placeholder="Rodamientos" /></Campo>
        <Campo etiqueta="Unidad"><input className="campo" value={f.unidad ?? ''} onChange={(e) => set('unidad', e.target.value)} /></Campo>
        <Campo etiqueta="Ubicación"><input className="campo" value={f.ubicacion ?? ''} onChange={(e) => set('ubicacion', e.target.value)} placeholder="Estante 3 / caja 12" /></Campo>
        <Campo etiqueta="Stock mínimo"><input className="campo" inputMode="decimal" value={f.stock_minimo ?? ''} onChange={(e) => set('stock_minimo', n(e.target.value) ?? 0)} /></Campo>
        <Campo etiqueta="Stock sugerido" ayuda="Según criticidad: tenerlo antes que hacer el preventivo"><input className="campo" inputMode="decimal" value={f.stock_sugerido ?? ''} onChange={(e) => set('stock_sugerido', n(e.target.value))} /></Campo>
        <Campo etiqueta="Costo unitario (USD)"><input className="campo" inputMode="decimal" value={f.costo_unit_usd ?? ''} onChange={(e) => set('costo_unit_usd', n(e.target.value))} /></Campo>
        <Campo etiqueta="Otros nombres (separados por coma)" className="sm:col-span-3" ayuda="Cómo lo llaman en planta, para encontrarlo al buscar"><input className="campo" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="perno, pistón" /></Campo>
        {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.activo ?? true} onChange={(e) => set('activo', e.target.checked)} /> Activo</label>}
      </div>
      {!f.id && <p className="mt-3 text-xs text-suave">El stock inicial se carga después con un movimiento de ajuste o una entrada.</p>}
    </Modal>
  )
}

function FormMovimiento({ articulo, onCerrar, onListo }: { articulo: Articulo; onCerrar: () => void; onListo: () => void }) {
  const { data: proveedores } = useProveedores()
  const [tipo, setTipo] = useState<'entrada' | 'salida' | 'ajuste'>('entrada')
  const [cantidad, setCantidad] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [comprobante, setComprobante] = useState('')
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const c = Number(cantidad.replace(',', '.'))
  const resultado = tipo === 'entrada' ? articulo.stock_actual + c : tipo === 'salida' ? articulo.stock_actual - c : c
  async function guardar() {
    if (!c && tipo !== 'ajuste') { setError('Indicá la cantidad.'); return }
    setGuardando(true)
    const { error } = tipo === 'ajuste'
      ? await supabase.rpc('mant_ajustar_stock', { p_articulo: articulo.id, p_contado: c, p_comentario: comentario || null })
      : await supabase.from('mant_movimientos').insert({
          articulo_id: articulo.id, tipo, cantidad: c, proveedor: proveedor || null, comprobante: comprobante || null, comentario: comentario || null
        })
    setGuardando(false)
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <Modal abierto titulo={`Movimiento · ${articulo.codigo}`} onCerrar={onCerrar}
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Registrar</Boton></>}>
      <ErrorBox texto={error} />
      <p className="mb-3 text-sm">{articulo.descripcion} · stock actual <b>{fmtNum(articulo.stock_actual, 1)} {articulo.unidad}</b></p>
      <div className="mb-3 grid grid-cols-3 gap-1">
        {(['entrada', 'salida', 'ajuste'] as const).map((t) => (
          <Boton key={t} variante={tipo === t ? 'primario' : 'secundario'} onClick={() => setTipo(t)}>{t === 'entrada' ? 'Entrada' : t === 'salida' ? 'Salida' : 'Ajuste (conteo)'}</Boton>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta={tipo === 'ajuste' ? 'Stock contado' : 'Cantidad'} ayuda={cantidad ? `Quedará en ${fmtNum(resultado, 1)} ${articulo.unidad}` : undefined}>
          <input className="campo" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </Campo>
        {tipo === 'entrada' && <Campo etiqueta="Proveedor"><input className="campo" list="lista-prov-mov" value={proveedor} onChange={(e) => setProveedor(e.target.value)} /><datalist id="lista-prov-mov">{(proveedores ?? []).map((p) => <option key={p.id} value={p.nombre} />)}</datalist></Campo>}
        {tipo === 'entrada' && <Campo etiqueta="Remito / factura"><input className="campo" value={comprobante} onChange={(e) => setComprobante(e.target.value)} /></Campo>}
        <Campo etiqueta="Comentario" className="sm:col-span-2"><input className="campo" value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder={tipo === 'salida' ? 'Para qué / quién retira' : ''} /></Campo>
      </div>
    </Modal>
  )
}

/** Carga masiva del padrón: CSV con columnas codigo;descripcion;familia;unidad;ubicacion;stock;minimo;alias */
function Importar({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const avisar = useAviso()
  const [filas, setFilas] = useState<Record<string, string>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<string | null>(null)

  async function leer(f: File) {
    setError(null)
    const texto = await f.text()
    const sep = (texto.split('\n')[0].match(/;/g)?.length ?? 0) >= (texto.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
    const lineas = parsearCSV(texto, sep).filter((l) => l.some((c) => c.trim()))
    if (lineas.length < 2) { setError('El archivo no tiene filas.'); return }
    const cab = lineas[0].map((c) => c.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
    if (!cab.includes('codigo') || !cab.includes('descripcion')) { setError('Faltan las columnas "codigo" y "descripcion" en la primera fila.'); return }
    setFilas(lineas.slice(1).map((l) => Object.fromEntries(cab.map((c, i) => [c, (l[i] ?? '').trim()]))))
  }

  async function importar() {
    try {
      const num = (s?: string) => (s ? Number(s.replace(/\./g, '').replace(',', '.')) || 0 : 0)
      const unicas = new Map(filas.filter((r) => r.codigo && r.descripcion).map((r) => [r.codigo.toUpperCase(), r]))
      const lista = [...unicas.values()]
      for (let i = 0; i < lista.length; i += 500) {
        setProgreso(`Artículos ${i + 1}–${Math.min(i + 500, lista.length)} de ${lista.length}…`)
        const { error } = await supabase.from('mant_articulos').upsert(lista.slice(i, i + 500).map((r) => ({
          codigo: r.codigo.toUpperCase(), descripcion: r.descripcion, familia: r.familia || null, unidad: r.unidad || 'un',
          ubicacion: r.ubicacion || null, stock_minimo: num(r.minimo),
          alias: (r.alias || '').split(/[|,]/).map((x) => x.trim().toLowerCase()).filter(Boolean)
        })), { onConflict: 'codigo' })
        if (error) throw error
      }
      const conStock = lista.filter((r) => r.stock !== undefined && r.stock !== '')
      for (let i = 0; i < conStock.length; i += 500) {
        setProgreso(`Stock inicial ${i + 1}–${Math.min(i + 500, conStock.length)} de ${conStock.length}…`)
        const lote = conStock.slice(i, i + 500)
        const { data, error } = await supabase.from('mant_articulos').select('id, codigo, stock_actual').in('codigo', lote.map((r) => r.codigo.toUpperCase()))
        if (error) throw error
        const movs = (data ?? []).map((a) => ({ a, dif: num(unicas.get(a.codigo)?.stock) - Number(a.stock_actual) }))
          .filter((x) => x.dif !== 0).map((x) => ({ articulo_id: x.a.id, tipo: 'ajuste', cantidad: x.dif, comentario: 'Carga inicial del padrón' }))
        if (movs.length) { const r = await supabase.from('mant_movimientos').insert(movs); if (r.error) throw r.error }
      }
      avisar(`Se importaron ${lista.length} artículos.`)
      onListo()
    } catch (e) {
      setError(mensajeError(e)); setProgreso(null)
    }
  }

  return (
    <Modal abierto titulo="Importar padrón de artículos" onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton disabled={!filas.length} cargando={!!progreso} onClick={() => void importar()}>Importar {filas.length || ''} filas</Boton></>}>
      <ErrorBox texto={error} />
      <p className="mb-3 text-sm">Guardá la planilla como <b>CSV</b> con estas columnas en la primera fila (las que no tengas, dejalas afuera):</p>
      <code className="mb-3 block rounded bg-fondo-2 p-2 text-xs">codigo;descripcion;familia;unidad;ubicacion;stock;minimo;alias</code>
      <p className="mb-3 text-xs text-suave">Si el código ya existe, se actualiza. El stock se carga como ajuste "Carga inicial". En alias van otros nombres separados por "|".</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer(f) }} />
      {progreso && <p className="mt-3 text-sm font-bold">{progreso}</p>}
      {filas.length > 0 && !progreso && (
        <div className="mt-3 max-h-48 overflow-auto rounded border border-borde text-xs">
          <table className="tabla"><thead><tr>{Object.keys(filas[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{filas.slice(0, 8).map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table>
        </div>
      )}
    </Modal>
  )
}

function parsearCSV(texto: string, sep: string) {
  const filas: string[][] = []; let fila: string[] = []; let campo = ''; let comillas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ } else if (c === '"') comillas = false; else campo += c
    } else if (c === '"') comillas = true
    else if (c === sep) { fila.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else campo += c
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila) }
  return filas
}

interface Mov { id: string; tipo: string; cantidad: number; proveedor: string | null; comprobante: string | null; comentario: string | null; creado_en: string; articulo: { codigo: string; descripcion: string; unidad: string }; usuario: { nombre: string } | null; orden: { numero: number } | null }

function Movimientos() {
  const { data, cargando, error } = useDatos(async () => {
    const r = await supabase.from('mant_movimientos').select('*, articulo:mant_articulos(codigo, descripcion, unidad), usuario:mant_usuarios(nombre), orden:mant_ordenes(numero)')
      .order('creado_en', { ascending: false }).limit(300)
    return { data: (r.data ?? []) as unknown as Mov[], error: r.error }
  })
  const TIPO: Record<string, [string, 'verde' | 'rojo' | 'azul' | 'gris']> = { entrada: ['Entrada', 'verde'], salida: ['Salida', 'rojo'], consumo_ot: ['Consumo OT', 'azul'], ajuste: ['Ajuste', 'gris'] }
  return (
    <>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !data?.length ? <Vacio texto="Sin movimientos todavía." /> : (
        <Tarjeta className="overflow-x-auto" titulo="Últimos 300 movimientos">
          <table className="tabla -m-4 w-[calc(100%+2rem)]">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Artículo</th><th>Cantidad</th><th>Detalle</th><th>Usuario</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtFechaHora(m.creado_en)}</td>
                  <td><Insignia t={TIPO[m.tipo][1]}>{TIPO[m.tipo][0]}</Insignia></td>
                  <td><b>{m.articulo.codigo}</b> · {m.articulo.descripcion}</td>
                  <td className="whitespace-nowrap font-bold">{m.tipo === 'entrada' || (m.tipo === 'ajuste' && m.cantidad > 0) ? '+' : m.tipo === 'ajuste' ? '' : '−'}{fmtNum(Math.abs(m.cantidad), 1)} {m.articulo.unidad}</td>
                  <td className="text-suave">{[m.orden && numOT(m.orden.numero), m.proveedor, m.comprobante, m.comentario].filter(Boolean).join(' · ')}</td>
                  <td>{m.usuario?.nombre ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </>
  )
}

interface RepSin { id: string; texto: string; cantidad: number; creado_en: string; orden: { id: string; numero: number; equipo: { codigo: string } | null } }

/** Repuestos que el operario escribió a mano: el pañolero los vincula al catálogo y ahí se descuentan */
function SinVincular({ onCambio }: { onCambio: () => void }) {
  const nav = useNavigate()
  const avisar = useAviso()
  const { data, cargando, error, recargar } = useDatos(async () => {
    const r = await supabase.from('mant_ot_repuestos').select('id, texto, cantidad, creado_en, orden:mant_ordenes(id, numero, equipo:mant_equipos(codigo))')
      .is('articulo_id', null).order('creado_en', { ascending: false })
    return { data: (r.data ?? []) as unknown as RepSin[], error: r.error }
  })
  const [aprender, setAprender] = useState(true)
  const lista = useMemo(() => data ?? [], [data])
  async function vincular(r: RepSin, a: Articulo) {
    const { error } = await supabase.from('mant_ot_repuestos').update({ articulo_id: a.id }).eq('id', r.id)
    if (error) { avisar(mensajeError(error), 'error'); return }
    const nombre = r.texto.trim().toLowerCase()
    if (aprender && nombre && !a.alias.includes(nombre) && nombre !== a.descripcion.toLowerCase()) {
      await supabase.from('mant_articulos').update({ alias: [...a.alias, nombre] }).eq('id', a.id)
    }
    avisar(`Vinculado a ${a.codigo}: se descontó del stock.`)
    void recargar(); onCambio()
  }
  return (
    <>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={aprender} onChange={(e) => setAprender(e.target.checked)} /> Guardar el nombre que usó el operario como alias del artículo</label>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !lista.length ? <Vacio texto="No hay repuestos pendientes de vincular." /> : (
        <div className="grid gap-2">
          {lista.map((r) => (
            <div key={r.id} className="grid items-center gap-2 rounded-xl border border-borde bg-white p-3 md:grid-cols-2">
              <div className="text-sm">
                <b>{r.cantidad} × {r.texto}</b>
                <div className="text-xs text-suave"><button className="font-bold text-primario" onClick={() => nav(`/ordenes/${r.orden.id}`)}>{numOT(r.orden.numero)}</button> · {r.orden.equipo?.codigo ?? 'sin equipo'} · {fmtFechaHora(r.creado_en)}</div>
              </div>
              <SelectorArticulo placeholder="Buscar el artículo del catálogo…" onElegir={(a) => void vincular(r, a)} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------
// Alertas: repuestos sin stock o bajo mínimo, por gravedad, con "Pedir presupuesto"
// ---------------------------------------------------------------------
type Alerta = Articulo & { eq?: { codigo: string; nombre: string; clasificacion: string }; pedido?: number; nivel: 'critica' | 'bajo' | 'minimo' }
const NIVEL = {
  critica: { titulo: 'Críticas', desc: 'Sin stock o repuesto de equipo crítico', caja: 'border-[#f3c4c6] bg-rojo-claro', num: 'text-primario-oscuro', cab: 'bg-rojo-claro', pill: 'bg-primario text-white', etiqueta: 'Crítica', barra: '#cc1a20', borde: 'border-[#f3c4c6]' },
  bajo: { titulo: 'Bajo mínimo', desc: 'Por debajo del mínimo', caja: 'border-[#f1d49a] bg-ambar-claro', num: 'text-pendiente', cab: 'bg-ambar-claro', pill: 'bg-ambar text-white', etiqueta: 'Alta', barra: '#d9a21b', borde: 'border-[#f1d49a]' },
  minimo: { titulo: 'En el mínimo', desc: 'Llegan al mínimo con el próximo uso', caja: 'border-[#c9d6ee] bg-azul-claro', num: 'text-revision', cab: 'bg-azul-claro', pill: 'bg-azul text-white', etiqueta: 'Atención', barra: '#5b84c4', borde: 'border-[#c9d6ee]' }
} as const

function Alertas() {
  const avisar = useAviso()
  const { puede } = useSesion()
  const [pidiendo, setPidiendo] = useState<string | null>(null)
  const { data, cargando, error, recargar } = useDatos(async () => {
    const st = await supabase.from('mant_v_stock').select('*').eq('activo', true).eq('bajo_minimo', true).gt('stock_minimo', 0).order('stock_actual').limit(600)
    const arts = (st.data ?? []) as Articulo[]
    const ids = arts.map((a) => a.id)
    const [rel, it] = ids.length ? await Promise.all([
      supabase.from('mant_equipo_repuestos').select('articulo_id,equipo_id').in('articulo_id', ids),
      supabase.from('mant_compra_items').select('articulo_id,compra:mant_compras(numero,estado)').in('articulo_id', ids)
    ]) : [{ data: [] }, { data: [] }]
    const rels = (rel.data ?? []) as { articulo_id: string; equipo_id: string }[]
    const eqIds = [...new Set(rels.map((r) => r.equipo_id))]
    const eqs = eqIds.length ? await supabase.from('mant_v_equipos').select('id,codigo,nombre,clasificacion').in('id', eqIds) : { data: [] }
    const eqMap = new Map(((eqs.data ?? []) as { id: string; codigo: string; nombre: string; clasificacion: string }[]).map((e) => [e.id, e]))
    const orden = { C: 0, MC: 1, NC: 2 } as Record<string, number>
    const pedidos = new Map<string, number>()
    for (const x of (it.data ?? []) as unknown as { articulo_id: string; compra: { numero: number; estado: string } | null }[])
      if (x.compra && ['borrador', 'pendiente', 'aprobada', 'comprada'].includes(x.compra.estado)) pedidos.set(x.articulo_id, x.compra.numero)
    const alertas: Alerta[] = arts.map((a) => {
      const eq = rels.filter((r) => r.articulo_id === a.id).map((r) => eqMap.get(r.equipo_id)).filter(Boolean)
        .sort((x, y) => orden[x!.clasificacion] - orden[y!.clasificacion])[0]
      const nivel = a.stock_actual <= 0 || (eq?.clasificacion === 'C' && a.stock_actual < a.stock_minimo) ? 'critica' : a.stock_actual < a.stock_minimo ? 'bajo' : 'minimo'
      return { ...a, eq, pedido: pedidos.get(a.id), nivel }
    })
    return { data: alertas, error: st.error }
  })

  async function pedir(a: Alerta) {
    setPidiendo(a.id)
    const { data: c, error } = await supabase.rpc('mant_pedir_presupuesto', { p_articulo: a.id })
    setPidiendo(null)
    if (error) avisar(mensajeError(error), 'error')
    else { avisar('Pedido de presupuesto creado en Compras.'); void recargar(); void c }
  }

  if (cargando && !data) return <Cargando />
  if (!data?.length) return <OkBox>No hay repuestos bajo mínimo.</OkBox>
  const puedePedir = puede('panolero', 'referente', 'supervisor', 'compras')
  return (
    <>
      <ErrorBox texto={error} />
      <div className="flex flex-wrap items-start gap-4">
        {(['critica', 'bajo', 'minimo'] as const).map((n) => {
          const cfg = NIVEL[n], items = data.filter((a) => a.nivel === n)
          return (
            <div key={n} className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
              <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 ${cfg.caja}`}>
                <span className={`text-[34px] font-bold leading-none ${cfg.num}`}>{items.length}</span>
                <span className="flex flex-col gap-0.5"><span className="text-[15px] font-semibold">{cfg.titulo}</span><span className="text-xs text-suave">{cfg.desc}</span></span>
              </div>
              {items.length === 0 && <div className="rounded-2xl border-[1.5px] border-dashed border-borde-campo p-4 text-center text-[13px] text-tenue">Sin alertas en este nivel</div>}
              {items.slice(0, 25).map((a) => {
                const falta = a.stock_minimo - a.stock_actual
                const sugerido = Math.max((a.stock_sugerido ?? a.stock_minimo * 2) - a.stock_actual, 1)
                return (
                  <div key={a.id} className={`flex flex-col gap-2.5 overflow-hidden rounded-tarjeta border bg-white pb-4 ${cfg.borde}`}>
                    <div className={`flex items-center justify-between px-4 py-2.5 ${cfg.cab}`}>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.pill}`}>{cfg.etiqueta}</span>
                      {a.eq?.clasificacion === 'C' && <span className="text-xs font-semibold text-primario-oscuro">Equipo crítico</span>}
                    </div>
                    <span className="flex flex-col gap-0.5 px-4"><span className="text-base font-semibold">{a.descripcion}</span><span className="text-xs text-tenue">{a.eq ? `${a.eq.nombre} · ${a.eq.codigo}` : a.codigo}</span></span>
                    <span className="flex items-baseline gap-2 px-4"><span className={`text-[30px] font-bold leading-none ${cfg.num}`}>{fmtNum(a.stock_actual)}</span><span className="text-sm text-suave">en stock · mínimo {fmtNum(a.stock_minimo)}</span></span>
                    <span className="mx-4 block h-2 overflow-hidden rounded-full bg-linea"><span className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, (a.stock_actual / a.stock_minimo) * 100))}%`, background: cfg.barra }} /></span>
                    <span className="px-4 text-[13px] text-texto-2">{a.stock_actual <= 0 ? 'Sin stock' : falta > 0 ? `Faltan ${fmtNum(falta)} para el mínimo` : 'Está justo en el mínimo'} · sugerido pedir {fmtNum(sugerido)}</span>
                    {a.pedido ? <span className="mx-4 self-start rounded-full bg-azul-claro px-3 py-1.5 text-[13px] font-semibold text-revision">Pedido en curso · {numCompra(a.pedido)}</span>
                      : puedePedir && <div className="px-4"><Boton className="w-full" cargando={pidiendo === a.id} onClick={() => void pedir(a)}>Pedir presupuesto</Boton></div>}
                  </div>
                )
              })}
              {items.length > 25 && <div className="text-center text-[13px] text-tenue">y {items.length - 25} más · ver el Listado de repuestos</div>}
            </div>
          )
        })}
      </div>
    </>
  )
}
