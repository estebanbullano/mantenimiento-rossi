import { useState, type FormEvent, type ReactNode } from 'react'
import { configurado, mensajeError, supabase, urlRetorno } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { Boton, Campo, ErrorBox, OkBox, Segmento, Titulo } from '@/components/ui'
import logo from '@/assets/logo-famiglia-rossi-circulo.png'

type Modo = 'entrar' | 'registro' | 'olvide'
type Pestana = 'oficina' | 'planta'

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }

function Marco({ children, lateral }: { children: ReactNode; lateral?: ReactNode }) {
  return (
    <div className="min-h-full bg-fondo">
      <div className="h-1 bg-acento" />
      <div className="mx-auto flex max-w-[980px] flex-col gap-9 px-5 py-10 md:py-14">
        <div className="flex items-center gap-3.5">
          <img src={logo} alt="Famiglia Rossi" className="h-[72px] w-[72px] object-contain" />
          <div className="text-sm text-tenue">Agrícola Magdalena · Famiglia Rossi · 24/7</div>
        </div>
        <div className="flex flex-col gap-2.5">
          <h1 className="m-0"><Titulo texto="Mantenimiento en una sola plataforma" className="text-[34px] md:text-[46px] leading-[1.1]" /></h1>
          <p className="m-0 max-w-[640px] text-lg text-suave">Preventivo, criticidad, pedidos de reparación, órdenes de trabajo, pañol y compras, conectados sobre la misma base de datos.</p>
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <section className="flex w-full max-w-[480px] flex-[1_1_360px] flex-col gap-[18px] rounded-3xl border border-borde bg-white p-7 shadow-[0_10px_30px_rgba(60,40,20,0.07)]">
            {children}
          </section>
          {lateral && <section className="flex flex-[1_1_300px] flex-col gap-2.5">{lateral}</section>}
        </div>
      </div>
    </div>
  )
}

const COMO: [string, string, string][] = [
  ['O', 'Personal de oficina', 'Jefe de mantenimiento, supervisor, pañol y compras: entran con su mail y contraseña.'],
  ['P', 'Operarios y producción', 'Desde el celular de planta, con el legajo o el DNI. Sin contraseña.'],
  ['C', 'Pedidos desde el celular', 'Cualquiera de planta reporta una falla en 30 segundos y sigue el estado en "Mis pedidos".']
]

function Lateral() {
  return (
    <>
      <span className="sobretitulo">Cómo se ingresa</span>
      {COMO.map(([ini, t, d]) => (
        <div key={t} className="flex items-center gap-3 rounded-2xl border border-borde bg-white px-3.5 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rojo-claro font-bold text-primario-oscuro">{ini}</span>
          <span className="flex flex-col gap-0.5"><span className="text-[15px] font-semibold">{t}</span><span className="text-[13px] text-suave">{d}</span></span>
        </div>
      ))}
    </>
  )
}

export function Acceso() {
  const [pestana, setPestana] = useState<Pestana>((leer('mr-ingreso') as Pestana) || 'oficina')
  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [nombre, setNombre] = useState('')
  const [legajo, setLegajo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  if (!configurado) {
    return (
      <Marco>
        <ErrorBox texto="Falta configurar la conexión con Supabase." />
        <p className="text-sm text-suave">Copiá <code>.env.example</code> como <code>.env</code>, completá la URL y la clave del proyecto y volvé a compilar.</p>
      </Marco>
    )
  }

  const cambiarPestana = (p: Pestana) => { setPestana(p); guardar('mr-ingreso', p); setError(null); setOk(null); setModo('entrar') }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null); setOk(null); setCargando(true)
    try {
      if (pestana === 'planta') {
        const id = legajo.trim()
        if (!id) throw new Error('Escribí tu legajo o tu DNI.')
        const { data, error } = await supabase.rpc('mant_ingreso_planta', { p_id: id })
        if (error) throw error
        const fila = (data as { email: string; clave: string }[] | null)?.[0]
        if (!fila) throw new Error('No encontramos ese legajo o DNI. Pedile a mantenimiento que te dé de alta.')
        const r = await supabase.auth.signInWithPassword({ email: fila.email, password: fila.clave })
        if (r.error) throw r.error
      } else if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave })
        if (error) throw error
      } else if (modo === 'registro') {
        const { error } = await supabase.auth.signUp({
          email: email.trim(), password: clave,
          options: { data: { nombre: nombre.trim() }, emailRedirectTo: urlRetorno() }
        })
        if (error) throw error
        setOk('Listo. Confirmá el mail que te llegó; después un administrador habilita tu cuenta.')
        setModo('entrar')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: urlRetorno() })
        if (error) throw error
        setOk('Te mandamos un mail con el enlace para elegir una contraseña nueva.')
      }
    } catch (err) {
      setError(mensajeError(err))
    } finally {
      setCargando(false)
    }
  }

  return (
    <Marco lateral={<Lateral />}>
      <h2 className="m-0"><Titulo texto={modo === 'registro' ? 'Creá tu cuenta' : modo === 'olvide' ? 'Recuperá tu contraseña' : 'Ingresá a la plataforma'} className="text-2xl" /></h2>
      {modo === 'entrar' && <Segmento valor={pestana} onCambio={cambiarPestana} opciones={[['oficina', 'Personal de oficina'], ['planta', 'Operario de planta']]} />}
      <form onSubmit={enviar} className="flex flex-col gap-[18px]">
        {pestana === 'planta' && modo === 'entrar' ? (
          <div>
            <Campo etiqueta="Legajo o DNI">
              <input className="campo min-h-[54px] text-xl tracking-wider" inputMode="numeric" autoComplete="username" placeholder="Ej.: 1042 o 30512884" value={legajo} onChange={(e) => setLegajo(e.target.value)} />
            </Campo>
            <span className="mt-2 block text-[13px] text-suave">Sin contraseña: entrás desde el celular de planta con tu legajo o tu DNI.</span>
          </div>
        ) : (
          <>
            {modo === 'registro' && (
              <Campo etiqueta="Nombre y apellido"><input className="campo" required value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
            )}
            <Campo etiqueta="Mail"><input className="campo" type="email" required autoComplete="email" placeholder="nombre@famigliarossi.com.ar" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
            {modo !== 'olvide' && (
              <Campo etiqueta="Contraseña"><input className="campo" type="password" required minLength={6} autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} value={clave} onChange={(e) => setClave(e.target.value)} /></Campo>
            )}
          </>
        )}
        <ErrorBox texto={error} />
        {ok && <OkBox>{ok}</OkBox>}
        <Boton type="submit" grande className="w-full" cargando={cargando}>
          {modo === 'entrar' ? 'Ingresar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}
        </Boton>
      </form>
      {pestana === 'oficina' || modo !== 'entrar' ? (
        <div className="flex justify-between text-[13px]">
          {modo === 'entrar' ? (
            <>
              <button className="font-semibold text-primario-oscuro" onClick={() => setModo('registro')}>Crear cuenta</button>
              <button className="text-tenue" onClick={() => setModo('olvide')}>Olvidé mi contraseña</button>
            </>
          ) : (
            <button className="font-semibold text-primario-oscuro" onClick={() => setModo('entrar')}>← Volver</button>
          )}
        </div>
      ) : null}
      <span className="text-xs text-tenue">Cada persona ve solo las pantallas de su rol.</span>
    </Marco>
  )
}

export function NuevaClave() {
  const { terminarRecuperacion } = useSesion()
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  async function guardarClave(e: FormEvent) {
    e.preventDefault(); setCargando(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    setCargando(false)
    if (error) setError(mensajeError(error))
    else terminarRecuperacion()
  }
  return (
    <Marco>
      <h2 className="m-0"><Titulo texto="Elegí tu contraseña nueva" className="text-2xl" /></h2>
      <form onSubmit={guardarClave} className="flex flex-col gap-4">
        <ErrorBox texto={error} />
        <Campo etiqueta="Contraseña nueva"><input className="campo" type="password" required minLength={6} value={clave} onChange={(e) => setClave(e.target.value)} /></Campo>
        <Boton type="submit" grande className="w-full" cargando={cargando}>Guardar contraseña</Boton>
      </form>
    </Marco>
  )
}

export function CuentaPendiente() {
  const { usuario, salir, recargarUsuario } = useSesion()
  return (
    <Marco>
      <h2 className="m-0"><Titulo texto="Cuenta en espera" className="text-2xl" /></h2>
      <p className="m-0 text-[15px] text-texto-2">
        Hola <b>{usuario?.nombre}</b>. Tu cuenta está creada y espera que un administrador la habilite y te asigne un rol.
      </p>
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={() => void recargarUsuario()}>Volver a revisar</Boton>
        <Boton variante="fantasma" className="flex-1" onClick={() => void salir()}>Salir</Boton>
      </div>
    </Marco>
  )
}
