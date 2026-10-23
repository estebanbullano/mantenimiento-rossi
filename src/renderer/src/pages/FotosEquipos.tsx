import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { usePlantas } from '@/lib/catalogos'
import { subirArchivo, useDatos } from '@/lib/util'
import type { Clasificacion } from '@/lib/tipos'
import { Cargando, Chip, ErrorBox, InsCriticidad, useAviso } from '@/components/ui'
import { PantallaCelular } from '@/components/Celular'
import { Foto } from '@/components/selectores'

interface Eq { id: string; codigo: string; nombre: string; planta_id: string; sector_id: string | null; sector_nombre: string | null; clasificacion: Clasificacion | null }

/** Todas las filas de una consulta (Supabase devuelve de a 1000) */
async function todas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const r: T[] = []
  for (let i = 0; i < 20; i++) {
    const { data, error } = await consulta(i * 1000, i * 1000 + 999)
    if (error) throw error
    r.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return r
}

/** Link para sacarle la foto a cada máquina desde el celular: #/fotos-equipos */
export function FotosEquipos() {
  const nav = useNavigate()
  const avisar = useAviso()
  const { puede } = useSesion()
  const { data: pl } = usePlantas()
  const [planta, setPlanta] = useState('')
  const [sector, setSector] = useState('')
  const [texto, setTexto] = useState('')
  const [soloSin, setSoloSin] = useState(true)
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [nuevas, setNuevas] = useState<Record<string, string>>({})

  const { data, cargando, error } = useDatos(async () => {
    try {
      const [eqs, fotos] = await Promise.all([
        todas<Eq>((a, b) => supabase.from('mant_v_equipos').select('id,codigo,nombre,planta_id,sector_id,sector_nombre,clasificacion').eq('activo', true).order('codigo').range(a, b)),
        todas<{ equipo_id: string; ruta: string }>((a, b) => supabase.from('mant_v_equipo_foto').select('equipo_id,ruta').range(a, b))
      ])
      return { data: { eqs, fotos: new Map(fotos.map((f) => [f.equipo_id, f.ruta])) }, error: null }
    } catch (e) { return { data: null, error: e } }
  })

  const fotoDe = (id: string) => nuevas[id] ?? data?.fotos.get(id)
  const plantas = pl?.plantas ?? []
  const sectores = (pl?.sectores ?? []).filter((s) => !planta || s.planta_id === planta)
  const base = (data?.eqs ?? []).filter((e) => (!planta || e.planta_id === planta) && (!sector || e.sector_id === sector))
  const conFoto = base.filter((e) => fotoDe(e.id)).length
  const lista = useMemo(() => {
    const q = texto.toLowerCase().trim()
    return base.filter((e) => (!soloSin || !fotoDe(e.id)) && (!q || `${e.codigo} ${e.nombre}`.toLowerCase().includes(q)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, soloSin, texto, nuevas])

  async function sacar(e: Eq, f: File) {
    setSubiendo(e.id)
    try {
      const ruta = await subirArchivo(`equipos/${e.codigo}`, f)
      const { error } = await supabase.from('mant_equipo_fotos').insert({ equipo_id: e.id, ruta })
      if (error) throw error
      setNuevas((n) => ({ ...n, [e.id]: ruta }))
      avisar(`Foto guardada: ${e.nombre}`)
    } catch (err) { avisar(mensajeError(err), 'error') }
    setSubiendo(null)
  }

  const sel = 'campo min-h-[44px] rounded-xl'
  return (
    <div className="mx-auto w-full max-w-[560px] md:py-6">
      <div className="overflow-hidden md:rounded-[24px] md:border md:border-borde">
        <PantallaCelular titulo="Fotos de las máquinas" sub={data ? `${conFoto} de ${base.length} con foto${planta || sector ? ' en este filtro' : ''}` : undefined}
          selector={<div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <select className={sel} value={planta} onChange={(e) => { setPlanta(e.target.value); setSector('') }}>
                <option value="">Todas las plantas</option>{plantas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <select className={sel} value={sector} onChange={(e) => setSector(e.target.value)} disabled={!planta}>
                <option value="">{planta ? 'Todos los sectores' : 'Elegí la planta'}</option>{sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <input className={sel} placeholder="Buscar por nombre o código…" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <div className="flex gap-1.5"><Chip activo={soloSin} onClick={() => setSoloSin(true)}>Sin foto</Chip><Chip activo={!soloSin} onClick={() => setSoloSin(false)}>Todas</Chip></div>
          </div>}>
          <ErrorBox texto={error ? mensajeError(error) : null} />
          {cargando && !data ? <Cargando /> : (
            <div className="flex flex-col gap-2.5">
              {data && base.length > 0 && <span className="flex h-2 overflow-hidden rounded-full bg-linea"><span style={{ width: `${(conFoto / base.length) * 100}%`, background: '#1e6b3a' }} /></span>}
              {lista.length === 0 && <div className="py-6 text-center text-sm text-suave">{soloSin && base.length ? '¡Todas las máquinas de este filtro tienen foto! 📸' : 'No hay máquinas con este filtro.'}</div>}
              {lista.slice(0, 200).map((e) => {
                const f = fotoDe(e.id)
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-[16px] border border-borde p-2.5">
                    {f ? <Foto ruta={f} className="h-16 w-16 shrink-0" /> : <span className="rayado h-16 w-16 shrink-0 rounded-[14px]" />}
                    <button className="flex min-w-0 flex-1 flex-col items-start text-left" disabled={!puede('referente', 'supervisor', 'director')} onClick={() => nav(`/equipos/${e.id}`)}>
                      <span className="text-[15px] font-semibold leading-tight">{e.nombre}</span>
                      <span className="flex items-center gap-1.5 text-xs text-tenue">{e.codigo}{e.sector_nombre ? ` · ${e.sector_nombre}` : ''} {e.clasificacion && <InsCriticidad c={e.clasificacion} corta />}</span>
                    </button>
                    <label className={`flex min-h-[44px] shrink-0 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-semibold ${f ? 'border border-borde-campo bg-white text-texto' : 'bg-primario text-white'} ${subiendo === e.id ? 'opacity-60' : ''}`}>
                      {subiendo === e.id ? 'Subiendo…' : f ? '📷 Otra' : '📷 Sacar'}
                      <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!!subiendo}
                        onChange={(ev) => { const file = ev.target.files?.[0]; if (file) void sacar(e, file); ev.target.value = '' }} />
                    </label>
                  </div>
                )
              })}
              {lista.length > 200 && <div className="text-center text-xs text-tenue">Se muestran 200 de {lista.length}: elegí planta o sector.</div>}
            </div>
          )}
        </PantallaCelular>
      </div>
    </div>
  )
}

/** Foto de la máquina en su ficha, con botón para sacar o cambiar */
export function FotoEquipo({ equipoId, codigo }: { equipoId: string; codigo: string }) {
  const avisar = useAviso()
  const { puede } = useSesion()
  const [subiendo, setSubiendo] = useState(false)
  const { data, recargar } = useDatos(async () => {
    const r = await supabase.from('mant_equipo_fotos').select('id,ruta,creado_en').eq('equipo_id', equipoId).order('creado_en', { ascending: false }).limit(6)
    return { data: (r.data ?? []) as { id: string; ruta: string; creado_en: string }[], error: r.error }
  }, [equipoId])
  async function sacar(f: File) {
    setSubiendo(true)
    try {
      const ruta = await subirArchivo(`equipos/${codigo}`, f)
      const { error } = await supabase.from('mant_equipo_fotos').insert({ equipo_id: equipoId, ruta })
      if (error) throw error
      avisar('Foto guardada.'); void recargar()
    } catch (err) { avisar(mensajeError(err), 'error') }
    setSubiendo(false)
  }
  const fotos = data ?? []
  return (
    <div className="flex flex-col gap-2">
      {fotos[0] ? <Foto ruta={fotos[0].ruta} className="h-[200px] w-full" /> : <div className="rayado flex h-[140px] items-center justify-center rounded-[14px] text-sm text-suave">Sin foto todavía</div>}
      {fotos.length > 1 && <div className="flex gap-1.5">{fotos.slice(1).map((f) => <Foto key={f.id} ruta={f.ruta} className="h-12 w-12" />)}</div>}
      {puede('referente', 'supervisor', 'operario') && (
        <label className="cursor-pointer self-start rounded-full border border-borde-campo bg-white px-3.5 py-2 text-[13px] font-semibold">
          {subiendo ? 'Subiendo…' : fotos.length ? '📷 Cambiar foto' : '📷 Sacar foto'}
          <input type="file" accept="image/*" className="hidden" disabled={subiendo} onChange={(e) => { const f = e.target.files?.[0]; if (f) void sacar(f); e.target.value = '' }} />
        </label>
      )}
    </div>
  )
}
