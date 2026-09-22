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


def _literal_sql(sql: str, i: int) -> tuple[str, int]:
    """Lee el literal que arranca en `sql[i]` como lo lee Postgres: (texto, fin).

    Dos reglas de Postgres que el test de firmas no mira y que acá importan:
    `''` adentro de un literal es UNA comilla escapada, y dos literales seguidos se
    pegan sólo si entre ellos hay un salto de línea. Sin salto (`'a' 'b'`) es un
    error de sintaxis, y pegados (`'a''b'`) son un solo literal con una comilla en
    el medio.
    """
    partes = []
    while True:
        assert sql[i] == "'", f"se esperaba un literal y hay: {sql[i:i + 40]!r}"
        i += 1
        while True:
            j = sql.index("'", i)
            partes.append(sql[i:j])
            if sql[j + 1:j + 2] == "'":
                partes.append("'")
                i = j + 2
                continue
            i = j + 1
            break
        sigue = re.match(r"[ \t]*\n\s*'", sql[i:])
        if not sigue:
            return "".join(partes), i
        i += sigue.end() - 1


def _comentarios(sql: str) -> dict[str, str]:
    """{objeto: texto} de cada COMMENT ON, con el texto que queda en la base."""
    sin_notas = re.sub(r"(?m)^\s*--[^\n]*", "", sql)
    textos = {}
    for m in re.finditer(r"comment on (?:column|table) ([\w.]+) is\s*", sin_notas, re.I):
        texto, fin = _literal_sql(sin_notas, m.end())
        resto = sin_notas[fin:].lstrip()
        assert resto == "" or resto.startswith(";"), (
            f"el COMMENT de {m.group(1)} no termina en un literal: sigue {resto[:60]!r}"
        )
        textos[m.group(1)] = texto
    return textos


# Ya corrieron en Supabase con el defecto de abajo y se dejaron como están a
# propósito: corregirlas acá reescribe su COMMENT en producción en el próximo
# deploy (sólo el texto, ninguna fila), y eso se decide aparte. `strict=True` hace
# que el día que alguien las arregle el test avise que hay que sacarlas de esta lista.
COMMENT_CON_COMILLAS_CONOCIDO = {
    "2026-09-11_no_lleva_materia_prima",
    "2026-09-11_inicio_base_del_plan",
    "2026-09-15_proceso_no_lleva_maquina",
}

# El módulo escribió a propósito una versión resumida del .sql: prosa distinta, no
# este defecto. En esas sólo se cuentan las comillas.
COMMENT_RESUMIDO_A_PROPOSITO = {"2026-09-11_modificado_en_ot"}


def _casos_de_comment():
    for nombre, sentencias in migraciones.MIGRACIONES:
        marcas = []
        if nombre in COMMENT_CON_COMILLAS_CONOCIDO:
            marcas.append(pytest.mark.xfail(
                strict=True,
                reason="ya corrió en producción así; corregirla reescribe el COMMENT",
            ))
        yield pytest.param(nombre, sentencias, id=nombre, marks=marcas)


@pytest.mark.parametrize("nombre,sentencias", list(_casos_de_comment()))
def test_cada_comment_es_un_solo_literal(nombre, sentencias):
    """Que la documentación que queda en la base diga lo que dice el .sql.

    En Python un COMMENT largo va partido en varias strings. Si cada trozo abre y
    cierra su comilla, Python los pega en `...ninguna ''(altas...` y Postgres lee
    el `''` como una comilla escapada: no falla, el log dice "aplicada" y el
    comentario queda con apóstrofos sueltos. Pasó en cinco migraciones hasta el
    22/09 y el test de firmas no lo veía porque no mira la prosa.
    """
    del_archivo = _comentarios((MIGRATIONS_DIR / f"{nombre}.sql").read_text())
    for s in sentencias:
        if not s.lstrip().lower().startswith("comment on"):
            continue
        for objeto, texto in _comentarios(s).items():
            esperado = del_archivo.get(objeto)
            assert esperado is not None, f"{nombre}: el .sql no comenta {objeto}"
            sueltas = texto.count("'") - esperado.count("'")
            assert sueltas == 0, (
                f"{nombre}: el COMMENT de {objeto} queda en la base con {sueltas} "
                f"comilla(s) de más: «{texto}». Partido en varias strings de Python, "
                f"la comilla simple va sólo al principio de la primera y al final de "
                f"la última."
            )
            if nombre in COMMENT_RESUMIDO_A_PROPOSITO:
                continue
            assert " ".join(texto.split()) == " ".join(esperado.split()), (
                f"{nombre}: el COMMENT de {objeto} que se aplica solo dice otra cosa "
                f"que el .sql.\n  módulo: «{texto}»\n  .sql:   «{esperado}»"
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
