import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { esEscritorio, supabase } from './supabase'
import type { Rol, Usuario } from './tipos'

interface Sesion {
  session: Session | null
  usuario: Usuario | null
  cargando: boolean
  recuperando: boolean               // llegó por el enlace de "olvidé mi contraseña"
  errorPerfil: string | null
  terminarRecuperacion: () => void
  recargarUsuario: () => Promise<void>
  salir: () => Promise<void>
  /** ¿El usuario tiene alguno de estos roles? El admin siempre puede. */
  puede: (...roles: Rol[]) => boolean
}

const Ctx = createContext<Sesion>(null as unknown as Sesion)
export const useSesion = () => useContext(Ctx)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [cargando, setCargando] = useState(true)
  const [recuperando, setRecuperando] = useState(false)
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null)

  async function cargarUsuario(s: Session | null) {
    if (!s) { setUsuario(null); return }
    const { data, error } = await supabase.from('mant_usuarios').select('*').eq('id', s.user.id).maybeSingle()
    setErrorPerfil(error ? error.message : data ? null : 'No se encontró tu perfil de usuario.')
    setUsuario((data as Usuario) ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await cargarUsuario(data.session)
      setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true)
      setSession(s)
      // fuera del callback para no bloquear el cliente de auth
      setTimeout(() => void cargarUsuario(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Escritorio: los enlaces de los mails llegan por el protocolo mantenimientorossi://
  useEffect(() => {
    const api = window.mantenimientoRossi
    if (!esEscritorio || !api) return
    const procesar = async (url: string | null) => {
      if (!url) return
      const u = new URL(url.replace('mantenimientorossi://', 'https://x/'))
      const code = u.searchParams.get('code')
      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
        if (u.searchParams.get('type') === 'recovery' || url.includes('recovery')) setRecuperando(true)
      }
    }
    void api.obtenerEnlacePendiente().then(procesar)
    return api.alRecibirEnlace((url) => void procesar(url))
  }, [])

  const valor: Sesion = {
    session,
    usuario,
    cargando,
    recuperando,
    errorPerfil,
    terminarRecuperacion: () => setRecuperando(false),
    recargarUsuario: () => cargarUsuario(session),
    salir: async () => { await supabase.auth.signOut(); setUsuario(null) },
    puede: (...roles) => !!usuario?.activo && (usuario.rol === 'admin' || roles.includes(usuario.rol))
  }
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

/** Atajos de permisos usados en varias pantallas */
export const STAFF: Rol[] = ['referente', 'supervisor', 'director']
export const PLANIFICA: Rol[] = ['referente', 'supervisor']
