"""Tipo, estado operativo y frecuencia de mantenimiento de cada máquina (RF-08).

El SRS pide registrar de cada máquina «nombre, tipo, capacidad, estado operativo y
frecuencia de mantenimiento». Lo que persigue este archivo no es que el POST conteste
200, sino las formas concretas en que ese registro deja de servir:

  1. **El PUT que dice que guardó y no guardó.** El repositorio filtraba el update
     contra un set de nombres escrito a mano; una columna que no estaba ahí se
     descartaba en silencio: PUT 200, sin error, sin log, y el dato no estaba. Por eso
     los tests de edición van siempre PUT → GET, nunca sólo el PUT.
  2. **Un front viejo borrando lo que cargó el nuevo.** El front se publica solo y el
     backend se deploya a mano: durante un rato conviven. Un front que no conoce estos
     campos tiene que poder editar el nombre sin pisarle el estado a la máquina.
  3. **Valores sueltos.** Tipo y estado son listas cerradas: un «Torno » o un
     «rota» guardados tal cual serían categorías nuevas que nadie ve en los filtros.
  4. **El front y el back ofreciendo listas distintas.** El formulario ofrece un tipo
     que el backend rechaza con 422, o al revés.

Todo por la API de verdad (router + handlers de la app) sobre el SQLite del conftest.
"""
import inspect
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from backend.application import PlanificacionService as PS
from backend.application.MaquinariaService import (
    ESTADOS_OPERATIVOS,
    TIPOS_MAQUINA,
)
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.domain.Maquinaria import Maquinaria
from backend.infrastructure import migraciones
from backend.presentation import MaquinariaAPI

RAIZ = Path(__file__).resolve().parents[2]
OPCIONES_FRONT = RAIZ / "frontend" / "src" / "app" / "recursos" / "_maquinaOpciones.ts"


def _app(session) -> FastAPI:
    """El router de máquinas con los handlers de la app, contra la base del test.

    Se pisa el `get_db` del propio módulo: el de fábrica abre el SessionLocal de
    PRODUCCIÓN. Ninguna ruta de este archivo puede llegar a Supabase.
    """
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(MaquinariaAPI.router)

    async def _db():
        yield session

    app.dependency_overrides[MaquinariaAPI.get_db] = _db
    return app


async def _cliente(session):
    return AsyncClient(transport=ASGITransport(app=_app(session)), base_url="http://t")


async def _una(c, id_maquina) -> dict:
    r = await c.get(f"/maquinarias/{id_maquina}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _de_la_lista(c, id_maquina) -> dict:
    r = await c.get("/maquinarias")
    assert r.status_code == 200, r.text
    return next(m for m in r.json()["data"] if m["id"] == id_maquina)


async def _maquina_vieja(session, nombre="TORNO 1") -> int:
    """Una máquina como las 31 que ya estaban: cargada sin ninguno de los campos nuevos."""
    await session.execute(
        text("INSERT INTO maquinaria (nombre, cod_maquina, capacidad) VALUES (:n, 'TORY-1', NULL)"),
        {"n": nombre},
    )
    await session.commit()
    return (await session.execute(select(Maquinaria.id).where(Maquinaria.nombre == nombre))).scalar_one()


# ─────────────────────────── 1. el PUT tiene que guardar ───────────────────────────

@pytest.mark.asyncio
async def test_el_put_guarda_los_campos_nuevos_y_el_get_los_devuelve(session):
    """El agujero del set escrito a mano: PUT 200 y el dato no estaba."""
    id_m = await _maquina_vieja(session)

    async with await _cliente(session) as c:
        r = await c.put(f"/maquinarias/{id_m}", json={
            "nombre": "TORNO 1",
            "tipo": "TORNO",
            "estado_operativo": "en_mantenimiento",
            "frecuencia_mantenimiento_dias": 90,
            "capacidad": "Volteo 400 mm",
        })
        assert r.status_code == 200, r.text
        assert r.json()["status"] is True

        for leida in (await _una(c, id_m), await _de_la_lista(c, id_m)):
            assert leida["tipo"] == "TORNO"
            assert leida["estado_operativo"] == "en_mantenimiento"
            assert leida["frecuencia_mantenimiento_dias"] == 90
            assert leida["capacidad"] == "Volteo 400 mm"

    # Y en la base, no sólo en lo que devuelve la API.
    session.expire_all()
    fila = await session.get(Maquinaria, id_m)
    assert (fila.tipo, fila.estado_operativo, fila.frecuencia_mantenimiento_dias) == (
        "TORNO", "en_mantenimiento", 90)


@pytest.mark.asyncio
async def test_el_put_devuelve_la_maquina_como_quedo(session):
    """El front la usa para dejar la fila como quedó sin volver a pedir la lista."""
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        r = await c.put(f"/maquinarias/{id_m}", json={"nombre": "TORNO 1", "tipo": "torno"})
    data = r.json()["data"]
    assert data["id"] == id_m                 # lo único que leía el front viejo
    assert data["tipo"] == "TORNO"            # ya normalizado
    assert data["estado_operativo"] == "operativa"


@pytest.mark.asyncio
async def test_se_puede_vaciar_la_frecuencia_y_el_tipo(session):
    """Para esos dos, null SÍ es un valor: «ya no se le lleva», «no sé qué tipo es»."""
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        await c.put(f"/maquinarias/{id_m}", json={
            "nombre": "TORNO 1", "tipo": "TORNO", "frecuencia_mantenimiento_dias": 30})
        r = await c.put(f"/maquinarias/{id_m}", json={
            "nombre": "TORNO 1", "tipo": None, "frecuencia_mantenimiento_dias": None})
        assert r.status_code == 200, r.text
        leida = await _una(c, id_m)
    assert leida["tipo"] is None
    assert leida["frecuencia_mantenimiento_dias"] is None


@pytest.mark.asyncio
async def test_estado_null_no_lo_vacia_ni_revienta(session):
    """La columna es NOT NULL: guardar el null era un 500. Se lee como «no lo cambio»."""
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        await c.put(f"/maquinarias/{id_m}", json={
            "nombre": "TORNO 1", "estado_operativo": "fuera_de_servicio"})
        r = await c.put(f"/maquinarias/{id_m}", json={
            "nombre": "TORNO 1", "estado_operativo": None})
        assert r.status_code == 200, r.text
        assert (await _una(c, id_m))["estado_operativo"] == "fuera_de_servicio"


# ─────────────────────────── 2. convivir con el front viejo ───────────────────────────

@pytest.mark.asyncio
async def test_las_maquinas_que_ya_estaban_quedan_operativas_y_sin_inventar_nada(session):
    """El DEFAULT de la migración, reproducido en el modelo (server_default).

    Se inserta por SQL crudo, sin nombrar las columnas nuevas, que es exactamente lo que
    les pasa a las 31 filas de producción cuando corre el ALTER.
    """
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        leida = await _una(c, id_m)
    assert leida["estado_operativo"] == "operativa"
    # Nada deducido del nombre, aunque «TORNO 1» lo haría fácil.
    assert leida["tipo"] is None
    assert leida["frecuencia_mantenimiento_dias"] is None


@pytest.mark.asyncio
async def test_el_front_viejo_edita_sin_pisar_lo_que_cargo_el_nuevo(session):
    """El payload exacto del MaquinaForm anterior al 22/09: cinco campos, ninguno nuevo."""
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        await c.put(f"/maquinarias/{id_m}", json={
            "nombre": "TORNO 1", "tipo": "TORNO",
            "estado_operativo": "en_mantenimiento", "frecuencia_mantenimiento_dias": 60})

        r = await c.put(f"/maquinarias/{id_m}", json={
            "nombre": "TORNO 1 (grande)", "cod_maquina": "TORY-1", "limitacion": None,
            "capacidad": None, "especialidad": None})
        assert r.status_code == 200, r.text
        leida = await _una(c, id_m)

    assert leida["nombre"] == "TORNO 1 (grande)"
    assert leida["tipo"] == "TORNO"
    assert leida["estado_operativo"] == "en_mantenimiento"
    assert leida["frecuencia_mantenimiento_dias"] == 60


@pytest.mark.asyncio
async def test_el_front_viejo_crea_y_la_maquina_nace_operativa(session):
    async with await _cliente(session) as c:
        r = await c.post("/maquinarias", json={
            "nombre": "PLEGADORA 2", "cod_maquina": "PLE-2", "limitacion": None,
            "capacidad": None, "especialidad": None})
        assert r.status_code == 200, r.text
        id_m = r.json()["data"]["id"]
        leida = await _una(c, id_m)
    assert leida["estado_operativo"] == "operativa"
    assert leida["tipo"] is None


@pytest.mark.asyncio
async def test_el_alta_con_todo_lo_del_rf(session):
    async with await _cliente(session) as c:
        r = await c.post("/maquinarias", json={
            "nombre": "FRESADORA CNC", "cod_maquina": "FCNCY-1",
            "tipo": "Fresadora", "estado_operativo": "Fuera de servicio",
            "capacidad": "Mesa 1000 x 500", "frecuencia_mantenimiento_dias": 180})
        assert r.status_code == 200, r.text
        creada = r.json()["data"]
        assert creada["estado_operativo"] == "fuera_de_servicio"
        leida = await _de_la_lista(c, creada["id"])
    assert leida["tipo"] == "FRESADORA"
    assert leida["estado_operativo"] == "fuera_de_servicio"
    assert leida["capacidad"] == "Mesa 1000 x 500"
    assert leida["frecuencia_mantenimiento_dias"] == 180


# ─────────────────────────── 3. listas cerradas ───────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("cuerpo,palabra", [
    ({"estado_operativo": "rota"}, "estado"),
    ({"tipo": "TORNITO"}, "tipo"),
    ({"frecuencia_mantenimiento_dias": 0}, "frecuencia"),
    ({"frecuencia_mantenimiento_dias": -30}, "frecuencia"),
    ({"frecuencia_mantenimiento_dias": 36500}, "frecuencia"),
])
async def test_un_valor_fuera_de_la_lista_es_422_y_no_toca_nada(session, cuerpo, palabra):
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        r = await c.put(f"/maquinarias/{id_m}", json={"nombre": "OTRO NOMBRE", **cuerpo})
        assert r.status_code == 422, r.text
        # El motivo llega legible a `parseApiError` del front (errors[0].message).
        assert palabra in r.json()["errors"][0]["message"].lower()

        leida = await _una(c, id_m)
    # Ni el campo malo ni los otros del mismo pedido: o se guarda todo o nada.
    assert leida["nombre"] == "TORNO 1"
    assert leida["estado_operativo"] == "operativa"
    assert leida["tipo"] is None


@pytest.mark.asyncio
async def test_el_alta_con_un_estado_inventado_es_422(session):
    async with await _cliente(session) as c:
        r = await c.post("/maquinarias", json={"nombre": "X", "estado_operativo": "rota"})
    assert r.status_code == 422, r.text
    assert (await session.execute(select(Maquinaria))).scalars().all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("escrito,guardado", [
    ("En mantenimiento", "en_mantenimiento"),
    ("  FUERA DE SERVICIO ", "fuera_de_servicio"),
    ("operativa", "operativa"),
])
async def test_el_estado_se_normaliza(session, escrito, guardado):
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        await c.put(f"/maquinarias/{id_m}", json={"nombre": "TORNO 1", "estado_operativo": escrito})
        assert (await _una(c, id_m))["estado_operativo"] == guardado


@pytest.mark.asyncio
@pytest.mark.parametrize("escrito,guardado", [
    ("torno", "TORNO"),
    (" Sierra circular ", "SIERRA_CIRCULAR"),
    ("soldadora_tig", "SOLDADORA_TIG"),
    ("", None),
])
async def test_el_tipo_se_normaliza(session, escrito, guardado):
    id_m = await _maquina_vieja(session)
    async with await _cliente(session) as c:
        await c.put(f"/maquinarias/{id_m}", json={"nombre": "TORNO 1", "tipo": escrito})
        assert (await _una(c, id_m))["tipo"] == guardado


# ─────────────────────────── 4. el front y el back, la misma lista ───────────────────────────

def _valores_del_front(constante: str) -> list[str]:
    fuente = OPCIONES_FRONT.read_text(encoding="utf-8")
    bloque = re.search(rf"export const {constante} = \[(.*?)\] as const;", fuente, re.S)
    assert bloque, f"no encontré {constante} en {OPCIONES_FRONT.name}"
    return re.findall(r'valor:\s*"([^"]+)"', bloque.group(1))


def test_el_front_ofrece_exactamente_los_tipos_que_acepta_el_back():
    assert _valores_del_front("TIPOS_MAQUINA") == list(TIPOS_MAQUINA)


def test_el_front_ofrece_exactamente_los_estados_que_acepta_el_back():
    assert _valores_del_front("ESTADOS_OPERATIVOS") == list(ESTADOS_OPERATIVOS)


def test_toda_familia_del_planificador_es_un_tipo_posible():
    """El tipo se alineó con las familias para poder cruzarlos algún día.

    Si mañana el planificador aprende una familia nueva y nadie la suma a la lista, esa
    máquina sólo se podría cargar como «Otro».
    """
    fuente = inspect.getsource(PS.familia_requerida_from_proceso)
    familias = set(re.findall(r'return "([A-Z_]+)"', fuente))
    assert familias, "no encontré ninguna familia: ¿cambió familia_requerida_from_proceso?"
    faltan = familias - set(TIPOS_MAQUINA)
    assert not faltan, f"familias del planificador que no son un tipo de máquina: {sorted(faltan)}"


# ─────────────────────────── la migración ───────────────────────────

def test_la_migracion_no_reescribe_filas_y_deja_default():
    """Corre sola contra Supabase al arrancar: sólo columnas nuevas, nada de UPDATE."""
    sentencias = dict(migraciones.MIGRACIONES)["2026-09-22_maquina_tipo_estado_mantenimiento"]
    todo = " ".join(sentencias).lower()
    assert "update " not in todo and "delete " not in todo
    assert "estado_operativo varchar(20) not null default 'operativa'" in todo


def test_los_comentarios_de_la_migracion_son_un_solo_literal():
    """`'a' 'b'` pegado sin salto de línea no concatena en Postgres: deja una comilla adentro."""
    sentencias = dict(migraciones.MIGRACIONES)["2026-09-22_maquina_tipo_estado_mantenimiento"]
    for s in sentencias:
        if s.startswith("COMMENT"):
            assert "''" not in s, s
