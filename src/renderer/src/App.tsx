import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ProveedorSesion, useSesion } from '@/lib/sesion'
import type { Rol } from '@/lib/tipos'
import { Cargando, ProveedorAvisos, Vacio } from '@/components/ui'
import { Layout } from '@/components/Layout'
import { Acceso, CuentaPendiente, NuevaClave } from '@/pages/Acceso'
import { Inicio } from '@/pages/Inicio'
import { NuevoPedido } from '@/pages/Solicitante'
import { Pedidos } from '@/pages/Pedidos'
import { MisTareas, TareaCelular } from '@/pages/Operario'
import { esRolCelular } from '@/components/Layout'
import { OrdenDetalle } from '@/pages/OrdenDetalle'
import { Ordenes } from '@/pages/Ordenes'
import { Preventivo } from '@/pages/Preventivo'
import { Equipos } from '@/pages/Equipos'
import { EquipoDetalle } from '@/pages/EquipoDetalle'
import { EtiquetasQR } from '@/pages/EtiquetasQR'
import { Panol } from '@/pages/Panol'
import { Compras } from '@/pages/Compras'
import { Indicadores } from '@/pages/Indicadores'
import { Usuarios } from '@/pages/Usuarios'
import { Configuracion } from '@/pages/Configuracion'

function Solo({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { puede } = useSesion()
  return puede(...roles) ? <>{children}</> : <div className="p-6"><Vacio texto="No tenés acceso a esta sección." /></div>
}

const MANT: Rol[] = ['referente', 'supervisor']
const STAFF: Rol[] = ['referente', 'supervisor', 'director']

function Rutas() {
  const { session, usuario, cargando, recuperando, errorPerfil, recargarUsuario, salir } = useSesion()
  if (cargando) return <Cargando />
  if (!session) return <Acceso />
  if (recuperando) return <NuevaClave />
  if (!usuario) return errorPerfil ? (
    <div className="mx-auto max-w-sm p-6 text-center">
      <Vacio texto={`No se pudo cargar tu perfil: ${errorPerfil}`}>
        <button className="mr-3 font-bold text-primario" onClick={() => void recargarUsuario()}>Reintentar</button>
        <button className="text-suave underline" onClick={() => void salir()}>Cerrar sesión</button>
      </Vacio>
    </div>
  ) : <Cargando texto="Cargando tu perfil…" />
  if (!usuario.activo) return <CuentaPendiente />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={usuario.rol === 'operario' ? <MisTareas /> : usuario.rol === 'solicitante' ? <NuevoPedido /> : <Inicio />} />
        <Route path="pedido/nuevo" element={<NuevoPedido />} />
        <Route path="pedidos" element={<Pedidos />} />
        <Route path="tareas" element={<Solo roles={['operario', ...MANT]}><MisTareas /></Solo>} />
        <Route path="ordenes" element={<Solo roles={STAFF}><Ordenes /></Solo>} />
        <Route path="ordenes/:id" element={esRolCelular(usuario.rol) ? <TareaCelular /> : <OrdenDetalle />} />
        <Route path="agenda" element={<Navigate to="/ordenes" replace />} />
        <Route path="preventivo" element={<Solo roles={STAFF}><Preventivo /></Solo>} />
        <Route path="equipos" element={<Solo roles={[...STAFF, 'panolero']}><Equipos /></Solo>} />
        <Route path="equipos/qr" element={<Solo roles={MANT}><EtiquetasQR /></Solo>} />
        <Route path="equipos/:id" element={<Solo roles={[...STAFF, 'panolero']}><EquipoDetalle /></Solo>} />
        <Route path="panol" element={<Solo roles={['panolero', 'compras', ...STAFF]}><Panol /></Solo>} />
        <Route path="compras" element={<Solo roles={['panolero', 'compras', ...STAFF]}><Compras /></Solo>} />
        <Route path="indicadores" element={<Solo roles={STAFF}><Indicadores /></Solo>} />
        <Route path="usuarios" element={<Solo roles={['admin']}><Usuarios /></Solo>} />
        <Route path="configuracion" element={<Solo roles={['referente']}><Configuracion /></Solo>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <ProveedorAvisos>
      <ProveedorSesion>
        <HashRouter>
          <Rutas />
        </HashRouter>
      </ProveedorSesion>
    </ProveedorAvisos>
  )
}
