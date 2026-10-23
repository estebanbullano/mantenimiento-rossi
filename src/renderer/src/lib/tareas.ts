import { mensajeError, supabase } from './supabase'
import { pedirTexto } from '@/components/Pregunta'

/** Elimina una tarea del plan preventivo (pregunta antes). Devuelve true si se eliminó. */
export async function eliminarTarea(t: { id: string; descripcion: string }, avisar: (t: string, tipo?: 'ok' | 'error') => void) {
  const motivo = await pedirTexto({ titulo: 'Eliminar tarea', mensaje: `¿Eliminar "${t.descripcion}" del plan preventivo?\n\nSe cancelan sus OT pendientes; las ya hechas quedan en el historial de la máquina.`, aceptar: 'Eliminar', peligro: true })
  if (motivo === null) return false
  const { data, error } = await supabase.rpc('mant_eliminar_tarea', { p_tarea: t.id, p_motivo: motivo.trim() || null })
  if (error) { avisar(mensajeError(error), 'error'); return false }
  const r = (data ?? {}) as { ots_canceladas?: number; ots_en_historial?: number }
  avisar(`Tarea eliminada${r.ots_canceladas ? ` · ${r.ots_canceladas} OT pendiente${r.ots_canceladas > 1 ? 's' : ''} cancelada${r.ots_canceladas > 1 ? 's' : ''}` : ''}${r.ots_en_historial ? ` · ${r.ots_en_historial} en el historial` : ''}.`)
  return true
}
