import { supabase } from './supabase'
import { useDatos } from './util'
import type { Equipo, Planta, Proveedor, Sector, Usuario } from './tipos'

export function useEquipos() {
  return useDatos(async () => {
    const r = await supabase.from('mant_v_equipos').select('*').eq('activo', true).order('codigo')
    return { data: (r.data ?? []) as Equipo[], error: r.error }
  })
}

export function usePlantas() {
  return useDatos(async () => {
    const [p, s] = await Promise.all([
      supabase.from('mant_plantas').select('*').order('codigo'),
      supabase.from('mant_sectores').select('*').order('codigo')
    ])
    return { data: { plantas: (p.data ?? []) as Planta[], sectores: (s.data ?? []) as Sector[] }, error: p.error || s.error }
  })
}

/** Usuarios activos de mantenimiento a los que se les puede asignar una OT */
export function useOperarios() {
  return useDatos(async () => {
    const r = await supabase.from('mant_usuarios').select('*').eq('activo', true)
      .in('rol', ['operario', 'referente', 'supervisor']).order('nombre')
    return { data: (r.data ?? []) as Usuario[], error: r.error }
  })
}

export function useProveedores() {
  return useDatos(async () => {
    const r = await supabase.from('mant_proveedores').select('*').eq('activo', true).order('nombre')
    return { data: (r.data ?? []) as Proveedor[], error: r.error }
  })
}

export const TURNOS = ['Mañana', 'Tarde', 'Noche', 'Central']
