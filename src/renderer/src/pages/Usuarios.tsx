import { useState } from 'react'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { TURNOS } from '@/lib/catalogos'
import { useDatos } from '@/lib/util'
import { ROLES, type Rol, type Usuario } from '@/lib/tipos'
import { Boton, Campo, Cargando, Chip, ErrorBox, H2, Insignia, Pagina, Tarjeta, useAviso } from '@/components/ui'

const esPlanta = (u: Usuario) => (u.email ?? '').endsWith('@planta.famigliarossi.local')

export function Usuarios() {
  const avisar = useAviso()
  const { usuario: yo } = useSesion()
  const [filtro, setFiltro] = useState<'pendientes' | 'activos' | 'todos'>('todos')
  const { data, cargando, error, recargar, setData } = useDatos(async () => {
    let q = supabase.from('mant_usuarios').select('*').order('activo').order('nombre')
    if (filtro === 'pendientes') q = q.eq('activo', false)
    if (filtro === 'activos') q = q.eq('activo', true)
    const r = await q
    return { data: (r.data ?? []) as Usuario[], error: r.error }
  }, [filtro])

  async function guardar(u: Usuario, cambios: Partial<Usuario>) {
    setData((d) => d?.map((x) => (x.id === u.id ? { ...x, ...cambios } : x)) ?? null)
    const { error } = await supabase.from('mant_usuarios').update(cambios).eq('id', u.id)
    if (error) { avisar(mensajeError(error), 'error'); void recargar() }
  }

  return (
    <Pagina kicker="Administración" titulo="Usuarios y accesos"
      subtitulo="El personal de oficina crea su cuenta con mail desde la pantalla de ingreso y acá se habilita. Operarios y producción se dan de alta acá y entran con su legajo o DNI.">
      <AltaPlanta onListo={() => void recargar()} />
      <div className="flex gap-2">
        {(['todos', 'pendientes', 'activos'] as const).map((f) => <Chip key={f} activo={filtro === f} onClick={() => setFiltro(f)}>{f[0].toUpperCase() + f.slice(1)}</Chip>)}
      </div>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla min-w-[1100px]">
            <thead><tr><th>Nombre</th><th>Ingreso</th><th>Legajo</th><th>DNI</th><th>Rol</th><th>Área</th><th>Turno</th><th>Límite USD</th><th>Estado</th></tr></thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id}>
                  <td><input className="campo min-h-[38px] py-1" defaultValue={u.nombre} onBlur={(e) => e.target.value !== u.nombre && void guardar(u, { nombre: e.target.value })} /></td>
                  <td className="text-[13px] text-suave">{esPlanta(u) ? <Insignia t="azul">Legajo / DNI</Insignia> : u.email}</td>
                  <td><input className="campo min-h-[38px] w-24 py-1" defaultValue={u.legajo ?? ''} onBlur={(e) => e.target.value !== (u.legajo ?? '') && void guardar(u, { legajo: e.target.value.trim() || null })} /></td>
                  <td><input className="campo min-h-[38px] w-32 py-1" defaultValue={u.dni ?? ''} onBlur={(e) => e.target.value !== (u.dni ?? '') && void guardar(u, { dni: e.target.value.replace(/\D/g, '') || null })} /></td>
                  <td>
                    <select className="campo min-h-[38px] py-1" value={u.rol} disabled={u.id === yo?.id} onChange={(e) => void guardar(u, { rol: e.target.value as Rol })}>
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><input className="campo min-h-[38px] py-1" defaultValue={u.area ?? ''} placeholder="Producción…" onBlur={(e) => e.target.value !== (u.area ?? '') && void guardar(u, { area: e.target.value || null })} /></td>
                  <td>
                    <select className="campo min-h-[38px] py-1" value={u.turno ?? ''} onChange={(e) => void guardar(u, { turno: e.target.value || null })}>
                      <option value="">—</option>{TURNOS.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td><input className="campo min-h-[38px] w-24 py-1" type="number" min={0} defaultValue={u.limite_aprobacion_usd} disabled={u.rol !== 'referente'}
                    onBlur={(e) => Number(e.target.value) !== Number(u.limite_aprobacion_usd) && void guardar(u, { limite_aprobacion_usd: Number(e.target.value) })} /></td>
                  <td>
                    {u.activo
                      ? <button disabled={u.id === yo?.id} title="Tocá para deshabilitar" onClick={() => void guardar(u, { activo: false })}><Insignia t="verde">Activo</Insignia></button>
                      : <Boton chico onClick={() => void guardar(u, { activo: true })}>Habilitar</Boton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Pagina>
  )
}

function AltaPlanta({ onListo }: { onListo: () => void }) {
  const avisar = useAviso()
  const vacio = { nombre: '', legajo: '', dni: '', rol: 'operario', turno: 'Mañana', area: '' }
  const [f, setF] = useState(vacio)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  async function crear() {
    setError(null); setGuardando(true)
    const { error } = await supabase.rpc('mant_crear_usuario_planta', {
      p_nombre: f.nombre, p_legajo: f.legajo, p_dni: f.dni, p_rol: f.rol, p_turno: f.rol === 'operario' ? f.turno : null, p_area: f.area || null
    })
    setGuardando(false)
    if (error) setError(mensajeError(error))
    else { avisar(`${f.nombre} ya puede entrar con su legajo o DNI.`); setF(vacio); onListo() }
  }
  return (
    <Tarjeta className="flex flex-col gap-3.5">
      <H2 texto="Alta de personal de planta" />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Campo etiqueta="Nombre y apellido" className="sm:col-span-2"><input className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
        <Campo etiqueta="Legajo"><input className="campo" inputMode="numeric" value={f.legajo} onChange={(e) => setF({ ...f, legajo: e.target.value })} /></Campo>
        <Campo etiqueta="DNI"><input className="campo" inputMode="numeric" value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value })} /></Campo>
        <Campo etiqueta="Rol">
          <select className="campo" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
            <option value="operario">Operario</option><option value="solicitante">Producción (solicitante)</option>
          </select>
        </Campo>
        {f.rol === 'operario'
          ? <Campo etiqueta="Turno"><select className="campo" value={f.turno} onChange={(e) => setF({ ...f, turno: e.target.value })}>{TURNOS.map((t) => <option key={t}>{t}</option>)}</select></Campo>
          : <Campo etiqueta="Área"><input className="campo" placeholder="Fábrica de pasta" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></Campo>}
      </div>
      <ErrorBox texto={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Boton cargando={guardando} disabled={!f.nombre.trim() || (!f.legajo.trim() && !f.dni.trim())} onClick={() => void crear()}>Dar de alta</Boton>
        <span className="text-[13px] text-tenue">Entra desde el celular en "Operario de planta", sin contraseña.</span>
      </div>
    </Tarjeta>
  )
}
