import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { Clasificacion, EstadoCompra, EstadoOT, EstadoPedido, Prioridad, Urgencia } from '@/lib/tipos'

// ---------- Títulos: primera palabra en negrita, resto liviano ----------
export function Titulo({ texto, className = 'text-[34px]' }: { texto: string; className?: string }) {
  const [primera, ...resto] = texto.split(' ')
  return <span className={`font-light leading-tight ${className}`}><span className="font-bold">{primera}</span>{resto.length ? ' ' + resto.join(' ') : ''}</span>
}

export const H2 = ({ texto, className = 'text-xl' }: { texto: string; className?: string }) =>
  <h2 className="m-0"><Titulo texto={texto} className={className} /></h2>

// ---------- Botones ----------
type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma' | 'verde' | 'contorno'
const VAR: Record<Variante, string> = {
  primario: 'bg-primario text-white hover:bg-primario-oscuro',
  secundario: 'bg-white text-texto border border-borde-campo hover:bg-crema',
  peligro: 'bg-white text-primario-oscuro border border-borde-campo hover:bg-rojo-suave',
  fantasma: 'text-texto-2 hover:bg-black/5',
  verde: 'bg-aprobado text-white hover:brightness-110',
  contorno: 'bg-white text-primario-oscuro border border-dashed border-primario hover:bg-rojo-suave'
}

export function Boton({ variante = 'primario', grande, chico, className = '', cargando, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; grande?: boolean; chico?: boolean; cargando?: boolean }) {
  const tam = grande ? 'min-h-[50px] px-6 py-3 text-base' : chico ? 'min-h-[34px] px-3.5 py-1.5 text-[13px]' : 'min-h-[44px] px-[18px] py-2.5 text-sm'
  return (
    <button
      {...p}
      disabled={p.disabled || cargando}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${tam} ${VAR[variante]} ${className}`}
    >
      {cargando && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  )
}

/** Botón "volver" redondeado: ← Equipos */
export const Volver = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className="self-start rounded-full bg-white px-4 py-2 text-[13px] font-medium text-texto">← {children}</button>
)

// ---------- Campos ----------
export function Campo({ etiqueta, children, ayuda, className = '', suave }: { etiqueta: ReactNode; children: ReactNode; ayuda?: ReactNode; className?: string; suave?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className={suave ? 'etiqueta-suave' : 'etiqueta'}>{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-tenue">{ayuda}</span>}
    </label>
  )
}

// ---------- Contenedores ----------
export function Tarjeta({ children, className = '', titulo, acciones, sinPadding }: { children: ReactNode; className?: string; titulo?: ReactNode; acciones?: ReactNode; sinPadding?: boolean }) {
  return (
    <section className={`tarjeta ${sinPadding ? '' : 'p-5'} ${className}`}>
      {(titulo || acciones) && (
        <header className={`mb-3 flex flex-wrap items-center justify-between gap-2 ${sinPadding ? 'px-5 pt-5' : ''}`}>
          {typeof titulo === 'string' ? <h2 className="m-0 text-lg font-semibold">{titulo}</h2> : titulo}
          {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Pagina({ titulo, kicker, subtitulo, acciones, children, ancho = 'max-w-[1400px]' }:
  { titulo: string; kicker?: ReactNode; subtitulo?: ReactNode; acciones?: ReactNode; children: ReactNode; ancho?: string }) {
  return (
    <div className={`mx-auto ${ancho} px-4 pb-16 pt-6 md:px-6`}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          {kicker && <div className="kicker">{kicker}</div>}
          <h1 className="m-0 mt-1"><Titulo texto={titulo} className="text-[28px] md:text-[34px]" /></h1>
          {subtitulo && <p className="mt-1 text-sm text-suave">{subtitulo}</p>}
        </div>
        {acciones && <div className="no-imprimir flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </div>
  )
}

/** Selector de vistas: contenedor blanco y pestaña activa en rojo (como "Por equipo / Calendario anual") */
export function Pestanas<T extends string>({ valor, opciones, onCambio, className = '' }: { valor: T; opciones: [T, string, number?][]; onCambio: (v: T) => void; className?: string }) {
  return (
    <div className={`no-imprimir flex flex-wrap gap-1.5 self-start rounded-full border border-borde bg-white p-1 ${className}`}>
      {opciones.map(([v, txt, n]) => (
        <button key={v} onClick={() => onCambio(v)}
          className={`min-h-[40px] whitespace-nowrap rounded-full px-4 py-2 text-sm ${valor === v ? 'bg-primario font-semibold text-white' : 'text-texto-2 hover:bg-crema'}`}>
          {txt}{n != null && n > 0 && ` (${n})`}
        </button>
      ))}
    </div>
  )
}

/** Selector de dos opciones sobre fondo crema, activa en blanco (como "Nuevo pedido / Mis pedidos") */
export function Segmento<T extends string>({ valor, opciones, onCambio }: { valor: T; opciones: [T, string][]; onCambio: (v: T) => void }) {
  return (
    <div className="grid gap-1.5 rounded-full bg-fondo p-1" style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0,1fr))` }}>
      {opciones.map(([v, txt]) => (
        <button key={v} type="button" onClick={() => onCambio(v)}
          className={`min-h-[40px] rounded-full px-3.5 py-2 text-sm text-texto ${valor === v ? 'bg-white font-semibold shadow-[0_2px_8px_rgba(60,40,20,0.10)]' : ''}`}>{txt}</button>
      ))}
    </div>
  )
}

/** Filtro tipo chip (Todos · C · MC · NC) */
export const Chip = ({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick}
    className={`min-h-[36px] rounded-full border px-3.5 py-1.5 text-[13px] font-medium ${activo ? 'border-primario bg-primario text-white' : 'border-borde-campo bg-white text-texto-2'}`}>
    {children}
  </button>
)

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
      <div className={`flex max-h-[92vh] w-full ${ancho} flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-linea px-5 py-4">
          <h3 className="m-0"><Titulo texto={titulo} className="text-xl" /></h3>
          <button onClick={onCerrar} className="flex h-9 w-9 items-center justify-center rounded-full bg-fondo text-xl leading-none text-suave" aria-label="Cerrar">×</button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap justify-end gap-2 border-t border-linea px-5 py-3">{pie}</footer>}
      </div>
    </div>
  )
}

export const Cargando = ({ texto = 'Cargando…' }: { texto?: string }) => (
  <div className="flex items-center gap-3 p-6 text-sm text-suave">
    <span className="h-5 w-5 animate-spin rounded-full border-[3px] border-rojo-claro border-t-primario" /> {texto}
  </div>
)

export const Vacio = ({ texto, children }: { texto: ReactNode; children?: ReactNode }) => (
  <div className="rounded-tarjeta border-[1.5px] border-dashed border-borde-campo bg-white px-5 py-6 text-center text-sm text-suave">
    <p className="m-0">{texto}</p>{children && <div className="mt-3">{children}</div>}
  </div>
)

export const ErrorBox = ({ texto }: { texto: string | null }) =>
  texto ? <div className="rounded-xl bg-rojo-claro px-3.5 py-2.5 text-sm text-primario-oscuro">{texto}</div> : null

export const OkBox = ({ children }: { children: ReactNode }) =>
  <div className="rounded-2xl bg-verde-claro px-3.5 py-3 text-sm font-medium leading-snug text-aprobado">{children}</div>

/** Indicador del panel: número grande con barra de avance */
export function Kpi({ titulo, valor, detalle, color, avance, onClick }:
  { titulo: string; valor: ReactNode; detalle?: ReactNode; color?: string; avance?: number; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className="flex flex-col gap-2 rounded-tarjeta border border-borde bg-white p-5 text-left text-texto shadow-[0_6px_20px_rgba(60,40,20,0.05)] transition enabled:hover:shadow-[0_8px_26px_rgba(60,40,20,0.10)] disabled:cursor-default">
      <span className="text-sm font-medium text-suave">{titulo}</span>
      <span className="text-[40px] font-semibold leading-none" style={{ color }}>{valor}</span>
      {avance != null && (
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-beige">
          <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, avance))}%`, background: color ?? '#3a332b' }} />
        </span>
      )}
      {detalle && <span className="text-[13px] text-suave">{detalle}</span>}
    </button>
  )
}

/** Barra fina de avance */
export const Barra = ({ pct, color = '#cc1a20', alto = 'h-2' }: { pct: number; color?: string; alto?: string }) => (
  <span className={`block ${alto} w-full overflow-hidden rounded-full bg-linea`}>
    <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
  </span>
)

// ---------- Insignias ----------
const tono = {
  gris: 'bg-beige text-suave',
  verde: 'bg-verde-claro text-aprobado',
  amarillo: 'bg-ambar-claro text-pendiente',
  azul: 'bg-azul-claro text-revision',
  rojo: 'bg-rojo-claro text-primario-oscuro',
  primario: 'bg-primario text-white',
  blanco: 'bg-white text-texto border border-borde'
}
export type Tono = keyof typeof tono
export const Insignia = ({ t = 'gris', children, ancho }: { t?: Tono; children: ReactNode; ancho?: boolean }) => (
  <span className={`inline-flex items-center justify-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold ${ancho ? 'w-full' : ''} ${tono[t]}`}>{children}</span>
)

const PRIO: Record<Prioridad, [Tono, string]> = { urgente: ['primario', 'Urgente'], alta: ['primario', 'Prioridad alta'], media: ['amarillo', 'Prioridad media'], baja: ['gris', 'Prioridad baja'] }
export const InsPrioridad = ({ p, ancho }: { p: Prioridad | null | undefined; ancho?: boolean }) =>
  p ? <Insignia t={PRIO[p][0]} ancho={ancho}>{PRIO[p][1]}</Insignia> : <Insignia t="gris" ancho={ancho}>Sin prioridad</Insignia>

const EOT: Record<EstadoOT, [Tono, string]> = { pendiente: ['gris', 'Pendiente'], en_proceso: ['azul', 'En proceso'], completada: ['verde', 'Completado'], cancelada: ['gris', 'Cancelada'] }
export const InsEstadoOT = ({ e, vencida }: { e: EstadoOT; vencida?: boolean }) =>
  vencida ? <Insignia t="rojo">Vencida</Insignia> : <Insignia t={EOT[e][0]}>{EOT[e][1]}</Insignia>

/** Estado del pedido como lo ve la bandeja: Nuevo (sin prioridad) · Pendiente · En proceso · Completado */
export function estadoBandeja(e: EstadoPedido, prioridad: Prioridad | null | undefined): [Tono, string] {
  if (e === 'cerrado') return ['verde', 'Completado']
  if (e === 'rechazado') return ['gris', 'Rechazado']
  if (e === 'en_ot' || e === 'aprobado') return ['azul', 'En proceso']
  return prioridad ? ['gris', 'Pendiente'] : ['rojo', 'Nuevo']
}
export const InsEstadoPedido = ({ e, prioridad, ancho }: { e: EstadoPedido; prioridad?: Prioridad | null; ancho?: boolean }) => {
  const [t, txt] = estadoBandeja(e, prioridad)
  return <Insignia t={t} ancho={ancho}>{txt}</Insignia>
}

export const ESTADO_EQUIPO: Record<Urgencia, [Tono, string, string]> = {
  alta: ['rojo', 'Parado', '#b3141a'],
  media: ['amarillo', 'Funciona con problemas', '#d9a21b'],
  baja: ['verde', 'Detalle menor', '#1e6b3a']
}
export const InsEstadoEquipo = ({ u }: { u: Urgencia | null | undefined }) =>
  u ? <Insignia t={ESTADO_EQUIPO[u][0]}>{ESTADO_EQUIPO[u][1]}</Insignia> : null

const ECOMP: Record<EstadoCompra, [Tono, string]> = { borrador: ['gris', 'Borrador'], pendiente: ['amarillo', 'Pendiente de aprobación'], aprobada: ['verde', 'Aprobado'], rechazada: ['rojo', 'Rechazado'], comprada: ['verde', 'Aprobado'], recibida: ['verde', 'Aprobado'] }
export const InsEstadoCompra = ({ e, ancho }: { e: EstadoCompra; ancho?: boolean }) => <Insignia t={ECOMP[e][0]} ancho={ancho}>{ECOMP[e][1]}</Insignia>

export const CRIT: Record<Clasificacion, [Tono, string, string]> = { C: ['rojo', 'C · Crítico', '#b3141a'], MC: ['amarillo', 'MC · Media', '#8a5a00'], NC: ['verde', 'NC · No crítico', '#1e6b3a'] }
export const InsCriticidad = ({ c, valor, corta, ancho }: { c?: Clasificacion | null; valor?: number; corta?: boolean; ancho?: boolean }) =>
  c ? <Insignia t={CRIT[c][0]} ancho={ancho}>{corta ? c : CRIT[c][1]}{valor != null && ` (${valor})`}</Insignia> : null

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
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
        {avisos.map((a) => (
          <div key={a.id} className={`pointer-events-auto max-w-md rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg ${a.tipo === 'error' ? 'bg-primario-oscuro' : 'bg-texto'}`}>{a.texto}</div>
        ))}
      </div>
    </AvisoCtx.Provider>
  )
}
