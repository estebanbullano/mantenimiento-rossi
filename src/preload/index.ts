import { contextBridge, ipcRenderer } from 'electron'

const api = {
  obtenerEnlacePendiente: (): Promise<string | null> => ipcRenderer.invoke('obtener-enlace-pendiente'),
  abrirExterno: (url: string) => ipcRenderer.invoke('abrir-externo', url),
  version: (): Promise<string> => ipcRenderer.invoke('version-app'),
  instalarActualizacion: () => ipcRenderer.invoke('instalar-actualizacion'),
  alActualizacionLista: (callback: (version: string) => void) => {
    const manejador = (_e: unknown, version: string) => callback(version)
    ipcRenderer.on('actualizacion-lista', manejador)
    return () => { ipcRenderer.removeListener('actualizacion-lista', manejador) }
  },
  alRecibirEnlace: (callback: (url: string) => void) => {
    const manejador = (_e: unknown, url: string) => callback(url)
    ipcRenderer.on('auth-callback', manejador)
    return () => { ipcRenderer.removeListener('auth-callback', manejador) }
  }
}

export type ApiEscritorio = typeof api
contextBridge.exposeInMainWorld('mantenimientoRossi', api)
