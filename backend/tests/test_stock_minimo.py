"""Stock mínimo por insumo y el aviso de stock bajo (RF-14).

El SRS pide que el sistema avise SOLO cuando un insumo queda por debajo del mínimo.
El stock ya lo traía el sync del viejo; faltaban el mínimo y quién mirara.

Lo que persigue este archivo son las formas en que un aviso así se rompe sin que
nadie se entere:

  1. **Que repita.** Si cada corrida vuelve a avisar del mismo insumo mientras sigue
     abajo, la campanita se llena y deja de mirarse. Por eso se corre DOS veces.
  2. **Que no vuelva a avisar.** Un insumo, a diferencia de una OT, se perfora muchas
     veces. Si la marca del aviso no se rearma cuando se repone, la segunda bajada
     pasa callada — y es justo la que nadie está esperando.
  3. **Que avise de más.** Una pieza sin mínimo no se vigila, y un stock NULL es «no
     sabemos», no «cero»: pintar en rojo lo que nadie cargó ya se corrigió una vez
     (columna Material) y no se repite acá.
  4. **Que quede una marca sin su aviso.** Si el aviso no se pudo escribir y la marca
     sí, la pieza queda callada para siempre.
  5. **Que el sync le pise el mínimo.** El mínimo es de SPMM, y desde el 23/09/2026
     también el stock. Si alguien vuelve a poner un upsert de piezas que reescriba
     todo, el mínimo (y el stock) se borran en cada pasada. Un test lee el sync (sin
     correrlo) y lo cuida.
"""
import math
import re
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.application import AlertaStockService as modulo_alerta
from backend.application.AlertaStockService import (
    TIPO_ALERTA,
    AlertaStockService,
    armar_mensaje,
    armar_motivo,
    formatear_cantidad,
)
from backend.application.PiezaService import PiezaService
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.Notificacion import Notificacion
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.Pieza import Pieza, esta_bajo_minimo
from backend.domain.Prioridad import Prioridad
from backend.domain.Sector import Sector
from backend.dto.PiezaRequestDTO import PiezaStockMinimoDTO
from backend.infrastructure import auditoria_movimientos as auditoria
from backend.infrastructure import migraciones
from backend.presentation import PiezaAPI

# Un martes cualquiera, a media mañana. Fijo para que nada dependa del día en que se
# corran los tests.
HOY = datetime(2026, 9, 22, 10, 30)

RAIZ_BACKEND = Path(__file__).resolve().parents[1]


def _pieza(id_pieza: int, stock, minimo, **extra) -> Pieza:
    datos = dict(
        id=id_pieza,
        cod_pieza=f"MP-{id_pieza:03d}",
        descripcion=f"Electrodo {id_pieza}",
        unidad="KG",
        stockactual=stock,
        stock_minimo=minimo,
    )
    datos.update(extra)
    return Pieza(**datos)


async def _avisos(session) -> list[Notificacion]:
    return (await session.execute(
        select(Notificacion)
        .where(Notificacion.tipo == TIPO_ALERTA)
        .order_by(Notificacion.id_notificacion)
    )).scalars().all()


async def _correr(session, **kw):
    kw.setdefault("ahora", HOY)
    return await AlertaStockService(session).detectarYAvisarStockBajo(**kw)


async def _releer(session, id_pieza: int) -> Pieza:
    """La pieza como está en la base, no como quedó en la sesión."""
    session.expire_all()
    return (await session.execute(select(Pieza).where(Pieza.id == id_pieza))).scalar_one()


async def _cambiar_stock(session, id_pieza: int, stock):
    """Lo que hace el sync del viejo: reescribir `stockactual` y nada más."""
    pieza = await _releer(session, id_pieza)
    pieza.stockactual = stock
    await session.commit()


# ─────────────────────────── la regla ───────────────────────────

@pytest.mark.parametrize("stock,minimo,esperado", [
    (3, 10, True),       # abajo
    (10, 10, False),     # justo en el mínimo: «por debajo» es estrictamente menor
    (15, 10, False),     # arriba
    (3, None, False),    # sin mínimo: no se vigila
    (None, 10, False),   # stock desconocido: no es «cero»
    (-2, 0, True),       # mínimo 0: avisa sólo si el stock queda negativo
    (0, 0, False),
])
def test_la_regla_de_bajo_minimo(stock, minimo, esperado):
    assert esta_bajo_minimo(stock, minimo) is esperado
    # La propiedad del modelo es la misma regla.
    assert Pieza(cod_pieza="X", descripcion="X", stockactual=stock,
                 stock_minimo=minimo).bajo_minimo is esperado


# ─────────────────────────── que avise ───────────────────────────

@pytest.mark.asyncio
async def test_un_insumo_bajo_el_minimo_genera_un_aviso(session):
    session.add(_pieza(1, 3, 10, proveedor="Soldar SA", estante="E2", letra="B", nro="4"))
    await session.commit()

    resultado = await _correr(session)

    assert resultado.data["creadas"] == 1
    assert resultado.data["sin_avisar"] == 0

    avisos = await _avisos(session)
    assert len(avisos) == 1
    aviso = avisos[0]
    # Tocarlo en la campanita lleva a la pieza.
    assert aviso.id_pieza == 1
    assert aviso.id_orden_trabajo is None
    # Lo que hace falta para decidir si se pide hoy, sin abrir nada.
    assert "MP-001" in aviso.mensaje and "Electrodo 1" in aviso.mensaje
    assert "quedan 3 KG" in aviso.mensaje and "mínimo es 10 KG" in aviso.mensaje
    assert "Faltan 7 KG" in aviso.motivo
    assert "Soldar SA" in aviso.motivo and "E2 B 4" in aviso.motivo
    assert not aviso.leida
    # No la generó una persona: la generó el detector.
    assert aviso.id_usuario_creador is None
    assert aviso.fecha_creacion == HOY

    # Y la pieza queda marcada: esta bajada ya está avisada.
    assert (await _releer(session, 1)).stock_bajo_avisado_en == HOY


@pytest.mark.asyncio
async def test_sin_minimo_sin_stock_o_en_el_minimo_no_avisa(session):
    session.add_all([
        _pieza(1, 3, None),     # no se vigila
        _pieza(2, None, 10),    # stock desconocido
        _pieza(3, 10, 10),      # justo en el mínimo
        _pieza(4, 50, 10),      # sobra
    ])
    await session.commit()

    resultado = await _correr(session)

    assert resultado.data["creadas"] == 0
    assert await _avisos(session) == []


# ─────────────────────── que no repita, y que vuelva ───────────────────────

@pytest.mark.asyncio
async def test_correr_dos_veces_no_duplica_el_aviso(session):
    session.add(_pieza(1, 3, 10))
    await session.commit()

    primera = await _correr(session)
    segunda = await _correr(session, ahora=HOY + timedelta(hours=1))

    assert primera.data["creadas"] == 1
    assert segunda.data["creadas"] == 0
    assert len(await _avisos(session)) == 1


@pytest.mark.asyncio
async def test_si_se_repone_y_vuelve_a_bajar_avisa_de_nuevo(session):
    """El corazón del pedido: una bajada, un aviso; otra bajada, otro aviso."""
    session.add(_pieza(1, 3, 10))
    await session.commit()

    assert (await _correr(session)).data["creadas"] == 1

    # Sigue abajo aunque se haya movido: es la misma bajada, no se repite.
    await _cambiar_stock(session, 1, 5)
    assert (await _correr(session)).data["creadas"] == 0

    # El sync trae la reposición: la marca se rearma.
    await _cambiar_stock(session, 1, 40)
    repuesta = await _correr(session)
    assert repuesta.data["creadas"] == 0
    assert repuesta.data["rearmadas"] == 1
    assert (await _releer(session, 1)).stock_bajo_avisado_en is None

    # Y la próxima vez que baja, avisa otra vez.
    await _cambiar_stock(session, 1, 2)
    otra = await _correr(session, ahora=HOY + timedelta(days=3))
    assert otra.data["creadas"] == 1

    avisos = await _avisos(session)
    assert len(avisos) == 2
    assert "quedan 2 KG" in avisos[1].mensaje
    assert avisos[1].fecha_creacion == HOY + timedelta(days=3)


@pytest.mark.asyncio
async def test_sacarle_el_minimo_tambien_rearma(session):
    session.add(_pieza(1, 3, 10))
    await session.commit()
    await _correr(session)

    pieza = await _releer(session, 1)
    pieza.stock_minimo = None
    await session.commit()

    assert (await _correr(session)).data["rearmadas"] == 1
    assert (await _releer(session, 1)).stock_bajo_avisado_en is None


# ─────────────────────── la marca y su aviso, juntos ───────────────────────

@pytest.mark.asyncio
async def test_si_el_aviso_no_se_escribe_la_marca_tampoco_queda(session, monkeypatch):
    """Una marca sin su aviso dejaría la pieza callada para siempre."""
    session.add(_pieza(1, 3, 10))
    await session.commit()

    def _explota(*_a, **_k):
        raise RuntimeError("se cortó la base a mitad de camino")

    monkeypatch.setattr(modulo_alerta, "armar_motivo", _explota)
    with pytest.raises(InfrastructureException):
        await _correr(session)

    assert (await _releer(session, 1)).stock_bajo_avisado_en is None
    assert await _avisos(session) == []

    # La corrida siguiente, sana, avisa.
    monkeypatch.undo()
    assert (await _correr(session)).data["creadas"] == 1


# ─────────────────────── el tope por corrida ───────────────────────

@pytest.mark.asyncio
async def test_una_corrida_no_puede_llenar_la_campanita(session):
    """El día que el pañol cargue treinta mínimos de una, no pueden salir treinta juntos."""
    for i in range(1, 8):
        session.add(_pieza(i, 1, 10))
    await session.commit()

    primera = await _correr(session, tope=3)
    assert primera.data["creadas"] == 3
    assert primera.data["sin_avisar"] == 4

    segunda = await _correr(session, tope=3)
    tercera = await _correr(session, tope=3)
    assert (segunda.data["creadas"], tercera.data["creadas"]) == (3, 1)
    assert tercera.data["sin_avisar"] == 0

    avisos = await _avisos(session)
    assert len(avisos) == 7
    assert len({a.id_pieza for a in avisos}) == 7


@pytest.mark.asyncio
async def test_con_tope_se_avisa_primero_lo_mas_comprometido(session):
    session.add_all([
        _pieza(1, 9, 10),       # 90 % del mínimo
        _pieza(2, 0, 10),       # sin nada
        _pieza(3, 5, 10),       # la mitad
    ])
    await session.commit()

    await _correr(session, tope=2)

    assert [a.id_pieza for a in await _avisos(session)] == [2, 3]


# ─────────────────────────── la hora ───────────────────────────

@pytest.mark.asyncio
async def test_el_aviso_se_estampa_con_la_hora_del_taller(session):
    session.add(_pieza(1, 3, 10))
    await session.commit()

    # Sin `ahora`: el servicio tiene que resolverla él, y en hora de Argentina.
    await AlertaStockService(session).detectarYAvisarStockBajo()

    aviso = (await _avisos(session))[0]
    esperada = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).replace(tzinfo=None)
    assert aviso.fecha_creacion.tzinfo is None, "con zona, asyncpg rechaza el guardado"
    assert abs((aviso.fecha_creacion - esperada).total_seconds()) < 60


def test_el_detector_no_usa_utcnow_en_ningun_lado():
    fuente = (RAIZ_BACKEND / "application" / "AlertaStockService.py").read_text(encoding="utf-8")
    sospechosas = [l.strip() for l in fuente.splitlines()
                   if re.search(r"datetime\.(utcnow|now)\(", l)
                   and not l.strip().startswith("#")]
    assert not sospechosas, "usá ahora_ar(): " + " | ".join(sospechosas)


# ─────────────────────────── el texto ───────────────────────────

def test_los_numeros_se_escriben_como_en_el_taller():
    assert formatear_cantidad(12.0) == "12"
    assert formatear_cantidad(2.5) == "2,5"
    assert formatear_cantidad(0.125) == "0,125"
    assert formatear_cantidad(1 / 3) == "0,333"
    assert formatear_cantidad(-0.0) == "0"


def test_la_frase_cabe_en_la_columna_aunque_la_descripcion_sea_enorme():
    frase = armar_mensaje("MP-1", "CHAPA " * 400, 1.5, 20, "MTS")
    assert len(frase) <= 500
    # Lo que importa —cuánto queda y el mínimo— no se lo come la descripción.
    assert "quedan 1,5 MTS" in frase and "mínimo es 20 MTS" in frase


def test_sin_unidad_no_queda_un_espacio_colgando():
    assert armar_mensaje("MP-1", "Disco", 2, 5, None) == (
        "Stock bajo de MP-1 (Disco): quedan 2 y el mínimo es 5.")
    assert armar_motivo(2, 5, None, None, None, None, None) == "Faltan 3 para llegar al mínimo."


# ─────────────────────── cargar el mínimo ───────────────────────

@pytest.mark.asyncio
async def test_cargar_el_minimo_no_toca_nada_del_sistema_viejo(session):
    session.add(_pieza(1, 30, None, proveedor="Soldar SA"))
    await session.commit()

    r = await PiezaService(session).definirStockMinimo(1, PiezaStockMinimoDTO(stock_minimo=12.5))

    assert r.data["stock_minimo"] == 12.5
    pieza = await _releer(session, 1)
    assert pieza.stock_minimo == 12.5
    # El stock y la descripción son del viejo: el mínimo no los toca.
    assert pieza.stockactual == 30
    assert pieza.descripcion == "Electrodo 1" and pieza.proveedor == "Soldar SA"


@pytest.mark.asyncio
async def test_quitar_el_minimo_deja_de_vigilar(session):
    session.add(_pieza(1, 3, 10))
    await session.commit()

    await PiezaService(session).definirStockMinimo(1, PiezaStockMinimoDTO(stock_minimo=None))

    assert (await _releer(session, 1)).stock_minimo is None
    assert (await _correr(session)).data["creadas"] == 0


@pytest.mark.asyncio
async def test_sacar_y_volver_a_poner_el_minimo_entre_corridas_vuelve_a_avisar(session):
    """Si el rearme esperara al detector, esta bajada no se avisaría nunca."""
    session.add(_pieza(1, 3, 10))
    await session.commit()
    await _correr(session)

    servicio = PiezaService(session)
    await servicio.definirStockMinimo(1, PiezaStockMinimoDTO(stock_minimo=None))
    await servicio.definirStockMinimo(1, PiezaStockMinimoDTO(stock_minimo=8))

    assert (await _correr(session, ahora=HOY + timedelta(hours=2))).data["creadas"] == 1
    assert len(await _avisos(session)) == 2


@pytest.mark.asyncio
async def test_corregir_el_minimo_mientras_sigue_abajo_no_repite(session):
    """Es la misma bajada: cambiarle el número no la vuelve una bajada nueva."""
    session.add(_pieza(1, 3, 10))
    await session.commit()
    await _correr(session)

    await PiezaService(session).definirStockMinimo(1, PiezaStockMinimoDTO(stock_minimo=20))

    assert (await _releer(session, 1)).stock_bajo_avisado_en == HOY
    assert (await _correr(session)).data["creadas"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("valor,frase", [
    (-1, "negativo"),
    (math.nan, "número"),
    (math.inf, "número"),
    (5_000_000, "no puede pasar"),
])
async def test_un_minimo_imposible_se_rechaza_con_su_motivo(session, valor, frase):
    session.add(_pieza(1, 3, None))
    await session.commit()

    with pytest.raises(BusinessException) as e:
        await PiezaService(session).definirStockMinimo(1, PiezaStockMinimoDTO(stock_minimo=valor))
    assert frase in e.value.message
    assert (await _releer(session, 1)).stock_minimo is None


@pytest.mark.asyncio
async def test_el_minimo_de_una_pieza_que_no_existe(session):
    with pytest.raises(NotFoundException):
        await PiezaService(session).definirStockMinimo(99, PiezaStockMinimoDTO(stock_minimo=1))


# ─────────────────────── la solapa Materia Prima ───────────────────────

@pytest.mark.asyncio
async def test_la_lista_filtra_lo_vigilado_y_lo_que_esta_abajo(session):
    session.add_all([
        _pieza(1, 3, 10),       # vigilada y abajo
        _pieza(2, 30, 10),      # vigilada y bien
        _pieza(3, 0, None),     # no vigilada
    ])
    await session.commit()
    servicio = PiezaService(session)

    todas = (await servicio.listarPiezas()).data
    assert todas["total_count"] == 3
    # La pantalla sabe que el backend ya tiene la función porque el campo VIENE,
    # aunque sea null. Con el backend viejo no viene y la columna no se muestra.
    assert all("stock_minimo" in p for p in todas["data"])

    con_minimo = (await servicio.listarPiezas(con_minimo=True)).data
    assert [p["id"] for p in con_minimo["data"]] == [1, 2]
    assert con_minimo["total_count"] == 2

    bajo = (await servicio.listarPiezas(bajo_minimo=True)).data
    assert [p["id"] for p in bajo["data"]] == [1]
    # El total también filtra: si no, el «Mostrando 1 de 3» mentiría.
    assert bajo["total_count"] == 1


# ─────────────────────── por HTTP, como lo llama la solapa ───────────────────────

def _app_piezas(session) -> FastAPI:
    """El router de piezas con los handlers de la app, contra la base del test.

    Se pisa el `get_db` del propio módulo: el de fábrica abre el SessionLocal de
    PRODUCCIÓN. Ninguna ruta de este archivo puede llegar a Supabase.
    """
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(PiezaAPI.router)

    async def _db():
        yield session

    app.dependency_overrides[PiezaAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: {"sub": "lucas"}
    return app


@pytest.mark.asyncio
async def test_el_camino_de_la_solapa(session):
    session.add(_pieza(1, 3, None))
    await session.commit()

    async with AsyncClient(transport=ASGITransport(app=_app_piezas(session)),
                           base_url="http://t") as c:
        r = await c.put("/piezas/1/stock-minimo", json={"stock_minimo": 10})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["stock_minimo"] == 10

        r = await c.get("/piezas", params={"bajo_minimo": "true"})
        assert [p["id"] for p in r.json()["data"]["data"]] == [1]

        # Un número imposible vuelve con su motivo, en castellano, para revertir la celda.
        r = await c.put("/piezas/1/stock-minimo", json={"stock_minimo": -3})
        assert r.status_code == 422
        assert "negativo" in r.json()["errors"][0]["message"]

        # Un cuerpo vacío no es «quitalo»: es un error.
        r = await c.put("/piezas/1/stock-minimo", json={})
        assert r.status_code == 400

        r = await c.put("/piezas/1/stock-minimo", json={"stock_minimo": None})
        assert r.status_code == 200
        assert r.json()["data"]["stock_minimo"] is None


def test_el_registro_de_auditoria_lo_nombra_como_el_taller():
    assert auditoria.se_audita("PUT", "/piezas/7/stock-minimo")
    _, entidad, id_entidad, _ = auditoria.describir("PUT", "/piezas/7/stock-minimo", 200, "Lucas")
    assert entidad == "materia prima › stock mínimo" and id_entidad == "7"


# ─────────────────────── el disparador ───────────────────────

async def _una_ot_vencida(session):
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja", abreviatura="BAND"),
        Cliente(id=1, nombre="ACME SRL"),
    ])
    await session.commit()
    session.add(OrdenTrabajo(
        id=1, id_otvieja=7001, id_prioridad=1, id_sector=1, id_articulo=1, id_cliente=1,
        unidades=3, fecha_orden=datetime(2026, 8, 1), fecha_entrada=datetime(2026, 8, 1),
        fecha_prometida=datetime(2026, 1, 10), finalizadototal=0,
    ))
    await session.commit()


@pytest_asyncio.fixture
async def cliente_interno(session):
    """La app real, con la base en memoria pisada en la dependencia del endpoint."""
    from backend.presentation import main

    async def _db():
        yield session

    main.app.dependency_overrides[main.get_db_interno] = _db
    async with AsyncClient(transport=ASGITransport(app=main.app),
                           base_url="http://test") as c:
        yield c
    main.app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_sin_token_configurado_el_disparador_no_existe(cliente_interno, monkeypatch):
    monkeypatch.delenv("SYNC_TOKEN", raising=False)
    assert (await cliente_interno.post("/internal/alertas")).status_code == 404


@pytest.mark.asyncio
async def test_con_el_token_equivocado_no_pasa(cliente_interno, monkeypatch):
    monkeypatch.setenv("SYNC_TOKEN", "el-de-verdad")
    r = await cliente_interno.post("/internal/alertas", headers={"x-sync-token": "otro"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_un_solo_disparador_corre_los_dos_avisos(cliente_interno, session, monkeypatch):
    monkeypatch.setenv("SYNC_TOKEN", "el-de-verdad")
    await _una_ot_vencida(session)
    session.add(_pieza(1, 3, 10))
    await session.commit()

    r = await cliente_interno.post("/internal/alertas", headers={"x-sync-token": "el-de-verdad"})

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["retraso"]["creadas"] == 1
    assert cuerpo["stock"]["creadas"] == 1
    assert cuerpo["fallas"] == {}

    tipos = sorted(n.tipo for n in (await session.execute(select(Notificacion))).scalars())
    assert tipos == ["OT_RETRASADA", "STOCK_BAJO"]


@pytest.mark.asyncio
async def test_si_un_aviso_falla_el_otro_corre_igual(cliente_interno, session, monkeypatch):
    """Y la respuesta es 500 y dice cuál, para que el cron lo marque y lo reintente."""
    from backend.application.AlertaRetrasoService import AlertaRetrasoService

    monkeypatch.setenv("SYNC_TOKEN", "el-de-verdad")
    session.add(_pieza(1, 3, 10))
    await session.commit()

    async def _falla(self, **_):
        raise InfrastructureException("Error al generar las alertas de retraso.")

    monkeypatch.setattr(AlertaRetrasoService, "detectarYAvisarRetrasos", _falla)

    r = await cliente_interno.post("/internal/alertas", headers={"x-sync-token": "el-de-verdad"})

    assert r.status_code == 500
    cuerpo = r.json()
    assert "retraso" in cuerpo["fallas"]
    assert cuerpo["stock"]["creadas"] == 1
    assert len(await _avisos(session)) == 1


# ─────────────────────── la migración y el sync ───────────────────────

def test_la_migracion_solo_agrega_columnas_nullable():
    """Corre sola contra Supabase al arrancar: no puede reescribir ni borrar nada."""
    sentencias = dict(migraciones.MIGRACIONES)["2026-09-22_stock_minimo"]
    todo = " ".join(sentencias).lower()
    assert "update " not in todo and "delete " not in todo and "drop " not in todo
    assert "not null" not in todo and "default" not in todo, "nacen en NULL: sin mínimo"
    for col in ("stock_minimo", "stock_bajo_avisado_en", "id_pieza"):
        assert f"add column if not exists {col}" in todo


def test_los_comentarios_de_la_migracion_son_un_solo_literal():
    """`'a' 'b'` pegado sin salto de línea no concatena en Postgres: deja una comilla adentro."""
    for s in dict(migraciones.MIGRACIONES)["2026-09-22_stock_minimo"]:
        if s.startswith("COMMENT"):
            assert "''" not in s, s


def _codigo_sin_comentarios(ruta: Path) -> str:
    """El fuente sin comentarios ni docstrings: lo que el programa HACE, no lo que cuenta.
    Los comentarios de los pasos desactivados nombran justamente lo que ya no se toca."""
    import ast

    arbol = ast.parse(ruta.read_text(encoding="utf-8"))
    for nodo in ast.walk(arbol):
        cuerpo = getattr(nodo, "body", None)
        if (isinstance(cuerpo, list) and cuerpo and isinstance(cuerpo[0], ast.Expr)
                and isinstance(cuerpo[0].value, ast.Constant) and isinstance(cuerpo[0].value.value, str)):
            cuerpo[0] = ast.Pass()
    return ast.unparse(arbol)


def test_el_sync_no_le_pisa_el_minimo_a_nadie():
    """El mínimo es de SPMM y el sync del viejo corre solo, una pasada tras otra.

    Hasta el 23/09/2026 el sync actualizaba el stock de las piezas (paso 7) y este test
    cuidaba que al machear no reescribiera nada más. Desde la reunión de ese día el
    stock también es de SPMM (la suma de sus movimientos), el paso 7 está apagado y lo
    único que el sync le trae al catálogo son los códigos nuevos y el último precio
    (paso 7b). Se LEE el sync, no se lo corre: si alguien vuelve a escribir el mínimo,
    la marca del aviso o el stock, esto se pone en rojo antes de que lo que cargó el
    pañol desaparezca solo.
    """
    from backend.application.materia_prima.legado import CatalogoLegado, pieza_desde_legacy

    codigo = _codigo_sin_comentarios(RAIZ_BACKEND / "scripts" / "sync_db.py")
    for prohibido in ("stock_minimo", "stock_bajo_avisado_en", "stockactual"):
        assert prohibido not in codigo, f"el sync volvió a escribir {prohibido}"
    # Y la conversión con la que el paso 7b da de alta un código nuevo tampoco los trae:
    # una pieza nueva nace sin mínimo (nadie lo pidió) y sin stock inventado.
    datos = pieza_desde_legacy({"Idpieza": "ABC001", "descripcion": "X", "insumo": 2,
                                "stockactual": 50, "CRITICO": 3}, CatalogoLegado())
    assert not {"stock_minimo", "stock_bajo_avisado_en", "stockactual"} & set(datos)


def test_la_notificacion_dice_de_que_pieza_habla():
    aviso = Notificacion(mensaje="x", tipo=TIPO_ALERTA, leida=False, id_pieza=5,
                         fecha_creacion=HOY)
    assert aviso.to_dict()["id_pieza"] == 5
