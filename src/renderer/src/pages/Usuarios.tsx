import { useState } from 'react'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { TURNOS } from '@/lib/catalogos'
import { useDatos } from '@/lib/util'
import { ROLES, type Rol, type Usuario } from '@/lib/tipos'
import { Boton, Cargando, ErrorBox, Insignia, Pagina, Tarjeta, useAviso } from '@/components/ui'

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
    <Pagina titulo="Usuarios" subtitulo="Cada persona crea su cuenta desde la pantalla de ingreso; acá se habilita y se le asigna el rol.">
      <div className="mb-3 flex gap-2">
        {(['todos', 'pendientes', 'activos'] as const).map((f) => <Boton key={f} variante={filtro === f ? 'primario' : 'secundario'} onClick={() => setFiltro(f)}>{f[0].toUpperCase() + f.slice(1)}</Boton>)}
      </div>
      <ErrorBox texto={error} />
      {cargando ? <Cargando /> : (
        <Tarjeta className="overflow-x-auto">
          <table className="tabla -m-4 w-[calc(100%+2rem)]">
            <thead><tr><th>Nombre</th><th>Mail</th><th>Rol</th><th>Área</th><th>Turno</th><th>Límite aprobación (USD)</th><th>Estado</th></tr></thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id}>
                  <td><input className="campo py-1" defaultValue={u.nombre} onBlur={(e) => e.target.value !== u.nombre && void guardar(u, { nombre: e.target.value })} /></td>
                  <td className="text-suave">{u.email}</td>
                  <td>
                    <select className="campo py-1" value={u.rol} disabled={u.id === yo?.id} onChange={(e) => void guardar(u, { rol: e.target.value as Rol })}>
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><input className="campo py-1" defaultValue={u.area ?? ''} placeholder="Producción…" onBlur={(e) => e.target.value !== (u.area ?? '') && void guardar(u, { area: e.target.value || null })} /></td>
                  <td>
                    <select className="campo py-1" value={u.turno ?? ''} onChange={(e) => void guardar(u, { turno: e.target.value || null })}>
                      <option value="">—</option>{TURNOS.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td><input className="campo w-28 py-1" type="number" min={0} defaultValue={u.limite_aprobacion_usd} disabled={u.rol !== 'referente'}
                    onBlur={(e) => Number(e.target.value) !== Number(u.limite_aprobacion_usd) && void guardar(u, { limite_aprobacion_usd: Number(e.target.value) })} /></td>
                  <td>
                    {u.activo
                      ? <button disabled={u.id === yo?.id} onClick={() => void guardar(u, { activo: false })}><Insignia t="verde">Activo</Insignia></button>
                      : <Boton onClick={() => void guardar(u, { activo: true })}>Habilitar</Boton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </Pagina>
  )
}
