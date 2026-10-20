import { useState, type FormEvent } from 'react'
import { configurado, mensajeError, supabase, urlRetorno } from '@/lib/supabase'
import { useSesion } from '@/lib/sesion'
import { Boton, Campo, ErrorBox } from '@/components/ui'
import logo from '@/assets/logo-famiglia-rossi-circulo.png'

type Modo = 'entrar' | 'registro' | 'olvide'

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-primario p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex flex-col items-center text-center">
          <img src={logo} alt="Famiglia Rossi" className="h-20 w-20" />
          <h1 className="mt-3 text-xl font-extrabold">Mantenimiento Rossi</h1>
          <p className="text-sm text-suave">Agrícola Magdalena S.R.L.</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Acceso() {
  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [nombre, setNombre] = useState('')
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

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null); setOk(null); setCargando(true)
    try {
      if (modo === 'entrar') {
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
    <Marco>
      <form onSubmit={enviar} className="space-y-3">
        <ErrorBox texto={error} />
        {ok && <div className="rounded-lg bg-aprobado/10 px-3 py-2 text-sm text-aprobado">{ok}</div>}
        {modo === 'registro' && (
          <Campo etiqueta="Nombre y apellido"><input className="campo" required value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        )}
        <Campo etiqueta="Mail"><input className="campo" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        {modo !== 'olvide' && (
          <Campo etiqueta="Contraseña"><input className="campo" type="password" required minLength={6} autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} value={clave} onChange={(e) => setClave(e.target.value)} /></Campo>
        )}
        <Boton type="submit" grande className="w-full" cargando={cargando}>
          {modo === 'entrar' ? 'Entrar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}
        </Boton>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        {modo === 'entrar' ? (
          <>
            <button className="font-bold text-primario" onClick={() => setModo('registro')}>Crear cuenta</button>
            <button className="text-suave" onClick={() => setModo('olvide')}>Olvidé mi contraseña</button>
          </>
        ) : (
          <button className="font-bold text-primario" onClick={() => setModo('entrar')}>← Volver</button>
        )}
      </div>
    </Marco>
  )
}

export function NuevaClave() {
  const { terminarRecuperacion } = useSesion()
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  async function guardar(e: FormEvent) {
    e.preventDefault(); setCargando(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    setCargando(false)
    if (error) setError(mensajeError(error))
    else terminarRecuperacion()
  }
  return (
    <Marco>
      <form onSubmit={guardar} className="space-y-3">
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
      <p className="text-center text-sm">
        Hola <b>{usuario?.nombre}</b>. Tu cuenta está creada y espera que un administrador la habilite y te asigne un rol.
      </p>
      <div className="mt-4 flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={() => void recargarUsuario()}>Volver a revisar</Boton>
        <Boton variante="fantasma" className="flex-1" onClick={() => void salir()}>Salir</Boton>
      </div>
    </Marco>
  )
}
