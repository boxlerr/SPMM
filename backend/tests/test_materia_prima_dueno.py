"""Quién es el dueño de las materias primas (application/materia_prima/dueno.py).

La prueba piloto de la semana del 28/09 corre SPMM en paralelo con el Sistema Integral,
y durante la prueba el Integral sigue siendo el dueño: Carolina y Maxi cargan allá y SPMM
lo refleja (el espejo del sync). Lo que persigue este archivo:

  1. Que un deploy no cambie nada: sin la variable (o con cualquier cosa mal escrita) el
     dueño es el Integral.
  2. Que con el Integral como dueño NINGUNA ruta que escribe de los tres routers de
     materia prima escriba: 422 con el aviso de la prueba, y la base igual. Se recorren
     las rutas de los routers, no una lista a mano: una ruta nueva queda cubierta sola.
  3. Que las lecturas (y la vista previa del alta, que es un POST que no escribe) sigan
     andando, y que la pantalla se entere del dueño por GET /materia-prima/catalogos.
  4. Que con SPMM como dueño todo sea como antes (los demás tests de materia prima corren
     así: conftest.materia_prima_con_spmm_como_dueno).
  5. Que el 422 no tape el 401/403: en la app de verdad el dueño se mira después de la
     sesión y la política de cada router.
"""
import re

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from backend.application.materia_prima import dueno as D
from backend.domain.CaneraOcupacion import CaneraOcupacion
from backend.domain.Material import Material
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.Pieza import Pieza
from backend.domain.PiezaMovimiento import PiezaMovimiento
from backend.domain.PiezaPrecio import PiezaPrecio
from backend.domain.PiezaRecorte import PiezaRecorte
from backend.domain.Proveedor import Proveedor
from backend.presentation import MateriaPrimaCatalogoAPI, MateriaPrimaOTAPI, MateriaPrimaPendientesAPI
from backend.tests.test_materia_prima_ot import BARRA, OT_A, app_de_prueba, linea, mundo

ROUTERS = (MateriaPrimaCatalogoAPI, MateriaPrimaOTAPI, MateriaPrimaPendientesAPI)
LECTURAS = {"GET", "HEAD", "OPTIONS"}


def _rutas_que_escriben() -> list[tuple[str, str]]:
    """(método, plantilla) de toda ruta de los tres routers que no es una lectura, menos
    la vista previa del alta."""
    rutas = []
    for modulo in ROUTERS:
        for r in modulo.router.routes:
            if not isinstance(r, APIRoute):
                continue
            for metodo in sorted(r.methods - LECTURAS):
                if (metodo, r.path) != ("POST", "/materia-prima/insumos/previsualizar"):
                    rutas.append((metodo, r.path))
    return rutas


def _concreta(path: str, id_: int = 1) -> str:
    return re.sub(r"\{[^}]+\}", str(id_), path)


async def _conteos(session) -> dict[str, int]:
    """Cuántas filas hay en cada tabla que alguna ruta de materia prima escribe."""
    salida = {}
    for modelo in (Pieza, OrdenTrabajoPieza, PiezaMovimiento, PiezaPrecio, PiezaRecorte,
                   CaneraOcupacion, Material, Proveedor):
        salida[modelo.__tablename__] = (await session.execute(
            select(func.count()).select_from(modelo))).scalar_one()
    return salida


def _mensaje(r) -> str:
    """El aviso del 422, que tiene que llegar igual en los dos campos donde lo busca quien
    lee la respuesta: errors[0].message (lib/utils.parseApiError) y errorDescription (lo
    que la prueba de punta a punta del 24/09 encontró en null)."""
    cuerpo = r.json()
    assert cuerpo["errorDescription"] == cuerpo["errors"][0]["message"], cuerpo
    return cuerpo["errors"][0]["message"]


# ─────────────────────────── 1. la variable ───────────────────────────

def test_sin_la_variable_el_dueno_es_el_integral(monkeypatch):
    """Un deploy no cambia el comportamiento de la prueba: hasta que alguien ponga la
    variable en 'spmm', SPMM refleja y no escribe."""
    monkeypatch.delenv("MATERIA_PRIMA_DUENO", raising=False)
    assert D.dueno() == "integral" and not D.spmm_es_dueno()
    assert D.aviso_dueno() == D.AVISO_PILOTO


@pytest.mark.parametrize("valor, esperado", [
    ("spmm", "spmm"), (" SPMM ", "spmm"), ("Spmm", "spmm"),
    ("integral", "integral"), ("", "integral"), ("spm", "integral"), ("true", "integral"),
])
def test_lo_que_no_es_spmm_es_integral(monkeypatch, valor, esperado):
    """Ante la duda (vacío, mal escrito), del lado seguro: SPMM no escribe."""
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", valor)
    assert D.dueno() == esperado
    assert D.aviso_dueno() == (None if esperado == "spmm" else D.AVISO_PILOTO)


def test_el_aviso_dice_cada_cuanto_llega_lo_del_integral():
    """El Scheduler del sync corre cada 30 minutos (*/30): el aviso no puede prometer que
    se ve «al instante» ni «solo». La frecuencia vive en una constante (si el Scheduler
    cambia, se cambia ahí) y el texto la usa."""
    assert D.FRECUENCIA_ESPEJO_MIN == 30
    assert D.AVISO_PILOTO == ("Durante la prueba piloto las materias primas se cargan en el "
                              "Sistema Integral; Metlosys las trae de ahí cada 30 minutos.")
    for promesa in ("al instante", "solas", "a los pocos minutos"):
        assert promesa not in D.AVISO_PILOTO


def test_otro_422_de_negocio_sigue_sin_error_description():
    """El errorDescription lo pide sólo la escritura en modo espejo: los demás 422 de
    negocio quedan como estaban (errors[0].message y errorDescription en null)."""
    import asyncio
    import json

    from backend.commons.exceptions.BusinessException import BusinessException
    from backend.commons.handlers.exception_handlers import business_handler

    otro = json.loads(asyncio.run(business_handler(None, BusinessException("otra cosa"))).body)
    assert otro["errorDescription"] is None and otro["errors"][0]["message"] == "otra cosa"
    espejo = json.loads(asyncio.run(business_handler(None, D.EscrituraEnModoEspejo())).body)
    assert espejo["errorDescription"] == espejo["errors"][0]["message"] == D.AVISO_PILOTO


def test_se_lee_en_cada_llamada(monkeypatch):
    """Sin reiniciar nada: cambiar la variable cambia el dueño en la llamada siguiente."""
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    assert not D.spmm_es_dueno()
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "spmm")
    assert D.spmm_es_dueno()


@pytest.mark.parametrize("metodo, ruta, escribe", [
    ("GET", "/materia-prima/insumos", False),
    ("HEAD", "/materia-prima/insumos", False),
    ("OPTIONS", "/materia-prima/insumos", False),
    ("POST", "/materia-prima/insumos/previsualizar", False),
    ("POST", "/materia-prima/insumos", True),
    ("PUT", "/materia-prima/lineas/{id_linea}", True),
    ("PATCH", "/materia-prima/lineas/{id_linea}", True),
    ("DELETE", "/materia-prima/canera/{id_ocupacion}", True),
    ("post", "/materia-prima/insumos/previsualizar", False),
])
def test_que_es_escribir(metodo, ruta, escribe):
    assert D.es_escritura(metodo, ruta) is escribe


# ─────────────────────────── 2. con el Integral, nada escribe ───────────────────────────

def test_hay_rutas_que_escriben_en_los_tres_routers():
    """Que el barrido de abajo no pase por no encontrar nada."""
    rutas = _rutas_que_escriben()
    assert len(rutas) >= 20
    for esperada in (("POST", "/materia-prima/insumos"),
                     ("PUT", "/materia-prima/lineas/{id_linea}"),
                     ("PUT", "/materia-prima/ot/{id_orden_trabajo}/no-lleva"),
                     ("POST", "/materia-prima/canera"),
                     ("POST", "/materia-prima/canera/liberar-terminadas")):
        assert esperada in rutas


@pytest.mark.asyncio
async def test_con_el_integral_ninguna_ruta_escribe(session, monkeypatch):
    """Cada ruta que escribe contesta 422 con el aviso de la prueba piloto, con un cuerpo
    vacío (el aviso va antes que la validación del cuerpo: dice por qué no se puede, no
    qué campo falta), y la base queda igual."""
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 2.0))
    await session.commit()
    antes = await _conteos(session)
    async with AsyncClient(transport=ASGITransport(app=app_de_prueba(session)), base_url="http://t") as c:
        for metodo, path in _rutas_que_escriben():
            r = await c.request(metodo, _concreta(path), json={})
            assert r.status_code == 422, (metodo, path, r.status_code, r.text)
            assert _mensaje(r) == D.AVISO_PILOTO, (metodo, path)
    assert await _conteos(session) == antes


@pytest.mark.asyncio
async def test_con_el_integral_tampoco_con_un_pedido_valido(session, monkeypatch):
    """No es que el cuerpo vacío no pasaba: con uno que con SPMM como dueño se guarda, con
    el Integral no se guarda."""
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 2.0))
    await session.commit()
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    async with AsyncClient(transport=ASGITransport(app=app_de_prueba(session)), base_url="http://t") as c:
        r = await c.put(f"/materia-prima/ot/{OT_A}/no-lleva", json={"no_lleva": True})
        assert r.status_code == 422 and _mensaje(r) == D.AVISO_PILOTO
        r = await c.post("/materia-prima/materiales", json={"nombre": "BRONCE"})
        assert r.status_code == 422
    ot = (await session.execute(select(OrdenTrabajo.no_lleva_materia_prima)
                                .where(OrdenTrabajo.id == OT_A))).scalar_one()
    assert not ot
    assert (await session.execute(select(Material).where(Material.nombre == "BRONCE"))).first() is None

    # La misma operación con SPMM como dueño, sí.
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "spmm")
    async with AsyncClient(transport=ASGITransport(app=app_de_prueba(session)), base_url="http://t") as c:
        r = await c.post("/materia-prima/materiales", json={"nombre": "BRONCE"})
        assert r.status_code == 200, r.text
    assert (await session.execute(select(Material).where(Material.nombre == "BRONCE"))).first() is not None


# ─────────────────────────── 3. las lecturas andan ───────────────────────────

@pytest.mark.asyncio
async def test_con_el_integral_se_lee_todo_y_la_pantalla_sabe_el_dueno(session, monkeypatch):
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 2.0))
    await session.commit()
    async with AsyncClient(transport=ASGITransport(app=app_de_prueba(session)), base_url="http://t") as c:
        r = await c.get("/materia-prima/catalogos")
        assert r.status_code == 200, r.text
        datos = r.json()["data"]
        assert datos["dueno"] == "integral" and datos["aviso_dueno"] == D.AVISO_PILOTO
        assert "materiales" in datos and "formatos" in datos, "el resto de los catálogos sigue"
        for ruta in ("/materia-prima/insumos", f"/materia-prima/insumos/{BARRA}",
                     f"/materia-prima/insumos/{BARRA}/movimientos", f"/materia-prima/ot/{OT_A}/lineas",
                     "/materia-prima/canera", "/materia-prima/proveedores",
                     "/materia-prima/pendientes?todas_abiertas=true"):
            r = await c.get(ruta)
            assert r.status_code == 200, (ruta, r.text)
        # La vista previa del alta es un POST que no escribe: anda.
        r = await c.post("/materia-prima/insumos/previsualizar",
                         json={"tipo": "insumo_desc", "descripcion": "CHAPA A MEDIDA"})
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_con_spmm_la_pantalla_no_muestra_cartel(session, monkeypatch):
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "spmm")
    await mundo(session)
    async with AsyncClient(transport=ASGITransport(app=app_de_prueba(session)), base_url="http://t") as c:
        datos = (await c.get("/materia-prima/catalogos")).json()["data"]
    assert datos["dueno"] == "spmm" and datos["aviso_dueno"] is None


# ─────────────────────────── 5. en la app de verdad ───────────────────────────

def _rutas_de_materia_prima_en_la_app():
    from backend.presentation.main import app
    return [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/materia-prima")]


def test_en_la_app_el_dueno_se_mira_despues_de_la_sesion_y_la_politica():
    """main.py cuelga la sesión y la política en include_router; el dueño va en el
    APIRouter. FastAPI resuelve primero las de include_router: sin token sigue siendo 401
    y sin permiso 403, no el aviso de la prueba."""
    rutas = _rutas_de_materia_prima_en_la_app()
    assert len(rutas) >= 30
    for r in rutas:
        nombres = [getattr(d.call, "__name__", "") for d in r.dependant.dependencies]
        assert "solo_si_spmm_es_dueno" in nombres, r.path
        dueno = nombres.index("solo_si_spmm_es_dueno")
        assert nombres.index("get_current_user") < dueno, r.path
        politica = next(i for i, n in enumerate(nombres) if n.startswith("require_politica_"))
        assert politica < dueno, r.path


@pytest.mark.asyncio
async def test_en_la_app_sin_token_no_es_el_aviso(monkeypatch):
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    from backend.presentation.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/materia-prima/materiales", json={"nombre": "BRONCE"})
    assert r.status_code in (401, 403), r.text
