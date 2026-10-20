/// <reference types="vite/client" />
import type { ApiEscritorio } from '../../preload'

declare global {
  const __PLATAFORMA__: 'escritorio' | 'web'
  interface Window {
    mantenimientoRossi?: ApiEscritorio
  }
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
    readonly VITE_WEB_URL?: string
  }
}

declare module '*.png' {
  const src: string
  export default src
}
