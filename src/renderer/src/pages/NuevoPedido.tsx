import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useEquipos } from '@/lib/catalogos'
import { numPedido, subirArchivo } from '@/lib/util'
import { Boton, Campo, ErrorBox, Pagina, Tarjeta, useAviso } from '@/components/ui'
import { BotonFoto, SelectorEquipo } from '@/components/selectores'

/** Formulario único de pedido de reparación. El link no cambia: #/pedido/nuevo (o con ?equipo=CÓDIGO desde el QR). */
export function NuevoPedido() {
  const { usuario } = useSesion()
  const nav = useNavigate()
  const avisar = useAviso()
  const [params] = useSearchParams()
  const { data: equipos } = useEquipos()
  const [equipoId, setEquipoId] = useState<string | null>(null)
  const [sinEquipo, setSinEquipo] = useState(false)
  const [ubicacion, setUbicacion] = useState('')
  const [area, setArea] = useState(usuario?.area ?? '')
  const [descripcion, setDescripcion] = useState('')
  const [detenido, setDetenido] = useState(false)
  const [foto, setFoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Viene del QR pegado en el equipo
  useEffect(() => {
    const cod = params.get('equipo')
    if (cod && equipos) {
      const e = equipos.find((x) => x.codigo.toUpperCase() === cod.toUpperCase())
      if (e) setEquipoId(e.id)
    }
  }, [params, equipos])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!sinEquipo && !equipoId) { setError('Elegí el equipo o marcá que no sabés cuál es.'); return }
    setError(null); setEnviando(true)
    try {
      const foto_ruta = foto ? await subirArchivo(`pedidos/${usuario!.id}`, foto) : null
      const { data, error } = await supabase.from('mant_pedidos').insert({
        equipo_id: sinEquipo ? null : equipoId,
        ubicacion: sinEquipo ? ubicacion.trim() : null,
        area: area.trim() || null,
        descripcion: descripcion.trim(),
        equipo_detenido: detenido,
        foto_ruta
      }).select('numero').single()
      if (error) throw error
      avisar(`Pedido ${numPedido(data.numero)} enviado a mantenimiento.`)
      nav('/pedidos?mios=1')
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Pagina titulo="Pedir una reparación" subtitulo="Mantenimiento lo prioriza y te avisa la fecha comprometida.">
      <form onSubmit={enviar} className="mx-auto max-w-xl space-y-4">
        <ErrorBox texto={error} />
        <Tarjeta>
          <div className="space-y-4">
            <Campo etiqueta="Equipo">
              {sinEquipo ? (
                <input className="campo" required placeholder="¿Dónde está? Ej.: Planta de pastas, línea 2, junto a la envasadora" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} />
              ) : (
                <SelectorEquipo equipos={equipos ?? []} valor={equipoId} onCambio={setEquipoId} />
              )}
              <label className="mt-2 flex items-center gap-2 text-sm text-suave">
                <input type="checkbox" checked={sinEquipo} onChange={(e) => setSinEquipo(e.target.checked)} /> No sé qué equipo es
              </label>
            </Campo>
            <Campo etiqueta="¿Qué pasa?">
              <textarea className="campo min-h-28" required value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Describí la falla: qué hace, desde cuándo, si hay ruido, pérdida, olor…" />
            </Campo>
            <Campo etiqueta="Área que pide">
              <input className="campo" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Producción, Logística, Calidad…" />
            </Campo>
            <label className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 p-3 ${detenido ? 'border-primario bg-primario/5' : 'border-borde'}`}>
              <input type="checkbox" className="h-5 w-5 accent-primario" checked={detenido} onChange={(e) => setDetenido(e.target.checked)} />
              <span>
                <span className="block font-bold">El equipo está parado</span>
                <span className="text-xs text-suave">Marcalo solo si la falla detiene la producción.</span>
              </span>
            </label>
            <div>
              <span className="etiqueta">Foto (opcional)</span>
              <div className="flex items-center gap-3">
                <BotonFoto texto={foto ? 'Cambiar foto' : 'Sacar foto'} onArchivo={setFoto} />
                {foto && <span className="truncate text-sm text-suave">{foto.name}</span>}
              </div>
            </div>
          </div>
        </Tarjeta>
        <Boton type="submit" grande className="w-full" cargando={enviando}>Enviar pedido</Boton>
      </form>
    </Pagina>
  )
}
