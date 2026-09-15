"""Las migraciones que se aplican solas al levantar.

El módulo `infrastructure/migraciones.py` es el único pedazo de código cuyo trabajo
es que un deploy a mano no rompa el arranque, y era el único sin un test que lo
tocara: ningún test dispara el `startup_event` (los que usan httpx.ASGITransport no
emiten eventos de lifespan, y los otros se arman su propia app), así que un error de
tipeo en el DDL no lo veía nadie hasta el primer arranque en frío en producción,
donde el único rastro es un logger.warning.
"""
import re
from pathlib import Path

import pytest

from backend.infrastructure import migraciones


MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "scripts" / "migrations"


def _normalizar(sql: str) -> str:
    """Deja el SQL comparable: sin comentarios, sin saltos, espacios colapsados."""
    sin_comentarios = re.sub(r"--[^\n]*", " ", sql)
    return re.sub(r"\s+", " ", sin_comentarios).strip().lower()


def _firmas(sql: str) -> set[str]:
    """Qué DDL hay, sin mirar el texto.

    Se compara por firma y no palabra por palabra porque el .sql parte los literales
    largos en varias líneas (concatenación implícita de Postgres) y el módulo los
    escribe de otra forma. Lo que importa no es la prosa: es que no falte una
    sentencia. El bug que motiva este test fue exactamente ese — el módulo aplicaba
    los dos ADD COLUMN y se dejaba el índice y los dos COMMENT, y logueaba
    "aplicada" igual.
    """
    t = _normalizar(sql)
    firmas = set()
    for col in re.findall(r"add column if not exists (\w+)", t):
        firmas.add(f"columna:{col}")
    for obj in re.findall(r"comment on column ([\w.]+)", t):
        firmas.add(f"comentario:{obj}")
    # `unique` opcional: sin esto un CREATE UNIQUE INDEX no se reconocía como DDL y el
    # test daba por buena una migración que el módulo no estuviera aplicando — justo el
    # agujero que este archivo viene a tapar. Lo destapó la del 15/09.
    for idx in re.findall(r"create (?:unique )?index if not exists (\w+)", t):
        firmas.add(f"indice:{idx}")
    # Una migración puede crear una tabla entera y no tocar ninguna columna existente
    # (la de auditoría, 15/09). Sin esto el test la daba por "sin DDL reconocible" y
    # fallaba pidiendo un ADD COLUMN que esa migración no tiene por qué tener.
    for tabla in re.findall(r"create table if not exists (\w+)", t):
        firmas.add(f"tabla:{tabla}")
    return firmas


@pytest.mark.parametrize("nombre,sentencias", migraciones.MIGRACIONES)
def test_lo_que_se_aplica_solo_es_todo_el_sql(nombre, sentencias):
    """Que el módulo y el .sql no se separen.

    El .sql es la fuente —ahí vive el POR QUÉ— y el módulo es la copia que se aplica
    sola al levantar. Si se separan, producción queda distinta del archivo que la
    documenta y nadie se entera, porque el log dice "aplicada" lo mismo.
    """
    archivo = MIGRATIONS_DIR / f"{nombre}.sql"
    assert archivo.exists(), f"falta {archivo}: el .sql es la fuente, el módulo la copia"

    del_archivo = _firmas(archivo.read_text())
    del_modulo = _firmas(" ; ".join(sentencias))

    assert del_archivo, f"{archivo.name} no tiene DDL reconocible"
    assert del_modulo == del_archivo, (
        f"{archivo.name} declara {sorted(del_archivo)} y el módulo aplica "
        f"{sorted(del_modulo)}. Lo que se aplica solo tiene que ser TODO el .sql."
    )


def test_todo_el_ddl_es_idempotente():
    """Corre en cada arranque y con varias instancias a la vez."""
    for nombre, sentencias in migraciones.MIGRACIONES:
        for s in sentencias:
            bajo = s.lower()
            if "add column" in bajo:
                assert "if not exists" in bajo, f"{nombre}: ADD COLUMN sin IF NOT EXISTS"
            if "create index" in bajo:
                assert "if not exists" in bajo, f"{nombre}: CREATE INDEX sin IF NOT EXISTS"
            if "create table" in bajo:
                assert "if not exists" in bajo, f"{nombre}: CREATE TABLE sin IF NOT EXISTS"
            # COMMENT ON siempre se puede repetir, no necesita guarda.


def test_se_protege_del_lock_de_la_tabla_mas_caliente():
    """El ALTER toma ACCESS EXCLUSIVE sobre orden_trabajo y la cola de PG es FIFO.

    Sin lock_timeout, una instancia levantando en frío mientras el planificador lee
    puede dejar colgado el GET /ordenes de TODAS las instancias, porque las consultas
    nuevas se encolan detrás del ALTER que espera.
    """
    import inspect
    cuerpo = inspect.getsource(migraciones._aplicar_una)
    assert "lock_timeout" in cuerpo, "el ALTER puede encolar a toda la app detrás suyo"
    assert "wait_for" in inspect.getsource(migraciones.aplicar_migraciones), (
        "sin tope total, un arranque puede colgarse esperando a la base"
    )


@pytest.mark.asyncio
async def test_no_hace_nada_si_la_base_no_es_postgres():
    """SQLite (tests) y el SQL Server del rollback se saltean.

    OJO: se le inyecta un engine a propósito. El `engine` del módulo es el de
    PRODUCCIÓN —se arma al importar db.py— así que llamar a aplicar_migraciones()
    pelado desde un test le corre el ALTER a Supabase. Este test se escribió primero
    sin el motor y se descubrió justo así.
    """
    from sqlalchemy.ext.asyncio import create_async_engine
    falso = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        await migraciones.aplicar_migraciones(motor=falso)  # no levanta, no toca nada
    finally:
        await falso.dispose()
