import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { TURNOS, useOperarios, usePlantas } from '@/lib/catalogos'
import { fmtFecha, fmtFechaHora, fmtFrecuencia, fmtMin, fmtNum, hoy, numOT, useDatos } from '@/lib/util'
import { UNIDADES, type Articulo, type Equipo, type Orden, type Tarea, type TareaItem, type Unidad } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, InsCriticidad, InsEstadoOT, Modal, Pagina, Tarjeta, useAviso } from '@/components/ui'
import { SelectorArticulo } from '@/components/selectores'
import { FormEquipo } from './Equipos'

type RepRef = { articulo_id: string; cantidad_ref: number; articulo: { codigo: string; descripcion: string; stock_actual: number; unidad: string } }
type Hist = { id: string; valor_anterior: number; unidad_anterior: Unidad; valor_nuevo: number; unidad_nueva: Unidad; motivo: string | null; creado_en: string; tarea_id: string }
type TareaRep = { tarea_id: string; articulo_id: string; cantidad: number; articulo: { codigo: string; descripcion: string } }

export function EquipoDetalle() {
  const { id } = useParams()
  const nav = useNavigate()
  const avisar = useAviso()
  const { puede } = useSesion()
  const editable = puede('referente', 'supervisor')
  const { data: pl } = usePlantas()
  const { data: operarios } = useOperarios()
  const [editar, setEditar] = useState(false)
  const [tarea, setTarea] = useState<Partial<Tarea> | null>(null)
  const [ajuste, setAjuste] = useState<Tarea | null>(null)

  const { data, cargando, error, recargar } = useDatos(async () => {
    const [e, r, t, o, h, it, tr] = await Promise.all([
      supabase.from('mant_v_equipos').select('*').eq('id', id!).maybeSingle(),
      supabase.from('mant_equipo_repuestos').select('articulo_id, cantidad_ref, articulo:mant_articulos(codigo, descripcion, stock_actual, unidad)').eq('equipo_id', id!),
      supabase.from('mant_tareas').select('*').eq('equipo_id', id!).order('proxima_fecha'),
      supabase.from('mant_v_ordenes').select('*').eq('equipo_id', id!).order('creado_en', { ascending: false }).limit(50),
      supabase.from('mant_tareas_historial').select('*, tarea:mant_tareas!inner(equipo_id)').eq('tarea.equipo_id', id!).order('creado_en', { ascending: false }),
      supabase.from('mant_tarea_items').select('*, tarea:mant_tareas!inner(equipo_id)').eq('tarea.equipo_id', id!).order('orden'),
      supabase.from('mant_tarea_repuestos').select('tarea_id, articulo_id, cantidad, articulo:mant_articulos(codigo, descripcion), tarea:mant_tareas!inner(equipo_id)').eq('tarea.equipo_id', id!)
    ])
    return {
      data: {
        equipo: e.data as Equipo | null, repuestos: (r.data ?? []) as unknown as RepRef[], tareas: (t.data ?? []) as Tarea[],
        ordenes: (o.data ?? []) as Orden[], historial: (h.data ?? []) as Hist[], tareaRep: (tr.data ?? []) as unknown as TareaRep[],
        items: (it.data ?? []) as TareaItem[]
      },
      error: e.error || r.error || t.error || o.error
    }
  }, [id])

  async function op(fn: () => PromiseLike<{ error: unknown }>) {
    const { error } = await fn()
    if (error) avisar(mensajeError(error), 'error'); else void recargar()
  }

  if (cargando) return <Cargando />
  const e = data?.equipo
  if (!e) return <Pagina titulo="Equipo no encontrado"><ErrorBox texto={error} /></Pagina>
  const correctivas = data.ordenes.filter((o) => o.tipo === 'correctiva' && o.estado === 'completada')
  const mttr = correctivas.length ? Math.round(correctivas.reduce((s, o) => s + (o.tiempo_real_min ?? 0), 0) / correctivas.length) : null

  return (
    <Pagina titulo={e.codigo} subtitulo={<span className="flex flex-wrap items-center gap-2">{e.nombre} · {e.planta_nombre}{e.sector_nombre ? ` / ${e.sector_nombre}` : ''} <InsCriticidad c={e.clasificacion} valor={e.criticidad} /></span>}
      acciones={<>
        <Boton variante="fantasma" onClick={() => nav('/equipos')}>← Equipos</Boton>
        <Boton variante="secundario" onClick={() => nav(`/pedido/nuevo?equipo=${encodeURIComponent(e.codigo)}`)}>Pedir reparación</Boton>
        {editable && <Boton onClick={() => setEditar(true)}>Editar ficha</Boton>}
      </>}>
      <ErrorBox texto={error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Ficha técnica">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="etiqueta">Marca</dt><dd>{e.marca ?? '—'}</dd></div>
            <div><dt className="etiqueta">Modelo</dt><dd>{e.modelo ?? '—'}</dd></div>
            <div><dt className="etiqueta">N° serie</dt><dd>{e.nro_serie ?? '—'}</dd></div>
            <div><dt className="etiqueta">Diseño propio</dt><dd>{e.diseno_propio ? 'Sí' : 'No'}</dd></div>
            <div><dt className="etiqueta">Reemplazo</dt><dd>{e.tiene_reemplazo ? 'Sí' : 'No'}</dd></div>
            <div><dt className="etiqueta">Frecuencia de fallas</dt><dd>{e.frecuencia_fallas ? ({4:'4 · Pobre',3:'3 · Promedio',2:'2 · Buena',1:'1 · Excelente'} as Record<number,string>)[e.frecuencia_fallas] : '—'}</dd></div>
          </dl>
          {e.descripcion && <p className="mt-3 whitespace-pre-wrap text-sm">{e.descripcion}</p>}
          <div className="mt-4 rounded-lg bg-fondo-2 p-3 text-sm">
            <div className="etiqueta">Criticidad</div>
            C = ({e.io} × {e.fo}) + {e.cm} + {e.isa} = <b>{e.criticidad}</b>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border border-borde p-2"><div className="etiqueta">Correctivos</div><b className="text-lg">{correctivas.length}</b></div>
            <div className="rounded-lg border border-borde p-2"><div className="etiqueta">Tiempo medio</div><b className="text-lg">{fmtMin(mttr)}</b></div>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Plan preventivo" className="lg:col-span-2"
          acciones={editable && <Boton variante="secundario" onClick={() => setTarea({ equipo_id: e.id, frecuencia_valor: 1, frecuencia_unidad: 'meses', proxima_fecha: hoy(), activa: true })}>+ Tarea</Boton>}>
          {!data.tareas.length ? <p className="text-sm text-suave">Sin tareas preventivas.</p> : (
            <ul className="divide-y divide-borde">
              {data.tareas.map((t) => (
                <li key={t.id} className={`py-3 ${t.activa ? '' : 'opacity-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-bold">{t.descripcion}{t.origen && <span className="ml-2 rounded bg-fondo-2 px-1.5 py-0.5 text-[10px] font-bold uppercase text-suave">{t.origen}</span>}</div>
                      <div className="text-sm text-suave">
                        <b className="capitalize text-texto">{fmtFrecuencia(t.frecuencia_valor, t.frecuencia_unidad)}</b>
                        {t.duracion_estimada_horas ? ` · ${fmtNum(t.duracion_estimada_horas, 1)} h` : ''}
                        {t.responsable_id ? ` · ${operarios?.find((u) => u.id === t.responsable_id)?.nombre ?? ''}` : ''}
                        {t.turno ? ` · ${t.turno}` : ''}{t.requiere_parada ? ' · requiere parada' : ''}
                      </div>
                      <div className="text-sm">Última: {fmtFecha(t.ultima_ejecucion)} · Próxima: <b>{fmtFecha(t.proxima_fecha)}</b></div>
                      {data.items.filter((i) => i.tarea_id === t.id).length > 0 && (
                        <details className="mt-1 text-sm">
                          <summary className="cursor-pointer text-revision">{data.items.filter((i) => i.tarea_id === t.id).length} puntos de control</summary>
                          <ol className="ml-5 mt-1 list-decimal space-y-0.5 text-suave">
                            {data.items.filter((i) => i.tarea_id === t.id).map((i) => <li key={i.id}>{i.descripcion}{i.horas ? ` (${i.horas} h)` : ''}{i.detalle ? <span className="text-xs"> — {i.detalle}</span> : ''}</li>)}
                          </ol>
                        </details>
                      )}
                      {data.tareaRep.filter((r) => r.tarea_id === t.id).length > 0 && (
                        <div className="mt-1 text-xs text-suave">Repuestos: {data.tareaRep.filter((r) => r.tarea_id === t.id).map((r) => `${r.cantidad} × ${r.articulo.codigo}`).join(', ')}</div>
                      )}
                      {data.historial.filter((h) => h.tarea_id === t.id).map((h) => (
                        <div key={h.id} className="mt-1 text-xs text-revision">
                          {fmtFechaHora(h.creado_en)}: de {h.valor_anterior} {UNIDADES[h.unidad_anterior]} a {h.valor_nuevo} {UNIDADES[h.unidad_nueva]}{h.motivo ? ` — ${h.motivo}` : ''}
                        </div>
                      ))}
                    </div>
                    {editable && (
                      <div className="flex gap-1">
                        <Boton variante="secundario" onClick={() => setAjuste(t)}>Ajustar frecuencia</Boton>
                        <Boton variante="fantasma" onClick={() => setTarea(t)}>Editar</Boton>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Repuestos de referencia">
          {data.repuestos.length > 0 && (
            <ul className="mb-3 divide-y divide-borde text-sm">
              {data.repuestos.map((r) => (
                <li key={r.articulo_id} className="flex justify-between gap-2 py-1.5">
                  <span><b>{r.articulo.codigo}</b> · {r.articulo.descripcion} <span className="text-suave">({r.cantidad_ref})</span></span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-suave">stock {r.articulo.stock_actual}</span>
                    {puede('referente', 'supervisor', 'panolero') && <button className="text-xs font-bold text-rechazado" onClick={() => void op(() => supabase.from('mant_equipo_repuestos').delete().eq('equipo_id', e.id).eq('articulo_id', r.articulo_id))}>×</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {puede('referente', 'supervisor', 'panolero') && (
            <SelectorArticulo placeholder="Agregar repuesto del catálogo…" onElegir={(a: Articulo) =>
              void op(() => supabase.from('mant_equipo_repuestos').upsert({ equipo_id: e.id, articulo_id: a.id, cantidad_ref: 1 }))} />
          )}
        </Tarjeta>

        <Tarjeta titulo={`Historial de órdenes (${data.ordenes.length})`} className="lg:col-span-2">
          {!data.ordenes.length ? <p className="text-sm text-suave">Sin órdenes todavía.</p> : (
            <table className="tabla -m-4 w-[calc(100%+2rem)]">
              <thead><tr><th>OT</th><th>Tipo</th><th>Tarea</th><th>Responsable</th><th>Cierre</th><th>Tiempo</th><th>Estado</th></tr></thead>
              <tbody>
                {data.ordenes.map((o) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => nav(`/ordenes/${o.id}`)}>
                    <td className="whitespace-nowrap font-bold">{numOT(o.numero)}</td><td>{o.tipo === 'preventiva' ? 'Prev.' : 'Corr.'}</td><td>{o.titulo}</td>
                    <td>{o.asignado_nombre ?? '—'}</td><td>{fmtFechaHora(o.completada_en)}</td><td>{fmtMin(o.tiempo_real_min)}</td><td><InsEstadoOT e={o.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
      </div>

      {editar && <FormEquipo equipo={e} plantas={pl?.plantas ?? []} sectores={pl?.sectores ?? []} onCerrar={() => setEditar(false)} onListo={() => { setEditar(false); void recargar() }} />}
      {tarea && <FormTarea tarea={tarea} repuestos={data.tareaRep.filter((r) => r.tarea_id === tarea.id)} items={data.items.filter((i) => i.tarea_id === tarea.id)} onCerrar={() => setTarea(null)} onListo={() => { setTarea(null); void recargar() }} />}
      {ajuste && <AjusteFrecuencia tarea={ajuste} onCerrar={() => setAjuste(null)} onListo={() => { setAjuste(null); void recargar() }} />}
    </Pagina>
  )
}

function FormTarea({ tarea, repuestos, items, onCerrar, onListo }: { tarea: Partial<Tarea>; repuestos: TareaRep[]; items: TareaItem[]; onCerrar: () => void; onListo: () => void }) {
  const { data: operarios } = useOperarios()
  const avisar = useAviso()
  const [f, setF] = useState<Partial<Tarea>>(tarea)
  const [puntos, setPuntos] = useState<string>(items.map((i) => i.descripcion + (i.detalle ? ` — ${i.detalle}` : '')).join('\n'))
  const [reps, setReps] = useState(repuestos.map((r) => ({ articulo_id: r.articulo_id, codigo: r.articulo.codigo, descripcion: r.articulo.descripcion, cantidad: r.cantidad })))
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const set = (k: keyof Tarea, v: unknown) => setF((x) => ({ ...x, [k]: v }))

  async function guardar() {
    if (!f.descripcion?.trim() || !f.frecuencia_valor) { setError('Completá la tarea y la frecuencia.'); return }
    setGuardando(true)
    const fila = {
      equipo_id: f.equipo_id, descripcion: f.descripcion.trim(), duracion_estimada_horas: f.duracion_estimada_horas ?? null,
      responsable_id: f.responsable_id || null, turno: f.turno || null, requiere_parada: !!f.requiere_parada,
      proxima_fecha: f.proxima_fecha || hoy(), activa: f.activa ?? true, notas: f.notas || null,
      ...(f.id ? {} : { frecuencia_valor: f.frecuencia_valor, frecuencia_unidad: f.frecuencia_unidad })
    }
    const r = f.id ? await supabase.from('mant_tareas').update(fila).eq('id', f.id).select('id').single()
                   : await supabase.from('mant_tareas').insert(fila).select('id').single()
    if (r.error) { setGuardando(false); setError(mensajeError(r.error)); return }
    const tid = r.data.id
    await supabase.from('mant_tarea_items').delete().eq('tarea_id', tid)
    const lineas = puntos.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lineas.length) {
      const { error } = await supabase.from('mant_tarea_items').insert(lineas.map((l, i) => {
        const [d, ...det] = l.split(' — ')
        return { tarea_id: tid, orden: i + 1, descripcion: d.trim(), detalle: det.join(' — ').trim() || null }
      }))
      if (error) avisar(mensajeError(error), 'error')
    }
    await supabase.from('mant_tarea_repuestos').delete().eq('tarea_id', tid)
    if (reps.length) {
      const { error } = await supabase.from('mant_tarea_repuestos').insert(reps.map((x) => ({ tarea_id: tid, articulo_id: x.articulo_id, cantidad: x.cantidad })))
      if (error) avisar(mensajeError(error), 'error')
    }
    setGuardando(false)
    onListo()
  }

  return (
    <Modal abierto titulo={f.id ? 'Editar tarea preventiva' : 'Nueva tarea preventiva'} onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Guardar</Boton></>}>
      <ErrorBox texto={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tarea" className="sm:col-span-2"><input className="campo" value={f.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value)} placeholder="Cambio de goma de válvula mariposa" /></Campo>
        <Campo etiqueta="Frecuencia" ayuda={f.id ? 'Para cambiarla usá “Ajustar frecuencia”: queda en el historial.' : undefined}>
          <div className="flex gap-1">
            <input className="campo w-24" type="number" min={1} disabled={!!f.id} value={f.frecuencia_valor ?? 1} onChange={(e) => set('frecuencia_valor', Number(e.target.value))} />
            <select className="campo" disabled={!!f.id} value={f.frecuencia_unidad} onChange={(e) => set('frecuencia_unidad', e.target.value)}>
              {Object.entries(UNIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </Campo>
        <Campo etiqueta="Próxima fecha"><input type="date" className="campo" value={f.proxima_fecha ?? ''} onChange={(e) => set('proxima_fecha', e.target.value)} /></Campo>
        <Campo etiqueta="Duración estimada (h)"><input className="campo" inputMode="decimal" value={f.duracion_estimada_horas ?? ''} onChange={(e) => set('duracion_estimada_horas', e.target.value ? Number(e.target.value.replace(',', '.')) : null)} /></Campo>
        <Campo etiqueta="Responsable habitual">
          <select className="campo" value={f.responsable_id ?? ''} onChange={(e) => set('responsable_id', e.target.value || null)}>
            <option value="">—</option>{(operarios ?? []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Turno">
          <select className="campo" value={f.turno ?? ''} onChange={(e) => set('turno', e.target.value || null)}><option value="">—</option>{TURNOS.map((t) => <option key={t}>{t}</option>)}</select>
        </Campo>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.requiere_parada} onChange={(e) => set('requiere_parada', e.target.checked)} /> Requiere parada de línea</label>
          {f.id && <label className="flex items-center gap-2"><input type="checkbox" checked={f.activa ?? true} onChange={(e) => set('activa', e.target.checked)} /> Activa</label>}
        </div>
        <Campo etiqueta="Puntos de control (uno por línea; detalle después de “ — ”)" className="sm:col-span-2" ayuda="El operario los tilda uno por uno en la orden de trabajo">
          <textarea className="campo min-h-32 font-mono text-xs" value={puntos} onChange={(e) => setPuntos(e.target.value)} placeholder={'Engrasar rodamientos — Grasa Berulub FG-H 2 EP\nRevisar estado de correas'} />
        </Campo>
        <Campo etiqueta="Instrucciones / notas" className="sm:col-span-2"><textarea className="campo" value={f.notas ?? ''} onChange={(e) => set('notas', e.target.value)} /></Campo>
      </div>
      <div className="mt-4">
        <span className="etiqueta">Repuestos que usa (para anticipar compras)</span>
        {reps.map((r, i) => (
          <div key={r.articulo_id} className="mb-1 flex items-center gap-2 text-sm">
            <input className="campo w-20 py-1" inputMode="decimal" value={r.cantidad} onChange={(e) => setReps(reps.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value.replace(',', '.')) || 1 } : x))} />
            <span className="flex-1"><b>{r.codigo}</b> · {r.descripcion}</span>
            <button className="font-bold text-rechazado" onClick={() => setReps(reps.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <SelectorArticulo onElegir={(a) => !reps.some((r) => r.articulo_id === a.id) && setReps([...reps, { articulo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, cantidad: 1 }])} />
      </div>
    </Modal>
  )
}

function AjusteFrecuencia({ tarea, onCerrar, onListo }: { tarea: Tarea; onCerrar: () => void; onListo: () => void }) {
  const [valor, setValor] = useState(tarea.frecuencia_valor)
  const [unidad, setUnidad] = useState<Unidad>(tarea.frecuencia_unidad)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  async function guardar() {
    setGuardando(true)
    const { error } = await supabase.rpc('mant_ajustar_frecuencia', { p_tarea: tarea.id, p_valor: valor, p_unidad: unidad, p_motivo: motivo })
    setGuardando(false)
    if (error) setError(mensajeError(error)); else onListo()
  }
  return (
    <Modal abierto titulo="Ajustar frecuencia" onCerrar={onCerrar}
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} disabled={!motivo.trim()} onClick={() => void guardar()}>Guardar ajuste</Boton></>}>
      <ErrorBox texto={error} />
      <p className="mb-3 text-sm">{tarea.descripcion} · hoy cada <b>{tarea.frecuencia_valor} {UNIDADES[tarea.frecuencia_unidad]}</b></p>
      <div className="mb-3 flex gap-2">
        <input className="campo w-24" type="number" min={1} value={valor} onChange={(e) => setValor(Number(e.target.value))} />
        <select className="campo" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)}>{Object.entries(UNIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <Campo etiqueta="Motivo (queda en el historial)"><textarea className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: en la inspección la goma estaba en buen estado a los 3 meses" /></Campo>
      <p className="mt-2 text-xs text-suave">La próxima fecha se recalcula desde la última ejecución.</p>
    </Modal>
  )
}
