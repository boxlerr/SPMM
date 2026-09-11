"""Migraciones que se aplican solas al levantar el backend.

POR QUÉ EXISTE ESTO

El backend se deploya A MANO a Cloud Run: entre "subí la imagen" y "está andando"
no hay ningún paso donde alguien corra el .sql. Y una columna nueva no es opcional
para el que lee: SQLAlchemy arma el SELECT con TODAS las columnas del modelo, así
que si la base todavía no la tiene no se rompe la pantalla nueva — se rompe la
lectura de todas las OT. El día que eso pasa, el backend está deployado y la base
no, y desde afuera parece que el deploy salió mal.

Hasta ahora cada repositorio se curaba solo (`_ensure_tabla` en AuditoriaRepository,
`_ensure_columns` en PlanificacionRepository), pero eso sirve cuando la tabla la
escribe SQL a mano y el que la necesita es un solo método. Para una columna del
modelo no alcanza: tiene que estar ANTES de la primera lectura, no antes de la
primera escritura.

El .sql sigue siendo la fuente: vive en backend/scripts/migrations/ con la fecha
adelante, ahí está el POR QUÉ completo y es lo que se corre a mano contra una base
que la app no puede levantar. Acá va sólo el DDL, repetido a propósito: duplicar
unas líneas es más barato y más previsible que leer y ordenar los .sql en el
arranque. Que no se separen lo cuida un test
(tests/test_migraciones_al_arrancar.py), que compara las dos listas de sentencias.

REGLAS

- Idempotente siempre (IF NOT EXISTS): esto corre en CADA arranque y hay varias
  instancias levantando a la vez.
- Nunca levanta. Una base que no deja hacer el ALTER tiene que dar un error visible
  al usar la pantalla, no dejar el servicio sin arrancar.
- **Lo que se pone acá tiene que ser TODO el .sql**, no la parte que parece
  importante. Si el .sql crea un índice o deja un COMMENT y acá van sólo las
  columnas, la base de producción queda distinta del archivo que la documenta y el
  log dice "aplicada" igual. La primera versión de este módulo tenía ese bug.
- Sólo Postgres. Producción es Supabase; los tests corren sobre SQLite, donde las
  tablas salen de `Base.metadata` y ya traen todas las columnas.

  OJO CON EL SQL SERVER: `db.py` todavía sabe caer al SQL Server on-prem si se saca
  `SUPABASE_DB_URL` —es el camino de rollback— y esa base NO tiene las columnas que
  se agregan acá ni las va a tener, porque este módulo la saltea. Ese rollback hoy
  rompe la lectura de órdenes con "Invalid column name", y no lo estrena esta
  migración: ya pasaba con `no_lleva_plano` (10/09). Queda dicho para que nadie lo
  descubra el día que necesita el rollback.
"""
import asyncio

from sqlalchemy import text

from backend.commons.loggers.logger import logger
from backend.infrastructure.db import engine

# Cuánto se espera por el lock antes de rendirse.
#
# Un ALTER TABLE toma ACCESS EXCLUSIVE sobre `orden_trabajo`, y Postgres lo toma
# ANTES de evaluar el IF NOT EXISTS: o sea que también el caso "ya estaba", que es
# el de todos los arranques menos el primero, se pone en la cola por el lock más
# fuerte que hay sobre la tabla más caliente de la app. Y la cola de PG es FIFO:
# mientras el ALTER espera, toda consulta nueva contra esa tabla se encola DETRÁS
# de él, también en las instancias que ya estaban andando.
#
# Sin este timeout, una instancia fría levantando justo mientras el planificador
# hace su lectura larga puede dejar `GET /ordenes` colgado en todo el servicio. Con
# 3 segundos, en el peor caso la migración se rinde, loguea el warning y el
# arranque sigue: la próxima instancia la aplica.
LOCK_TIMEOUT = "3s"

# Y un tope para todo el módulo, por si la base ni siquiera contesta: Cloud Run
# corta el arranque a los 240 s y quedarse esperando acá sería el síntoma
# "el deploy no levanta" que este archivo viene a evitar.
TOPE_TOTAL_SEG = 20

# (nombre del .sql, sentencias idempotentes). El nombre es sólo para el log: es lo
# que se busca en backend/scripts/migrations/ cuando algo no se aplicó.
MIGRACIONES: list[tuple[str, list[str]]] = [
    (
        "2026-09-11_modificado_en_ot",
        [
            "ALTER TABLE orden_trabajo "
            "ADD COLUMN IF NOT EXISTS modificado_en TIMESTAMP, "
            "ADD COLUMN IF NOT EXISTS modificado_por VARCHAR(120)",
            "COMMENT ON COLUMN orden_trabajo.modificado_en IS "
            "'Cuándo se tocó esta OT por última vez DESDE SPMM. NULL = nunca se "
            "tocó acá (la trajo el sistema viejo), que no es lo mismo que se desconoce.'",
            "COMMENT ON COLUMN orden_trabajo.modificado_por IS "
            "'Quién la tocó. NULL = no se registró el usuario; nunca un autor inventado.'",
            "CREATE INDEX IF NOT EXISTS ix_orden_trabajo_modificado_en "
            "ON orden_trabajo (modificado_en DESC) WHERE modificado_en IS NOT NULL",
        ],
    ),
    (
        "2026-09-11_no_lleva_materia_prima",
        [
            "ALTER TABLE orden_trabajo "
            "ADD COLUMN IF NOT EXISTS no_lleva_materia_prima SMALLINT NOT NULL DEFAULT 0",
            "COMMENT ON COLUMN orden_trabajo.no_lleva_materia_prima IS "
            "'El taller marcó que esta orden NO necesita materia prima. Distinto de no tener '"
            "'ninguna fila en orden_trabajo_pieza, que sólo dice que nadie cargó la lista. '"
            "'La escribe SPMM; el sync del sistema viejo no la toca.'",
            "CREATE INDEX IF NOT EXISTS ix_orden_trabajo_falta_material "
            "ON orden_trabajo (id) WHERE COALESCE(no_lleva_materia_prima, 0) = 0",
        ],
    ),
]


async def _aplicar_una(nombre: str, sentencias: list[str], motor=None) -> None:
    # Todas las sentencias de una migración van en la MISMA transacción: media
    # migración aplicada es peor que ninguna, porque el log diría "aplicada".
    async with (motor or engine).begin() as conn:
        await conn.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        for s in sentencias:
            await conn.execute(text(s))


async def aplicar_migraciones(motor=None) -> None:
    """Corre el DDL pendiente. No devuelve nada y no levanta nunca.

    `motor` existe para los tests y NO es un detalle menor: el engine de este módulo
    es el de producción, importado al cargar. Un test que llame a esto sin inyectar
    nada le corre el ALTER a Supabase.
    """
    motor = motor or engine
    if motor.dialect.name != "postgresql":
        logger.info(
            "Migraciones: la base es %s y no Postgres — no se aplica nada.",
            motor.dialect.name,
        )
        return

    for nombre, sentencias in MIGRACIONES:
        try:
            await asyncio.wait_for(_aplicar_una(nombre, sentencias, motor), timeout=TOPE_TOTAL_SEG)
            logger.info(
                "Migraciones: %s aplicada entera (o ya estaba) — %d sentencias.",
                nombre, len(sentencias),
            )
        except Exception as e:
            # Incluye el TimeoutError del wait_for y el lock_timeout de Postgres: en
            # los dos casos la base quedó como estaba y la próxima instancia
            # reintenta. Warning y seguimos: el arranque no se frena por esto.
            logger.warning(
                "Migraciones: NO se pudo aplicar %s: %s. "
                "Corré backend/scripts/migrations/%s.sql a mano.",
                nombre, e, nombre,
            )
