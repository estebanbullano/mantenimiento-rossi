import { supabase } from './supabase'
import { deISO, hoy, lunesDe, sumarDias } from './util'
import type { ComentarioPedido, EstadoPedido, EstadoTicket, MaterialPedido, Pedido, Prioridad } from './tipos'

/** nuevo → pendiente · en OT → en proceso · cerrado → completado */
export function estadoTicket(e: EstadoPedido): EstadoTicket {
  if (e === 'cerrado') return 'completado'
  if (e === 'rechazado') return 'rechazado'
  if (e === 'en_ot' || e === 'aprobado') return 'proceso'
  return 'pendiente'
}
export const ESTADOS_TICKET: Record<EstadoTicket, string> = { pendiente: 'Pendiente', proceso: 'En proceso', completado: 'Completado', rechazado: 'Rechazado' }

export const PRIO_TXT: Record<Prioridad, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Media', baja: 'Baja' }
/** Para agrupar y filtrar: urgente cuenta como alta */
export const grupoPrioridad = (p: Prioridad | null | undefined): 'alta' | 'media' | 'baja' => (p === 'urgente' || p === 'alta' ? 'alta' : p === 'baja' ? 'baja' : 'media')

export const PLAZOS = [3, 7, 10, 15, 20, 30, 45, 60, 90]

export function diasDesde(iso: string | null | undefined) {
  if (!iso) return null
  return Math.round((deISO(hoy()).getTime() - deISO(iso).getTime()) / 86400000)
}
export const diasHasta = (iso: string | null | undefined) => { const d = diasDesde(iso); return d == null ? null : -d }

export const txtDias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`

/** Semáforo de la fecha probable de cierre (solo tickets en proceso) */
export function estadoCierre(t: Pedido): { clase: string; borde: string; texto: string } | null {
  if (estadoTicket(t.estado) !== 'proceso' || !t.fecha_cierre_estimada) return null
  const d = diasHasta(t.fecha_cierre_estimada)!
  if (d < 0) return { clase: 'bg-rechazado text-white', borde: 'border-l-rechazado', texto: `Vencido hace ${txtDias(-d)}` }
  if (d === 0) return { clase: 'bg-[#d9660b] text-white', borde: 'border-l-[#d9660b]', texto: 'Vence hoy' }
  if (d <= 2) return { clase: 'bg-[#d9660b] text-white', borde: 'border-l-[#d9660b]', texto: `Vence en ${txtDias(d)}` }
  if (d <= 5) return { clase: 'bg-pendiente text-[#2a1f00]', borde: 'border-l-pendiente', texto: `Vence en ${txtDias(d)}` }
  return { clase: 'bg-aprobado text-white', borde: 'border-l-aprobado', texto: `Vence en ${txtDias(d)}` }
}

export type Antiguedad = '' | 'hoy' | '3d' | '7d' | 'mas7' | 'mas30'
export const ANTIGUEDADES: [Antiguedad, string][] = [['', 'Antigüedad: todas'], ['hoy', 'Hoy'], ['3d', 'Últimos 3 días'], ['7d', 'Última semana'], ['mas7', 'Hace más de 7 días'], ['mas30', 'Hace más de 30 días']]
export function cumpleAntiguedad(t: Pedido, f: Antiguedad) {
  if (!f) return true
  const d = diasDesde(t.fecha_reporte)
  if (d == null) return false
  return f === 'hoy' ? d === 0 : f === '3d' ? d <= 3 : f === '7d' ? d <= 7 : f === 'mas7' ? d > 7 : d > 30
}

/** Las dos semanas que muestra la agenda (actual y próxima), de lunes a domingo */
export function dosSemanas() {
  const lunes = lunesDe(new Date())
  const semana = (ini: string, titulo: string) => ({
    titulo, dias: Array.from({ length: 7 }, (_, i) => {
      const iso = sumarDias(ini, i)
      const d = deISO(iso)
      return { iso, etiqueta: `${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` }
    })
  })
  const s1 = semana(lunes, 'Semana actual'), s2 = semana(sumarDias(lunes, 7), 'Semana que viene')
  return [s1, s2].map((s) => ({ ...s, titulo: `${s.titulo} (${s.dias[0].etiqueta} al ${s.dias[6].etiqueta})` }))
}

/** Comentarios y materiales de un conjunto de tickets, agrupados por ticket */
export async function cargarDetalles(ids: string[]) {
  const vacio = { comentarios: {} as Record<string, ComentarioPedido[]>, materiales: {} as Record<string, MaterialPedido[]> }
  if (!ids.length) return vacio
  const [c, m, u] = await Promise.all([
    supabase.from('mant_pedido_comentarios').select('*').in('pedido_id', ids).order('creado_en'),
    supabase.from('mant_pedido_materiales').select('*').in('pedido_id', ids).order('creado_en'),
    supabase.from('mant_usuarios').select('id,nombre')
  ])
  const nombres = Object.fromEntries(((u.data ?? []) as { id: string; nombre: string }[]).map((x) => [x.id, x.nombre]))
  for (const x of (c.data ?? []) as ComentarioPedido[]) {
    x.autor_nombre = x.autor_id ? nombres[x.autor_id] : 'Sistema'
    ;(vacio.comentarios[x.pedido_id] ??= []).push(x)
  }
  for (const x of (m.data ?? []) as MaterialPedido[]) (vacio.materiales[x.pedido_id] ??= []).push(x)
  return vacio
}

export const tituloTicket = (t: Pedido) => t.titulo || (t.equipo_nombre ? `Reparación: ${t.equipo_nombre}` : t.descripcion.slice(0, 80))
