import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { useEquipos } from '@/lib/catalogos'
import { fmtFecha, numPedido, subirArchivo, useDatos } from '@/lib/util'
import type { ComentarioPedido, Equipo, Pedido, Urgencia } from '@/lib/tipos'
import { Boton, Campo, Cargando, ErrorBox, ESTADO_EQUIPO, InsEstadoPedido, OkBox, Segmento, Vacio } from '@/components/ui'
import { OpcionPunto, PantallaCelular } from '@/components/Celular'
import { CargarAdjuntos, subirAdjuntos, type AdjuntoNuevo } from '@/components/AdjuntosPedido'
import { esRolCelular } from '@/components/Layout'

const OTRO = '__otro'
const CLAVE_MAIL = 'mant.mail_contacto'
const leerMail = () => { try { return localStorage.getItem(CLAVE_MAIL) ?? '' } catch { return '' } }
const guardarMail = (m: string) => { try { localStorage.setItem(CLAVE_MAIL, m) } catch { /* sin almacenamiento */ } }
const esMailInterno = (m?: string | null) => !m || m.endsWith('@planta.famigliarossi.local')
const fmtCorta = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')

/** Área = planta · sector, armada con el maestro de equipos */
function useAreas(equipos: Equipo[] | null) {
  return useMemo(() => {
    const m = new Map<string, { clave: string; txt: string; equipos: Equipo[] }>()
    for (const e of equipos ?? []) {
      const clave = `${e.planta_id}|${e.sector_id ?? ''}`
      const txt = [e.planta_nombre, e.sector_nombre].filter(Boolean).join(' · ')
      if (!m.has(clave)) m.set(clave, { clave, txt, equipos: [] })
      m.get(clave)!.equipos.push(e)
    }
    return [...m.values()].sort((a, b) => a.txt.localeCompare(b.txt))
  }, [equipos])
}

/** Celular del solicitante: "Nuevo pedido" y "Mis pedidos" */
export function PedidosCelular({ inicial = 'nuevo' }: { inicial?: 'nuevo' | 'mis' }) {
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'nuevo' | 'mis'>(params.get('equipo') ? 'nuevo' : inicial)
  const [recien, setRecien] = useState<number | null>(null)
  useEffect(() => setTab(params.get('equipo') ? 'nuevo' : inicial), [inicial, params])
  return (
    <PantallaCelular titulo="Pedidos de reparación"
      selector={<Segmento valor={tab} onCambio={(v) => { setTab(v); setRecien(null) }} opciones={[['nuevo', 'Nuevo pedido'], ['mis', 'Mis pedidos']]} />}>
      {tab === 'nuevo'
        ? <NuevoPedidoForm equipoInicial={params.get('equipo')} onEnviado={(n) => { setRecien(n); setTab('mis') }} />
        : <MisPedidos recien={recien} />}
    </PantallaCelular>
  )
}

function NuevoPedidoForm({ equipoInicial, onEnviado }: { equipoInicial: string | null; onEnviado: (n: number) => void }) {
  const { usuario } = useSesion()
  const { data: equipos, cargando } = useEquipos()
  const areas = useAreas(equipos)
  const [nombre, setNombre] = useState(usuario?.nombre ?? '')
  const [mail, setMail] = useState(esMailInterno(usuario?.email) ? leerMail() : usuario?.email ?? '')
  const [area, setArea] = useState('')
  const [equipoId, setEquipoId] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [estado, setEstado] = useState<Urgencia>('media')
  const [desc, setDesc] = useState('')
  const [adjuntos, setAdjuntos] = useState<AdjuntoNuevo[]>([])
  const [avisoAdj, setAvisoAdj] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Mail por defecto: el de su usuario; si entra por legajo, el último que usó en un pedido
  useEffect(() => {
    if (mail || !usuario?.id) return
    void supabase.from('mant_pedidos').select('email_contacto').eq('solicitante_id', usuario.id).not('email_contacto', 'is', null)
      .order('creado_en', { ascending: false }).limit(1).then(({ data }) => {
        const m = (data?.[0] as { email_contacto: string } | undefined)?.email_contacto
        if (m) setMail((x) => x || m)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id])

  // Desde el QR del equipo: ya viene elegido
  useEffect(() => {
    if (!equipoInicial || !equipos) return
    const e = equipos.find((x) => x.codigo.toUpperCase() === equipoInicial.toUpperCase() || x.id === equipoInicial)
    if (e) { setArea(`${e.planta_id}|${e.sector_id ?? ''}`); setEquipoId(e.id) }
  }, [equipoInicial, equipos])

  const areaSel = areas.find((a) => a.clave === area)
  const delArea = areaSel?.equipos ?? []

  async function enviar() {
    if (!area) return setError('Elegí el área.')
    if (!equipoId) return setError('Elegí el equipo (o "Otro / no sé cuál").')
    if (equipoId === OTRO && !ubicacion.trim()) return setError('Contá dónde está el problema.')
    if (!desc.trim()) return setError('Contá qué pasó.')
    setError(null); setEnviando(true)
    try {
      const eq = equipos?.find((x) => x.id === equipoId)
      const primera = adjuntos.find((a) => a.tipo === 'foto')
      const foto_ruta = primera ? await subirArchivo(`pedidos/${usuario!.id}/foto`, primera.archivo) : null
      const { data, error } = await supabase.from('mant_pedidos').insert({
        titulo: desc.trim().split('\n')[0].slice(0, 80),
        equipo_id: eq ? eq.id : null,
        ubicacion: eq ? null : ubicacion.trim(),
        area: areaSel?.txt ?? null,
        descripcion: desc.trim(),
        urgencia_reportada: estado,
        equipo_detenido: estado === 'alta',
        nombre_contacto: nombre.trim() || null,
        email_contacto: mail.trim() || null,
        foto_ruta
      }).select('id, numero').single()
      if (error) throw error
      if (mail.trim()) guardarMail(mail.trim())
      const fallas = adjuntos.length ? await subirAdjuntos(data.id, `pedidos/${usuario!.id}`, adjuntos, primera && foto_ruta ? { id: primera.id, ruta: foto_ruta } : undefined) : 0
      setAvisoAdj(fallas ? `El pedido se envió, pero ${fallas} adjunto${fallas > 1 ? 's no se pudieron' : ' no se pudo'} subir.` : null)
      setEquipoId(''); setUbicacion(''); setDesc(''); setEstado('media'); setAdjuntos([])
      onEnviado(data.numero)
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setEnviando(false)
    }
  }

  if (cargando && !equipos) return <Cargando />
  return (
    <div className="flex flex-col gap-3.5">
      <Campo etiqueta="Tu nombre" suave><input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
      <Campo etiqueta="Tu mail" suave ayuda={mail ? 'Te avisamos ahí los avances del pedido. Lo recordamos para la próxima.' : 'Te vamos a mandar ahí los avisos y avances del pedido.'}>
        <input className="campo" type="email" placeholder="nombre@famigliarossi.com.ar" value={mail} onChange={(e) => setMail(e.target.value)} />
      </Campo>
      <Campo etiqueta="Área" suave>
        <select className="campo" value={area} onChange={(e) => { setArea(e.target.value); setEquipoId('') }}>
          <option value="">Elegí el área…</option>
          {areas.map((a) => <option key={a.clave} value={a.clave}>{a.txt}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Equipo" suave>
        <select className="campo" value={equipoId} disabled={!area} onChange={(e) => setEquipoId(e.target.value)}>
          <option value="">{area ? 'Elegí el equipo…' : 'Primero elegí el área'}</option>
          {delArea.map((e) => <option key={e.id} value={e.id}>{e.nombre} ({e.codigo})</option>)}
          {area && <option value={OTRO}>Otro / no sé cuál es</option>}
        </select>
      </Campo>
      {equipoId === OTRO && (
        <Campo etiqueta="¿Dónde está?" suave><input className="campo" placeholder="Ej.: canilla del vestuario, planta baja" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} /></Campo>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-suave">¿Cómo está el equipo?</span>
        {(['alta', 'media', 'baja'] as Urgencia[]).map((u) => (
          <OpcionPunto key={u} activa={estado === u} color={ESTADO_EQUIPO[u][2]} onClick={() => setEstado(u)}>{ESTADO_EQUIPO[u][1]}</OpcionPunto>
        ))}
      </div>
      <Campo etiqueta="¿Qué pasó?" suave>
        <textarea className="campo resize-none" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej.: pierde aceite por el sello y hace ruido al arrancar" />
      </Campo>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-suave">Foto, documento, video o audio <span className="font-normal text-tenue">· opcional</span></span>
        <CargarAdjuntos lista={adjuntos} onCambio={setAdjuntos} />
      </div>
      <ErrorBox texto={avisoAdj} />
      <ErrorBox texto={error} />
      <Boton grande className="w-full" cargando={enviando} onClick={() => void enviar()}>Enviar pedido</Boton>
      <div className="text-center text-xs text-tenue">Llega directo a la bandeja de mantenimiento. Ya no hace falta mandarlo por WhatsApp.</div>
    </div>
  )
}

function MisPedidos({ recien }: { recien: number | null }) {
  const { usuario } = useSesion()
  const { data, cargando, error } = useDatos(async () => {
    const r = await supabase.from('mant_v_pedidos').select('*').eq('solicitante_id', usuario!.id).order('creado_en', { ascending: false }).limit(60)
    const pedidos = (r.data ?? []) as Pedido[]
    const c = pedidos.length
      ? await supabase.from('mant_pedido_comentarios').select('*').in('pedido_id', pedidos.map((p) => p.id)).order('creado_en')
      : { data: [] }
    const porPedido: Record<string, ComentarioPedido[]> = {}
    for (const x of (c.data ?? []) as ComentarioPedido[]) (porPedido[x.pedido_id] ??= []).push(x)
    return { data: { pedidos, porPedido }, error: r.error }
  }, [usuario?.id, recien])

  if (cargando && !data) return <Cargando />
  return (
    <div className="flex flex-col gap-3">
      {recien && <OkBox>Listo, tu pedido {numPedido(recien)} quedó registrado.</OkBox>}
      <ErrorBox texto={error} />
      {data && data.pedidos.length === 0 && <Vacio texto="Todavía no hiciste pedidos." />}
      {data?.pedidos.map((p) => {
        const avisos = [{ t: `Recibimos tu pedido ${numPedido(p.numero)}`, w: p.creado_en }, ...(data.porPedido[p.id] ?? []).map((c) => ({ t: c.texto, w: c.creado_en }))]
        const mail = p.email_contacto
        return (
          <div key={p.id} className="flex flex-col gap-2 rounded-[18px] border border-borde p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-tenue">{numPedido(p.numero)} · {fmtCorta(p.creado_en)}</span>
              <InsEstadoPedido e={p.estado} prioridad={p.prioridad} />
            </div>
            <div className="text-[15px] font-medium leading-snug">{p.descripcion}</div>
            <div className="text-[13px] text-suave">{p.equipo_nombre ?? p.ubicacion ?? 'Sin equipo'}</div>
            <div className="flex justify-between rounded-xl bg-fondo px-3 py-2 text-[13px]">
              <span className="text-suave">Fecha comprometida</span>
              <span className="font-semibold">{p.fecha_cierre_estimada ? fmtFecha(p.fecha_cierre_estimada).slice(0, 5) : 'A definir'}</span>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-linea pt-2">
              <span className="text-xs text-tenue">{mail ? `Avisos enviados a ${mail}` : 'Avances del pedido'}</span>
              {avisos.map((a, i) => (
                <span key={i} className="flex gap-2 text-[13px] leading-snug">
                  <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-aprobado" />
                  <span><span className="font-medium">{a.t}</span> <span className="text-tenue">· {fmtCorta(a.w)}</span></span>
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** En la PC del personal de oficina la vista de celular se muestra como un teléfono */
export function MarcoTelefono({ children }: { children: ReactNode }) {
  const { usuario } = useSesion()
  if (esRolCelular(usuario?.rol)) return <>{children}</>
  return (
    <div className="flex justify-center px-4 py-8">
      <div className="w-[380px] max-w-full overflow-hidden rounded-[48px] border-[11px] border-texto bg-white shadow-[0_24px_60px_rgba(40,25,10,0.18)]">
        <div className="flex h-[26px] justify-center"><div className="h-5 w-[110px] rounded-b-[14px] bg-texto" /></div>
        {children}
      </div>
    </div>
  )
}

/** Ruta #/pedido/nuevo: link fijo y QR de los equipos */
export function NuevoPedido() {
  return <MarcoTelefono><PedidosCelular inicial="nuevo" /></MarcoTelefono>
}
