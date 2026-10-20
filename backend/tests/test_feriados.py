"""Los feriados de Argentina: se traen solos y el taller elige si trabaja cada uno.

Ningún test sale a internet: la fuente se pisa con una función que devuelve lo que
haga falta. La base es SQLite en memoria con las dos tablas del calendario.
"""
from datetime import date

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool

from backend.core.security import get_current_user
from backend.infrastructure import FeriadoRepository as modulo
from backend.infrastructure.DiaBloqueadoRepository import DiaBloqueadoRepository, feriados_sin_romper
from backend.infrastructure.FeriadoRepository import FeriadoRepository, bloquea, validar_fuente
from backend.presentation import ConfigAPI

OCTUBRE = [
    {"fecha": date(2026, 10, 12), "tipo": "trasladable", "nombre": "Día del Respeto a la Diversidad Cultural"},
    {"fecha": date(2026, 11, 23), "tipo": "trasladable", "nombre": "Día de la Soberanía Nacional (20/11)"},
    {"fecha": date(2026, 12, 7), "tipo": "puente", "nombre": "Puente turístico no laborable"},
    {"fecha": date(2026, 12, 8), "tipo": "inamovible", "nombre": "Inmaculada Concepción de María"},
]


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})
    async with engine.begin() as c:
        await c.execute(text("CREATE TABLE dia_bloqueado (fecha DATE PRIMARY KEY, creado_en TIMESTAMP)"))
        await c.execute(text(
            "CREATE TABLE feriado (fecha DATE PRIMARY KEY, nombre VARCHAR(200) NOT NULL, "
            "tipo VARCHAR(20) NOT NULL, se_trabaja BOOLEAN, decidido_por VARCHAR(120), "
            "decidido_en TIMESTAMP, traido_en TIMESTAMP NOT NULL)"))
    async with AsyncSession(engine, expire_on_commit=False) as s:
        yield s
    await engine.dispose()
    modulo._FALLO.clear()
    modulo._SIN_PUBLICAR.clear()


def fuente(*listas):
    """Una fuente falsa: cada llamada devuelve la lista siguiente (la última se repite)."""
    llamadas = []

    def leer(anio):
        llamadas.append(anio)
        return [dict(f) for f in listas[min(len(llamadas), len(listas)) - 1]] if anio == 2026 else []
    leer.llamadas = llamadas
    return leer


def test_la_regla_de_que_bloquea():
    assert bloquea("inamovible", None) is True
    assert bloquea("trasladable", None) is True
    # Un día no laborable es optativo para el empleador: sin elegir, se trabaja.
    assert bloquea("puente", None) is False
    assert bloquea("puente", False) is True
    assert bloquea("inamovible", True) is False


async def test_el_planificador_saltea_los_feriados_pero_no_los_puentes(db):
    await FeriadoRepository(db, fuente(OCTUBRE)).traer_anio(2026)
    await db.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES ('2026-10-20')"))
    await db.commit()

    bloqueados = await DiaBloqueadoRepository(db).listar()
    assert bloqueados == ["2026-10-12", "2026-10-20", "2026-11-23", "2026-12-08"]
    assert [d.isoformat() for d in await feriados_sin_romper(db)] == bloqueados


async def test_volver_a_traer_no_pisa_lo_que_eligio_el_taller(db):
    repo = FeriadoRepository(db, fuente(OCTUBRE, OCTUBRE[1:]))
    await repo.traer_anio(2026)
    await repo.elegir(date(2026, 10, 12), True, "Lucas")
    await repo.elegir(date(2026, 12, 7), False, "Lucas")

    # La fuente ya no trae el 12/10: igual queda, porque el taller lo eligió.
    await repo.traer_anio(2026)
    por_fecha = {f["fecha"]: f for f in await repo.listar()}
    assert por_fecha["2026-10-12"]["se_trabaja"] is True
    assert por_fecha["2026-10-12"]["decidido_por"] == "Lucas"
    assert por_fecha["2026-12-07"]["bloquea"] is True
    assert "2026-10-12" not in await DiaBloqueadoRepository(db).listar()
    assert "2026-12-07" in await DiaBloqueadoRepository(db).listar()


async def test_lo_que_la_fuente_ya_no_trae_se_borra_si_nadie_lo_eligio(db):
    repo = FeriadoRepository(db, fuente(OCTUBRE, OCTUBRE[1:]))
    await repo.traer_anio(2026)
    await repo.traer_anio(2026)
    assert "2026-10-12" not in [f["fecha"] for f in await repo.listar()]


async def test_un_anio_sin_publicar_no_borra_nada(db):
    repo = FeriadoRepository(db, fuente(OCTUBRE, []))
    await repo.traer_anio(2026)
    assert await repo.traer_anio(2026) == 0
    assert len(await repo.listar()) == 4


async def test_bloquear_o_desbloquear_un_feriado_guarda_la_eleccion(db):
    await FeriadoRepository(db, fuente(OCTUBRE)).traer_anio(2026)
    dias = DiaBloqueadoRepository(db)

    await dias.quitar("2026-10-12", "Julián")
    await dias.agregar("2026-12-07", "Julián")
    assert (await db.scalar(text("SELECT COUNT(*) FROM dia_bloqueado"))) == 0
    bloqueados = await dias.listar()
    assert "2026-10-12" not in bloqueados
    assert "2026-12-07" in bloqueados

    # Un día que no es feriado sigue yendo a dia_bloqueado, como siempre.
    await dias.agregar("2026-10-21")
    assert "2026-10-21" in await dias.listar()


async def test_si_la_fuente_no_contesta_sigue_y_no_insiste(db):
    llamadas = []

    def caida(anio):
        llamadas.append(anio)
        raise OSError("sin internet")

    repo = FeriadoRepository(db, caida)
    await repo.asegurar_anios([2026])
    await repo.asegurar_anios([2026])
    assert llamadas == [2026]
    assert await FeriadoRepository(db).listar() == []


async def test_no_vuelve_a_pedir_un_anio_traido_hace_poco(db):
    leer = fuente(OCTUBRE)
    repo = FeriadoRepository(db, leer)
    await repo.asegurar_anios([2026])
    await repo.asegurar_anios([2026])
    assert leer.llamadas == [2026]


async def test_un_anio_sin_publicar_no_se_pide_en_cada_pedido(db):
    """El año que viene todavía no tiene feriados (pasa todo octubre): la fuente contesta
    lista vacía, no queda ninguna fila, y antes cada GET /config/availability volvía a
    salir a internet a preguntar. Ahora se pregunta de nuevo recién a la hora."""
    leer = fuente(OCTUBRE)
    repo = FeriadoRepository(db, leer)
    await repo.asegurar_anios([2027])
    await repo.asegurar_anios([2027])
    await repo.asegurar_anios([2027])
    assert leer.llamadas == [2027]
    # Pasada la hora, se vuelve a preguntar (por si ya lo publicaron).
    modulo._SIN_PUBLICAR[2027] -= modulo.REINTENTO_SEG + 1
    await repo.asegurar_anios([2027])
    assert leer.llamadas == [2027, 2027]


async def test_sin_la_tabla_el_planificador_mira_solo_dia_bloqueado():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as c:
        await c.execute(text("CREATE TABLE dia_bloqueado (fecha DATE PRIMARY KEY, creado_en TIMESTAMP)"))
        await c.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES ('2026-10-20')"))
    async with AsyncSession(engine) as s:
        assert await DiaBloqueadoRepository(s).listar() == ["2026-10-20"]
        assert await feriados_sin_romper(s) == [date(2026, 10, 20)]
    await engine.dispose()


def test_la_fuente_se_valida():
    datos = [
        {"fecha": "2026-04-02", "tipo": "inamovible", "nombre": "Malvinas"},
        {"fecha": "2026-04-02", "tipo": "puente", "nombre": "Otra cosa"},
        {"fecha": "2026-12-25", "tipo": "Inamovible", "nombre": "Navidad"},
    ]
    filas = validar_fuente(datos, 2026)
    assert filas == [
        {"fecha": date(2026, 4, 2), "tipo": "inamovible", "nombre": "Malvinas / Otra cosa"},
        {"fecha": date(2026, 12, 25), "tipo": "inamovible", "nombre": "Navidad"},
    ]
    with pytest.raises(ValueError):
        validar_fuente([{"fecha": "2027-01-01", "tipo": "inamovible", "nombre": "x"}], 2026)
    with pytest.raises(ValueError):
        validar_fuente([{"fecha": "2026-01-01", "tipo": "regional", "nombre": "x"}], 2026)
    with pytest.raises(ValueError):
        validar_fuente({"error": "no"}, 2026)


async def test_la_pantalla_lista_y_elige(db, monkeypatch):
    monkeypatch.setattr(modulo, "leer_fuente", fuente(OCTUBRE))
    monkeypatch.setattr(FeriadoRepository.__init__, "__defaults__", (modulo.leer_fuente,))
    await db.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES ('2026-10-12')"))
    await db.commit()

    app = FastAPI()
    app.include_router(ConfigAPI.router)

    async def _db():
        yield db
    app.dependency_overrides[ConfigAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: {"username": "lucas", "nombre": "Lucas", "apellido": "P"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/config/feriados", params={"desde": "2026-10-01", "hasta": "2026-12-31"})
        assert r.status_code == 200
        assert [f["fecha"] for f in r.json()["feriados"]] == ["2026-10-12", "2026-11-23", "2026-12-07", "2026-12-08"]

        # Se trabaja el 12/10, aunque alguien lo hubiera bloqueado a mano.
        r = await c.put("/config/feriados/2026-10-12", json={"se_trabaja": True})
        assert r.status_code == 200
        assert r.json()["feriado"]["decidido_por"] == "Lucas P"
        assert "2026-10-12" not in r.json()["blocked_dates"]

        # Volver a lo de siempre: el feriado bloquea otra vez.
        r = await c.put("/config/feriados/2026-10-12", json={"se_trabaja": None})
        assert "2026-10-12" in r.json()["blocked_dates"]

        r = await c.put("/config/feriados/2026-10-13", json={"se_trabaja": True})
        assert r.status_code == 404
