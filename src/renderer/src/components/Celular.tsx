import type { ReactNode } from 'react'
import { Titulo } from './ui'

/** Pantalla de celular: encabezado fijo (título, dato a la derecha, selector) y contenido */
export function PantallaCelular({ titulo, derecha, sub, selector, children }:
  { titulo: string; derecha?: ReactNode; sub?: ReactNode; selector?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-76px)] flex-col bg-white md:min-h-[720px]">
      <div className="flex flex-col gap-3 border-b border-linea px-[18px] pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[19px]"><Titulo texto={titulo} className="text-[19px]" /></div>
          {derecha}
        </div>
        {sub && <div className="-mt-2 text-[13px] text-suave">{sub}</div>}
        {selector}
      </div>
      <div className="flex-1 px-[18px] pb-6 pt-4">{children}</div>
    </div>
  )
}

/** Opción grande con punto de color (estado del equipo) */
export function OpcionPunto({ activa, color, onClick, children }: { activa: boolean; color: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex min-h-[46px] items-center gap-2.5 rounded-[14px] border px-3.5 py-2.5 text-left text-[15px] text-texto ${activa ? 'border-2 border-primario bg-rojo-suave font-semibold' : 'border-borde-campo bg-white'}`}>
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />{children}
    </button>
  )
}

/** Carga de foto con recuadro punteado rojo (sacar o subir) */
export function CargaFoto({ archivo, url, onArchivo, onQuitar, texto = 'Sacar / subir foto', alto = 'h-[130px]' }:
  { archivo: File | null; url?: string | null; onArchivo: (f: File) => void; onQuitar: () => void; texto?: string; alto?: string }) {
  if (archivo || url != null) {
    const src = url || (archivo ? URL.createObjectURL(archivo) : '')
    return (
      <div className={`rayado relative flex ${alto} items-end justify-between overflow-hidden rounded-[14px] p-2`}>
        {src && <img src={src} alt="Foto" className="absolute inset-0 h-full w-full object-cover" />}
        <span className="relative max-w-[60%] truncate rounded-full bg-white px-2.5 py-1 text-xs font-medium">{archivo?.name ?? 'Foto'}</span>
        <button type="button" onClick={onQuitar} className="relative rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-primario-oscuro">Quitar</button>
      </div>
    )
  }
  return (
    <label className="block min-h-[46px] cursor-pointer rounded-[14px] border-[1.5px] border-dashed border-primario p-3 text-center text-sm font-semibold text-primario-oscuro">
      {texto}
      <input type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onArchivo(f); e.target.value = '' }} />
    </label>
  )
}
