# Mantenimiento Rossi

Plataforma integrada de mantenimiento de Agrícola Magdalena S.R.L. Misma arquitectura que **Compras Rossi**:
aplicación de escritorio para Windows (Electron + React) con base de datos y login en **Supabase**,
instalador `.exe` y actualización automática desde GitHub Releases. Además se publica una **versión web**
del mismo código para que los operarios cierren sus tareas desde el celular.

## Qué hace

| Módulo | Funciones |
| --- | --- |
| **Planificación** | Maestro de equipos (fábrica-sector-equipo-número), criticidad `C = (IO × FO) + CM + ISA` con la matriz RG MA 03 configurable y clasificación manual del referente, rutinas preventivas con frecuencia y puntos de control, ajuste de frecuencia con historial y motivo, generación automática de las órdenes de la semana, agenda semanal arrastrable por persona y día, calendario anual (vista RG MA 01), rondas del plan semanal por turno. |
| **Correctivo y ejecución** | Pedido de reparación con link fijo (y QR por equipo), foto opcional, priorización y asignación por el referente, seguimiento del estado para el área solicitante, app del operario en el celular: puntos de control para tildar, repuestos usados, **foto obligatoria para cerrar**, tiempo real. Control de avance por turno. |
| **Pañol y compras** | Catálogo de artículos con alias (los nombres que usa la planta), stock mínimo y sugerido, entradas/salidas/ajustes, descuento automático por orden de trabajo, repuestos escritos a mano que el pañolero vincula después (y el sistema aprende el alias), compras vinculadas a la OT, presupuesto adjunto, aprobación por monto en USD (referente hasta su límite, por encima el director), recepción que da entrada al pañol, gasto mensual. |
| **Transversal** | Roles (solicitante, operario, referente, supervisor, pañolero, compras, director, admin), auditoría de cada cambio, indicadores (cumplimiento preventivo, correctivos, tiempo medio de reparación, equipos con más fallas). |

## Estructura

```
supabase/migrations/0001_mantenimiento.sql   esquema completo: tablas mant_*, funciones, triggers, RLS, bucket de fotos
supabase/carga-inicial/importar_planillas.py genera 0002_carga_inicial.sql desde las planillas del área
supabase/tests/probar-esquema.mjs            33 pruebas del esquema contra Postgres embebido (npm run probar-sql)
src/main, src/preload                        proceso principal de Electron (ventana, protocolo, auto-update)
src/renderer                                 la app (React + Tailwind), compartida por escritorio y web
electron-builder.yml                         instalador Windows + canal de actualizaciones
.github/workflows/publicar.yml               compila el instalador, crea el release y publica la web
```

Todas las tablas llevan el prefijo `mant_` para convivir con Compras Rossi en el mismo proyecto de Supabase
sin pisar nada. Los usuarios de `auth.users` son los mismos: cada persona que ya tiene cuenta en Compras
aparece en `mant_usuarios` (inactiva hasta que un administrador le asigne rol).

## Puesta en marcha (una sola vez)

1. **Base de datos.** En el proyecto de Supabase de Compras Rossi, SQL Editor → pegar y correr
   `supabase/migrations/0001_mantenimiento.sql`. Se puede volver a correr sin romper nada.
2. **Carga inicial.** Con las planillas del área en una carpeta:
   ```
   pip install openpyxl
   python3 supabase/carga-inicial/importar_planillas.py <carpeta> supabase/carga-inicial
   ```
   Genera `0002_carga_inicial.sql` (correrlo en el SQL Editor) e `informe_carga.md` con lo que hay que revisar a mano.
   Última corrida: 344 equipos, 9 plantas, 42 sectores, 714 rutinas con 1.871 puntos de control, 201 rondas por turno, 2.579 artículos, 21 proveedores.
3. **Primer administrador.** En Table Editor → `mant_usuarios`: poner `activo = true` y `rol = admin` a tu usuario.
   El resto se habilita desde la app (menú Usuarios).
4. **Conexión.** Copiar `.env.example` a `.env` con la URL y la clave *anon* del proyecto (Project Settings → API)
   y la dirección donde va a vivir la versión web (`VITE_WEB_URL`, la usan los QR).
5. **Mails de login.** En Supabase → Authentication → URL Configuration agregar a *Redirect URLs*:
   `mantenimientorossi://auth-callback` y la URL de la versión web.
6. **Fotos.** El bucket `mant-fotos` lo crea el script. Si el proyecto tiene límite de tamaño por archivo, 5 MB alcanza (la app comprime a ~300 KB).
7. **Plan semanal automático (opcional).** Database → Extensions → habilitar `pg_cron` y descomentar el último bloque de `0001_mantenimiento.sql`.
   Si no, el referente aprieta "Generar órdenes de la semana" en Plan preventivo.

## Desarrollo

```
npm install
npm run dev          # escritorio (Electron)
npm run dev:web      # versión web en http://localhost:5180
npm run typecheck
npm run probar-sql   # pruebas del esquema
```

## Publicar una versión

Todo se hace desde GitHub, sin instalar nada en la PC:

1. En GitHub, editar `package.json` y subir el número de versión (`"version": "1.0.1"`).
2. Ir a **Actions → Publicar instalador → Run workflow**.
3. El workflow compila el instalador en Windows, crea el release `v1.0.1` con el `.exe` y publica la versión web
   en GitHub Pages. Las PC con la app instalada bajan la actualización solas y avisan "Reiniciar y actualizar".

También funciona pusheando un tag `vX.Y.Z` (`npm run version:tag`) desde una PC con git.

No hacen falta secrets: la URL y la clave pública (anon) de Supabase están en el workflow, y el release se crea
con el token que GitHub le da al propio workflow.

Para compilar el instalador a mano en una PC con Windows: `npm run instalador` → `dist/Mantenimiento-Rossi-Instalador-X.Y.Z.exe`.

## Versión web (celulares)

Es la misma app compilada con `npm run build:web`. Los operarios la abren desde el navegador del celular y pueden
"Agregar a pantalla de inicio". El link no cambia nunca; los QR pegados en los equipos apuntan a
`VITE_WEB_URL/#/pedido/nuevo?equipo=CÓDIGO`.

## Reglas que hace cumplir la base de datos (no dependen de la app)

- Una orden no se puede cerrar sin foto de cierre.
- El operario solo cambia avance y cierre de sus propias órdenes; prioridad, asignación y fechas las cambia el referente.
- Los repuestos vinculados al catálogo descuentan stock al instante; si se corrige la cantidad, se ajusta.
- Una compra solo pasa a aprobada por `mant_decidir_compra`, que valida el límite en USD del referente.
- El monto de una compra aprobada no se puede cambiar.
- Al recibir una compra, sus ítems del catálogo entran al pañol.
- Al cerrar una preventiva se reprograma la tarea desde la fecha de cierre; al cerrar una correctiva se resuelve el pedido.
- Cada cambio queda en `mant_auditoria` con usuario y fecha.
