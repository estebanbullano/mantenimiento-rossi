"""
Carga inicial desde las planillas del área de mantenimiento.

Lee:
  RG_MA_01_Inventario_de_Maq.-Inf._y_MTTO.xlsx  → plantas, sectores, equipos, criticidad y rutinas preventivas
  PLAN_SEMANAL.xlsx                               → rondas por turno (mañana / tarde / noche), por día de la semana
  INSUMOS_PA_OL.xlsx                              → artículos del pañol, stock y proveedores
  <PLANTA>.xlsx (MOLINO_DE_TRIGO, ACOPIO, …)       → checklists mensuales por unidad (se usan para completar rutinas)

Genera:
  0002_carga_inicial.sql   → se corre en el SQL Editor de Supabase después de 0001
  informe_carga.md         → qué se importó y qué quedó para revisar a mano

Uso:  python3 importar_planillas.py <carpeta con las planillas> [carpeta de salida]
"""
import re, sys, glob, unicodedata, collections, datetime
from pathlib import Path
import openpyxl

ORIGEN = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
SALIDA = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent)
SALIDA.mkdir(parents=True, exist_ok=True)

PLANTAS = {
    'FP': 'Fábrica de pastas', 'MT': 'Molino de trigo', 'MM': 'Molino de maíz', 'ACOP': 'Acopio',
    'PEL': 'Planta de pellets', 'PREM': 'Premezcla', 'LG': 'Legumbres', 'REC': 'Recepción', 'DP': 'Depósito',
}
SECTORES = {
    'ALM': 'Almacenamiento', 'PL': 'Pasta larga', 'PC': 'Pasta corta', 'PAST': 'Servicios fábrica de pastas',
    'TRASP': 'Transporte', 'AGUA': 'Agua', 'MOL': 'Molienda', 'MOJ': 'Mojado', '1LIMP': 'Primera limpieza',
    '2LIMP': 'Segunda limpieza', 'DEG': 'Desgerminado', 'DISG': 'Disgregado', 'CARG': 'Carga', 'ENVAS': 'Envasado',
    'ENVS': 'Envasado', 'REC': 'Recepción', 'ACOND': 'Acondicionado', 'LIMP': 'Limpieza', 'EXTRA': 'Extracción',
    'PRENS': 'Prensado', 'ENFR': 'Enfriado', 'ALMPT': 'Almacén producto terminado', 'RES': 'Rechazo', 'MEZCL': 'Mezclado',
    'TRANSP': 'Transporte', 'BZA': 'Balanza', 'TALB': 'Tablero', 'TABL': 'Tablero', 'TELA': 'Telas',
}
FRECUENCIAS = [  # (patrón, valor, unidad)
    (r'cada turno|diari|todos los d', 1, 'dias'), (r'seman', 1, 'semanas'), (r'quincen|15 ?d', 2, 'semanas'),
    (r'30 ?d|mes|mens', 1, 'meses'), (r'bimes', 2, 'meses'), (r'trimes', 3, 'meses'), (r'cuatrimes', 4, 'meses'),
    (r'semes', 6, 'meses'), (r'3 ?a[ñn]', 36, 'meses'), (r'2 ?a[ñn]', 24, 'meses'), (r'anual|1 ?a[ñn]|a[ñn]o', 12, 'meses'),
]
NOMBRE_FREC = {(1, 'dias'): 'Diaria', (1, 'semanas'): 'Semanal', (2, 'semanas'): 'Quincenal', (1, 'meses'): 'Mensual',
               (2, 'meses'): 'Bimestral', (3, 'meses'): 'Trimestral', (4, 'meses'): 'Cuatrimestral', (6, 'meses'): 'Semestral',
               (12, 'meses'): 'Anual', (24, 'meses'): 'Cada 2 años', (36, 'meses'): 'Cada 3 años'}

def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s).strip(' .\t-')

def codigo(s):
    s = norm(s).upper().replace('_X0009_', '').replace(' ', '').replace('.', '-')
    s = re.sub(r'-+', '-', s).strip('-')
    return {'ACPO': 'ACOP'}.get(s.split('-')[0], s.split('-')[0]) + s[len(s.split('-')[0]):] if '-' in s else s

def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(round(v, 3))
    return "'" + str(v).replace("'", "''") + "'"

def frecuencia(txt):
    t = norm(txt).lower()
    if not t: return None
    for pat, v, u in FRECUENCIAS:
        if re.search(pat, t): return (v, u)
    m = re.search(r'(\d+)\s*h', t)
    if m: return (int(m.group(1)), 'horas')
    return None

informe = collections.defaultdict(list)
sql = ['-- Carga inicial generada por importar_planillas.py el ' + datetime.date.today().isoformat(),
       '-- Se puede volver a correr: actualiza por código y no duplica.', 'begin;', '']

# ----------------------------------------------------------------------------------
# 1. Maestro de equipos (RG MA 01, hoja RFP 04 01)
# ----------------------------------------------------------------------------------
rg_path = next(iter(glob.glob(str(ORIGEN / 'RG_MA_01*.xlsx'))), None)
if not rg_path: sys.exit('No encuentro RG_MA_01*.xlsx en ' + str(ORIGEN))
rg = openpyxl.load_workbook(rg_path, read_only=True, data_only=True)
ws = rg['RFP 04 01']
equipos = {}
for r in ws.iter_rows(min_row=8, max_row=2000, values_only=True):
    if not r[20] or not r[5]: continue
    cod = codigo(r[20])
    partes = cod.split('-')
    if len(partes) < 3:
        informe['codigos_invalidos'].append(f'{r[20]!r} ({r[5]})'); continue
    planta, sector = partes[0], partes[1]
    if cod in equipos: informe['codigos_duplicados'].append(cod); continue
    crt = r[28] if r[28] in ('NC', 'MC', 'C') else None
    equipos[cod] = dict(codigo=cod, nombre=norm(r[5]).title(), planta=planta, sector=sector,
                        activo=(norm(r[21]).upper() != 'INACTIVO'),
                        frec=r[22] if isinstance(r[22], (int, float)) else None,
                        io=r[23] if isinstance(r[23], (int, float)) else None,
                        fo=r[24] if isinstance(r[24], (int, float)) else None,
                        cm=r[25] if isinstance(r[25], (int, float)) else None,
                        isa=r[26] if isinstance(r[26], (int, float)) else None,
                        consecuencia=r[27] if isinstance(r[27], (int, float)) else None, crt=crt,
                        calendario=[i + 1 for i, c in enumerate(r[29:77]) if c], tareas=[])
    if r[23] is None: informe['sin_criticidad'].append(cod)

plantas = sorted({e['planta'] for e in equipos.values()})
sectores = sorted({(e['planta'], e['sector']) for e in equipos.values()})
sql.append('-- Plantas y sectores')
for p in plantas:
    sql.append(f"insert into mant_plantas (codigo, nombre) values ({q(p)}, {q(PLANTAS.get(p, p))}) on conflict (codigo) do update set nombre = excluded.nombre;")
for p, s in sectores:
    sql.append(f"insert into mant_sectores (planta_id, codigo, nombre) select id, {q(s)}, {q(SECTORES.get(s, s))} from mant_plantas where codigo = {q(p)} on conflict (planta_id, codigo) do nothing;")

# ----------------------------------------------------------------------------------
# 2. Rutinas preventivas por equipo (una hoja por equipo en el RG MA 01)
# ----------------------------------------------------------------------------------
def leer_hoja_equipo(w):
    cod_celda = None
    tareas = []  # (descripcion, horas, frecuencia_txt, detalle)
    for r in w.iter_rows(min_row=1, max_row=60, values_only=True):
        if r[0] == 'COD EQUIPO': cod_celda = r[2]
        if r[0] in ('ITEM',) or r[1] in (None, '') or r[1] == 'DESCRIPCIÒN MANTENIMIENTO PREVENTIVO PROGRAMADO A REALIZAR': continue
        if isinstance(r[1], str) and norm(r[1]) and r[4] not in ('HORAS', 'CONTRATIEMPO', 'HORAS TOTALES'):
            if norm(r[1]).upper() in ('DESCRIPCION MANTENIMIENTO PREVENTIVO PROGRAMADO A REALIZAR',): continue
            tareas.append((norm(r[1]), r[5] if isinstance(r[5], (int, float)) else None, r[6], norm(r[9]) or None))
    return cod_celda, tareas

hojas_sin_equipo = []
for w in rg.worksheets[2:]:
    cod_celda, tareas = leer_hoja_equipo(w)
    cod = codigo(cod_celda or w.title)
    if cod not in equipos:
        alt = codigo(w.title)
        if alt in equipos: cod = alt
        else:
            hojas_sin_equipo.append(f'{w.title} (cod. en hoja: {cod_celda})'); continue
    # agrupa por frecuencia: cada frecuencia es una rutina con sus puntos
    frec_actual = None
    grupos = collections.OrderedDict()
    for desc, horas, ftxt, detalle in tareas:
        f = frecuencia(ftxt) or frec_actual
        if f is None:
            informe['tareas_sin_frecuencia'].append(f'{cod}: {desc}'); continue
        frec_actual = f
        grupos.setdefault(f, []).append((desc, horas, detalle))
    equipos[cod]['tareas'] = list(grupos.items())

sql.append('\n-- Equipos')
for e in equipos.values():
    sql.append(
        "insert into mant_equipos (codigo, nombre, planta_id, sector_id, io, fo, cm_manual, isa, frecuencia_fallas, clasificacion_manual, activo) "
        f"select {q(e['codigo'])}, {q(e['nombre'])}, p.id, s.id, {q(e['io'] or 1)}, {q(e['fo'] or 1)}, {q(e['cm'])}, {q(e['isa'] or 0)}, "
        f"{q(int(e['frec']) if e['frec'] and 1 <= e['frec'] <= 4 else None)}, {q(e['crt'])}, {q(e['activo'])} "
        f"from mant_plantas p join mant_sectores s on s.planta_id = p.id and s.codigo = {q(e['sector'])} where p.codigo = {q(e['planta'])} "
        "on conflict (codigo) do update set nombre = excluded.nombre, planta_id = excluded.planta_id, sector_id = excluded.sector_id, "
        "io = excluded.io, fo = excluded.fo, cm_manual = excluded.cm_manual, isa = excluded.isa, frecuencia_fallas = excluded.frecuencia_fallas, "
        "clasificacion_manual = excluded.clasificacion_manual, activo = excluded.activo;")

# Próxima fecha: primera semana marcada en el calendario del año; si no hay, lunes de la semana que viene
hoy = datetime.date.today()
lunes = hoy - datetime.timedelta(days=hoy.weekday())

def fecha_semana_calendario(semanas):
    """Columnas S1..S4 de cada mes → primer día de esa 'semana' del mes (aprox.)"""
    for s in semanas:
        mes, sem = (s - 1) // 4 + 1, (s - 1) % 4
        f = datetime.date(hoy.year, mes, 1) + datetime.timedelta(days=7 * sem)
        if f >= lunes: return f
    for s in semanas:
        mes, sem = (s - 1) // 4 + 1, (s - 1) % 4
        return datetime.date(hoy.year + 1, mes, 1) + datetime.timedelta(days=7 * sem)
    return None

sql.append('\n-- Rutinas preventivas (RG MA 01)')
n_tareas = n_items = 0
for e in equipos.values():
    for (valor, unidad), puntos in e['tareas']:
        nombre = NOMBRE_FREC.get((valor, unidad), f'Cada {valor} {unidad}')
        desc = f'{nombre}: ' + (puntos[0][0] if len(puntos) == 1 else f'{len(puntos)} puntos de control')
        horas = sum(p[1] or 0 for p in puntos) or None
        prox = fecha_semana_calendario(e['calendario']) if unidad == 'meses' and valor >= 1 and e['calendario'] else None
        prox = prox or (lunes + datetime.timedelta(days=7))
        sql.append(
            f"insert into mant_tareas (equipo_id, descripcion, origen, frecuencia_valor, frecuencia_unidad, duracion_estimada_horas, proxima_fecha) "
            f"select id, {q(desc)}, 'RG MA 01', {valor}, {q(unidad)}, {q(horas)}, {q(prox.isoformat())} from mant_equipos where codigo = {q(e['codigo'])} "
            f"and not exists (select 1 from mant_tareas t where t.equipo_id = mant_equipos.id and t.origen = 'RG MA 01' and t.frecuencia_valor = {valor} and t.frecuencia_unidad = {q(unidad)});")
        for i, (pd, ph, pdet) in enumerate(puntos):
            sql.append(
                f"insert into mant_tarea_items (tarea_id, orden, descripcion, horas, detalle) "
                f"select t.id, {i + 1}, {q(pd)}, {q(ph)}, {q(pdet)} from mant_tareas t join mant_equipos e on e.id = t.equipo_id "
                f"where e.codigo = {q(e['codigo'])} and t.origen = 'RG MA 01' and t.frecuencia_valor = {valor} and t.frecuencia_unidad = {q(unidad)} "
                f"and not exists (select 1 from mant_tarea_items i where i.tarea_id = t.id and i.orden = {i + 1});")
            n_items += 1
        n_tareas += 1

# ----------------------------------------------------------------------------------
# 3. Plan semanal por turno (rondas por unidad, sin código de equipo)
# ----------------------------------------------------------------------------------
plan_path = next(iter(glob.glob(str(ORIGEN / 'PLAN_SEMANAL*.xlsx'))), None)
n_rondas = 0
nombres_equipo = {norm(e['nombre']).upper(): e['codigo'] for e in equipos.values()}
if plan_path:
    sql.append('\n-- Rondas del plan semanal por turno')
    pl = openpyxl.load_workbook(plan_path, read_only=True, data_only=True)
    for w in pl.worksheets:
        turno = norm(w.title).title()
        dia = 1; unidad = None; horas = None; puntos = []
        rondas = []
        def cerrar():
            if unidad and puntos: rondas.append((turno, dia, unidad, horas, list(puntos)))
        for r in w.iter_rows(min_row=3, values_only=True):
            if isinstance(r[1], str) and re.match(r'\s*DIA\s*\d', r[1], re.I):
                cerrar(); puntos = []; unidad = None
                dia = int(re.search(r'\d+', r[1]).group()); continue
            if r[0]:
                cerrar(); puntos = []
                unidad = norm(r[0]).title(); horas = r[2] if isinstance(r[2], (int, float)) else None
            if isinstance(r[1], str) and norm(r[1]) and unidad:
                puntos.append((norm(r[1]), norm(r[7]) or None))
        cerrar()
        for turno, dia, unidad, horas, puntos in rondas:
            cod = nombres_equipo.get(unidad.upper())
            prox = lunes + datetime.timedelta(days=7 + dia - 1)
            desc = f'{unidad} · ronda {turno.lower()}, día {dia}'
            sel = f"(select id from mant_equipos where codigo = {q(cod)})" if cod else 'null'
            sql.append(
                f"insert into mant_tareas (equipo_id, unidad, descripcion, origen, frecuencia_valor, frecuencia_unidad, duracion_estimada_horas, turno, proxima_fecha) "
                f"select {sel}, {q(unidad)}, {q(desc)}, 'Plan semanal', 1, 'semanas', {q(horas)}, {q(turno)}, {q(prox.isoformat())} "
                f"where not exists (select 1 from mant_tareas where origen = 'Plan semanal' and descripcion = {q(desc)});")
            for i, (pd, obs) in enumerate(puntos):
                sql.append(
                    f"insert into mant_tarea_items (tarea_id, orden, descripcion, detalle) select id, {i + 1}, {q(pd)}, {q(obs)} from mant_tareas "
                    f"where origen = 'Plan semanal' and descripcion = {q(desc)} and not exists (select 1 from mant_tarea_items i where i.tarea_id = mant_tareas.id and i.orden = {i + 1});")
            n_rondas += 1
            if not cod: informe['rondas_sin_equipo_codificado'].append(f'{turno} día {dia}: {unidad}')

# ----------------------------------------------------------------------------------
# 4. Pañol: artículos, stock inicial y proveedores (INSUMOS_PAÑOL)
# ----------------------------------------------------------------------------------
ins_path = next(iter(glob.glob(str(ORIGEN / 'INSUMOS*.xlsx'))), None)
n_art = n_prov = 0
if ins_path:
    ins = openpyxl.load_workbook(ins_path, read_only=True, data_only=True)
    sql.append('\n-- Proveedores')
    for r in ins['PROVEEDORES_ACTIVOS'].iter_rows(min_row=3, values_only=True):
        if not r[1]: continue
        sql.append(f"insert into mant_proveedores (nombre, localidad, contacto, telefono, telefono2, rubro) values ({q(norm(r[1]).title())}, {q(norm(r[2]).title() or None)}, {q(norm(r[3]).title() or None)}, {q(norm(r[4]) or None)}, {q(norm(r[5]) or None)}, {q(norm(r[6]).title() or None)}) on conflict (nombre) do nothing;")
        n_prov += 1

    sql.append('\n-- Artículos del pañol (stock actual como ajuste de carga inicial)')
    vistos = {}
    def cod_art(desc, marca, n):
        base = re.sub(r'[^A-Z0-9]+', '-', norm(desc).upper())[:28].strip('-')
        c = base
        k = 2
        while c in vistos and vistos[c] != (desc, marca):
            c = f'{base}-{k}'; k += 1
        vistos[c] = (desc, marca)
        return c
    familias = collections.Counter()
    for r in ins['PRODUCTOS - STOCK'].iter_rows(min_row=2, values_only=True):
        desc = norm(r[2])
        if not desc: continue
        familia = norm(r[1]).title() or None
        marca = norm(r[3]) or None
        if marca in ('?', '-', '--', 'N/A', 'NA', 'S/M', 'SIN MARCA'): marca = None
        cant = r[4] if isinstance(r[4], (int, float)) else 0
        minimo = r[5] if isinstance(r[5], (int, float)) else 0
        precio = r[7] if isinstance(r[7], (int, float)) else None
        ubic = norm(r[0]) or None
        c = cod_art(desc, marca, n_art)
        familias[familia] += 1
        alias = [a.lower() for a in [marca] if a]
        sql.append(
            f"insert into mant_articulos (codigo, descripcion, familia, unidad, ubicacion, stock_minimo, costo_unit_usd, alias) values "
            f"({q(c)}, {q(desc + (' · ' + marca if marca else ''))}, {q(familia)}, 'un', {q(ubic)}, {q(minimo)}, {q(precio)}, array[{', '.join(q(a) for a in alias)}]::text[]) "
            "on conflict (codigo) do update set descripcion = excluded.descripcion, familia = excluded.familia, ubicacion = excluded.ubicacion, stock_minimo = excluded.stock_minimo, costo_unit_usd = excluded.costo_unit_usd;")
        if cant:
            sql.append(
                f"insert into mant_movimientos (articulo_id, tipo, cantidad, comentario) select id, 'ajuste', {q(cant)} - stock_actual, 'Carga inicial del padrón' "
                f"from mant_articulos where codigo = {q(c)} and stock_actual <> {q(cant)} and not exists (select 1 from mant_movimientos m where m.articulo_id = mant_articulos.id and m.comentario = 'Carga inicial del padrón');")
        n_art += 1
    informe['familias_panol'] = [f'{k}: {v}' for k, v in familias.most_common()]

sql += ['', 'commit;']
(SALIDA / '0002_carga_inicial.sql').write_text('\n'.join(sql), encoding='utf-8')

# ----------------------------------------------------------------------------------
# Informe
# ----------------------------------------------------------------------------------
crt = collections.Counter(e['crt'] for e in equipos.values())
md = [f'# Informe de carga inicial — {hoy.isoformat()}', '',
      f'- Plantas: {len(plantas)} · Sectores: {len(sectores)} · Equipos: {len(equipos)} (activos {sum(e["activo"] for e in equipos.values())})',
      f'- Criticidad asignada en la planilla: C {crt.get("C", 0)} · MC {crt.get("MC", 0)} · NC {crt.get("NC", 0)} · sin dato {crt.get(None, 0)}',
      f'- Rutinas preventivas (RG MA 01): {n_tareas} con {n_items} puntos de control',
      f'- Rondas del plan semanal por turno: {n_rondas}',
      f'- Artículos del pañol: {n_art} · Proveedores: {n_prov}', '',
      '## Para revisar a mano', '']
secciones = {
    'codigos_invalidos': 'Equipos del maestro con código que no respeta FABRICA-SECTOR-EQUIPO-N (no se importaron)',
    'codigos_duplicados': 'Códigos repetidos en el maestro (se tomó el primero)',
    'sin_criticidad': 'Equipos sin IO/FO/CM/ISA cargados (quedan con criticidad NC hasta que se completen)',
    'tareas_sin_frecuencia': 'Tareas de la ficha sin frecuencia reconocible (no se importaron)',
    'rondas_sin_equipo_codificado': 'Rondas del plan semanal cuya unidad no coincide con un equipo del maestro (quedan como ronda por unidad; se les puede asignar equipo en la app)',
    'familias_panol': 'Familias de artículos encontradas en el pañol',
}
md.append(f'- Hojas del RG MA 01 sin equipo en el maestro ({len(hojas_sin_equipo)}): ' + ', '.join(hojas_sin_equipo))
for k, titulo in secciones.items():
    items = informe.get(k, [])
    md.append(f'\n### {titulo} ({len(items)})')
    md += [f'- {x}' for x in items[:400]]
(SALIDA / 'informe_carga.md').write_text('\n'.join(md), encoding='utf-8')
print('\n'.join(md[:8]))
print('SQL:', SALIDA / '0002_carga_inicial.sql', len(sql), 'sentencias')
