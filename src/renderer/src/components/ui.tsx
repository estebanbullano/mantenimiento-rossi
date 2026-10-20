import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Clasificacion, EstadoCompra, EstadoOT, EstadoPedido, Prioridad } from '@/lib/tipos'

// ---------- Botones ----------
type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma'
const VAR: Record<Variante, string> = {
  primario: 'bg-primario text-white hover:bg-primario-oscuro',
  secundario: 'bg-white text-texto border border-borde hover:bg-fondo-2',
  peligro: 'bg-white text-rechazado border border-rechazado/40 hover:bg-rechazado/5',
  fantasma: 'text-suave hover:bg-black/5'
}

export function Boton({ variante = 'primario', grande, className = '', cargando, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; grande?: boolean; cargando?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || cargando}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${grande ? 'px-5 py-3 text-base' : 'px-3.5 py-2 text-sm'} ${VAR[variante]} ${className}`}
    >
      {cargando && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  )
}

// ---------- Campos ----------
export function Campo({ etiqueta, children, ayuda, className = '' }: { etiqueta: string; children: ReactNode; ayuda?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="etiqueta">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-suave">{ayuda}</span>}
    </label>
  )
}

// ---------- Contenedores ----------
export function Tarjeta({ children, className = '', titulo, acciones }: { children: ReactNode; className?: string; titulo?: ReactNode; acciones?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-borde bg-white ${className}`}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-borde px-4 py-3">
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{titulo}</h2>
          <div className="flex flex-wrap gap-2">{acciones}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Pagina({ titulo, subtitulo, acciones, children }: { titulo: string; subtitulo?: ReactNode; acciones?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{titulo}</h1>
          {subtitulo && <p className="mt-0.5 text-sm text-suave">{subtitulo}</p>}
        </div>
        {acciones && <div className="no-imprimir flex flex-wrap gap-2">{acciones}</div>}
      </div>
      {children}
    </div>
  )
}

export function Pestanas<T extends string>({ valor, opciones, onCambio }: { valor: T; opciones: [T, string, number?][]; onCambio: (v: T) => void }) {
  return (
    <div className="no-imprimir mb-4 flex gap-1 overflow-x-auto border-b border-borde">
      {opciones.map(([v, txt, n]) => (
        <button key={v} onClick={() => onCambio(v)}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-bold ${valor === v ? 'border-primario text-primario' : 'border-transparent text-suave hover:text-texto'}`}>
          {txt}{n != null && n > 0 && <span className="ml-1.5 rounded-full bg-primario px-1.5 py-0.5 text-[11px] text-white">{n}</span>}
        </button>
      ))}
    </div>
  )
}

export function Modal({ abierto, titulo, onCerrar, children, pie, ancho = 'max-w-lg' }:
  { abierto: boolean; titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: string }) {
  useEffect(() => {
    if (!abierto) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [abierto, onCerrar])
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={onCerrar}>
      <div className={`flex max-h-[92vh] w-full ${ancho} flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-borde px-5 py-3">
          <h3 className="text-lg font-extrabold">{titulo}</h3>
          <button onClick={onCerrar} className="rounded p-1 text-2xl leading-none text-suave hover:bg-black/5" aria-label="Cerrar">×</button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap justify-end gap-2 border-t border-borde px-5 py-3">{pie}</footer>}
      </div>
    </div>
  )
}

export const Cargando = ({ texto = 'Cargando…' }: { texto?: string }) => (
  <div className="flex items-center gap-2 p-6 text-sm text-suave">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primario border-t-transparent" /> {texto}
  </div>
)

export const Vacio = ({ texto, children }: { texto: string; children?: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-borde bg-white p-8 text-center text-sm text-suave">
    <p>{texto}</p>{children && <div className="mt-3">{children}</div>}
  </div>
)

export const ErrorBox = ({ texto }: { texto: string | null }) =>
  texto ? <div className="mb-3 rounded-lg border border-rechazado/30 bg-rechazado/5 px-3 py-2 text-sm text-rechazado">{texto}</div> : null

export function Kpi({ titulo, valor, detalle, alerta, onClick }: { titulo: string; valor: ReactNode; detalle?: ReactNode; alerta?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`rounded-xl border bg-white p-4 text-left transition enabled:hover:shadow-md ${alerta ? 'border-primario/50' : 'border-borde'}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-suave">{titulo}</div>
      <div className={`mt-1 text-3xl font-extrabold ${alerta ? 'text-primario' : ''}`}>{valor}</div>
      {detalle && <div className="mt-1 text-xs text-suave">{detalle}</div>}
    </button>
  )
}

// ---------- Insignias ----------
const tono = {
  gris: 'bg-black/5 text-suave',
  verde: 'bg-aprobado/10 text-aprobado',
  amarillo: 'bg-pendiente/20 text-[#8a5a00]',
  azul: 'bg-revision/10 text-revision',
  rojo: 'bg-rechazado/10 text-rechazado',
  primario: 'bg-primario text-white'
}
export type Tono = keyof typeof tono
export const Insignia = ({ t = 'gris', children }: { t?: Tono; children: ReactNode }) => (
  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${tono[t]}`}>{children}</span>
)

const PRIO: Record<Prioridad, [Tono, string]> = { urgente: ['primario', 'Urgente'], alta: ['rojo', 'Alta'], media: ['amarillo', 'Media'], baja: ['gris', 'Baja'] }
export const InsPrioridad = ({ p }: { p: Prioridad | null | undefined }) => p ? <Insignia t={PRIO[p][0]}>{PRIO[p][1]}</Insignia> : null

const EOT: Record<EstadoOT, [Tono, string]> = { pendiente: ['amarillo', 'Pendiente'], en_proceso: ['azul', 'En proceso'], completada: ['verde', 'Completada'], cancelada: ['gris', 'Cancelada'] }
export const InsEstadoOT = ({ e }: { e: EstadoOT }) => <Insignia t={EOT[e][0]}>{EOT[e][1]}</Insignia>

const EPED: Record<EstadoPedido, [Tono, string]> = { nuevo: ['amarillo', 'Por priorizar'], aprobado: ['azul', 'Aprobado'], rechazado: ['rojo', 'Rechazado'], en_ot: ['azul', 'En orden de trabajo'], cerrado: ['verde', 'Resuelto'] }
export const InsEstadoPedido = ({ e }: { e: EstadoPedido }) => <Insignia t={EPED[e][0]}>{EPED[e][1]}</Insignia>

const ECOMP: Record<EstadoCompra, [Tono, string]> = { borrador: ['gris', 'Borrador'], pendiente: ['amarillo', 'Pendiente de aprobación'], aprobada: ['azul', 'Aprobada'], rechazada: ['rojo', 'Rechazada'], comprada: ['azul', 'Comprada'], recibida: ['verde', 'Recibida'] }
export const InsEstadoCompra = ({ e }: { e: EstadoCompra }) => <Insignia t={ECOMP[e][0]}>{ECOMP[e][1]}</Insignia>

const CLAS: Record<Clasificacion, [Tono, string]> = { C: ['primario', 'C · Crítico'], MC: ['amarillo', 'MC · Medio'], NC: ['gris', 'NC · No crítico'] }
export const InsCriticidad = ({ c, valor }: { c?: Clasificacion; valor?: number }) =>
  c ? <Insignia t={CLAS[c][0]}>{CLAS[c][1]}{valor != null && ` (${valor})`}</Insignia> : null

// ---------- Avisos ----------
type Aviso = { id: number; texto: string; tipo: 'ok' | 'error' }
const AvisoCtx = createContext<(texto: string, tipo?: 'ok' | 'error') => void>(() => {})
export const useAviso = () => useContext(AvisoCtx)

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const avisar = useCallback((texto: string, tipo: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setAvisos((a) => [...a, { id, texto, tipo }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'error' ? 7000 : 3500)
  }, [])
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {avisos.map((a) => (
          <div key={a.id} className={`pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow-lg ${a.tipo === 'error' ? 'bg-rechazado' : 'bg-texto'}`}>{a.texto}</div>
        ))}
      </div>
    </AvisoCtx.Provider>
  )
}
