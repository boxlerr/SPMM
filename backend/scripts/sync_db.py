"""
Sincronización legacy (SQL Server on-prem) → SPMM (Supabase / Postgres).

ANTES: SMPP y la base legacy `metalurgica_db` vivían en el MISMO SQL Server, así
que cada paso era un `MERGE` cross-database (una sola sentencia leía de una base y
escribía en la otra).

AHORA: SPMM está en Supabase, así que eso ya no es posible. Esto es un **ETL de
dos conexiones**:
    1. se LEE del legacy con SQL Server (las queries de lectura siguen en T-SQL,
       porque corren contra SQL Server),
    2. se resuelven las FKs en Python (antes las resolvía el JOIN cross-DB),
    3. se hace UPSERT en Postgres.

Las reglas de negocio son las mismas que tenía el MERGE: se inserta lo que no
existe y se actualiza sólo lo que cambió.

La materia prima va aparte (paso 7b / ESPEJO de run_sync): con el Sistema Integral como
dueño (MATERIA_PRIMA_DUENO=integral, la prueba piloto) se refleja entera en cada pasada;
con SPMM como dueño sólo llegan las altas y los precios del viejo.
"""

import asyncio
import math
import os
import re
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import quote_plus

from sqlalchemy import create_engine, insert, select, text, update

from backend.application.materia_prima.legado import (
    CatalogoLegado,
    fecha_desde_texto,
    norm_codigo,
    pieza_desde_legacy,
    una_fila_por_codigo,
)
from backend.application.materia_prima.dueno import dueno, spmm_es_dueno
from backend.commons.loggers.logger import logger
from backend.domain.Formato import Formato
from backend.domain.Material import Material
from backend.domain.MaterialCalidad import MaterialCalidad
from backend.domain.Pieza import Pieza
from backend.domain.PiezaPrecio import PiezaPrecio
from backend.domain.Proveedor import Proveedor
from backend.infrastructure.db import SessionLocal
from backend.scripts import sync_huella as huella

# ---------------------------------------------------------------------------
# Conexión al legacy. Sigue siendo el SQL Server on-prem: por defecto el mismo
# servidor/credenciales que usaba la app, pero apuntando a `metalurgica_db`.
# ---------------------------------------------------------------------------
_LEGACY_ENGINE = None


def _legacy_engine():
    global _LEGACY_ENGINE
    if _LEGACY_ENGINE is None:
        driver = "ODBC Driver 17 for SQL Server"
        server = os.getenv("LEGACY_DB_SERVER") or os.getenv("DB_SERVER")
        base = os.getenv("LEGACY_DB_NAME", "metalurgica_db")
        user = os.getenv("LEGACY_DB_USER") or os.getenv("DB_USER")
        pwd = os.getenv("LEGACY_DB_PASSWORD") or os.getenv("DB_PASSWORD")
        if (os.getenv("TRUSTED_CONNECTION") or "").lower() == "yes":
            cs = (f"DRIVER={{{driver}}};SERVER={server};DATABASE={base};"
                  f"Trusted_Connection=yes;TrustServerCertificate=yes;")
        else:
            cs = (f"DRIVER={{{driver}}};SERVER={server};DATABASE={base};"
                  f"UID={user};PWD={pwd};TrustServerCertificate=yes;")
        _LEGACY_ENGINE = create_engine(
            f"mssql+pyodbc:///?odbc_connect={quote_plus(cs)}",
            pool_pre_ping=True, pool_recycle=1800,
        )
    return _LEGACY_ENGINE


def _leer_sync(sql, params=None, tope_seg=None):
    with _legacy_engine().connect() as c:
        # El tope de la consulta en el driver (pyodbc `timeout` = SQL_ATTR_QUERY_TIMEOUT):
        # pasado ese tiempo el driver la cancela del lado del SQL Server y levanta. Se pone
        # en CADA lectura, también el 0 (sin tope, como siempre), porque la conexión vuelve
        # al pool con el valor que le quedó y la lectura siguiente no tiene por qué heredarlo.
        c.connection.dbapi_connection.timeout = math.ceil(tope_seg) if tope_seg else 0
        return [dict(r) for r in c.execute(text(sql), params or {}).mappings()]


async def _leer(sql, params=None, tope_seg=None):
    """Lee del legacy en un thread aparte (pyodbc es sincrónico y bloquearía el loop).

    `tope_seg`: para las lecturas que corren con una transacción de Supabase abierta (la
    segunda lectura del espejo, releer_lineas_del_viejo en el script de la importación):
    el driver corta la consulta a ese tiempo. Quien llama igual la envuelve en un
    asyncio.wait_for, por si el driver ni siquiera puede avisar (la red caída a mitad de
    camino): ahí el thread queda esperando solo, pero la corrida sigue y suelta sus locks.
    Sin tope (None), como siempre: el resto del sync no tiene nada tomado mientras lee."""
    return await asyncio.to_thread(_leer_sync, sql, params, tope_seg)


# ---------------------------------------------------------------------------
# Helpers de upsert (reemplazan al MERGE)
# ---------------------------------------------------------------------------
def _norm(v):
    """Normaliza para comparar: el MERGE comparaba con ISNULL(x,'') <> ISNULL(y,'')."""
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return v.date() if (v.hour, v.minute, v.second) == (0, 0, 0) else v
    if isinstance(v, str):
        return v.strip()
    return v


def _cambio(actual, nuevo, columnas):
    return any(_norm(actual.get(c)) != _norm(nuevo.get(c)) for c in columnas)


def _clave(valor):
    """Las claves de texto se comparan sin distinguir mayúsculas ni espacios, como
    hacía SQL Server (su collation por defecto es case-insensitive)."""
    return valor.strip().upper() if isinstance(valor, str) else valor


def _nombre_proceso(valor):
    """
    Normaliza el nombre de un proceso antes de meterlo al catálogo: recorta las
    puntas y colapsa los espacios de adentro.

    El catálogo se COSECHA de texto libre del legacy (Q_PROCESOS saca un DISTINCT de
    lo que alguien tipeó en cada línea de OT), así que cada variante de tipeo entra
    como un proceso NUEVO. Y un proceso nuevo nace sin rango, que para el
    planificador significa "lo puede hacer cualquiera" — ver
    PlanificacionService._crear_variables_y_dominios. Así aparecieron gemelos como
    'FRESADORA  ENGRASADO' y 'FRESADORA ENGRASADO'.

    `_clave` ya empareja por mayúsculas y espacios de las puntas, pero NO por los de
    adentro: 'A  B' y 'A B' le daban claves distintas y se insertaban las dos.

    Los errores de tipeo de verdad ('TORNO T3c' por 'TORNO T3') esto no los puede
    atrapar: para eso está la auditoría (scripts/auditoria_procesos_sin_rango.py).
    """
    if not isinstance(valor, str):
        return valor
    return re.sub(r"\s+", " ", valor).strip()


async def _upsert(session, tabla, filas, claves, columnas, cols_update=None):
    """
    Equivalente al MERGE: inserta lo que no existe y actualiza sólo lo que cambió.
    No necesita índices UNIQUE en el destino (hay códigos duplicados heredados):
    machea leyendo las claves que ya están en la tabla.

    `columnas`   -> lo que se escribe al INSERTAR.
    `cols_update`-> lo que se compara y actualiza al MACHEAR. Por defecto, todo.
                    Importa: el MERGE de `pieza` sólo actualizaba `stockactual`,
                    para no pisar descripción/costo/unidad con los del legacy.
    """
    if not filas:
        return 0, 0

    # El legacy tiene claves repetidas (ej. 11 pares (OT, pieza) con dos filas, y
    # códigos de artículo/pieza duplicados). Sin deduplicar, cada corrida escribía
    # una fila distinta y el sync quedaba oscilando para siempre. Nos quedamos con
    # la última ocurrencia, que además es lo que hacía que el MERGE de SQL Server
    # fallara con "attempted to UPDATE the same row more than once".
    unicas = {}
    for f in filas:
        unicas[tuple(_clave(f[c]) for c in claves)] = f
    if len(unicas) != len(filas):
        logger.warning(f"  {tabla}: {len(filas) - len(unicas)} filas con clave repetida en el origen (se usa la última)")
    filas = list(unicas.values())

    datos = [c for c in columnas if c not in claves]
    upd = [c for c in (cols_update if cols_update is not None else datos) if c not in claves]
    res = await session.execute(text(f"SELECT {', '.join(claves + datos)} FROM {tabla}"))
    existentes = {tuple(_clave(r[k]) for k in claves): dict(r) for r in res.mappings()}

    nuevas, cambiadas = [], []
    for f in filas:
        k = tuple(_clave(f[c]) for c in claves)
        actual = existentes.get(k)
        if actual is None:
            nuevas.append(f)
        elif upd and _cambio(actual, f, upd):
            cambiadas.append(f)

    if nuevas:
        cols = claves + datos
        await session.execute(
            text(f"INSERT INTO {tabla} ({', '.join(cols)}) "
                 f"VALUES ({', '.join(':' + c for c in cols)})"),
            nuevas,
        )
    if cambiadas:
        await session.execute(
            text(f"UPDATE {tabla} SET {', '.join(f'{c} = :{c}' for c in upd)} "
                 f"WHERE {' AND '.join(f'{k} = :{k}' for k in claves)}"),
            cambiadas,
        )
    return len(nuevas), len(cambiadas)


async def _mapa(session, tabla, col_clave, col_valor="id"):
    res = await session.execute(text(f"SELECT {col_clave}, {col_valor} FROM {tabla}"))
    return {_clave(r[col_clave]): r[col_valor] for r in res.mappings() if r[col_clave] is not None}


# ---------------------------------------------------------------------------
# Lecturas del legacy (T-SQL: corren contra SQL Server)
# ---------------------------------------------------------------------------
Q_CLIENTES = """
SELECT idCliente AS id_viejo,
       LTRIM(RTRIM(Descripcion)) AS nombre, LTRIM(RTRIM(fantasia)) AS fantasia,
       LTRIM(RTRIM(abreviatura)) AS abreviatura, LTRIM(RTRIM(direccion)) AS direccion,
       LTRIM(RTRIM(localidad)) AS localidad, LTRIM(RTRIM(cuit)) AS cuit,
       LTRIM(RTRIM(telefono)) AS telefono, LTRIM(RTRIM(celular)) AS celular,
       LTRIM(RTRIM(mail)) AS mail, LTRIM(RTRIM(web)) AS web, LTRIM(RTRIM(obs)) AS obs
FROM dbo.cliente
"""

Q_ARTICULOS = """
SELECT LTRIM(RTRIM(Idarticulo)) AS cod_articulo,
       LTRIM(RTRIM(descripcion)) AS descripcion,
       LTRIM(RTRIM(abreviatura)) AS abreviatura
FROM dbo.articulo
WHERE Idarticulo IS NOT NULL AND LTRIM(RTRIM(Idarticulo)) <> ''
"""

# Igual que antes, pero SIN los JOIN a las tablas de SPMM: se traen las claves
# naturales (prioridad/sector/artículo/cliente) y las FKs se resuelven en Python.
Q_OTS = """
SELECT
  v.idot AS id_otvieja,
  ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(v.obs + ' ', '') + ISNULL(v.obs1 + ' ', '') + ISNULL(v.obs2 + ' ', '') + ISNULL(v.obs3, ''))), ''), 'Sin observaciones') AS observaciones,
  LTRIM(RTRIM(v.prioridad))  AS _prioridad,
  LTRIM(RTRIM(v.sector))     AS _sector,
  LTRIM(RTRIM(v.idarticulo)) AS _cod_articulo,
  v.idcliente                AS _cliente_viejo,
  v.fecha AS fecha_orden, v.fechaentrada AS fecha_entrada, v.fechaprometida AS fecha_prometida,
  CASE WHEN v.fechaentrega = '1950-01-01' THEN NULL ELSE v.fechaentrega END AS fecha_entrega,
  v.cantidad AS unidades,
  ISNULL(v.cantidadE, 0) AS cantidad_entregada,
  ISNULL(v.reclamo, 0) AS reclamo, ISNULL(v.revisada, 0) AS revisada,
  ISNULL(v.finalizadoparcial, 0) AS finalizadoparcial,
  ISNULL(v.finalizadototal, 0) AS finalizadototal,
  ISNULL(v.programada, 0) AS programada, ISNULL(v.enproceso, 0) AS en_proceso,
  ISNULL(v.suspendida, 0) AS suspendida,
  CASE WHEN ISNULL(v.email, '') <> '' THEN 1 ELSE 0 END AS email,
  CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(v.plano,''))), '') IS NOT NULL THEN 1
       WHEN ISNULL(v.tplano,0) = 1 THEN 1 ELSE 0 END AS tiene_plano,
  '' AS n_ped_l,
  ISNULL(v.nropedido, '') AS n_pedido, ISNULL(v.subsector, '') AS subsector,
  ISNULL(v.requerido, '') AS requerido_por, ISNULL(v.aprobado, '') AS aprobado_por,
  ISNULL(v.remitosalida, '') AS remitos_salida,
  CASE WHEN v.fmaterial = '1950-01-01' THEN NULL ELSE v.fmaterial END AS f_disp_material,
  -- Qué clase de trabajo es. En el legacy NO hay una columna por tipo: es UN grupo de
  -- radios guardado en `v.forma`, y el índice sigue el orden en que están puestos en la
  -- pantalla (columna por columna):
  --     0 Fabricación · 1 Reparación · 2 Sin Cargo · 3 Stock · 4 Interno
  -- Medido contra la base real (15/09/2026): forma 0→4814, 1→2128, 2→62, 3→0, 4→3.
  -- Lo que fija el mapeo, y no es una corazonada:
  --   · `dbo.otrabajoStock` —la tabla donde el legacy guarda las órdenes de stock— tiene
  --     forma=3 en sus filas. Eso clava el 3 y con él todo el orden.
  --   · de las 2128 con forma=1, 380 dicen «REPARA…» en el texto (contra 18 de las 4814
  --     con forma=0), y son trabajos de reparar: «pelar y vulcanizar», «enderezar».
  --   · la OT 15187, forma=2, dice «En garantía:» — que es exactamente sin cargo.
  --   · la OT 15713, que el taller mandó fotografiada con «Fabricación» tildado, es forma=0.
  --
  -- ANTES ACÁ DECÍA `ISNULL(v.afabricar, 0) AS fabricacion`, y estaba mal de raíz:
  -- `afabricar` es la CANTIDAD a fabricar (el casillero "a Fabricar:" del programa viejo),
  -- no un sí/no. Metía números adentro de una bandera 0/1 —quedaron OT con fabricacion =
  -- 20, 30, 110, 160— y todo el resto del sistema compara con `= 1`, así que el taller
  -- veía TODAS las OT sin tipo. Es el «no lo está tomando que es del programa viejo» de
  -- Camilo (14/09).
  CASE WHEN ISNULL(v.forma, 0) = 0 THEN 1 ELSE 0 END AS fabricacion,
  CASE WHEN v.forma = 1 THEN 1 ELSE 0 END AS reparacion,
  CASE WHEN v.forma = 2 THEN 1 ELSE 0 END AS sin_cargo,
  CASE WHEN v.forma = 3 THEN 1 ELSE 0 END AS stock,
  CASE WHEN v.forma = 4 THEN 1 ELSE 0 END AS interno,
  ISNULL(v.ttotal, 0) AS tercerizado_total,
  ISNULL(v.tparcial, 0) AS tercerizado_parcial,
  ISNULL(v.fc, 0) AS fc, ISNULL(v.ttt1, 0) AS ttt1
FROM dbo.otrabajo v
WHERE v.fecha >= :fecha_desde
   OR (
        ISNULL(v.fc, 0) <> 1
    AND v.fechaentrega    = '1950-01-01'
    AND v.fecha           > '2021-01-01'
    AND ISNULL(v.cantidade, 0) < ISNULL(v.cantidad, 0)
    AND ISNULL(v.ttt1, 0) <> 1
    AND ISNULL(v.suspendida, 0) = 0
   )
"""

# Regla OFICIAL de "OT pendiente" del sistema legacy (la que usa Jorge, su creador).
# NO se chequea `remitido`: en legacy indica sólo un remito parcial y la OT sigue
# activa hasta que `fechaentrega` deje de ser '1950-01-01'.
Q_PENDIENTES = """
SELECT v.idot
FROM dbo.otrabajo v
WHERE ISNULL(v.fc, 0) <> 1
  AND v.fechaentrega    = '1950-01-01'
  AND v.fecha           > '2021-01-01'
  AND ISNULL(v.cantidade, 0) < ISNULL(v.cantidad, 0)
  AND ISNULL(v.ttt1, 0) <> 1
  AND ISNULL(v.suspendida, 0) = 0
"""

Q_PROCESOS = """
SELECT DISTINCT LTRIM(SUBSTRING(op.proceso, CHARINDEX('-', op.proceso) + 1, LEN(op.proceso))) AS nombre
FROM dbo.otrabajoProceso op
WHERE op.proceso IS NOT NULL AND CHARINDEX('-', op.proceso) > 0
"""

# Q_PIEZAS y Q_MATERIA_PRIMA (pasos 7 y 8, ver run_sync) se SACARON el 23/09/2026 y no
# quedan de muestra como Q_OTS: estaban mal. Armaban la pieza desde las líneas de las OT
# (stock = cantstk, que vale 0 en las 19.504 filas del viejo) e inventaban las marcas de
# cada línea (pedido = cantidad > 0, disponible = pendiente = 0). La lectura buena de las
# dos tablas está en scripts/importar_materia_prima_legacy.py.

# El catálogo del viejo que lee el paso 7b: sólo las columnas que usa la conversión
# (application/materia_prima/legado.pieza_desde_legacy), la misma de la importación.
Q_CATALOGO_VIEJO = """
SELECT Idpieza, descripcion, unitario, unidad, fecha, insumo, material, formato,
       t1, t2, t3, t4, t5, medida, estante, letra, nro, proveedor, obs, inactivo
FROM dbo.pieza
WHERE Idpieza IS NOT NULL AND LTRIM(RTRIM(Idpieza)) <> ''
"""

# Semillas (se ejecutan en el destino).
SEEDS = [
    ("articulo", "INSERT INTO articulo (cod_articulo, descripcion, abreviatura) "
                 "SELECT 'NO-DEF', 'Articulo no definido (heredado)', 'N/D' "
                 "WHERE NOT EXISTS (SELECT 1 FROM articulo WHERE cod_articulo = 'NO-DEF')"),
    ("sector", "INSERT INTO sector (nombre) SELECT 'SIN SECTOR' "
               "WHERE NOT EXISTS (SELECT 1 FROM sector WHERE nombre = 'SIN SECTOR')"),
    ("prioridad", "INSERT INTO prioridad (descripcion) SELECT 'SIN PRIORIDAD' "
                  "WHERE NOT EXISTS (SELECT 1 FROM prioridad WHERE descripcion = 'SIN PRIORIDAD')"),
]

COLS_CLIENTE = ["nombre", "fantasia", "abreviatura", "direccion", "localidad",
                "cuit", "telefono", "celular", "mail", "web", "obs"]
COLS_OT = ["observaciones", "id_prioridad", "id_sector", "id_articulo", "id_cliente",
           "fecha_orden", "fecha_entrada", "fecha_prometida", "fecha_entrega", "unidades",
           "cantidad_entregada", "reclamo", "revisada", "finalizadoparcial", "finalizadototal",
           "programada", "en_proceso", "suspendida", "email", "tiene_plano", "n_ped_l",
           "n_pedido", "subsector", "requerido_por", "aprobado_por", "remitos_salida",
           "f_disp_material", "fabricacion", "reparacion", "sin_cargo", "stock", "interno",
           "tercerizado_total", "tercerizado_parcial", "fc", "ttt1"]


async def run_sync(forzar: bool = False) -> str:
    """Una pasada del sync. Devuelve 'sin_cambios', 'completa' o 'con_errores' (lo que
    contesta POST /internal/sync).

    PRIMERO LAS HUELLAS (scripts/sync_huella.py; pedido de Julián del 25/09: el Scheduler
    pasa a */10 y el sync tiene que trabajar sólo si cambió algo). Una consulta al Integral
    y otra a SPMM; si las dos son iguales a las de la última pasada completa que salió bien
    (y fue hace menos de huella.RED_DE_SEGURIDAD), no se hace NADA más: ni semillas, ni
    clientes, ni artículos, ni espejo, ni desfasaje. Un renglón de log y listo.

    Si cambió el Integral, pasada completa. Si cambió SÓLO SPMM en las tablas del espejo,
    pasada completa y un WARNING: alguien escribió ahí por afuera (el backend viejo de
    Render, si se despierta) y el espejo lo restituye. Si una huella no se puede leer, o
    `forzar`, pasada completa: saltear por error es lo único que no puede pasar.

    Las huellas se guardan sólo si la pasada completa salió bien de punta a punta (ver
    `ok` abajo): si algo falló, la próxima pasada corre entera otra vez."""
    arranque = time.perf_counter()
    empezo = _ahora_ar()
    modo = dueno()
    async with SessionLocal() as session:
        guardado, huella_integral, huella_spmm = await _leer_huellas(session, modo)
        decision = huella.decidir(guardado, huella_integral, huella_spmm, empezo, forzar)
        if not decision.completa:
            await _marcar_visto(session, empezo)
            desde = f"{guardado.ultima_completa:%H:%M}" if guardado and guardado.ultima_completa else "?"
            logger.info(f"sync: sin cambios en el Integral ni en SPMM desde {desde} — no se hace "
                        f"nada ({(time.perf_counter() - arranque) * 1000:.0f} ms)")
            return "sin_cambios"
        if decision.alerta:
            logger.warning(f"sync: {decision.motivo}")
        else:
            logger.info(f"sync: pasada completa — {decision.motivo}")

        # Si la pasada deja SPMM igual al Integral de punta a punta. Cualquier paso que
        # falle (o un espejo que no reflejó todo) la baja, y entonces no se guardan huellas.
        ok = True
        logger.info("Iniciando sincronización de base de datos completa...")
        try:
            # 1. Semillas
            logger.info("Asegurando datos semilla (Articulo, Sector, Prioridad)...")
            for _, sql in SEEDS:
                await session.execute(text(sql))
            await session.commit()

            # 2. Catálogos (antes que las OTs, que dependen de ellos)
            logger.info("Actualizando catálogo de clientes...")
            n, u = await _upsert(session, "cliente", await _leer(Q_CLIENTES),
                                 ["id_viejo"], ["id_viejo"] + COLS_CLIENTE)
            logger.info(f"  -> clientes: {n} nuevos, {u} actualizados")

            logger.info("Actualizando catálogo de artículos...")
            n, u = await _upsert(session, "articulo", await _leer(Q_ARTICULOS),
                                 ["cod_articulo"], ["cod_articulo", "descripcion", "abreviatura"])
            logger.info(f"  -> artículos: {n} nuevos, {u} actualizados")
            await session.commit()

            # 3 y 4. Órdenes de trabajo y zombies — DESACTIVADO 2026-09-02.
            #
            #    Decisión de Julián: «no vamos a traerlas más, vamos a crearlas todas
            #    desde acá». Desde el cutover de julio SPMM ya era el dueño de los
            #    procesos (ver más abajo); ahora también lo es de las OT.
            #
            #    Lo que hacía y por qué molestaba: un UPSERT por `id_otvieja` sobre las
            #    OT de los últimos 60 días, que cada 5 minutos le devolvía a la OT lo
            #    que decía el legacy —fechas, cantidades, prioridad, sector— y pisaba lo
            #    que se hubiera corregido acá. Y el bloque de zombies daba por finalizada
            #    toda OT que el legacy no listara como pendiente, así que una OT creada
            #    en SPMM (sin `id_otvieja`) se salvaba de casualidad, por el
            #    `id_otvieja IS NOT NULL` de esos dos UPDATE.
            #
            #    Antes de apagarlo se corrió la última migración
            #    (`remigrar_procesos_legacy --abiertas --aplicar`, 2/9): 183 OT miradas,
            #    17 filas ajustadas y 25 pasadas insertadas.
            #
            #    Las consultas Q_OTS y Q_PENDIENTES quedan en el archivo a propósito: si
            #    alguna vez hay que traer una OT puntual, el SQL está y probado.
            logger.info("Sync de OTs DESACTIVADO — SPMM dueño de las órdenes (2026-09-02).")

            # 5. Catálogo de procesos — DESACTIVADO 2026-09-02, junto con las OT.
            #    Traía los nombres de proceso del legacy y daba de alta los que faltaban.
            #    Cada variante de tipeo creaba un proceso nuevo, que nacía sin rango y
            #    sin máquina, o sea asignable a cualquiera y sin reservar nada: de ahí
            #    salen los «AGUJEREADo y ROSCADO» y los «TORNO T1 trBAJO 3 dias 24h» que
            #    ensucian el catálogo. Los procesos se crean en SPMM.
            logger.info("Sync del catálogo de procesos DESACTIVADO — se crean en SPMM (2026-09-02).")

            # 6. Procesos por OT — DESACTIVADO 2026-07-06 (cutover Metlo).
            #    Acuerdo reunión 2-jul-2026 (Lucas): desde el lunes los procesos se
            #    cargan y editan SÓLO en SPMM. El sync los pisaba cada 5 minutos
            #    (reseteaba el avance a Pendiente, sobreescribía orden y tiempo, y
            #    re-insertaba los borrados). SPMM es el ÚNICO dueño de los procesos.
            logger.info("Sync de procesos por OT DESACTIVADO — SPMM dueño de procesos (cutover 2026-07-06).")

            # 7. Catálogo de piezas — DESACTIVADO 23/09/2026.
            #    Reunión con Lucas del 23/09: la gestión de materias primas PASA a SPMM y
            #    el viejo queda para facturas y remitos. El stock de SPMM es desde ahora la
            #    suma de sus movimientos (pieza_movimiento, la solapa Stock) y `stockactual` su
            #    caché, que escriben el servicio y (con el Integral como dueño) el espejo.
            #
            #    Lo que hacía y por qué no puede seguir: un upsert por código que armaba la
            #    pieza desde las líneas de las OT y, a toda pieza que ya estaba, le pisaba
            #    el stock con MAX(cantstk). En el viejo cantstk vale 0 en TODAS las filas,
            #    así que en cada pasada ponía en 0 el stock de las 5.222 piezas que alguna
            #    vez estuvieron en una OT (y 742 de ellas tenían stock allá). Con el stock
            #    pasando a SPMM, además borraría cada movimiento cargado acá.
            #
            #    Lo que sigue llegando del viejo (los códigos que se crean al facturar y el
            #    último precio de compra) lo trae el paso 7b, que no toca el stock.
            logger.info("Sync del catálogo y stock de piezas (paso 7) DESACTIVADO — "
                        + ("los trae el espejo del Integral." if not spmm_es_dueno()
                           else "SPMM dueño de la materia prima (2026-09-23)."))

            # 7b / ESPEJO. Qué se trae de la materia prima depende de quién es el dueño
            #    (application/materia_prima/dueno.py, variable MATERIA_PRIMA_DUENO):
            #
            #    · 'integral' (por defecto; la prueba piloto desde el 28/09): el Integral
            #      sigue siendo el dueño de todo y SPMM lo REFLEJA. En vez de los pasos 7 y
            #      8, el ESPEJO corre en cada pasada la misma importación que el script
            #      (scripts/importar_materia_prima_legacy.importar): catálogo, precios,
            #      stock, las líneas de las OT con sus marcas reales, los cortes y la
            #      cañera. Gana el Integral. El 7b no hace falta (el espejo trae lo mismo).
            #    · 'spmm': SPMM es el dueño; el espejo se apaga y sólo quedan las altas y
            #      los precios del viejo (7b).
            #
            #    Los dos aparte y sin tumbar el resto: un viejo que no contesta no puede
            #    dejar sin aviso de desfasaje (paso 9).
            if spmm_es_dueno():
                try:
                    n, u = await _altas_y_precios_del_viejo(session)
                    logger.info(f"  -> catálogo del viejo: {n} códigos nuevos, {u} precios nuevos")
                except Exception as e:
                    ok = False
                    await session.rollback()
                    logger.warning(f"  -> no se pudieron traer las altas y precios del viejo: {e}")
            else:
                try:
                    incompleto = _espejo_incompleto(await _espejo_del_integral(session))
                    if incompleto:
                        ok = False
                        logger.info(f"  -> espejo del Integral: {incompleto}; no se guardan las huellas")
                except Exception as e:
                    ok = False
                    await session.rollback()
                    logger.warning(f"  -> espejo del Integral (materia prima): no se pudo correr: "
                                   f"{type(e).__name__}: {e}")

            # 8. Materias primas por OT — DESACTIVADO 23/09/2026, por la misma reunión.
            #    Este paso las reescribía en cada pasada desde el viejo, y mal: las marcas
            #    no eran las del viejo sino inventadas (pedido = cantidad > 0, disponible =
            #    1), por eso SPMM decía «material ok» en 118 de las 212 OT abiertas que en
            #    el viejo estaban sin pedir o esperando. Tampoco borraba: una línea sacada
            #    allá quedaba viva acá (239 restos). Y cualquier OT creada en SPMM con un
            #    número que ya usa el viejo se quedaba con la materia prima de la otra.
            #
            #    Mientras el Integral sea el dueño, las trae el ESPEJO de arriba (marcas
            #    reales, cortes, cañera, stock). Con SPMM como dueño, Carolina las carga en
            #    SPMM y Maxi compra desde Pendientes: la tabla es sólo de SPMM.
            logger.info("Sync de materias primas por OT (paso 8) DESACTIVADO — "
                        + ("las trae el espejo del Integral." if not spmm_es_dueno()
                           else "se cargan en SPMM (2026-09-23)."))

            # 9. Avisar del desfasaje con el sistema viejo. NO lo arregla: lo cuenta.
            if not await _avisar_desfasaje(session):
                ok = False

            logger.info("Sincronización completada exitosamente." if ok else
                        "Sincronización completada con errores (ver arriba).")
        except Exception as e:
            ok = False
            await session.rollback()
            logger.error(f"Error durante la sincronización: {e}")

        if not ok:
            logger.warning("sync: la pasada completa no terminó bien — no se guardan las huellas "
                           "(la próxima corre entera)")
            return "con_errores"
        await _guardar_huellas(session, modo, guardado, huella_integral, huella_spmm, decision,
                               empezo)
        return "completa"


# ---------------------------------------------------------------------------
# Las huellas (scripts/sync_huella.py): leerlas, guardarlas y qué cuenta como una pasada
# que dejó SPMM igual al Integral.
# ---------------------------------------------------------------------------
async def _leer_huellas(session, modo):
    """(guardado, huella del Integral, huella de SPMM), las dos huellas a la vez (la del
    Integral va en un thread). Lo que no se pudo leer vuelve None, con un WARNING: para
    decidir() un None es «pasada completa», nunca «no cambió»."""

    async def _integral():
        try:
            return await huella.leer_huella_integral(_leer, modo)
        except Exception as e:
            logger.warning(f"sync: no se pudo leer la huella del Integral ({type(e).__name__}: {e})")
            return None

    async def _spmm():
        guardado = actual = None
        try:
            guardado = await huella.leer_estado(session)
        except Exception as e:
            await session.rollback()
            logger.warning(f"sync: no se pudo leer sync_estado ({type(e).__name__}: {e})")
        try:
            actual = await huella.leer_huella_spmm(session, modo)
        except Exception as e:
            logger.warning(f"sync: no se pudo leer la huella de SPMM ({type(e).__name__}: {e})")
        # Que la sesión no quede con una transacción de lectura abierta mientras corre el
        # resto (y una consulta que falló en Postgres deja la transacción abortada).
        await session.rollback()
        return guardado, actual

    huella_integral, (guardado, huella_spmm) = await asyncio.gather(_integral(), _spmm())
    return guardado, huella_integral, huella_spmm


async def _marcar_visto(session, ahora):
    """La hora en que el sync miró y no hizo nada. Si falla, da igual: no es un dato."""
    try:
        await huella.marcar_visto(session, ahora)
    except Exception as e:
        await session.rollback()
        logger.debug(f"sync: no se pudo anotar la hora en sync_estado: {e}")


async def _guardar_huellas(session, modo, guardado, huella_integral, huella_spmm_inicio,
                           decision, empezo):
    """Después de una pasada completa que salió bien: la huella de SPMM de lo que quedó
    escrito y la del Integral leída al empezar. Sin la del Integral (no se pudo leer) no se
    guarda nada: la próxima pasada corre entera. De OT, clientes y artículos que cambiaron
    MIENTRAS corría, lo de al empezar (huella.a_guardar: una OT que entró a mitad de la
    pasada no recibió su materia prima). Nunca levanta."""
    if huella_integral is None:
        return
    try:
        despues = await huella.leer_huella_spmm(session, modo)
        guardar, a_mitad = huella.a_guardar(huella_spmm_inicio, despues)
        await huella.guardar_estado(session, huella_integral, guardar, empezo, _ahora_ar())
    except Exception as e:
        await session.rollback()
        logger.warning(f"sync: no se pudieron guardar las huellas ({type(e).__name__}: {e}); "
                       f"la próxima pasada corre entera")
        return
    if a_mitad:
        logger.info(f"sync: {', '.join(a_mitad)} cambiaron mientras corría la pasada; la próxima "
                    f"corre entera para mirarlas")
    if decision.alerta:
        # ¿Quedó como estaba? Es lo que cuenta si el espejo de verdad restituyó.
        distintas = huella.restituidas(guardado, decision.tablas_espejo, despues)
        if distintas:
            logger.warning(f"sync: después de restituir, siguen distintas de la pasada completa "
                           f"anterior: {', '.join(distintas)} (¿cambió el Integral mientras "
                           f"corría, o lo que escribieron no es de lo que trae el espejo?)")
        else:
            logger.info(f"sync: restituido — {', '.join(decision.tablas_espejo)} quedaron como en "
                        f"la pasada completa anterior")


# Las lecturas del Integral que, vacías, el espejo toma como una lectura que falló (no
# borra, no apaga, no libera: importar_materia_prima_legacy, «lectura vacía»). Esa pasada
# no dejó SPMM igual al Integral. El plan semanal también: la ventana abarca 17 semanas y
# el taller carga de 55 a 93 OT en cada una; vacía es una lectura rota, no un plan vacío.
_LECTURAS_QUE_NO_PUEDEN_VENIR_VACIAS = ("pieza", "lineas", "cortes", "canera", "otrabajo",
                                        "plansemanal")


def _espejo_incompleto(resultado) -> str | None:
    """None si el espejo dejó SPMM igual al Integral; si no, por qué no. No hay espejo
    (la app no está sobre Postgres): None, no hay nada que reflejar."""
    if resultado is None:
        return None
    if resultado.faltan:
        return "falta la migración de materia prima"
    if resultado.ocupado:
        return "otra corrida de la importación tenía el candado"
    if resultado.fallo:
        return f"falló el paso {resultado.fallo[0]}"
    if resultado.ctx is None:
        return "no corrió ningún paso"
    vacias = [n for n in _LECTURAS_QUE_NO_PUEDEN_VENIR_VACIAS
              if n in resultado.ctx.viejo and not resultado.ctx.viejo[n]]
    if vacias:
        return f"el Integral devolvió vacío {', '.join(vacias)}"
    # El tope de borrado (frenar_en_tope): se iba a borrar más de lo que una pasada puede,
    # y no se borró nada. SPMM quedó con líneas que el Integral ya no tiene.
    for paso in resultado.pasos:
        if any("por el tope" in clave and n for clave, n in paso.conteos.items()):
            return "el tope de borrado frenó líneas que el Integral ya no tiene"
    return None


# El "sin fecha" del legacy. Mismo criterio que cerrar_ot_entregadas_en_legacy.
_SIN_FECHA_LEGACY = "1950-01-01"

# Hora local de Argentina y sin zona, como TODAS las fechas de esta base. Cloud Run
# corre en UTC y el Dockerfile no fija TZ, así que `datetime.now()` pelado guardaría
# tres horas adelantado. Mismo helper que AuditoriaRepository y PlanificacionRepository.
_TZ_AR = timezone(timedelta(hours=-3))


def _ahora_ar():
    return datetime.now(_TZ_AR).replace(tzinfo=None)

# ---------------------------------------------------------------------------
# 7b. Altas y precios del catálogo del viejo
# ---------------------------------------------------------------------------
async def _catalogo_legado(session):
    """Los catálogos de SPMM contra los que se convierte una pieza del viejo (material,
    calidad, formato y proveedor por nombre). Sólo se leen: el sync no los crea. Una
    calidad que el viejo estrena al facturar queda en NULL y se completa en la ficha."""
    materiales = {nombre: id_ for id_, nombre in (await session.execute(
        select(Material.id, Material.nombre))).all()}
    calidades = {(id_material, nombre): id_ for id_, id_material, nombre in (await session.execute(
        select(MaterialCalidad.id, MaterialCalidad.id_material, MaterialCalidad.nombre))).all()}
    formatos = {nombre: id_ for id_, nombre in (await session.execute(
        select(Formato.id, Formato.nombre))).all()}
    proveedores = [{"id": id_, "razon_social": rs, "fantasia": fa} for id_, rs, fa in (await session.execute(
        select(Proveedor.id, Proveedor.razon_social, Proveedor.fantasia))).all()]
    return CatalogoLegado(materiales, calidades, formatos, proveedores)


async def _importacion_hecha(session) -> bool:
    """¿Ya corrió alguna vez la importación de materia prima? (alguna pieza con origen)."""
    return (await session.execute(
        select(Pieza.id).where(Pieza.origen.isnot(None)).limit(1))).first() is not None


async def _espejo_del_integral(session):
    """ESPEJO de la materia prima mientras el Sistema Integral es el dueño (la prueba
    piloto; application/materia_prima/dueno.py). Corre la MISMA importación que el script
    (scripts/importar_materia_prima_legacy.importar) con los pasos PASOS_ESPEJO: gana el
    Integral, en cada pasada. Carolina y Maxi cargan allá; acá se ve en la pasada siguiente
    del sync (Cloud Scheduler, cada dueno.FRECUENCIA_ESPEJO_MIN minutos), con las marcas
    reales.

    Cómo, y por qué así:
      · con la base de la app pasada al pooler 6543 (la misma regla que el script): la
        importación abre su propia conexión asyncpg y el 5432 admite 15 clientes para
        todo el proyecto;
      · sin copias de seguridad (backup_*) en cada pasada: se acumularía una copia por
        pasada. Salvo hasta que cada copia existe, TABLA POR TABLA (SI_NO_HAY_COPIA del
        importador): la primera pasada es la importación inicial y reescribe miles de
        filas, que quedan copiadas como las deja el script; y si esa pasada falla a mitad
        de camino (escribió los insumos pero no las líneas), la siguiente todavía copia las
        líneas. Antes se decidía por «ninguna pieza con origen», y ese caso quedaba sin
        copia de las líneas;
      · con tiempos: la segunda lectura del Integral, que corre con la transacción de
        Supabase abierta, tiene tope, y Postgres corta la transacción si queda quieta
        (TOPE_RELECTURA_SEG y TOPE_OCIOSO_EN_TRANSACCION del importador): un Integral
        colgado no deja tomados los locks ni el candado;
      · sólo si la migración 2026-09-23_materia_prima está aplicada: si falta, importar()
        no toca nada y acá se loguea y se sigue (el sync no se puede caer por esto);
      · un candado de la importación impide que dos corridas (dos pasadas, o una pasada y
        el script a mano) escriban a la vez; la que llega segunda no hace nada;
      · con el tope de borrado que FRENA (frenar_en_tope): si una pasada fuera a borrar
        más de TOPE_BORRADO_LINEAS líneas de OT, no borra ninguna y lo avisa (una lectura
        rota del Integral no puede vaciar SPMM); la primera importación, si pasa el tope,
        se corre a mano con el script;
      · un renglón de log por pasada con lo que cambió, y un WARNING por cada cosa que
        alguien tiene que mirar (el tope, una lectura vacía, una OT de SPMM que no es la
        del Integral con ese número).

    Devuelve el Resultado de importar() (o None si la app no está sobre Postgres). Los
    errores se levantan: run_sync los loguea y sigue con el resto.
    """
    from backend.infrastructure.db import PG_URL
    from backend.scripts import importar_materia_prima_legacy as importacion

    if not PG_URL:
        logger.info("  -> espejo del Integral (materia prima): la app no está sobre Postgres; no se corre.")
        return None
    # Que la sesión de la app no quede con una transacción abierta mientras corre el
    # espejo, que va por su propia conexión.
    await session.rollback()
    resultado = await importacion.importar(
        importacion.PASOS_ESPEJO, aplicar=True, db_url=importacion.por_el_pooler(PG_URL),
        respaldar=importacion.SI_NO_HAY_COPIA, silencioso=True, frenar_en_tope=True)
    # Las copias que hizo esta pasada (la primera, o la que sigue a una primera que falló a
    # mitad): es lo que se busca para volver atrás.
    copias = ", ".join(f"{b} {n}" for b, n in resultado.copiadas().items())
    donde = f"materia prima, con copias: {copias}" if copias else "materia prima"
    if resultado.faltan or resultado.fallo:
        # Un paso que falló (por ejemplo, una fila tomada por la app más de 10 s) deja los
        # anteriores escritos y la próxima pasada sigue desde ahí: se avisa, no se levanta.
        logger.warning(f"  -> espejo del Integral ({donde}): {resultado.renglon()}")
    else:
        logger.info(f"  -> espejo del Integral ({donde}): {resultado.renglon()}")
    for alerta in resultado.alertas()[:20]:
        logger.warning(f"  -> espejo del Integral (materia prima): {alerta}")
    alertas = set(resultado.alertas())
    for aviso in [a for a in resultado.avisos() if a not in alertas][:20]:
        logger.debug(f"     {aviso}")
    return resultado


async def _altas_y_precios_del_viejo(session, filas=None, hoy=None):
    """Lo único que el sistema viejo le sigue mandando al catálogo de SPMM cuando SPMM es
    el dueño de la materia prima (con el Integral como dueño corre el espejo, que trae
    esto y todo lo demás; ver run_sync).

    Desde el 23/09/2026 la materia prima se gestiona en SPMM, pero las facturas de
    compra se siguen haciendo en el viejo, y ahí pasan dos cosas que SPMM necesita:

      · se crean códigos nuevos (el viejo da de alta la pieza al facturarla): se
        INSERTAN acá con la misma conversión que la importación
        (materia_prima/legado.pieza_desde_legacy) y origen 'legacy';
      · cambia el último precio de compra: si el del viejo (unitario > 0 con fecha que se
        entienda) es MÁS NUEVO que el de SPMM (o SPMM no tiene fecha), se actualizan
        `unitario` y `fecha_ultimo_precio` y queda una fila en el historial de precios
        con origen 'compra'.

    NADA MÁS. De una pieza que ya está no se toca la descripción, el tipo, las medidas,
    la ubicación, el inactivo ni el stock: eso ahora es de SPMM. Tampoco las líneas de
    las OT, los movimientos, los recortes ni la cañera.

    SÓLO CORRE SI LA IMPORTACIÓN YA SE HIZO (alguna pieza con `origen`). Antes, SPMM
    tiene el catálogo viejo a medias (sin tipo, sin proveedores, sin fecha de precio) y
    cada código «nuevo» del viejo entraría con datos que la importación iba a pisar
    igual; peor, sin `fecha_ultimo_precio` todos los precios parecerían más nuevos.

    `filas` y `hoy` son para los tests; en el sync se leen del viejo y del reloj.
    Devuelve (códigos nuevos, precios nuevos). Hace commit.
    """
    if not await _importacion_hecha(session):
        logger.info("  -> catálogo del viejo: la importación de materia prima todavía no "
                    "corrió (ninguna pieza tiene origen); no se trae nada.")
        return 0, 0

    if filas is None:
        filas = await _leer(Q_CATALOGO_VIEJO)
    ahora = _ahora_ar()
    hoy = hoy or ahora.date()

    # Una fila por código normalizado (el viejo repite '50%004' y '001'), elegida igual
    # que en la importación: la del precio más nuevo.
    viejo = {codigo: (fila, fecha_desde_texto(fila.get("fecha"), hoy))
             for codigo, fila in una_fila_por_codigo(filas, hoy).items()}

    # Los de SPMM por código normalizado: '50%004' tiene dos filas acá también y el
    # precio nuevo vale para las dos.
    existentes = defaultdict(list)
    for id_pieza, codigo, fecha_ultimo in (await session.execute(
            select(Pieza.id, Pieza.cod_pieza, Pieza.fecha_ultimo_precio))).all():
        existentes[norm_codigo(codigo)].append((id_pieza, fecha_ultimo))

    def _precio(fila, fecha):
        try:
            unitario = float(fila.get("unitario"))
        except (TypeError, ValueError):
            return None
        return unitario if unitario > 0 and fecha is not None else None

    nuevas, precios = [], []
    for codigo, (fila, fecha) in viejo.items():
        precio = _precio(fila, fecha)
        if codigo not in existentes:
            nuevas.append((fila, fecha, precio))
            continue
        if precio is None:
            continue
        for id_pieza, fecha_ultimo in existentes[codigo]:
            if fecha_ultimo is None or fecha > fecha_ultimo:
                await session.execute(
                    update(Pieza).where(Pieza.id == id_pieza)
                    .values(unitario=precio, fecha_ultimo_precio=fecha))
                precios.append({"id_pieza": id_pieza, "fecha": fecha, "precio": precio,
                                "origen": "compra", "creado_en": ahora})

    if nuevas:
        catalogo = await _catalogo_legado(session)
        for fila, fecha, precio in nuevas:
            datos = pieza_desde_legacy(fila, catalogo, hoy)
            datos["cod_pieza"] = str(fila.get("Idpieza")).strip()
            datos["creado_en"] = ahora
            id_pieza = (await session.execute(
                insert(Pieza).values(**datos).returning(Pieza.id))).scalar()
            if precio is not None and id_pieza is not None:
                precios.append({"id_pieza": id_pieza, "fecha": fecha, "precio": precio,
                                "origen": "compra", "creado_en": ahora})

    if precios:
        await session.execute(insert(PiezaPrecio), precios)
    await session.commit()
    return len(nuevas), len(precios)


_Q_YA_ENTREGADAS = """
SELECT v.idot
FROM dbo.otrabajo v
WHERE v.idot IN ({ids})
  AND (v.fechaentrega <> '{sin_fecha}' OR ISNULL(v.fc, 0) = 1)
"""


async def _avisar_desfasaje(session):
    """Cuenta las OT que el sistema viejo ya entregó y acá siguen abiertas, y avisa.

    POR QUÉ AVISA EN VEZ DE ARREGLAR

    El 2/9 se decidió que SPMM es el dueño de las órdenes y el sync dejó de tocarlas.
    Eso está bien, pero dejó dos agujeros que se tapan con scripts a mano
    (`migrar_ot_faltantes` para las que faltan, `cerrar_ot_entregadas_en_legacy` para
    las que allá ya se entregaron) y nadie se acuerda de correrlos.

    Lo que cuesta se midió el 11/9: el plan confirmado de la noche anterior tenía 4.815
    de sus 13.535 minutos —el 36%— reservados para trabajo que ya había salido por la
    puerta. Una de esas órdenes se había entregado ESE MISMO DÍA. Nadie podía saberlo:
    el dato estaba en la otra base y en SPMM no se veía por ningún lado.

    Así que esto NO cierra nada: eso sigue siendo decisión de una persona, con el script
    que ya existe. Lo único que hace es que el desfasaje deje de ser invisible.

    Nunca levanta: si el sistema viejo no contesta, el sync no se cae por un aviso.
    Devuelve si pudo revisar (False = falló y quedó en el log): con False, run_sync no
    guarda las huellas y la pasada siguiente lo vuelve a intentar.
    """
    try:
        res = await session.execute(text(
            "SELECT id_otvieja FROM orden_trabajo "
            " WHERE id_otvieja IS NOT NULL AND COALESCE(finalizadototal, 0) = 0 "
            "   AND fecha_entrega IS NULL"))
        abiertas = [r[0] for r in res]
        if not abiertas:
            return True

        filas = await _leer(_Q_YA_ENTREGADAS.format(
            sin_fecha=_SIN_FECHA_LEGACY, ids=",".join(str(i) for i in abiertas)))
        cuantas = len(filas)
        if not cuantas:
            logger.info("  -> desfasaje con el viejo: ninguna OT entregada allá sigue abierta acá")
            return True

        ots = ", ".join(f"#{f['idot']}" for f in sorted(filas, key=lambda x: x["idot"])[:8])
        if cuantas > 8:
            ots += f" y {cuantas - 8} más"
        mensaje = (f"{cuantas} órdenes ya entregadas en el sistema viejo siguen abiertas acá"
                   if cuantas > 1 else
                   f"1 orden ya entregada en el sistema viejo sigue abierta acá")
        motivo = (f"{ots}. Mientras sigan abiertas, el planificador les hace lugar: reserva "
                  f"máquina y gente para trabajo que ya salió. Se cierran corriendo "
                  f"`cerrar_ot_entregadas_en_legacy --aplicar`.")

        # Una sola por vez: esto corre cada pocos minutos y un aviso repetido deja de
        # leerse. Mientras el de antes siga sin leer, se actualiza el número en vez de
        # apilar uno nuevo.
        previo = (await session.execute(text(
            "SELECT id_notificacion FROM notificacion "
            " WHERE tipo = 'desfasaje_legacy' AND NOT leida "
            " ORDER BY fecha_creacion DESC LIMIT 1"))).first()
        if previo:
            await session.execute(text(
                "UPDATE notificacion SET mensaje = :m, motivo = :mo, fecha_creacion = :f "
                " WHERE id_notificacion = :id"),
                {"m": mensaje, "mo": motivo, "f": _ahora_ar(), "id": previo[0]})
        else:
            await session.execute(text(
                "INSERT INTO notificacion (mensaje, tipo, leida, motivo, fecha_creacion) "
                "VALUES (:m, 'desfasaje_legacy', false, :mo, :f)"),
                {"m": mensaje, "mo": motivo, "f": _ahora_ar()})
        await session.commit()
        logger.info(f"  -> desfasaje con el viejo: {cuantas} OT entregadas allá siguen abiertas acá")
        return True
    except Exception as e:
        # Un aviso que falla no puede tumbar la sincronización.
        logger.warning(f"  -> no se pudo revisar el desfasaje con el sistema viejo: {e}")
        return False


async def main():
    while True:
        try:
            await run_sync()
        except Exception as e:
            logger.error(f"Error inesperado en el loop principal: {e}")

        logger.info("Esperando 5 minutos para la próxima sincronización...")
        await asyncio.sleep(300)  # 5 minutos


if __name__ == "__main__":
    asyncio.run(main())
