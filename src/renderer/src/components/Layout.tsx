import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSesion } from '@/lib/sesion'
import { esEscritorio, supabase } from '@/lib/supabase'
import { ROLES, type Rol } from '@/lib/tipos'
import logo from '@/assets/logo-famiglia-rossi-circulo.png'

type Contador = 'pedidos' | 'panol' | 'compras'
interface Item { a: string; txt: string; roles?: Rol[]; contador?: Contador }

const ITEMS: Item[] = [
  { a: '/', txt: 'Inicio', roles: ['referente', 'supervisor', 'director', 'panolero', 'compras'] },
  { a: '/equipos', txt: 'Equipos', roles: ['referente', 'supervisor', 'director', 'panolero'] },
  { a: '/preventivo', txt: 'Preventivo', roles: ['referente', 'supervisor', 'director'] },
  { a: '/ordenes', txt: 'Órdenes de trabajo', roles: ['referente', 'supervisor', 'director'] },
  { a: '/pedidos', txt: 'Pedidos de reparación', roles: ['referente', 'supervisor', 'director'], contador: 'pedidos' },
  { a: '/panol', txt: 'Pañol', roles: ['panolero', 'referente', 'supervisor', 'compras', 'director'], contador: 'panol' },
  { a: '/compras', txt: 'Compras', roles: ['referente', 'supervisor', 'panolero', 'compras', 'director'], contador: 'compras' },
  { a: '/indicadores', txt: 'Indicadores', roles: ['referente', 'supervisor', 'director'] },
  { a: '/configuracion', txt: 'Configuración', roles: ['referente'] },
  { a: '/usuarios', txt: 'Usuarios', roles: ['admin'] }
]

/** Quienes usan la plataforma desde el celular: ven solo su pantalla, sin menú lateral */
export const esRolCelular = (rol?: Rol) => rol === 'solicitante' || rol === 'operario'

function useContadores(activo: boolean) {
  const [n, setN] = useState<Record<Contador, number>>({ pedidos: 0, panol: 0, compras: 0 })
  const loc = useLocation()
  useEffect(() => {
    if (!activo) return
    let vivo = true
    void Promise.all([
      supabase.from('mant_pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'nuevo').is('prioridad', null),
      supabase.from('mant_v_stock').select('id', { count: 'exact', head: true }).eq('activo', true).eq('bajo_minimo', true).gt('stock_minimo', 0),
      supabase.from('mant_compras').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')
    ]).then(([p, s, c]) => vivo && setN({ pedidos: p.count ?? 0, panol: s.count ?? 0, compras: c.count ?? 0 }))
    return () => { vivo = false }
  }, [activo, loc.pathname])
  return n
}

function Encabezado({ onMenu }: { onMenu?: () => void }) {
  const { usuario, salir } = useSesion()
  return (
    <header className="no-imprimir flex items-center gap-3 border-b border-borde bg-white px-4 py-3 md:px-5">
      {onMenu && (
        <button onClick={onMenu} aria-label="Menú" className="flex h-10 w-10 items-center justify-center rounded-full bg-fondo md:hidden">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      )}
      <img src={logo} alt="Famiglia Rossi" className="h-11 w-11 shrink-0 object-contain" />
      <div className="min-w-0 truncate text-[17px] font-light"><span className="font-bold">Mantenimiento</span><span className="hidden sm:inline"> · Agrícola Magdalena</span></div>
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-2.5 rounded-full bg-fondo py-1.5 pl-3.5 pr-2">
        <span className="hidden text-sm sm:inline"><span className="font-semibold">{usuario?.nombre}</span> · {usuario ? (usuario.turno && usuario.rol === 'operario' ? `Operario · turno ${usuario.turno.toLowerCase()}` : ROLES[usuario.rol]) : ''}</span>
        <span className="text-sm font-semibold sm:hidden">{usuario?.nombre?.split(' ')[0]}</span>
        <button onClick={() => void salir()} className="rounded-full bg-white px-3.5 py-2 text-[13px] font-medium text-texto">Cerrar sesión</button>
      </div>
    </header>
  )
}

function AvisoActualizacion() {
  const [actualizacion, setActualizacion] = useState<string | null>(null)
  useEffect(() => {
    const api = window.mantenimientoRossi
    if (!esEscritorio || !api) return
    return api.alActualizacionLista(setActualizacion)
  }, [])
  if (!actualizacion) return null
  return (
    <div className="no-imprimir flex flex-wrap items-center justify-between gap-3 bg-azul-claro px-5 py-2.5 text-sm text-revision">
      <span>Hay una versión nueva ({actualizacion}) lista para instalar.</span>
      <button className="rounded-full bg-revision px-4 py-1.5 font-semibold text-white" onClick={() => void window.mantenimientoRossi?.instalarActualizacion()}>Reiniciar y actualizar</button>
    </div>
  )
}

export function Layout() {
  const { usuario, puede } = useSesion()
  const [menu, setMenu] = useState(false)
  const [version, setVersion] = useState('')
  const loc = useLocation()
  const celular = esRolCelular(usuario?.rol)
  const contadores = useContadores(!celular)
  useEffect(() => setMenu(false), [loc.pathname])
  useEffect(() => { if (esEscritorio) void window.mantenimientoRossi?.version().then(setVersion) }, [])

  if (celular) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="h-1 bg-acento" />
        <Encabezado />
        <AvisoActualizacion />
        <main className="flex-1"><div className="mx-auto w-full max-w-[480px] md:my-6 md:overflow-hidden md:rounded-[32px] md:border md:border-borde md:bg-white md:shadow-[0_24px_60px_rgba(40,25,10,0.12)]"><Outlet /></div></main>
      </div>
    )
  }

  const visibles = ITEMS.filter((i) => !i.roles || puede(...i.roles))
  const enlace = (i: Item) => {
    const n = i.contador ? contadores[i.contador] : 0
    return (
      <NavLink key={i.a} to={i.a} end={i.a === '/'}
        className={({ isActive }) => `flex min-h-[44px] items-center justify-between gap-2 rounded-full px-4 py-2.5 text-[15px] ${isActive ? 'bg-primario font-semibold text-white' : 'text-texto-2 hover:bg-white/70'}`}>
        <span>{i.txt}</span>
        {n > 0 && <span className="rounded-full border border-[#f3c4c6] bg-white px-2 text-xs font-bold text-primario-oscuro">{n}</span>}
      </NavLink>
    )
  }
  const celularLinks = [
    { a: '/pedido/nuevo', txt: 'Nuevo pedido' },
    ...(puede('referente', 'supervisor') ? [{ a: '/tareas', txt: 'Mis tareas' }] : [])
  ]

  return (
    <div className="flex min-h-full flex-col">
      <div className="h-1 bg-acento" />
      <Encabezado onMenu={() => setMenu(true)} />
      <AvisoActualizacion />
      <div className="flex flex-1 items-start">
        <nav className={`no-imprimir fixed inset-y-0 left-0 z-40 flex w-[250px] shrink-0 flex-col gap-1 overflow-y-auto bg-fondo px-3.5 py-5 transition-transform md:sticky md:top-0 md:z-0 md:max-h-screen md:translate-x-0 ${menu ? 'translate-x-0 shadow-xl' : '-translate-x-full'}`}>
          {visibles.map(enlace)}
          <div className="px-3.5 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-tenue">Vistas celular</div>
          {celularLinks.map((l) => (
            <NavLink key={l.a} to={l.a} className={({ isActive }) => `min-h-[40px] rounded-full px-3.5 py-2.5 text-sm ${isActive ? 'bg-primario font-semibold text-white' : 'text-texto-2 hover:bg-white/70'}`}>{l.txt}</NavLink>
          ))}
          <div className="mx-1.5 mt-5 rounded-2xl border border-borde bg-white p-3.5 text-xs leading-relaxed text-suave">
            <span className="font-semibold text-texto">3 módulos, 1 base de datos.</span> Planificación · Correctivo y ejecución · Pañol y compras.
            {version && <div className="mt-1.5 text-[11px] text-tenue">Versión {version}</div>}
          </div>
        </nav>
        {menu && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMenu(false)} />}
        <main className="min-w-0 flex-1"><Outlet /></main>
      </div>
    </div>
  )
}
