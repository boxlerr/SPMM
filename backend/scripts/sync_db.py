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
from datetime import date, datetime, timedelta
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
  ISNULL(v.afabricar, 0) AS fabricacion,
  0 AS reparacion, 0 AS sin_cargo, 0 AS stock, 0 AS interno,
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

            # 3. Órdenes de trabajo. Las FKs las resolvemos acá (antes lo hacía el
            #    JOIN cross-database, que ya no es posible).
            fecha_desde = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-01")
            logger.info(f"Sincronizando Ordenes de Trabajo desde {fecha_desde}...")
            crudas = await _leer(Q_OTS, {"fecha_desde": fecha_desde})

            m_prio = await _mapa(session, "prioridad", "descripcion")
            m_sect = await _mapa(session, "sector", "nombre")
            m_art = await _mapa(session, "articulo", "cod_articulo")
            m_cli = await _mapa(session, "cliente", "id_viejo")
            def_prio = m_prio.get(_clave("SIN PRIORIDAD"))
            def_sect = m_sect.get(_clave("SIN SECTOR"))
            def_art = m_art.get(_clave("NO-DEF"))

            ots = []
            for r in crudas:
                f = {k: v for k, v in r.items() if not k.startswith("_")}
                f["id_prioridad"] = m_prio.get(_clave(r["_prioridad"]), def_prio)
                f["id_sector"] = m_sect.get(_clave(r["_sector"]), def_sect)
                f["id_articulo"] = m_art.get(_clave(r["_cod_articulo"]), def_art)
                f["id_cliente"] = m_cli.get(_clave(r["_cliente_viejo"]))
                ots.append(f)

            n, u = await _upsert(session, "orden_trabajo", ots, ["id_otvieja"],
                                 ["id_otvieja"] + COLS_OT)
            logger.info(f"  -> OTs: {n} nuevas, {u} actualizadas")
            await session.commit()

            # 4. Zombies. Antes eran dos UPDATE con JOIN cross-database; ahora se
            #    trae del legacy la lista de "pendientes" y se compara contra ella.
            pendientes = [r["idot"] for r in await _leer(Q_PENDIENTES)]
            logger.info(f"Pendientes según legacy: {len(pendientes)}")

            react = await session.execute(
                text("UPDATE orden_trabajo SET finalizadototal = 0 "
                     "WHERE id_otvieja IS NOT NULL AND COALESCE(finalizadototal, 0) = 1 "
                     "AND id_otvieja = ANY(:pend)"), {"pend": pendientes})
            logger.info(f"  -> Reactivadas: {react.rowcount}")

            zomb = await session.execute(
                text("UPDATE orden_trabajo SET finalizadototal = 1 "
                     "WHERE id_otvieja IS NOT NULL AND COALESCE(finalizadototal, 0) = 0 "
                     "AND NOT (id_otvieja = ANY(:pend))"), {"pend": pendientes})
            logger.info(f"  -> Marcadas como finalizadas: {zomb.rowcount}")
            await session.commit()

            # 5. Catálogo de procesos (sólo inserta los que faltan).
            #    Los nombres se normalizan (ver _nombre_proceso): vienen de texto libre
            #    del legacy y cada variante de tipeo crea un proceso nuevo, que nace sin
            #    rango y por lo tanto asignable a cualquiera.
            logger.info("Actualizando catálogo de procesos...")
            nombres = []
            for r in await _leer(Q_PROCESOS):
                nombre = _nombre_proceso(r["nombre"] or "")
                if nombre:
                    nombres.append({**r, "nombre": nombre})
            n, _ = await _upsert(session, "proceso", nombres, ["nombre"], ["nombre"])
            logger.info(f"  -> procesos nuevos: {n}")
            await session.commit()

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
            logger.info("Sincronización completada exitosamente.")
        except Exception as e:
            await session.rollback()
            logger.error(f"Error durante la sincronización: {e}")


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
