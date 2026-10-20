import { useCallback, useEffect, useRef, useState } from 'react'
import { BUCKET, mensajeError, supabase } from './supabase'
import { UNIDADES, type Unidad } from './tipos'

/** Carga datos y los recarga cuando cambian las dependencias */
export function useDatos<T>(cargar: () => PromiseLike<{ data: T | null; error: unknown }>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const fn = useRef(cargar)
  fn.current = cargar
  const pedido = useRef(0)

  const recargar = useCallback(async () => {
    const n = ++pedido.current
    setCargando(true)
    const r = await fn.current()
    if (n !== pedido.current) return            // llegó una respuesta más nueva: se ignora esta
    if (r.error) setError(mensajeError(r.error))
    else {
      setError(null)
      setData(r.data)
    }
    setCargando(false)
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void recargar() }, deps)
  return { data, error, cargando, recargar, setData }
}

// ---------- Fechas ----------
const hoyISO = () => aISO(new Date())
export const hoy = hoyISO

export function aISO(d: Date) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}

/** Interpreta 'YYYY-MM-DD' como fecha local (sin correrse un día) */
export function deISO(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function lunesDe(fecha: Date | string) {
  const d = typeof fecha === 'string' ? deISO(fecha) : new Date(fecha)
  const dia = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dia)
  return aISO(d)
}

export function sumarDias(iso: string, n: number) {
  const d = deISO(iso)
  d.setDate(d.getDate() + n)
  return aISO(d)
}

export function sumarFrecuencia(iso: string, valor: number, unidad: Unidad) {
  const d = deISO(iso)
  if (unidad === 'dias') d.setDate(d.getDate() + valor)
  else if (unidad === 'semanas') d.setDate(d.getDate() + valor * 7)
  else if (unidad === 'meses') d.setMonth(d.getMonth() + valor)
  else d.setDate(d.getDate() + Math.max(1, Math.ceil(valor / 24)))
  return aISO(d)
}

/** Número de semana ISO (S1…S53), como el calendario de la planilla RG MA 01 */
export function semanaISO(iso: string) {
  const d = deISO(iso)
  const jueves = new Date(d)
  jueves.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const enero4 = new Date(jueves.getFullYear(), 0, 4)
  return 1 + Math.round(((jueves.getTime() - enero4.getTime()) / 86400000 - 3 + ((enero4.getDay() + 6) % 7)) / 7)
}

export const fmtFecha = (s?: string | null) =>
  s ? deISO(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

export const fmtFechaHora = (s?: string | null) =>
  s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export const fmtNum = (n?: number | null, dec = 0) =>
  n == null ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

export const fmtMin = (min?: number | null) => {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`
}

/** "cada 1 meses" → "mensual", "cada 12 meses" → "anual" */
export function fmtFrecuencia(valor: number, unidad: Unidad) {
  const k = `${valor} ${unidad}`
  const n: Record<string, string> = { '1 dias': 'diaria', '1 semanas': 'semanal', '2 semanas': 'quincenal', '1 meses': 'mensual', '2 meses': 'bimestral',
    '3 meses': 'trimestral', '6 meses': 'semestral', '12 meses': 'anual', '24 meses': 'cada 2 años', '36 meses': 'cada 3 años' }
  return n[k] ?? (valor % 12 === 0 && unidad === 'meses' ? `cada ${valor / 12} años` : `cada ${valor} ${UNIDADES[unidad]}`)
}

export const numOT = (n: number) => `OT-${String(n).padStart(5, '0')}`
export const numPedido = (n: number) => `P-${String(n).padStart(5, '0')}`
export const numCompra = (n: number) => `C-${String(n).padStart(5, '0')}`

// ---------- Fotos ----------
/** Achica la foto del celular (4–8 MB) a ~300 KB antes de subirla */
export async function comprimirImagen(archivo: File, lado = 1600, calidad = 0.72): Promise<Blob> {
  if (!archivo.type.startsWith('image/')) return archivo
  const bitmap = await createImageBitmap(archivo)
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((ok) => canvas.toBlob((b) => ok(b ?? archivo), 'image/jpeg', calidad))
}

export async function subirArchivo(carpeta: string, archivo: File) {
  const esImagen = archivo.type.startsWith('image/')
  const cuerpo = esImagen ? await comprimirImagen(archivo) : archivo
  const ext = esImagen ? 'jpg' : (archivo.name.split('.').pop() || 'bin')
  const ruta = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, cuerpo, {
    contentType: esImagen ? 'image/jpeg' : archivo.type || undefined,
    upsert: false
  })
  if (error) throw error
  return ruta
}

export async function urlFirmada(ruta: string) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 3600)
  return data?.signedUrl ?? null
}

/** Convierte un texto a código (mayúsculas, guiones) */
export const aCodigo = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')
