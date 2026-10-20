// Proceso principal de Electron. Misma estructura que Compras Rossi:
// ventana única, enlace de login por protocolo propio y actualización automática.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
const PROTOCOLO = 'mantenimientorossi'

app.commandLine.appendSwitch('lang', 'es-AR')

let ventana: BrowserWindow | null = null
let enlacePendiente: string | null = null

const buscarEnlace = (argv: string[]) => argv.find((a) => a.startsWith(`${PROTOCOLO}://`)) ?? null

function entregarEnlace(url: string) {
  if (ventana && !ventana.webContents.isLoading()) ventana.webContents.send('auth-callback', url)
  else enlacePendiente = url
}

if (process.defaultApp) {
  app.setAsDefaultProtocolClient(PROTOCOLO, process.execPath, [app.getAppPath()])
} else {
  app.setAsDefaultProtocolClient(PROTOCOLO)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  enlacePendiente = buscarEnlace(process.argv)

  app.on('second-instance', (_e, argv) => {
    const url = buscarEnlace(argv)
    if (url) entregarEnlace(url)
    if (ventana) {
      if (ventana.isMinimized()) ventana.restore()
      ventana.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.famigliarossi.mantenimiento')

    ipcMain.handle('abrir-externo', (_e, url: unknown) => {
      if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('whatsapp://'))) {
        return shell.openExternal(url)
      }
      return undefined
    })
    ipcMain.handle('version-app', () => app.getVersion())
    ipcMain.handle('instalar-actualizacion', () => autoUpdater.quitAndInstall(false, true))
    ipcMain.handle('obtener-enlace-pendiente', () => {
      const url = enlacePendiente
      enlacePendiente = null
      return url
    })

    crearVentana()
    buscarActualizaciones()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

function buscarActualizaciones() {
  if (!app.isPackaged) return
  // Canal propio dentro del repositorio compartido con Compras Rossi
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => ventana?.webContents.send('actualizacion-lista', info.version))
  autoUpdater.on('error', (error) => console.error('Actualización:', error))
  const buscar = () => autoUpdater.checkForUpdates().catch((e) => console.error('Actualización:', e))
  buscar()
  setInterval(buscar, 4 * 60 * 60 * 1000)
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Mantenimiento Rossi',
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  ventana.once('ready-to-show', () => {
    ventana?.maximize()
    ventana?.show()
  })

  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  ventana.on('closed', () => {
    ventana = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) ventana.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else ventana.loadFile(join(__dirname, '../renderer/index.html'))
}
