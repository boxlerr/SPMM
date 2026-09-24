"""Las migraciones que se aplican solas al levantar.

El módulo `infrastructure/migraciones.py` es el único pedazo de código cuyo trabajo
es que un deploy a mano no rompa el arranque, y era el único sin un test que lo
tocara: ningún test dispara el `startup_event` (los que usan httpx.ASGITransport no
emiten eventos de lifespan, y los otros se arman su propia app), así que un error de
tipeo en el DDL no lo veía nadie hasta el primer arranque en frío en producción,
donde el único rastro es un logger.warning.
"""
import asyncio
import os
import re
from pathlib import Path
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from sqlalchemy import text

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
    # Una migración que sólo agrega filas a un catálogo (la sección confidencial de
    # Ingresos, 23/09): cada fila por su primer valor, el código.
    for tabla, valores in re.findall(r"insert into (\w+) \([^)]*\) values (.*?) on conflict", t):
        for codigo in re.findall(r"\(\s*'([^']*)'", valores):
            firmas.add(f"fila:{tabla}:{codigo}")
    # La semilla de formato (24/09) va como INSERT … SELECT … FROM (VALUES …) AS v WHERE NOT
    # EXISTS, para no gastar la secuencia en cada arranque: mismas filas, otra forma. Sin
    # esto sus filas se dejarían de comparar sin que nada fallara.
    for tabla, valores in re.findall(
            r"insert into (\w+) \([^)]*\) select .*? from \(values (.*?) ?\) as \w+ ", t):
        for codigo in re.findall(r"\(\s*'([^']*)'", valores):
            firmas.add(f"fila:{tabla}:{codigo}")
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
    assert "wait_for" in inspect.getsource(migraciones._intentar), (
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



# ─────────────── reintentos, «ya estaba» y /health (24/09) ───────────────
#
# La migración de RF-11 hace ALTER TABLE orden_trabajo con lock_timeout de 3 s. Si otra
# conexión tiene un lock sobre la tabla al arrancar, antes se rendía con un WARNING y la
# instancia atendía SIN las columnas: como el modelo ya las nombra, todas las lecturas de
# OT daban 500 hasta reciclarla. Y con varias instancias a la vez, el CREATE TABLE que
# perdía la carrera en pg_type pedía «corré el .sql a mano» con la base en orden.

class _MotorPG:
    """Sólo lo que mira aplicar_migraciones antes de ejecutar: el dialecto."""
    class dialect:
        name = "postgresql"


@pytest.fixture
def sin_migraciones_reales(monkeypatch):
    """Dos migraciones de mentira y nada de base: _aplicar_una y _ya_aplicada se pisan
    en cada test. Y el estado de /health vuelve a vacío al terminar."""
    monkeypatch.setattr(migraciones, "MIGRACIONES", [("a", ["x"]), ("b", ["y"])])
    yield
    migraciones._PENDIENTES.clear()


async def test_si_pierde_la_carrera_por_el_lock_la_misma_instancia_reintenta(
        monkeypatch, sin_migraciones_reales, caplog):
    intentos = {"a": 0, "b": 0}

    async def aplicar(nombre, sentencias, motor=None):
        intentos[nombre] += 1
        if nombre == "a" and intentos["a"] == 1:
            raise RuntimeError("canceling statement due to lock timeout")

    async def ya_aplicada(sentencias, motor):
        return False

    monkeypatch.setattr(migraciones, "_aplicar_una", aplicar)
    monkeypatch.setattr(migraciones, "_ya_aplicada", ya_aplicada)
    faltan = await migraciones.aplicar_migraciones(motor=_MotorPG(), pausa_seg=0)

    assert faltan == []
    assert intentos == {"a": 2, "b": 1}
    assert migraciones.migraciones_pendientes() == []
    assert not [r for r in caplog.records if r.levelname == "ERROR"]
    assert not any("a mano" in r.getMessage() for r in caplog.records), (
        "un intento que se reintenta solo no tiene por qué pedir que se corra nada a mano"
    )


async def test_si_no_entra_nunca_avisa_fuerte_y_lo_sigue_intentando(
        monkeypatch, sin_migraciones_reales, caplog):
    intentos = {"a": 0, "b": 0}

    async def aplicar(nombre, sentencias, motor=None):
        intentos[nombre] += 1
        if nombre == "a" and intentos["a"] <= 4:  # arranque (1 + 2) y un reintento de fondo
            raise RuntimeError("canceling statement due to lock timeout")

    async def ya_aplicada(sentencias, motor):
        return False

    monkeypatch.setattr(migraciones, "_aplicar_una", aplicar)
    monkeypatch.setattr(migraciones, "_ya_aplicada", ya_aplicada)
    faltan = await migraciones.aplicar_migraciones(
        motor=_MotorPG(), pausa_seg=0, esperas=(0.01,), tope_seg=1)

    assert faltan == ["a"]
    assert migraciones.migraciones_pendientes() == ["a"]
    errores = [r.getMessage() for r in caplog.records if r.levelname == "ERROR"]
    assert errores and "backend/scripts/migrations/a.sql" in errores[0]

    # El arranque no se frenó; la tarea de fondo la termina aplicando.
    await asyncio.gather(*list(migraciones._TAREAS))
    assert intentos["a"] == 5
    assert migraciones.migraciones_pendientes() == []


async def test_si_la_aplico_otra_instancia_no_asusta(monkeypatch, sin_migraciones_reales,
                                                     caplog):
    async def aplicar(nombre, sentencias, motor=None):
        if nombre == "a":
            raise RuntimeError('duplicate key value violates unique constraint '
                               '"pg_type_typname_nsp_index"')

    async def ya_aplicada(sentencias, motor):
        return True

    monkeypatch.setattr(migraciones, "_aplicar_una", aplicar)
    monkeypatch.setattr(migraciones, "_ya_aplicada", ya_aplicada)
    assert await migraciones.aplicar_migraciones(motor=_MotorPG(), pausa_seg=0) == []
    assert not [r for r in caplog.records if r.levelno >= 30], (
        "otra instancia la aplicó: ni WARNING ni ERROR"
    )


def test_que_se_puede_verificar_en_el_catalogo():
    por_nombre = dict(migraciones.MIGRACIONES)
    rf11 = migraciones._que_crea(por_nombre["2026-09-23_estados_de_control_ot"])
    assert rf11 and {t for t, _, _ in rf11} == {"columna"} and len(rf11) == 7
    assert {r for _, r, _ in rf11} == {"orden_trabajo"}
    rf10 = migraciones._que_crea(por_nombre["2026-09-23_uso_y_mantenimiento_de_maquinas"])
    assert ("tabla", "maquina_mantenimiento_aviso", None) in rf10
    assert ("indice", "ux_mant_aviso_clave", None) in rf10
    # Las que cargan filas no se pueden dar por aplicadas mirando el catálogo.
    assert migraciones._que_crea(por_nombre["2026-09-22_permisos_por_rol_y_area"]) is None
    assert migraciones._que_crea(por_nombre["2026-09-23_seccion_ingresos_confidencial"]) is None
    # Ni un ALTER que hace otra cosa que agregar columnas.
    assert migraciones._que_crea(["ALTER TABLE t ADD COLUMN IF NOT EXISTS a INT, "
                                  "ADD CONSTRAINT c CHECK (a > 0)"]) is None


def test_la_semilla_de_un_catalogo_nuevo_se_verifica_por_su_tabla():
    """Hallazgo del 24/09: por los INSERT de la semilla de `formato`, la de materia prima no
    se podía dar nunca por aplicada, y un arranque que perdía la carrera por el lock de
    `pieza` dejaba /health en 503 con la base completa. Ahora la semilla de una tabla que
    crea la MISMA migración la cubre la tabla (misma transacción); todo lo demás se sigue
    mirando: las columnas nuevas de pieza y orden_trabajo_pieza, que son lo que tumba
    lecturas si falta."""
    mp = migraciones._que_crea(dict(migraciones.MIGRACIONES)["2026-09-23_materia_prima"])
    assert mp is not None
    assert ("tabla", "formato", None) in mp
    assert ("columna", "pieza", "origen") in mp and ("columna", "orden_trabajo_pieza", "reserva") in mp
    assert ("indice", "ux_canera_celda_vigente", None) in mp
    assert len([o for o in mp if o[0] == "columna"]) == 18 + 21  # pieza + orden_trabajo_pieza

    crea = "CREATE TABLE IF NOT EXISTS cat (id SERIAL PRIMARY KEY, nombre TEXT UNIQUE)"
    semilla = "INSERT INTO cat (nombre) VALUES ('A') ON CONFLICT (nombre) DO NOTHING"
    assert migraciones._que_crea([crea, semilla]) == [("tabla", "cat", None)]
    # En una tabla que ya estaba, que la tabla exista no dice nada de sus filas.
    assert migraciones._que_crea(["INSERT INTO otra (nombre) VALUES ('A') ON CONFLICT DO NOTHING"]) is None
    assert migraciones._que_crea([crea, semilla.replace("cat", "otra")]) is None
    # Ni un INSERT que puede fallar o pisar (sin DO NOTHING).
    assert migraciones._que_crea([crea, "INSERT INTO cat (nombre) VALUES ('A')"]) is None
    assert migraciones._que_crea([crea, "INSERT INTO cat (nombre) VALUES ('A') ON CONFLICT "
                                        "(nombre) DO UPDATE SET nombre = 'B'"]) is None


def _filas_de_la_semilla(sentencias) -> list[tuple[str, str, tuple[str, ...], int]]:
    """(nombre, iniciales, etiquetas, orden) de cada fila que siembran los INSERT INTO formato."""
    filas = []
    for s in sentencias:
        if not s.startswith("INSERT INTO formato"):
            continue
        for tupla in re.findall(r"\(('[^)]*), (\d+)\)", s):
            literales = re.findall(r"'([^']*)'", tupla[0])
            filas.append((literales[0], literales[1], tuple(literales[2:]), int(tupla[1])))
    return filas


def test_la_semilla_de_formato_es_la_de_semilla_py():
    """Lo que se aplica solo al arrancar siembra la misma lista que semilla.py: nombre,
    iniciales, etiquetas y orden (el de FORMATOS_SEMILLA). El .sql contra semilla.py lo
    mira test_materia_prima_reglas; el test de firmas de arriba sólo compara los nombres."""
    from backend.application.materia_prima.semilla import FORMATOS_SEMILLA

    filas = _filas_de_la_semilla(dict(migraciones.MIGRACIONES)["2026-09-23_materia_prima"])
    esperadas = [(n, i, e, orden) for orden, (n, i, e) in enumerate(FORMATOS_SEMILLA, start=1)]
    assert sorted(filas, key=lambda f: f[3]) == esperadas


def test_la_semilla_no_gasta_la_secuencia_en_cada_arranque():
    """Con sólo ON CONFLICT DO NOTHING, Postgres pide el id a la secuencia antes de ver el
    choque: cada arranque le sumaba 15 a formato_id_seq. El WHERE NOT EXISTS filtra antes."""
    for s in dict(migraciones.MIGRACIONES)["2026-09-23_materia_prima"]:
        if s.startswith("INSERT INTO formato"):
            assert "WHERE NOT EXISTS (SELECT 1 FROM formato f WHERE f.nombre = v.nombre)" in s, s
            assert s.endswith("ON CONFLICT (nombre) DO NOTHING"), "dos instancias a la vez"


def test_health_da_503_con_una_migracion_sin_aplicar(sin_migraciones_reales):
    from fastapi.testclient import TestClient
    from backend.presentation.main import app

    cliente = TestClient(app)  # sin `with`: no dispara el startup
    assert cliente.get("/health").status_code == 200

    migraciones._PENDIENTES[:] = ["2026-09-23_estados_de_control_ot"]
    r = cliente.get("/health")
    assert r.status_code == 503
    cuerpo = r.json()
    assert cuerpo["migraciones_pendientes"] == ["2026-09-23_estados_de_control_ot"]
    assert cuerpo["correr_a_mano"] == [
        "backend/scripts/migrations/2026-09-23_estados_de_control_ot.sql"]


# ─────────────── lo mismo contra un Postgres de verdad (descartable) ───────────────
#
# SQLite no tiene locks de tabla ni pg_type: esto sólo corre con SPMM_PG_PRUEBAS
# apuntando a un Postgres LOCAL descartable (le borra el esquema public).

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


pg = pytest.mark.skipif(not (PG_URL and _pg_seguro(PG_URL)),
                        reason="sin SPMM_PG_PRUEBAS local")


@pytest_asyncio.fixture
async def motor_pg():
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool
    from backend.infrastructure.db import Base
    from backend.tests.conftest import TEST_TABLES

    motor = create_async_engine(PG_URL, poolclass=NullPool)
    async with motor.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TEST_TABLES))
        for col in ("controlado", "finalizado_para_pintar", "finalizado_tercerizacion_intermedia",
                    "finalizado_tercerizacion_final", "cantidad_finalizada_parcial",
                    "controlado_en", "controlado_por"):
            await conn.execute(text(f"ALTER TABLE orden_trabajo DROP COLUMN IF EXISTS {col}"))
    yield motor
    migraciones._PENDIENTES.clear()
    await motor.dispose()


async def _columnas_rf11(motor) -> int:
    async with motor.connect() as conn:
        return await conn.scalar(text(
            "SELECT count(*) FROM information_schema.columns WHERE table_name = 'orden_trabajo' "
            "AND column_name IN ('controlado', 'cantidad_finalizada_parcial', 'controlado_por')"))


@pg
async def test_pg_una_lectura_abierta_sobre_orden_trabajo_no_deja_la_instancia_sin_columnas(
        motor_pg, monkeypatch):
    """El caso del hallazgo: un SELECT en una transacción abierta (el sync, el
    planificador) tiene ACCESS SHARE sobre orden_trabajo cuando la instancia arranca.
    El primer intento se rinde a los 3 s; cuando la lectura termina, el reintento entra."""
    monkeypatch.setattr(migraciones, "MIGRACIONES",
                        [m for m in migraciones.MIGRACIONES
                         if m[0] == "2026-09-23_estados_de_control_ot"])
    lector = await motor_pg.connect()
    tx = await lector.begin()
    await lector.execute(text("SELECT count(*) FROM orden_trabajo"))

    async def suelta_la_lectura():
        await asyncio.sleep(4)  # después del primer lock_timeout de 3 s
        await tx.commit()
        await lector.close()

    soltar = asyncio.create_task(suelta_la_lectura())
    faltan = await migraciones.aplicar_migraciones(motor=motor_pg, pausa_seg=1,
                                                   segundo_plano=False)
    await soltar
    assert faltan == []
    assert await _columnas_rf11(motor_pg) == 3


@pg
async def test_pg_con_el_lock_tomado_todo_el_arranque_503_y_despues_entra(motor_pg, monkeypatch):
    monkeypatch.setattr(migraciones, "MIGRACIONES",
                        [m for m in migraciones.MIGRACIONES
                         if m[0] == "2026-09-23_estados_de_control_ot"])
    monkeypatch.setattr(migraciones, "LOCK_TIMEOUT", "200ms")
    lector = await motor_pg.connect()
    tx = await lector.begin()
    await lector.execute(text("SELECT count(*) FROM orden_trabajo"))
    try:
        faltan = await migraciones.aplicar_migraciones(
            motor=motor_pg, pausa_seg=0, esperas=(0.5,), tope_seg=30)
        assert faltan == ["2026-09-23_estados_de_control_ot"]
        assert migraciones.migraciones_pendientes() == faltan
        assert await _columnas_rf11(motor_pg) == 0
    finally:
        await tx.commit()
        await lector.close()
    await asyncio.gather(*list(migraciones._TAREAS))
    assert migraciones.migraciones_pendientes() == []
    assert await _columnas_rf11(motor_pg) == 3


@pg
async def test_pg_dos_instancias_a_la_vez_no_piden_correr_nada_a_mano(motor_pg, monkeypatch,
                                                                       caplog):
    """Dos CREATE TABLE IF NOT EXISTS concurrentes: el que pierde choca en pg_type. Se
    fuerza el choque con dos transacciones: la primera crea y no confirma todavía."""
    nombre = "2026-09-23_reportes_guardados"
    sentencias = dict(migraciones.MIGRACIONES)[nombre]
    monkeypatch.setattr(migraciones, "MIGRACIONES", [(nombre, sentencias)])

    otra = await motor_pg.connect()
    tx = await otra.begin()
    for s in sentencias:
        await otra.execute(text(s))

    async def confirma_la_otra():
        await asyncio.sleep(0.5)
        await tx.commit()
        await otra.close()

    confirmar = asyncio.create_task(confirma_la_otra())
    faltan = await migraciones.aplicar_migraciones(motor=motor_pg, pausa_seg=0,
                                                   segundo_plano=False)
    await confirmar
    assert faltan == []
    assert not [r for r in caplog.records if r.levelno >= 30], [
        r.getMessage() for r in caplog.records if r.levelno >= 30]


def _solo_materia_prima(monkeypatch):
    monkeypatch.setattr(migraciones, "MIGRACIONES",
                        [m for m in migraciones.MIGRACIONES if m[0] == "2026-09-23_materia_prima"])


@pg
async def test_pg_materia_prima_ya_aplicada_con_una_lectura_larga_no_da_503(motor_pg, monkeypatch,
                                                                          caplog):
    """El hallazgo del 24/09, en chico: con la migración ya aplicada, una lectura abierta
    sobre `pieza` (el espejo, el planificador) le gana el lock a cada intento del ALTER.
    Antes eso terminaba en «SIN aplicar» y /health 503; ahora el primer choque mira el
    catálogo, ve que está todo y no hay nada pendiente."""
    _solo_materia_prima(monkeypatch)
    assert await migraciones.aplicar_migraciones(motor=motor_pg, segundo_plano=False) == []
    monkeypatch.setattr(migraciones, "LOCK_TIMEOUT", "200ms")
    lector = await motor_pg.connect()
    tx = await lector.begin()
    await lector.execute(text("SELECT count(*) FROM pieza"))
    try:
        faltan = await migraciones.aplicar_migraciones(motor=motor_pg, pausa_seg=0,
                                                       segundo_plano=False)
    finally:
        await tx.commit()
        await lector.close()
    assert faltan == [] and migraciones.migraciones_pendientes() == []
    assert not [r for r in caplog.records if r.levelno >= 30], [
        r.getMessage() for r in caplog.records if r.levelno >= 30]
    assert any("ya estaba aplicada" in r.getMessage() for r in caplog.records)


@pg
async def test_pg_la_semilla_no_gasta_la_secuencia_en_cada_arranque(motor_pg, monkeypatch):
    _solo_materia_prima(monkeypatch)

    async def secuencia_y_filas():
        async with motor_pg.connect() as conn:
            return (await conn.scalar(text("SELECT last_value FROM formato_id_seq")),
                    await conn.scalar(text("SELECT count(*) FROM formato")))

    assert await migraciones.aplicar_migraciones(motor=motor_pg, segundo_plano=False) == []
    primera = await secuencia_y_filas()
    assert primera[1] == 15
    for _ in range(3):  # tres arranques más
        assert await migraciones.aplicar_migraciones(motor=motor_pg, segundo_plano=False) == []
    assert await secuencia_y_filas() == primera
