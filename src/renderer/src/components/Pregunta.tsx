import { useEffect, useRef, useState } from 'react'
import { Boton, Titulo } from './ui'

/**
 * Reemplazo de window.prompt(): en la app de escritorio (Electron) prompt() no existe
 * y devuelve null sin mostrar nada. Esta ventana funciona igual en la PC y en el celular.
 */
interface Opciones { titulo?: string; mensaje: string; etiqueta?: string; valor?: string; aceptar?: string; peligro?: boolean; obligatorio?: boolean }
interface Pendiente extends Opciones { resolver: (v: string | null) => void }

let mostrar: ((p: Pendiente) => void) | null = null

/** Pide un texto. Devuelve el texto (puede ser '') o null si se canceló. */
export function pedirTexto(o: Opciones): Promise<string | null> {
  return new Promise((resolver) => {
    if (mostrar) mostrar({ ...o, resolver })
    else resolver(window.prompt(o.mensaje, o.valor ?? '')) // respaldo
  })
}

export function ProveedorPreguntas() {
  const [p, setP] = useState<Pendiente | null>(null)
  const [txt, setTxt] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    mostrar = (n) => { setTxt(n.valor ?? ''); setP(n) }
    return () => { mostrar = null }
  }, [])
  useEffect(() => { if (p) setTimeout(() => ref.current?.focus(), 30) }, [p])
  if (!p) return null
  const cerrar = (v: string | null) => { p.resolver(v); setP(null) }
  const ok = () => { if (p.obligatorio && !txt.trim()) { ref.current?.focus(); return } cerrar(txt) }
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={() => cerrar(null)}>
      <div className="flex w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') cerrar(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok() }}>
        <header className="border-b border-linea px-5 py-4"><h3 className="m-0"><Titulo texto={p.titulo ?? 'Confirmar'} className="text-xl" /></h3></header>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-texto-2">{p.mensaje}</p>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {p.etiqueta ?? (p.obligatorio ? 'Motivo' : 'Motivo (opcional)')}
            <textarea ref={ref} className="campo min-h-[70px] font-normal" value={txt} onChange={(e) => setTxt(e.target.value)} />
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-linea px-5 py-3">
          <Boton variante="secundario" onClick={() => cerrar(null)}>Cancelar</Boton>
          <Boton variante={p.peligro ? 'peligro' : 'primario'} disabled={p.obligatorio && !txt.trim()} onClick={ok}>{p.aceptar ?? 'Aceptar'}</Boton>
        </footer>
      </div>
    </div>
  )
}
