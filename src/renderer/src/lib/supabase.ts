import { createClient } from '@supabase/supabase-js'

export const esEscritorio = __PLATAFORMA__ === 'escritorio' && !!window.mantenimientoRossi

const url = import.meta.env.VITE_SUPABASE_URL
const clave = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configurado = !!url && !!clave && !url.includes('xxxxxxxx')

export const supabase = createClient(url || 'https://sin-configurar.supabase.co', clave || 'sin-clave', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    // En la web el enlace del mail vuelve a la página; en escritorio llega por el protocolo propio
    detectSessionInUrl: !esEscritorio
  }
})

/** Dirección a la que vuelven los mails de alta y recuperación de contraseña */
export function urlRetorno() {
  if (esEscritorio) return `mantenimientorossi://auth-callback`
  // Sin el #: Supabase agrega ?code=… y la app lo canjea al cargar
  return window.location.origin + window.location.pathname
}

export const BUCKET = 'mant-fotos'

/** Supabase devuelve errores con mensajes en inglés; los traduce los más comunes */
export function mensajeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  if (m.includes('Invalid login credentials')) return 'Mail o contraseña incorrectos.'
  if (m.includes('Email not confirmed')) return 'Falta confirmar el mail: revisá tu casilla.'
  if (m.includes('User already registered')) return 'Ese mail ya tiene cuenta.'
  if (m.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.'
  if (m.includes('Failed to fetch')) return 'Sin conexión con el servidor. Revisá internet.'
  if (m.includes('row-level security')) return 'No tenés permiso para esta acción.'
  if (m.includes('duplicate key')) return 'Ya existe un registro con ese código.'
  return m
}
