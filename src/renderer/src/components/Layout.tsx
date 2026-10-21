import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSesion } from '@/lib/sesion'
import { esEscritorio } from '@/lib/supabase'
import { ROLES, type Rol } from '@/lib/tipos'
import logo from '@/assets/logo-molinos-rossi-blanco.png'

interface Item { a: string; txt: string; icono: ReactNode; roles?: Rol[]; movil?: boolean }

const I = (d: string) => <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>

const ITEMS: Item[] = [
  { a: '/', txt: 'Inicio', icono: I('M3 11l9-8 9 8M5 10v10h14V10'), movil: true },
  { a: '/pedidos', txt: 'Pedidos', icono: I('M4 4h16v16H4zM8 9h8M8 13h8M8 17h5'), movil: true },
  { a: '/tareas', txt: 'Mis tareas', icono: I('M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11'), roles: ['operario', 'referente', 'supervisor'], movil: true },
  { a: '/ordenes', txt: 'Órdenes de trabajo', icono: I('M14 3v4h4M6 3h8l4 4v14H6zM9 13h6M9 17h6'), roles: ['referente', 'supervisor', 'director'] },
  { a: '/agenda', txt: 'Agenda semanal', icono: I('M4 5h16v15H4zM4 10h16M9 3v4M15 3v4') },
  { a: '/preventivo', txt: 'Plan preventivo', icono: I('M12 8v4l3 2M21 12a9 9 0 1 1-9-9'), roles: ['referente', 'supervisor', 'director'] },
  { a: '/equipos', txt: 'Equipos y criticidad', icono: I('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'), roles: ['referente', 'supervisor', 'director', 'panolero'] },
  { a: '/panol', txt: 'Pañol', icono: I('M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8'), roles: ['panolero', 'referente', 'supervisor', 'compras', 'director'] },
  { a: '/compras', txt: 'Compras', icono: I('M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'), roles: ['referente', 'supervisor', 'panolero', 'compras', 'director'] },
  { a: '/indicadores', txt: 'Indicadores', icono: I('M4 20V10M10 20V4M16 20v-7M22 20H2'), roles: ['referente', 'supervisor', 'director'] },
  { a: '/usuarios', txt: 'Usuarios', icono: I('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'), roles: ['admin'] },
  { a: '/configuracion', txt: 'Configuración', icono: I('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'), roles: ['referente'] }
]

export function Layout() {
  const { usuario, puede, salir } = useSesion()
  const [menu, setMenu] = useState(false)
  const [actualizacion, setActualizacion] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const loc = useLocation()
  useEffect(() => setMenu(false), [loc.pathname])

  useEffect(() => {
    const api = window.mantenimientoRossi
    if (!esEscritorio || !api) return
    void api.version().then(setVersion)
    return api.alActualizacionLista(setActualizacion)
  }, [])

  const visibles = ITEMS.filter((i) => !i.roles || puede(...i.roles))
  const movil = visibles.filter((i) => i.movil)

  const enlace = (i: Item) => (
    <NavLink key={i.a} to={i.a} end={i.a === '/'}
      className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold transition ${isActive ? 'bg-white text-primario' : 'text-white/90 hover:bg-white/10'}`}>
      {i.icono}{i.txt}
    </NavLink>
  )

  return (
    <div className="flex h-full">
      {/* Barra lateral (PC) / menú desplegable (celular) */}
      <aside className={`no-imprimir fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-primario p-3 transition-transform md:static md:translate-x-0 ${menu ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <img src={logo} alt="Molinos Rossi" className="h-10" />
        </div>
        <div className="mb-3 px-2 text-xs font-extrabold uppercase tracking-widest text-white/70">Mantenimiento</div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">{visibles.map(enlace)}</nav>
        <div className="mt-3 border-t border-white/20 px-2 pt-3 text-white">
          <div className="truncate text-sm font-bold">{usuario?.nombre}</div>
          <div className="truncate text-xs text-white/70">{usuario ? ROLES[usuario.rol] : ''}</div>
          <button onClick={() => void salir()} className="mt-2 text-xs font-bold text-white/80 underline">Cerrar sesión</button>
          {version && <div className="mt-1 text-[11px] text-white/50">Versión {version}</div>}
        </div>
      </aside>
      {menu && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMenu(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-imprimir flex items-center gap-3 bg-primario px-3 py-2 text-white md:hidden">
          <button onClick={() => setMenu(true)} aria-label="Menú" className="rounded p-1 hover:bg-white/10">{I('M3 6h18M3 12h18M3 18h18')}</button>
          <span className="font-extrabold">Mantenimiento Rossi</span>
        </header>
        {actualizacion && (
          <div className="no-imprimir flex items-center justify-between gap-3 bg-revision px-4 py-2 text-sm text-white">
            <span>Hay una versión nueva ({actualizacion}) lista para instalar.</span>
            <button className="rounded bg-white px-3 py-1 font-bold text-revision" onClick={() => void window.mantenimientoRossi?.instalarActualizacion()}>Reiniciar y actualizar</button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0"><Outlet /></main>

        {/* Barra inferior en el celular, para los operarios */}
        <nav className="no-imprimir fixed inset-x-0 bottom-0 z-20 grid border-t border-borde bg-white md:hidden" style={{ gridTemplateColumns: `repeat(${movil.length}, 1fr)`, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {movil.map((i) => (
            <NavLink key={i.a} to={i.a} end={i.a === '/'}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${isActive ? 'text-primario' : 'text-suave'}`}>
              {i.icono}{i.txt}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
