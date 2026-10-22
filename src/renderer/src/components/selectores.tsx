import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Articulo, Equipo } from '@/lib/tipos'
import { urlFirmada } from '@/lib/util'
import { InsCriticidad } from './ui'

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Buscador de equipos por código o nombre */
export function SelectorEquipo({ equipos, valor, onCambio, placeholder = 'Buscar por código o nombre…' }:
  { equipos: Equipo[]; valor: string | null; onCambio: (id: string | null) => void; placeholder?: string }) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const elegido = equipos.find((e) => e.id === valor)
  const filtrados = useMemo(() => {
    const t = normalizar(texto)
    return equipos.filter((e) => !t || normalizar(`${e.codigo} ${e.nombre} ${e.sector_nombre ?? ''}`).includes(t)).slice(0, 40)
  }, [equipos, texto])

  if (elegido) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[14px] border border-borde-campo bg-white px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{elegido.codigo}</div>
          <div className="truncate text-xs text-suave">{elegido.nombre} · {elegido.planta_nombre}{elegido.sector_nombre ? ` / ${elegido.sector_nombre}` : ''}</div>
        </div>
        <button type="button" className="text-sm font-semibold text-primario" onClick={() => onCambio(null)}>Cambiar</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <input className="campo" value={texto} placeholder={placeholder}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true) }} onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)} />
      {abierto && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[14px] border border-borde bg-white shadow-lg">
          {filtrados.length === 0 && <div className="p-3 text-sm text-suave">Sin resultados</div>}
          {filtrados.map((e) => (
            <button type="button" key={e.id} onMouseDown={() => { onCambio(e.id); setTexto('') }}
              className="flex w-full items-center justify-between gap-2 border-b border-borde px-3 py-2 text-left last:border-0 hover:bg-crema">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{e.codigo}</span>
                <span className="block truncate text-xs text-suave">{e.nombre}</span>
              </span>
              <InsCriticidad c={e.clasificacion} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Buscador del catálogo del pañol (busca en código, descripción y alias) */
export function SelectorArticulo({ onElegir, placeholder = 'Buscar repuesto en el pañol…' }:
  { onElegir: (a: Articulo) => void; placeholder?: string }) {
  const [texto, setTexto] = useState('')
  const [res, setRes] = useState<Articulo[]>([])
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(t.current)
    if (texto.trim().length < 2) { setRes([]); return }
    t.current = setTimeout(async () => {
      const q = texto.trim().replace(/[%,()"{}\\]/g, ' ').replace(/\s+/g, ' ').trim()
      if (q.length < 2) { setRes([]); return }
      const { data } = await supabase.from('mant_v_stock').select('*').eq('activo', true)
        .or(`codigo.ilike.%${q}%,descripcion.ilike.%${q}%,alias.cs.{"${q.toLowerCase()}"}`).limit(15)
      setRes((data ?? []) as Articulo[])
    }, 250)
  }, [texto])
  return (
    <div className="relative">
      <input className="campo" value={texto} placeholder={placeholder} onChange={(e) => setTexto(e.target.value)} />
      {res.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-borde bg-white shadow-lg">
          {res.map((a) => (
            <button type="button" key={a.id} onClick={() => { onElegir(a); setTexto(''); setRes([]) }}
              className="flex w-full justify-between gap-2 border-b border-borde px-3 py-2 text-left text-sm last:border-0 hover:bg-crema">
              <span><b>{a.codigo}</b> · {a.descripcion}</span>
              <span className={`whitespace-nowrap ${a.bajo_minimo ? 'text-primario' : 'text-suave'}`}>Stock {a.stock_actual} {a.unidad}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Botón para sacar foto con la cámara del celular o elegir un archivo en la PC */
export function BotonFoto({ onArchivo, texto = 'Sacar foto', cargando, aceptar = 'image/*' }:
  { onArchivo: (f: File) => void; texto?: string; cargando?: boolean; aceptar?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept={aceptar} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onArchivo(f); e.target.value = '' }} />
      <button type="button" disabled={cargando} onClick={() => ref.current?.click()}
        className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-primario bg-white px-4 py-3 text-sm font-semibold text-primario-oscuro disabled:opacity-50">
        {cargando ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <IconoCamara />}
        {cargando ? 'Subiendo…' : texto}
      </button>
    </>
  )
}

export const IconoCamara = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="4" /></svg>
)

/** Miniatura de una foto guardada en el bucket privado */
export function Foto({ ruta, className = 'h-24 w-24', sinEnlace }: { ruta: string; className?: string; sinEnlace?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { void urlFirmada(ruta).then(setUrl) }, [ruta])
  if (!url) return <div className={`${className} rayado animate-pulse rounded-[14px]`} />
  const img = <img src={url} alt="" className={`${className} rounded-[14px] object-cover`} />
  return sinEnlace ? img : <a href={url} target="_blank" rel="noreferrer">{img}</a>
}
