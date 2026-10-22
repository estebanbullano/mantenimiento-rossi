import { useMemo, useState } from 'react'
import { mensajeError, supabase } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { fmtFecha, fmtFechaHora, fmtNum, useDatos } from '@/lib/util'
import type { Tarea } from '@/lib/tipos'
import { Boton, H2, Insignia, Tarjeta, useAviso } from './ui'

interface Lectura { id: string; horas: number; leida_en: string; origen: 'manual' | 'plc'; nota: string | null }
interface Uso { equipo_id: string; horas_uso: number | null; horas_uso_en: string | null; plc_habilitado: boolean; plc_protocolo: string | null; plc_direccion: string | null; plc_tag: string | null; plc_nota: string | null }
const PROTOCOLOS = ['Modbus TCP', 'OPC UA', 'Siemens S7', 'EtherNet/IP', 'MQTT', 'Otro']
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined

/** Horas de uso de la máquina: lecturas del horómetro (a mano o por PLC) y la configuración del PLC */
export function HorasUso({ equipoId, codigo, tareas }: { equipoId: string; codigo: string; tareas: Tarea[] }) {
  const avisar = useAviso()
  const { puede } = useSesion()
  const esMant = puede('referente', 'supervisor')
  const puedeCargar = puede('referente', 'supervisor', 'operario')
  const [horas, setHoras] = useState('')
  const [fecha, setFecha] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [verPlc, setVerPlc] = useState(false)
  const [plc, setPlc] = useState<Partial<Uso> | null>(null)
  const [clave, setClave] = useState<string | null>(null)

  const { data, recargar } = useDatos(async () => {
    const [l, u] = await Promise.all([
      supabase.from('mant_equipo_horas').select('id,horas,leida_en,origen,nota').eq('equipo_id', equipoId).order('leida_en', { ascending: false }).limit(60),
      supabase.from('mant_equipo_uso').select('*').eq('equipo_id', equipoId).maybeSingle()
    ])
    return { data: { lecturas: (l.data ?? []) as Lectura[], uso: u.data as Uso | null }, error: l.error }
  }, [equipoId])

  const lect = data?.lecturas ?? []
  const actual = lect[0]
  // promedio de horas por día en los últimos 30 días (o entre las lecturas que haya)
  const ritmo = useMemo(() => {
    if (lect.length < 2) return null
    const ult = lect[0], lim = new Date(new Date(ult.leida_en).getTime() - 30 * 86400000)
    const base = lect.find((x) => new Date(x.leida_en) <= lim) ?? lect[lect.length - 1]
    const dias = (new Date(ult.leida_en).getTime() - new Date(base.leida_en).getTime()) / 86400000
    if (dias < 0.5 || ult.horas < base.horas) return null
    return (ult.horas - base.horas) / dias
  }, [lect])
  // horas a la fecha de la última ejecución de cada tarea por horas
  const horasEn = (fechaIso: string | null) => fechaIso ? lect.find((x) => x.leida_en.slice(0, 10) <= fechaIso)?.horas ?? null : null
  const porHoras = tareas.filter((t) => t.activa && t.frecuencia_unidad === 'horas')

  async function cargar() {
    const h = Number(horas.replace(',', '.'))
    if (!horas.trim() || isNaN(h) || h < 0) return avisar('Indicá las horas del horómetro.', 'error')
    setGuardando(true)
    const { error } = await supabase.from('mant_equipo_horas').insert({ equipo_id: equipoId, horas: h, nota: nota.trim() || null, ...(fecha ? { leida_en: new Date(`${fecha}T12:00:00`).toISOString() } : {}) })
    setGuardando(false)
    if (error) return avisar(mensajeError(error), 'error')
    setHoras(''); setNota(''); setFecha(''); avisar('Lectura cargada.'); void recargar()
  }
  async function borrar(l: Lectura) {
    if (!confirm(`¿Borrar la lectura de ${fmtNum(l.horas, 1)} h?`)) return
    const { error } = await supabase.from('mant_equipo_horas').delete().eq('id', l.id)
    if (error) avisar(mensajeError(error), 'error'); else void recargar()
  }
  async function abrirPlc() {
    setPlc({ plc_habilitado: false, plc_protocolo: 'Modbus TCP', ...(data?.uso ?? {}) })
    setVerPlc(true)
    if (esMant && !clave) { const { data: c } = await supabase.rpc('mant_plc_clave'); setClave((c as string) ?? null) }
  }
  async function guardarPlc() {
    if (!plc) return
    setGuardando(true)
    const { error } = await supabase.from('mant_equipo_uso').upsert({
      equipo_id: equipoId, plc_habilitado: !!plc.plc_habilitado, plc_protocolo: plc.plc_protocolo || null,
      plc_direccion: plc.plc_direccion?.trim() || null, plc_tag: plc.plc_tag?.trim() || null, plc_nota: plc.plc_nota?.trim() || null, actualizado_en: new Date().toISOString()
    })
    setGuardando(false)
    if (error) return avisar(mensajeError(error), 'error')
    avisar('Configuración del PLC guardada.'); setVerPlc(false); void recargar()
  }

  const u = data?.uso
  const ultPlc = lect.find((x) => x.origen === 'plc')

  return (
    <Tarjeta className="flex flex-col gap-4 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H2 texto="Horas de uso" />
        <span className="flex items-center gap-2 text-[13px]">
          {u?.plc_habilitado
            ? <Insignia t={ultPlc && Date.now() - new Date(ultPlc.leida_en).getTime() < 2 * 86400000 ? 'verde' : 'amarillo'}>PLC {u.plc_protocolo ?? ''} · {ultPlc ? `última lectura ${fmtFechaHora(ultPlc.leida_en)}` : 'esperando la primera lectura'}</Insignia>
            : <Insignia>Carga manual · PLC sin conectar</Insignia>}
          {esMant && <Boton chico variante="secundario" onClick={() => void abrirPlc()}>Conexión PLC</Boton>}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-2xl bg-fondo p-3.5"><span className="text-xs text-suave">Horómetro</span><span className="text-[26px] font-semibold leading-none">{actual ? `${fmtNum(actual.horas, 1)} h` : '—'}</span><span className="text-xs text-tenue">{actual ? `al ${fmtFechaHora(actual.leida_en)}` : 'sin lecturas'}</span></div>
        <div className="flex flex-col gap-1 rounded-2xl bg-fondo p-3.5"><span className="text-xs text-suave">Uso promedio</span><span className="text-[26px] font-semibold leading-none">{ritmo != null ? `${fmtNum(ritmo, 1)} h/día` : '—'}</span><span className="text-xs text-tenue">últimos 30 días</span></div>
        <div className="flex flex-col gap-1 rounded-2xl bg-fondo p-3.5"><span className="text-xs text-suave">Por semana</span><span className="text-[26px] font-semibold leading-none">{ritmo != null ? `${fmtNum(ritmo * 7, 0)} h` : '—'}</span><span className="text-xs text-tenue">{ritmo != null ? `${Math.round((ritmo / 24) * 100)}% del tiempo en marcha` : 'hace falta más de una lectura'}</span></div>
        <div className="flex flex-col gap-1 rounded-2xl bg-fondo p-3.5"><span className="text-xs text-suave">Lecturas</span><span className="text-[26px] font-semibold leading-none">{lect.length}</span><span className="text-xs text-tenue">{lect.filter((x) => x.origen === 'plc').length} del PLC · {lect.filter((x) => x.origen === 'manual').length} a mano</span></div>
      </div>

      {porHoras.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Tareas por horas de marcha</span>
          {porHoras.map((t) => {
            const base = horasEn(t.ultima_ejecucion)
            const usadas = actual && base != null ? actual.horas - base : null
            const pct = usadas != null ? Math.min(100, (usadas / t.frecuencia_valor) * 100) : 0
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-fondo px-3 py-2 text-[13px]">
                <span className="min-w-[180px] flex-1"><b>{t.descripcion}</b> · cada {fmtNum(t.frecuencia_valor)} h</span>
                {usadas != null ? <>
                  <span className="flex h-2 w-40 overflow-hidden rounded-full bg-linea"><span style={{ width: `${pct}%`, background: pct >= 100 ? '#b3141a' : pct >= 80 ? '#d9a21b' : '#5b84c4' }} /></span>
                  <span className={pct >= 100 ? 'font-semibold text-primario-oscuro' : ''}>{fmtNum(usadas, 0)} de {fmtNum(t.frecuencia_valor)} h{ritmo && pct < 100 ? ` · faltan ~${Math.ceil((t.frecuencia_valor - usadas) / ritmo)} días` : pct >= 100 ? ' · le toca' : ''}</span>
                </> : <span className="text-tenue">Hace falta una lectura del día de la última ejecución ({fmtFecha(t.ultima_ejecucion)})</span>}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {puedeCargar && (
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2">
            <span className="text-[13px] font-semibold">Cargar lectura del horómetro</span>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <input className="campo" inputMode="decimal" placeholder="Horas (ej. 12450)" value={horas} onChange={(e) => setHoras(e.target.value)} />
              <input className="campo" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha (vacío = ahora)" title="Vacío = ahora" />
            </div>
            <input className="campo" placeholder="Nota (opcional; obligatoria si se cambió el horómetro)" value={nota} onChange={(e) => setNota(e.target.value)} />
            <Boton className="self-start" cargando={guardando} onClick={() => void cargar()}>Cargar lectura</Boton>
          </div>
        )}
        <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Últimas lecturas</span>
          {!lect.length && <span className="text-[13px] text-tenue">Todavía no hay lecturas. Cargá la del horómetro, o conectá el PLC.</span>}
          <div className="max-h-56 overflow-y-auto">
            {lect.slice(0, 30).map((l, i) => {
              const dif = lect[i + 1] ? l.horas - lect[i + 1].horas : null
              return (
                <div key={l.id} className="flex items-center justify-between gap-2 border-b border-linea-2 py-1.5 text-[13px]">
                  <span>{fmtFechaHora(l.leida_en)} <Insignia t={l.origen === 'plc' ? 'azul' : 'gris'}>{l.origen === 'plc' ? 'PLC' : 'Manual'}</Insignia>{l.nota && <span className="ml-1 text-tenue">· {l.nota}</span>}</span>
                  <span className="flex items-center gap-2"><b>{fmtNum(l.horas, 1)} h</b>{dif != null && dif >= 0 && <span className="text-xs text-tenue">+{fmtNum(dif, 1)}</span>}
                    {esMant && <button className="text-xs text-primario-oscuro" aria-label="Borrar" onClick={() => void borrar(l)}>×</button>}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {verPlc && plc && (
        <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-crema p-4">
          <span className="text-sm font-semibold">Conexión con el PLC de {codigo}</span>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primario" checked={!!plc.plc_habilitado} onChange={(e) => setPlc({ ...plc, plc_habilitado: e.target.checked })} />Recibir las horas desde el PLC</label>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-suave">Protocolo
              <select className="campo" value={plc.plc_protocolo ?? ''} onChange={(e) => setPlc({ ...plc, plc_protocolo: e.target.value })}>{PROTOCOLOS.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs text-suave">Dirección del PLC / gateway
              <input className="campo" placeholder="192.168.1.50:502" value={plc.plc_direccion ?? ''} onChange={(e) => setPlc({ ...plc, plc_direccion: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-xs text-suave">Tag / registro de horas de marcha
              <input className="campo" placeholder="HR 40001 · DB10.DBD0 · ns=2;s=Horas" value={plc.plc_tag ?? ''} onChange={(e) => setPlc({ ...plc, plc_tag: e.target.value })} /></label>
          </div>
          <input className="campo" placeholder="Nota (escala, unidad, quién lo configuró…)" value={plc.plc_nota ?? ''} onChange={(e) => setPlc({ ...plc, plc_nota: e.target.value })} />
          <details className="rounded-xl bg-white px-3 py-2 text-[13px]">
            <summary className="cursor-pointer font-medium">Datos para el integrador (Node-RED, Kepware, gateway IoT…)</summary>
            <div className="mt-2 flex flex-col gap-1.5 text-texto-2">
              <span>El gateway lee el tag del PLC y manda las horas a la plataforma con un POST:</span>
              <code className="block overflow-x-auto whitespace-pre rounded-lg bg-fondo p-2 text-xs">{`POST ${SUPA_URL ?? 'https://<proyecto>.supabase.co'}/rest/v1/rpc/mant_plc_horas
apikey: <clave pública de la app>
Content-Type: application/json

{ "p_clave": "${clave ?? '<clave del PLC>'}", "p_equipo": "${codigo}", "p_horas": 12345.6 }`}</code>
              <span className="text-xs text-tenue">La clave del PLC es la misma para todas las máquinas; no la compartas fuera de mantenimiento. Cada envío queda como lectura "PLC" con fecha y hora.</span>
            </div>
          </details>
          <div className="flex gap-2"><Boton cargando={guardando} onClick={() => void guardarPlc()}>Guardar</Boton><Boton variante="fantasma" onClick={() => setVerPlc(false)}>Cancelar</Boton></div>
        </div>
      )}
    </Tarjeta>
  )
}
