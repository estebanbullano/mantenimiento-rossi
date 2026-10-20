import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useEquipos, usePlantas } from '@/lib/catalogos'
import { Boton, Cargando, ErrorBox, Pagina } from '@/components/ui'
import logo from '@/assets/logo-famiglia-rossi-circulo.png'

const base = () => (import.meta.env.VITE_WEB_URL || '').replace(/\/$/, '')
export const urlPedidoEquipo = (codigo: string) => `${base()}/#/pedido/nuevo?equipo=${encodeURIComponent(codigo)}`

/** Etiquetas para pegar en cada equipo: al escanear se abre el pedido de reparación con el equipo cargado */
export function EtiquetasQR() {
  const { data: equipos, cargando } = useEquipos()
  const { data: pl } = usePlantas()
  const [planta, setPlanta] = useState('')
  const [sector, setSector] = useState('')
  const [qr, setQr] = useState<Record<string, string>>({})
  const lista = useMemo(() => (equipos ?? []).filter((e) => (!planta || e.planta_id === planta) && (!sector || e.sector_id === sector)), [equipos, planta, sector])

  useEffect(() => {
    let vivo = true
    void Promise.all(lista.map(async (e) => [e.id, await QRCode.toDataURL(urlPedidoEquipo(e.codigo), { margin: 1, width: 220, errorCorrectionLevel: 'M' })] as const))
      .then((pares) => vivo && setQr(Object.fromEntries(pares)))
    return () => { vivo = false }
  }, [lista])

  return (
    <Pagina titulo="Etiquetas QR de equipos" subtitulo="Imprimilas en hoja autoadhesiva y pegalas en cada equipo."
      acciones={<Boton onClick={() => window.print()}>Imprimir</Boton>}>
      {!base() && <ErrorBox texto="Falta configurar VITE_WEB_URL: los QR necesitan la dirección de la versión web." />}
      <div className="no-imprimir mb-4 flex flex-wrap gap-2">
        <select className="campo w-auto" value={planta} onChange={(e) => { setPlanta(e.target.value); setSector('') }}>
          <option value="">Todas las plantas</option>{(pl?.plantas ?? []).map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
        </select>
        <select className="campo w-auto" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">Todos los sectores</option>{(pl?.sectores ?? []).filter((s) => !planta || s.planta_id === planta).map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>)}
        </select>
        <span className="self-center text-sm text-suave">{lista.length} etiquetas</span>
      </div>
      {cargando ? <Cargando /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-2">
          {lista.map((e) => (
            <div key={e.id} className="flex break-inside-avoid flex-col items-center rounded-xl border-2 border-texto bg-white p-3 text-center">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-primario">
                <img src={logo} alt="" className="h-5 w-5" /> Mantenimiento
              </div>
              {qr[e.id] ? <img src={qr[e.id]} alt={e.codigo} className="h-36 w-36" /> : <div className="h-36 w-36 animate-pulse bg-fondo-2" />}
              <div className="mt-1 text-sm font-extrabold">{e.codigo}</div>
              <div className="text-xs text-suave">{e.nombre}</div>
              <div className="mt-1 text-[10px] text-suave">Escaneá para pedir una reparación</div>
            </div>
          ))}
        </div>
      )}
    </Pagina>
  )
}
