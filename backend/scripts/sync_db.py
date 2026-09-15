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
"""

import asyncio
import os
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text

from backend.commons.loggers.logger import logger
from backend.infrastructure.db import SessionLocal

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


def _leer_sync(sql, params=None):
    with _legacy_engine().connect() as c:
        return [dict(r) for r in c.execute(text(sql), params or {}).mappings()]


async def _leer(sql, params=None):
    """Lee del legacy en un thread aparte (pyodbc es sincrónico y bloquearía el loop)."""
    return await asyncio.to_thread(_leer_sync, sql, params)


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

Q_PIEZAS = """
SELECT LTRIM(RTRIM(mp.idpieza)) AS cod_pieza,
       MAX(ISNULL(mp.descripcion, '')) AS descripcion,
       CAST(MAX(ISNULL(mp.costo, 0)) AS DECIMAL(18,2)) AS unitario,
       MAX(ISNULL(NULLIF(LTRIM(RTRIM(mp.un)), ''), 'UN')) AS unidad,
       CAST(MAX(ISNULL(mp.cantstk, 0)) AS DECIMAL(18,2)) AS stockactual
FROM dbo.otrabajoMprimas mp
WHERE mp.idpieza IS NOT NULL AND LTRIM(RTRIM(mp.idpieza)) <> ''
GROUP BY LTRIM(RTRIM(mp.idpieza))
"""

Q_MATERIA_PRIMA = """
SELECT mp.idot AS _id_otvieja,
       LTRIM(RTRIM(mp.idpieza)) AS _cod_pieza,
       CAST(ISNULL(mp.cantidad, 0) AS DECIMAL(18,2)) AS cantidad,
       COALESCE(NULLIF(LTRIM(RTRIM(mp.un)), ''), 'SIN UNIDAD') AS unidad,
       CASE WHEN ISNULL(mp.cantidad, 0) > 0 THEN 1 ELSE 0 END AS pedido,
       CASE WHEN ISNULL(mp.pendiente, 0) = 0 THEN 1 ELSE 0 END AS disponible,
       CAST(ISNULL(mp.cantstk, 0) AS DECIMAL(18,2)) AS cantusada
FROM dbo.otrabajoMprimas mp
WHERE mp.idpieza IS NOT NULL AND LTRIM(RTRIM(mp.idpieza)) <> ''
ORDER BY mp.idot, LTRIM(RTRIM(mp.idpieza))
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


async def run_sync():
    logger.info("Iniciando sincronización de base de datos completa...")
    async with SessionLocal() as session:
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

            # 7. Catálogo de piezas (antes que las MP por OT, que necesitan el id_pieza).
            logger.info("Actualizando catálogo y stock de piezas...")
            n, u = await _upsert(session, "pieza", await _leer(Q_PIEZAS), ["cod_pieza"],
                                 ["cod_pieza", "descripcion", "unitario", "unidad", "stockactual"],
                                 cols_update=["stockactual"])
            logger.info(f"  -> piezas: {n} nuevas, {u} actualizadas")
            await session.commit()

            # 8. Materias primas por OT
            logger.info("Sincronizando materias primas por OT...")
            m_ot = await _mapa(session, "orden_trabajo", "id_otvieja")
            m_pza = await _mapa(session, "pieza", "cod_pieza")
            mps = []
            for r in await _leer(Q_MATERIA_PRIMA):
                id_ot = m_ot.get(_clave(r["_id_otvieja"]))
                id_pza = m_pza.get(_clave(r["_cod_pieza"]))
                if id_ot is None or id_pza is None:
                    continue  # la OT o la pieza no están en SPMM (fuera del rango del sync)
                f = {k: v for k, v in r.items() if not k.startswith("_")}
                f["id_orden_trabajo"], f["id_pieza"] = id_ot, id_pza
                mps.append(f)
            n, u = await _upsert(session, "orden_trabajo_pieza", mps,
                                 ["id_orden_trabajo", "id_pieza"],
                                 ["id_orden_trabajo", "id_pieza", "cantidad", "unidad",
                                  "pedido", "disponible", "cantusada"])
            logger.info(f"  -> materias primas: {n} nuevas, {u} actualizadas")

            await session.commit()

            # 9. Avisar del desfasaje con el sistema viejo. NO lo arregla: lo cuenta.
            await _avisar_desfasaje(session)

            logger.info("Sincronización completada exitosamente.")
        except Exception as e:
            await session.rollback()
            logger.error(f"Error durante la sincronización: {e}")


# El "sin fecha" del legacy. Mismo criterio que cerrar_ot_entregadas_en_legacy.
_SIN_FECHA_LEGACY = "1950-01-01"

# Hora local de Argentina y sin zona, como TODAS las fechas de esta base. Cloud Run
# corre en UTC y el Dockerfile no fija TZ, así que `datetime.now()` pelado guardaría
# tres horas adelantado. Mismo helper que AuditoriaRepository y PlanificacionRepository.
_TZ_AR = timezone(timedelta(hours=-3))


def _ahora_ar():
    return datetime.now(_TZ_AR).replace(tzinfo=None)

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
    """
    try:
        res = await session.execute(text(
            "SELECT id_otvieja FROM orden_trabajo "
            " WHERE id_otvieja IS NOT NULL AND COALESCE(finalizadototal, 0) = 0 "
            "   AND fecha_entrega IS NULL"))
        abiertas = [r[0] for r in res]
        if not abiertas:
            return

        filas = await _leer(_Q_YA_ENTREGADAS.format(
            sin_fecha=_SIN_FECHA_LEGACY, ids=",".join(str(i) for i in abiertas)))
        cuantas = len(filas)
        if not cuantas:
            logger.info("  -> desfasaje con el viejo: ninguna OT entregada allá sigue abierta acá")
            return

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
    except Exception as e:
        # Un aviso que falla no puede tumbar la sincronización.
        logger.warning(f"  -> no se pudo revisar el desfasaje con el sistema viejo: {e}")


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
