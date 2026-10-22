import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { usePlantas } from '@/lib/catalogos'
import { aCodigo, fmtNum, useDatos } from '@/lib/util'
import type { Config, Equipo, Planta, Sector } from '@/lib/tipos'
import { Boton, Campo, Cargando, Chip, ErrorBox, InsCriticidad, Modal, Pagina, Vacio, useAviso } from '@/components/ui'

export function useConfig() {
  return useDatos(async () => {
    const r = await supabase.from('mant_config').select('*').eq('id', 1).maybeSingle()
    return { data: r.data as Config | null, error: r.error }
  })
}

export function calcularCriticidad(e: Pick<Equipo, 'io' | 'fo' | 'isa' | 'cm_manual' | 'costo_falla_usd'>, c: Config | null) {
  if (!c) return null
  const cm = e.cm_manual ?? ((e.costo_falla_usd ?? 0) >= c.corte_costo_usd ? c.cm_supera_corte : c.cm_no_supera_corte)
  const valor = e.io * e.fo + cm + e.isa
  const clasificacion = valor >= c.umbral_c ? 'C' : valor >= c.umbral_mc ? 'MC' : 'NC'
  return { cm, valor, clasificacion: clasificacion as 'C' | 'MC' | 'NC' }
}

export function Equipos() {
  const nav = useNavigate()
  const { puede } = useSesion()
  const editable = puede('referente', 'supervisor')
  const { data: pl, recargar: recargarPlantas } = usePlantas()
  const [planta, setPlanta] = useState('')
  const [sector, setSector] = useState('')
  const [clas, setClas] = useState('')
  const [texto, setTexto] = useState('')
  const [editando, setEditando] = useState<Partial<Equipo> | null>(null)
  const [plantasAbierto, setPlantasAbierto] = useState(false)

  const { data, cargando, error, recargar } = useDatos(async () => {
    const r = await supabase.from('mant_v_equipos').select('*').order('codigo')
    return { data: (r.data ?? []) as Equipo[], error: r.error }
  })

  const [orden, setOrden] = useState<'desc' | 'asc'>('desc')
  const lista = useMemo(() => {
    const t = texto.toLowerCase()
    const l = (data ?? []).filter((e) => (!planta || e.planta_id === planta) && (!sector || e.sector_id === sector) &&
      (!clas || e.clasificacion === clas) && (!t || `${e.codigo} ${e.nombre}`.toLowerCase().includes(t)))
    return l.slice().sort((a, b) => ((b.criticidad ?? 0) - (a.criticidad ?? 0)) * (orden === 'desc' ? 1 : -1) || a.codigo.localeCompare(b.codigo))
  }, [data, planta, sector, clas, texto, orden])
  const resumen = { C: lista.filter((e) => e.clasificacion === 'C').length, MC: lista.filter((e) => e.clasificacion === 'MC').length, NC: lista.filter((e) => e.clasificacion === 'NC').length }
  const plSel = pl?.plantas.find((p) => p.id === planta)

  return (
    <Pagina kicker="Módulo 1 · Planificación" titulo="Equipos y criticidad"
      acciones={<>
        {([['', 'Todos'], ['C', 'C · Crítico'], ['MC', 'MC · Media'], ['NC', 'NC · No crítico']] as const).map(([v, t]) => <Chip key={v} activo={clas === v} onClick={() => setClas(v)}>{t}</Chip>)}
        <select className="campo-chico" value={orden} onChange={(e) => setOrden(e.target.value as 'desc' | 'asc')} aria-label="Ordenar">
          <option value="desc">Más críticos primero</option><option value="asc">Menos críticos primero</option>
        </select>
      </>}>
      <div className="flex flex-wrap items-center gap-2.5 text-sm text-suave">
        <label className="flex items-center gap-1.5 rounded-full border border-borde bg-white py-1 pl-3.5 pr-1.5">Planta:
          <select className="bg-transparent py-1 font-semibold text-texto outline-none" value={planta} onChange={(e) => { setPlanta(e.target.value); setSector('') }}>
            <option value="">Todas</option>{(pl?.plantas ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.codigo})</option>)}
          </select>
        </label>
        {plSel && (
          <select className="campo-chico" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">Todos los sectores</option>{(pl?.sectores ?? []).filter((s) => s.planta_id === planta).map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>)}
          </select>
        )}
        <input className="campo-chico min-w-[220px]" placeholder="Buscar código o nombre…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <span className="hidden lg:inline">Código: Fábrica-Sector-Equipo-Número · la criticidad sale de la matriz, no se carga a mano.</span>
        {editable && <span className="ml-auto flex flex-wrap gap-2">
          <Boton chico variante="secundario" onClick={() => setPlantasAbierto(true)}>Plantas y sectores</Boton>
          <Boton chico variante="secundario" onClick={() => nav('/equipos/qr')}>Etiquetas QR</Boton>
          <Boton chico onClick={() => setEditando({ io: 1, fo: 1, isa: 0, activo: true, planta_id: planta || pl?.plantas[0]?.id })}>+ Nuevo equipo</Boton>
        </span>}
      </div>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : !lista.length ? (
        <Vacio texto={data?.length ? 'Ningún equipo coincide con el filtro.' : 'Todavía no hay equipos. Cargá las plantas y sectores, y después los equipos (o importá la planilla RG MA 01).'} />
      ) : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla min-w-[760px]">
            <thead><tr><th>Código</th><th>Descripción</th><th>Planta</th><th>Sector</th>
              <th className="cursor-pointer !text-primario-oscuro" onClick={() => setOrden(orden === 'desc' ? 'asc' : 'desc')}>Puntaje {orden === 'desc' ? '↓' : '↑'}</th>
              <th className="cursor-pointer !text-primario-oscuro" onClick={() => setOrden(orden === 'desc' ? 'asc' : 'desc')}>Criticidad {orden === 'desc' ? '↓' : '↑'}</th></tr></thead>
            <tbody>
              {lista.slice(0, 400).map((e) => (
                <tr key={e.id} className={`cursor-pointer ${e.activo ? '' : 'opacity-50'}`} onClick={() => nav(`/equipos/${e.id}`)}>
                  <td className="whitespace-nowrap text-[13px] font-semibold">{e.codigo}</td><td>{e.nombre}</td>
                  <td className="text-suave">{e.planta_nombre}</td><td className="text-suave">{e.sector_codigo ?? '—'}</td>
                  <td className="font-semibold">{e.criticidad ?? '—'}</td>
                  <td className="w-[140px]"><InsCriticidad c={e.clasificacion} ancho /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[13px] text-tenue">{lista.length} equipos · {resumen.C} críticos, {resumen.MC} de media, {resumen.NC} no críticos{lista.length > 400 ? ' · se muestran los primeros 400' : ''} · Tocá un equipo para ver su ficha.</div>
      {editando && <FormEquipo equipo={editando} plantas={pl?.plantas ?? []} sectores={pl?.sectores ?? []} onCerrar={() => setEditando(null)} onListo={(id) => { setEditando(null); void recargar(); if (id) nav(`/equipos/${id}`) }} />}
      {plantasAbierto && <PlantasSectores plantas={pl?.plantas ?? []} sectores={pl?.sectores ?? []} onCerrar={() => setPlantasAbierto(false)} onCambio={() => void recargarPlantas()} />}
    </Pagina>
  )
}

export function FormEquipo({ equipo, plantas, sectores, onCerrar, onListo }:
  { equipo: Partial<Equipo>; plantas: Planta[]; sectores: Sector[]; onCerrar: () => void; onListo: (id?: string) => void }) {
  const { data: config } = useConfig()
  const [f, setF] = useState<Partial<Equipo>>(equipo)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const set = (k: keyof Equipo, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  const num = (v: string) => (v === '' ? null : Number(v.replace(',', '.')))
  const crit = calcularCriticidad({ io: f.io ?? 0, fo: f.fo ?? 0, isa: f.isa ?? 0, cm_manual: f.cm_manual ?? null, costo_falla_usd: f.costo_falla_usd ?? null }, config)
  const pl = plantas.find((p) => p.id === f.planta_id)
  const se = sectores.find((s) => s.id === f.sector_id)
  const sugerido = pl && f.nombre ? [pl.codigo, se?.codigo, aCodigo(f.nombre)].filter(Boolean).join('-') : ''

  async function guardar() {
    if (!f.codigo?.trim() || !f.nombre?.trim() || !f.planta_id) { setError('Código, nombre y planta son obligatorios.'); return }
    setGuardando(true)
    const fila = {
      codigo: f.codigo.trim().toUpperCase(), nombre: f.nombre.trim(), planta_id: f.planta_id, sector_id: f.sector_id || null,
      descripcion: f.descripcion || null, marca: f.marca || null, modelo: f.modelo || null, nro_serie: f.nro_serie || null,
      diseno_propio: !!f.diseno_propio, tiene_reemplazo: !!f.tiene_reemplazo, io: f.io ?? 0, fo: f.fo ?? 0, isa: f.isa ?? 0,
      cm_manual: f.cm_manual ?? null, costo_falla_usd: f.costo_falla_usd ?? null, frecuencia_fallas: f.frecuencia_fallas ?? null,
      clasificacion_manual: f.clasificacion_manual ?? null,
      notas: f.notas || null, activo: f.activo ?? true
    }
    const r = f.id
      ? await supabase.from('mant_equipos').update(fila).eq('id', f.id).select('id').single()
      : await supabase.from('mant_equipos').insert(fila).select('id').single()
    setGuardando(false)
    if (r.error) setError(mensajeError(r.error)); else onListo(f.id ? undefined : r.data.id)
  }

  return (
    <Modal abierto titulo={f.id ? `Editar ${f.codigo}` : 'Nuevo equipo'} onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton cargando={guardando} onClick={() => void guardar()}>Guardar</Boton></>}>
      <ErrorBox texto={error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Planta">
          <select className="campo" value={f.planta_id ?? ''} onChange={(e) => { set('planta_id', e.target.value); set('sector_id', null) }}>
            <option value="">Elegir…</option>{plantas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Sector">
          <select className="campo" value={f.sector_id ?? ''} onChange={(e) => set('sector_id', e.target.value || null)}>
            <option value="">—</option>{sectores.filter((s) => s.planta_id === f.planta_id).map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Nombre"><input className="campo" value={f.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} placeholder="Horno 1" /></Campo>
        <Campo etiqueta="Código" ayuda={!f.id && sugerido && sugerido !== f.codigo ? `Sugerido: ${sugerido}` : 'Fábrica-Sector-Equipo-Número'}>
          <div className="flex gap-1">
            <input className="campo" value={f.codigo ?? ''} onChange={(e) => set('codigo', e.target.value)} placeholder="FP-PL-HORNO-1" />
            {!f.id && sugerido && <Boton variante="secundario" type="button" onClick={() => set('codigo', sugerido)}>Usar</Boton>}
          </div>
        </Campo>
        <Campo etiqueta="Marca"><input className="campo" value={f.marca ?? ''} onChange={(e) => set('marca', e.target.value)} /></Campo>
        <Campo etiqueta="Modelo / N° serie">
          <div className="flex gap-1"><input className="campo" value={f.modelo ?? ''} onChange={(e) => set('modelo', e.target.value)} placeholder="Modelo" /><input className="campo" value={f.nro_serie ?? ''} onChange={(e) => set('nro_serie', e.target.value)} placeholder="Serie" /></div>
        </Campo>
        <Campo etiqueta="Descripción / datos técnicos" className="sm:col-span-3"><textarea className="campo" value={f.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value)} /></Campo>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.diseno_propio} onChange={(e) => set('diseno_propio', e.target.checked)} /> Diseño propio</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.tiene_reemplazo} onChange={(e) => set('tiene_reemplazo', e.target.checked)} /> Tiene equipo de reemplazo</label>
        {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.activo ?? true} onChange={(e) => set('activo', e.target.checked)} /> Activo</label>}
      </div>

      <div className="mt-5 rounded-xl border border-borde p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-extrabold">Criticidad · C = (IO × FO) + CM + ISA</h4>
          {crit && <div className="text-sm">C = ({f.io ?? 0} × {f.fo ?? 0}) + {crit.cm} + {f.isa ?? 0} = <b className="text-lg">{crit.valor}</b> <InsCriticidad c={f.clasificacion_manual ?? crit.clasificacion} />{f.clasificacion_manual && f.clasificacion_manual !== crit.clasificacion && <span className="ml-1 text-xs text-suave">(calculada: {crit.clasificacion})</span>}</div>}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo etiqueta="IO · Impacto operacional" ayuda="10 pérdida de despacho · 7 para todo · 4 inventario/calidad · 1 sin efecto"><input className="campo" type="number" min={0} value={f.io ?? 0} onChange={(e) => set('io', Number(e.target.value))} /></Campo>
          <Campo etiqueta="FO · Flexibilidad" ayuda="4 sin reemplazo · 2 se adapta otro · 1 se reemplaza"><input className="campo" type="number" min={0} value={f.fo ?? 0} onChange={(e) => set('fo', Number(e.target.value))} /></Campo>
          <Campo etiqueta="Costo de falla (USD)" ayuda={config ? `Corte: USD ${fmtNum(config.corte_costo_usd)}` : undefined}><input className="campo" inputMode="decimal" value={f.costo_falla_usd ?? ''} onChange={(e) => set('costo_falla_usd', num(e.target.value))} /></Campo>
          <Campo etiqueta="CM manual (opcional)" ayuda="Reemplaza al calculado por costo"><input className="campo" type="number" min={0} value={f.cm_manual ?? ''} onChange={(e) => set('cm_manual', num(e.target.value))} /></Campo>
          <Campo etiqueta="ISA · Seguridad y ambiente" ayuda="8 seguridad humana · 7 ambiente · 5 daños severos · 3 menores · 1 ninguno"><input className="campo" type="number" min={0} value={f.isa ?? 0} onChange={(e) => set('isa', Number(e.target.value))} /></Campo>
          <Campo etiqueta="FREC · Frecuencia de fallas" ayuda="4 pobre (>3/año) · 3 (2 a 3) · 2 (1 a 2) · 1 excelente (<1)">
            <select className="campo" value={f.frecuencia_fallas ?? ''} onChange={(e) => set('frecuencia_fallas', num(e.target.value))}>
              <option value="">—</option><option value="4">4 · Pobre</option><option value="3">3 · Promedio</option><option value="2">2 · Buena</option><option value="1">1 · Excelente</option>
            </select>
          </Campo>
          <Campo etiqueta="Clasificación asignada" ayuda="Si se deja en automática, se usa la calculada">
            <select className="campo" value={f.clasificacion_manual ?? ''} onChange={(e) => set('clasificacion_manual', e.target.value || null)}>
              <option value="">Automática</option><option value="C">C · Crítico</option><option value="MC">MC · Media criticidad</option><option value="NC">NC · No crítico</option>
            </select>
          </Campo>
        </div>
      </div>
      <Campo etiqueta="Notas" className="mt-3"><textarea className="campo" value={f.notas ?? ''} onChange={(e) => set('notas', e.target.value)} /></Campo>
    </Modal>
  )
}

function PlantasSectores({ plantas, sectores, onCerrar, onCambio }: { plantas: Planta[]; sectores: Sector[]; onCerrar: () => void; onCambio: () => void }) {
  const avisar = useAviso()
  const [p, setP] = useState({ codigo: '', nombre: '' })
  const [s, setS] = useState({ planta_id: plantas[0]?.id ?? '', codigo: '', nombre: '' })
  async function alta(tabla: string, fila: object, limpiar: () => void) {
    const { error } = await supabase.from(tabla).insert(fila)
    if (error) avisar(mensajeError(error), 'error'); else { limpiar(); onCambio() }
  }
  return (
    <Modal abierto titulo="Plantas y sectores" onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 font-extrabold">Plantas (fábricas)</h4>
          <ul className="mb-3 space-y-1 text-sm">{plantas.map((x) => <li key={x.id}><b>{x.codigo}</b> · {x.nombre}</li>)}</ul>
          <div className="flex gap-1">
            <input className="campo w-20" placeholder="FP" value={p.codigo} onChange={(e) => setP({ ...p, codigo: e.target.value.toUpperCase() })} />
            <input className="campo" placeholder="Fábrica de pastas" value={p.nombre} onChange={(e) => setP({ ...p, nombre: e.target.value })} />
            <Boton variante="secundario" disabled={!p.codigo || !p.nombre} onClick={() => void alta('mant_plantas', p, () => setP({ codigo: '', nombre: '' }))}>+</Boton>
          </div>
        </div>
        <div>
          <h4 className="mb-2 font-extrabold">Sectores</h4>
          <select className="campo mb-2" value={s.planta_id} onChange={(e) => setS({ ...s, planta_id: e.target.value })}>
            {plantas.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
          </select>
          <ul className="mb-3 space-y-1 text-sm">{sectores.filter((x) => x.planta_id === s.planta_id).map((x) => <li key={x.id}><b>{x.codigo}</b> · {x.nombre}</li>)}</ul>
          <div className="flex gap-1">
            <input className="campo w-20" placeholder="PL" value={s.codigo} onChange={(e) => setS({ ...s, codigo: e.target.value.toUpperCase() })} />
            <input className="campo" placeholder="Planta" value={s.nombre} onChange={(e) => setS({ ...s, nombre: e.target.value })} />
            <Boton variante="secundario" disabled={!s.planta_id || !s.codigo || !s.nombre} onClick={() => void alta('mant_sectores', s, () => setS({ ...s, codigo: '', nombre: '' }))}>+</Boton>
          </div>
        </div>
      </div>
    </Modal>
  )
}
