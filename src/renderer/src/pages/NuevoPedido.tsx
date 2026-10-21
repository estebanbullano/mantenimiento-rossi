import { useNavigate, useSearchParams } from 'react-router-dom'
import { Pagina } from '@/components/ui'
import { FormularioPedido } from '@/components/Ticket'

/** Link fijo para pedir una reparación: #/pedido/nuevo (o con ?equipo=CÓDIGO desde el QR pegado en el equipo). */
export function NuevoPedido() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  return (
    <Pagina titulo="Pedir una reparación" subtitulo="Mantenimiento lo prioriza y te avisa la fecha probable de cierre. Después lo seguís desde Pedidos.">
      <div className="mx-auto max-w-2xl">
        <FormularioPedido equipoInicial={params.get('equipo')} onEnviado={() => nav('/pedidos?mios=1')} />
      </div>
    </Pagina>
  )
}
