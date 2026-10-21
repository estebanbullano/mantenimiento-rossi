export type Rol = 'solicitante' | 'operario' | 'referente' | 'supervisor' | 'panolero' | 'compras' | 'director' | 'admin'

export const ROLES: Record<Rol, string> = {
  solicitante: 'Área solicitante',
  operario: 'Operario',
  referente: 'Referente de mantenimiento',
  supervisor: 'Supervisor de mantenimiento',
  panolero: 'Pañolero',
  compras: 'Compras',
  director: 'Director',
  admin: 'Administrador'
}

export interface Usuario {
  id: string
  email: string | null
  nombre: string
  rol: Rol
  area: string | null
  turno: string | null
  limite_aprobacion_usd: number
  activo: boolean
}

export interface Planta { id: string; codigo: string; nombre: string; activo: boolean }
export interface Sector { id: string; planta_id: string; codigo: string; nombre: string; activo: boolean }

export type Clasificacion = 'NC' | 'MC' | 'C'

export interface Equipo {
  id: string
  codigo: string
  nombre: string
  planta_id: string
  sector_id: string | null
  descripcion: string | null
  marca: string | null
  modelo: string | null
  nro_serie: string | null
  diseno_propio: boolean
  tiene_reemplazo: boolean
  io: number
  fo: number
  cm_manual: number | null
  costo_falla_usd: number | null
  isa: number
  frecuencia_fallas: number | null
  clasificacion_manual: Clasificacion | null
  notas: string | null
  activo: boolean
  // de la vista
  clasificacion_calculada?: Clasificacion
  planta_codigo?: string
  planta_nombre?: string
  sector_codigo?: string | null
  sector_nombre?: string | null
  cm?: number
  criticidad?: number
  clasificacion?: Clasificacion
}

export type Unidad = 'dias' | 'semanas' | 'meses' | 'horas'
export const UNIDADES: Record<Unidad, string> = { dias: 'días', semanas: 'semanas', meses: 'meses', horas: 'horas' }

export interface Tarea {
  id: string
  equipo_id: string | null
  unidad: string | null
  descripcion: string
  origen: string | null
  frecuencia_valor: number
  frecuencia_unidad: Unidad
  duracion_estimada_horas: number | null
  responsable_id: string | null
  turno: string | null
  requiere_parada: boolean
  ultima_ejecucion: string | null
  proxima_fecha: string
  activa: boolean
  notas: string | null
}

export type Prioridad = 'baja' | 'media' | 'alta' | 'urgente'
export const PRIORIDADES: Prioridad[] = ['urgente', 'alta', 'media', 'baja']

export type EstadoPedido = 'nuevo' | 'aprobado' | 'rechazado' | 'en_ot' | 'cerrado'

/** Estado del ticket tal como lo ve la gente: pendiente → en proceso → completado */
export type EstadoTicket = 'pendiente' | 'proceso' | 'completado' | 'rechazado'
export type Urgencia = 'alta' | 'media' | 'baja'
export const URGENCIAS: [Urgencia, string][] = [
  ['alta', 'Alta - la máquina está parada'],
  ['media', 'Media - funciona con problemas'],
  ['baja', 'Baja - puede esperar']
]
export type Disponibilidad = 'sin_verificar' | 'stock' | 'pedido' | 'transito'
export const DISPONIBILIDADES: Record<Disponibilidad, string> = { sin_verificar: 'Sin verificar', stock: 'En stock', pedido: 'A pedir', transito: 'En tránsito' }
export type Recursos = 'listo' | 'esperando' | 'sinmateriales'
export const RECURSOS: Record<Recursos, string> = { listo: 'Listo para hacer', esperando: 'Esperando material', sinmateriales: 'Sin materiales cargados' }

/** Áreas de la planta desde donde se piden reparaciones */
export const AREAS = ['Acopio', 'Molino trigo', 'Molino maíz', 'Pellet', 'Caldera', 'Envasado kg', 'Envasado 25', 'Pastas', 'Balanza', 'Depósito', 'Legumbres', 'Premezcla', 'Recepción']

export interface CambioFecha { de: string | null; a: string; motivo: string; fecha: string; avisado: boolean }

export interface Pedido {
  id: string
  numero: number
  titulo: string | null
  equipo_id: string | null
  ubicacion: string | null
  area: string | null
  descripcion: string
  equipo_detenido: boolean
  urgencia_reportada: Urgencia | null
  fecha_reporte: string
  solicitante_id: string
  estado: EstadoPedido
  prioridad: Prioridad | null
  fecha_comprometida: string | null
  fecha_cierre_estimada: string | null
  responsable_id: string | null
  asignados_ids: string[]
  tercerizado: boolean
  tercerizado_detalle: string | null
  duracion_dias: number | null
  fecha_inicio: string | null
  cambio_fecha: CambioFecha | null
  motivo_rechazo: string | null
  foto_ruta: string | null
  creado_en: string
  // de la vista
  equipo_codigo?: string | null
  equipo_nombre?: string | null
  solicitante_nombre?: string | null
  solicitante_email?: string | null
  responsable_nombre?: string | null
  asignados_nombres?: string[] | null
  orden_id?: string | null
  orden_estado?: EstadoOT | null
  orden_numero?: number | null
  recursos?: Recursos
  comentarios?: number
  dias_abierto?: number
}

export interface ComentarioPedido { id: string; pedido_id: string; autor_id: string | null; texto: string; creado_en: string; autor_nombre?: string }
export interface MaterialPedido { id: string; pedido_id: string; articulo_id: string | null; nombre: string; cantidad: string | null; disponibilidad: Disponibilidad }
export interface AgendaCelda { pedido_id: string; usuario_id: string; dia: string; fraccion: number; usuario_nombre: string; numero: number; titulo: string; prioridad: Prioridad | null; estado: EstadoPedido }

export type EstadoOT = 'pendiente' | 'en_proceso' | 'completada' | 'cancelada'

export interface Orden {
  id: string
  numero: number
  tipo: 'preventiva' | 'correctiva'
  equipo_id: string | null
  tarea_id: string | null
  pedido_id: string | null
  titulo: string
  descripcion: string | null
  prioridad: Prioridad
  estado: EstadoOT
  asignado_id: string | null
  turno: string | null
  semana: string | null
  fecha_programada: string | null
  fecha_comprometida: string | null
  duracion_estimada_horas: number | null
  iniciada_en: string | null
  completada_en: string | null
  tiempo_real_min: number | null
  comentario_cierre: string | null
  creado_en: string
  equipo_codigo?: string | null
  equipo_nombre?: string | null
  planta_id?: string | null
  tarea_unidad?: string | null
  asignado_nombre?: string | null
  pedido_numero?: number | null
  pedido_area?: string | null
  vencida?: boolean
  fotos_cierre?: number
  items_total?: number
  items_hechos?: number
}

export interface TareaItem { id: string; tarea_id: string; orden: number; descripcion: string; horas: number | null; detalle: string | null }
export interface OtItem { id: string; orden_id: string; orden: number; descripcion: string; detalle: string | null; hecho: boolean; observacion: string | null; hecho_en: string | null }
export interface Proveedor { id: string; nombre: string; localidad: string | null; contacto: string | null; telefono: string | null; rubro: string | null; activo: boolean }

export interface Articulo {
  id: string
  codigo: string
  descripcion: string
  familia: string | null
  unidad: string
  ubicacion: string | null
  alias: string[]
  stock_actual: number
  stock_minimo: number
  stock_sugerido: number | null
  costo_unit_usd: number | null
  activo: boolean
  bajo_minimo?: boolean
  bajo_sugerido?: boolean
  equipos_que_lo_usan?: number
}

export type EstadoCompra = 'borrador' | 'pendiente' | 'aprobada' | 'rechazada' | 'comprada' | 'recibida'

export interface Compra {
  id: string
  numero: number
  orden_id: string | null
  tarea_id: string | null
  descripcion: string
  proveedor: string | null
  moneda: 'ARS' | 'USD'
  monto: number
  tipo_cambio: number | null
  monto_usd: number | null
  estado: EstadoCompra
  adjunto_ruta: string | null
  solicitado_por: string | null
  decidido_por: string | null
  decidido_en: string | null
  comentario: string | null
  creado_en: string
}

export interface Config {
  corte_costo_usd: number
  cm_supera_corte: number
  cm_no_supera_corte: number
  umbral_mc: number
  umbral_c: number
}
