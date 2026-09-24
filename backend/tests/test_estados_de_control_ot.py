"""RF-11: «Estado y control» de la OT, las ocho casillas de la ficha del sistema viejo.

Julián, 23/09, con la foto de la ficha vieja: «tiene que estar, hacelo, ponelo en las
órdenes de trabajo; si no está alguna opción creala en la db y en la orden». Las casillas
son PROGRAMADA, EN PROCESO, FINALIZADO TOTAL, FINALIZADO PARCIAL (con su «Cant.»),
CONTROLADO, FINALIZADO PARA PINTAR, FINALIZADO TERCERIZACIÓN FINAL y FINALIZADO
TERCERIZACIÓN INTERMEDIA. Las cuatro primeras ya existían; la migración del 23/09 agrega
las otras cuatro, el «Cant.» del parcial y quién marcó Controlado y cuándo.

Lo que se fija acá:
  · cada casilla y la cantidad van y vuelven por el PUT / GET de siempre;
  · el front que ya está en producción (3422285) manda la OT entera SIN estos campos, y
    eso no puede dejarlos en 0: es lo que pasaría el día del deploy del backend si el
    front tarda;
  · un `null` en una casilla NOT NULL no tumba el guardado ni la borra;
  · quién marcó Controlado y cuándo lo pone el backend (no se puede mandar), no cambia
    al volver a guardar, se borra al desmarcar y nunca se inventa;
  · Auditoría lo cuenta como «marcó la OT como Controlada»;
  · la lista de todas las OT las trae para verlas y filtrarlas.

CONTRA QUÉ BASE

SQLite en memoria siempre. Si está SPMM_PG_PRUEBAS con la URL de un Postgres DESCARTABLE
en localhost, todo otra vez ahí, y además la tabla arranca con la forma de producción de
hoy (sin las columnas), con una OT del cliente adentro, y la migración se corre DOS
veces encima: tiene que ser idempotente, no tocar esa fila y dejar columnas que el ORM
lee y escribe. Esa base se BORRA ENTERA (DROP SCHEMA public CASCADE): sólo localhost.

    SPMM_PG_PRUEBAS=postgresql+asyncpg://postgres@127.0.0.1:55411/spmm_rf_11_estados pytest ...
"""
import json
import os
from datetime import datetime
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.permisos import DatosDePermisos, permisos_de
from backend.core.security import get_current_user, get_permisos_actuales
from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import CASILLAS_DE_CONTROL, OrdenTrabajo
from backend.domain.Prioridad import Prioridad
from backend.domain.Sector import Sector
from backend.infrastructure.db import Base
from backend.infrastructure.migraciones import MIGRACIONES
from backend.tests.conftest import TEST_TABLES

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url: str) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


MOTORES = ["sqlite"] + (["postgres"] if PG_URL and _pg_seguro(PG_URL) else [])
MIGRACION_RF11 = dict(MIGRACIONES)["2026-09-23_estados_de_control_ot"]
COLUMNAS_NUEVAS = (*CASILLAS_DE_CONTROL, "cantidad_finalizada_parcial", "controlado_en",
                   "controlado_por")

OT, NUMERO = 1500, 15300
# Una OT que ya estaba antes de la migración (en Postgres la escribe SQL pelado, como las
# 1.400 del cliente).
OT_VIEJA = 2
LUCAS = "Lucas Longchamps"
USUARIO = {"id_usuario": 1, "username": "lucas", "nombre": "Lucas", "apellido": "Longchamps"}

# Las ocho casillas, en el orden de la ficha vieja.
CASILLAS = ("programada", "en_proceso", "finalizadototal", "finalizadoparcial",
            "controlado", "finalizado_para_pintar", "finalizado_tercerizacion_final",
            "finalizado_tercerizacion_intermedia")


def _payload_del_front_viejo(**cambios):
    """Lo que manda el modal de la OT que está en producción (3422285) al guardar: la
    cabecera ENTERA, con las casillas viejas en 0/1 y sin ninguna de las nuevas."""
    payload = {
        "id_otvieja": NUMERO, "observaciones": "EJE 42", "detalle": "detalle",
        "id_cliente": 999, "cliente": "ACME S.A.", "unidades": 10,
        "id_prioridad": 1, "id_sector": 1, "id_articulo": 42,
        "fecha_orden": "2026-09-01T00:00:00.000Z", "fecha_entrada": "2026-09-01T00:00:00.000Z",
        "fecha_prometida": "2026-10-20T00:00:00.000Z", "fecha_entrega": None,
        "cantidad_entregada": 0, "reclamo": 0, "finalizadototal": 0, "finalizadoparcial": 0,
        "n_ped_l": "", "n_pedido": "", "subsector": "", "requerido_por": "", "aprobado_por": "",
        "remitos_salida": "", "f_disp_material": None,
        "fabricacion": False, "reparacion": False, "sin_cargo": False, "stock": False,
        "interno": False, "revisada": False, "tercerizado_total": False,
        "tercerizado_parcial": False, "suspendida": False, "email": False,
        "tiene_plano": False, "no_lleva_plano": False, "no_lleva_materia_prima": False,
        "programada": False, "en_proceso": False,
    }
    payload.update(cambios)
    return payload


# ─────────────────────────── la base ───────────────────────────

async def _catalogos(s):
    s.add_all([
        EstadoProceso(id=1, descripcion="Pendiente"), EstadoProceso(id=3, descripcion="Finalizado"),
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="MECANIZADO"),
        Articulo(id=42, cod_articulo="A42", descripcion="EJE 42", abreviatura="x"),
        Cliente(id=999, nombre="ACME S.A."),
    ])
    await s.commit()


@pytest_asyncio.fixture(params=MOTORES)
async def base(request):
    motor = request.param
    if motor == "postgres":
        engine = create_async_engine(PG_URL, poolclass=NullPool)
    else:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                     connect_args={"check_same_thread": False})
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        if motor == "postgres":
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=TEST_TABLES + [AuditoriaMovimiento.__table__]))
        if motor == "postgres":
            # La tabla como está HOY en producción: sin las columnas de RF-11.
            for col in COLUMNAS_NUEVAS:
                await conn.execute(text(f"ALTER TABLE orden_trabajo DROP COLUMN {col}"))
    async with Sesion() as s:
        await _catalogos(s)
    if motor == "postgres":
        async with engine.begin() as conn:
            # Una OT del cliente, escrita como las escribió el sistema viejo.
            await conn.execute(text(
                "INSERT INTO orden_trabajo (id, id_otvieja, id_prioridad, id_sector, id_articulo, "
                "id_cliente, unidades, fecha_orden, fecha_entrada, fecha_prometida, "
                "finalizadoparcial, programada, ttt1, fc, no_lleva_plano, no_lleva_materia_prima) "
                "VALUES (:id, 9001, 1, 1, 42, 999, 4, '2026-08-01', '2026-08-01', '2026-08-20', "
                "1, 1, 0, 0, 0, 0)"), {"id": OT_VIEJA})
            # La migración, dos veces: corre en cada arranque de cada instancia.
            for _ in range(2):
                for sentencia in MIGRACION_RF11:
                    await conn.execute(text(sentencia))
    else:
        async with Sesion() as s:
            s.add(OrdenTrabajo(id=OT_VIEJA, id_otvieja=9001, id_prioridad=1, id_sector=1,
                               id_articulo=42, id_cliente=999, unidades=4,
                               fecha_orden=datetime(2026, 8, 1), fecha_entrada=datetime(2026, 8, 1),
                               fecha_prometida=datetime(2026, 8, 20), finalizadoparcial=1,
                               programada=1))
            await s.commit()
    async with Sesion() as s:
        s.add(OrdenTrabajo(id=OT, id_otvieja=NUMERO, id_prioridad=1, id_sector=1, id_articulo=42,
                           id_cliente=999, unidades=10, detalle="detalle",
                           fecha_orden=datetime(2026, 9, 1), fecha_entrada=datetime(2026, 9, 1),
                           fecha_prometida=datetime(2026, 10, 20)))
        await s.commit()
    Sesion.motor = motor
    yield Sesion
    await engine.dispose()


@pytest_asyncio.fixture
async def api(base, monkeypatch):
    """Los endpoints de verdad (OT y Auditoría) con el middleware de verdad: lo que el
    registro guarda al marcar una casilla."""
    from starlette.middleware.base import BaseHTTPMiddleware

    from backend.core.security import create_access_token
    from backend.presentation import AuditoriaAPI, OrdenTrabajoAPI, main

    monkeypatch.setattr(main, "SessionLocal", base)

    async def _db():
        async with base() as s:
            yield s

    app = FastAPI()
    registrar_exception_handlers(app)
    app.add_middleware(BaseHTTPMiddleware, dispatch=main.auditar_movimientos)
    app.include_router(OrdenTrabajoAPI.router)
    app.include_router(AuditoriaAPI.router)
    app.dependency_overrides[OrdenTrabajoAPI.get_db] = _db
    app.dependency_overrides[AuditoriaAPI.get_db] = _db
    app.dependency_overrides[get_permisos_actuales] = lambda: permisos_de(
        DatosDePermisos(rol="admin"), 1, "lucas")
    app.dependency_overrides[get_current_user] = lambda: dict(USUARIO)
    token = create_access_token({"sub": "lucas", "id_usuario": 1, "nombre": "Lucas",
                                 "apellido": "Longchamps"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t",
                           headers={"Authorization": f"Bearer {token}"}) as c:
        c.sesiones = base
        yield c


async def _ot(api, id_=OT) -> dict:
    r = await api.get(f"/ordenes/{id_}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _guardar(api, id_=OT, **campos):
    r = await api.put(f"/ordenes/{id_}", json=campos)
    assert r.status_code == 200, r.text
    return r


async def _ultima_fila(api) -> AuditoriaMovimiento:
    async with api.sesiones() as s:
        return (await s.execute(select(AuditoriaMovimiento).where(
            AuditoriaMovimiento.ruta == f"/ordenes/{OT}", AuditoriaMovimiento.metodo == "PUT")
            .order_by(AuditoriaMovimiento.id.desc()).limit(1))).scalar_one()


# ─────────────────────────── la migración ───────────────────────────

async def test_la_migracion_no_toca_lo_que_habia_y_deja_lo_que_el_orm_lee(base, api):
    """La OT que ya estaba nace en 0 / NULL sin que nadie la reescriba, conserva lo suyo
    (su Finalizado parcial y su Programada), y se puede leer y guardar por la API."""
    vieja = await _ot(api, OT_VIEJA)
    for campo in CASILLAS_DE_CONTROL:
        assert vieja[campo] == 0, campo
    assert vieja["cantidad_finalizada_parcial"] is None
    assert vieja["controlado_en"] is None and vieja["controlado_por"] is None
    assert vieja["finalizadoparcial"] == 1 and vieja["programada"] == 1

    await _guardar(api, OT_VIEJA, controlado=True, cantidad_finalizada_parcial=3)
    vieja = await _ot(api, OT_VIEJA)
    assert vieja["controlado"] == 1 and vieja["cantidad_finalizada_parcial"] == 3

    if base.motor != "postgres":
        return
    async with base() as s:
        cols = {f.column_name: f for f in (await s.execute(text(
            "SELECT column_name, data_type, is_nullable, column_default, "
            "col_description('orden_trabajo'::regclass, ordinal_position) AS comentario "
            "FROM information_schema.columns WHERE table_name = 'orden_trabajo' "
            "AND column_name = ANY(:cols)"), {"cols": list(COLUMNAS_NUEVAS)})).all()}
    assert set(cols) == set(COLUMNAS_NUEVAS)
    for campo in CASILLAS_DE_CONTROL:
        assert cols[campo].data_type == "smallint"
        assert cols[campo].is_nullable == "NO" and cols[campo].column_default == "0"
    for campo in ("cantidad_finalizada_parcial", "controlado_en", "controlado_por"):
        assert cols[campo].is_nullable == "YES" and cols[campo].column_default is None
    assert cols["controlado_en"].data_type == "timestamp without time zone"
    for campo in COLUMNAS_NUEVAS:
        assert cols[campo].comentario and cols[campo].comentario.startswith("RF-11"), campo
    # Sin apóstrofos sueltos: el COMMENT es un solo literal (ver migraciones.py).
    assert "''" not in cols["cantidad_finalizada_parcial"].comentario


# ─────────────────────────── cada casilla va y vuelve ───────────────────────────

@pytest.mark.parametrize("casilla", CASILLAS)
async def test_cada_casilla_se_guarda_y_se_lee(api, casilla):
    await _guardar(api, **{casilla: True})
    assert (await _ot(api))[casilla] == 1
    await _guardar(api, **{casilla: False})
    assert (await _ot(api))[casilla] == 0


async def test_las_casillas_son_independientes(api):
    """En la ficha vieja son casillas, no un estado: una OT puede estar terminada en
    parte, controlada y para pintar a la vez, y marcar una no apaga las otras."""
    await _guardar(api, finalizadoparcial=True, controlado=True, finalizado_para_pintar=True)
    await _guardar(api, finalizado_tercerizacion_intermedia=True)
    ot = await _ot(api)
    assert [ot[c] for c in CASILLAS] == [0, 0, 0, 1, 1, 1, 0, 1]


async def test_la_cantidad_del_parcial_va_y_vuelve_y_no_es_la_entregada(api):
    await _guardar(api, finalizadoparcial=True, cantidad_finalizada_parcial=7)
    ot = await _ot(api)
    assert ot["cantidad_finalizada_parcial"] == 7
    # Terminar no es entregar: la entregada (y su fecha de entrega) no se mueven.
    assert ot["cantidad_entregada"] in (0, None) and ot["fecha_entrega"] is None

    # Vaciar el «Cant.» es válido: null = no se cargó.
    await _guardar(api, cantidad_finalizada_parcial=None)
    assert (await _ot(api))["cantidad_finalizada_parcial"] is None

    # Una cantidad negativa no entra (el manejador de errores la contesta como 400).
    r = await api.put(f"/ordenes/{OT}", json={"cantidad_finalizada_parcial": -1})
    assert r.status_code == 400, r.text
    assert (await _ot(api))["cantidad_finalizada_parcial"] is None
    # Ni una enorme: la columna es INTEGER y antes era un error de la base (un 500).
    r = await api.put(f"/ordenes/{OT}", json={"cantidad_finalizada_parcial": 10**12})
    assert r.status_code == 400, r.text
    assert (await _ot(api))["cantidad_finalizada_parcial"] is None


@pytest.mark.parametrize("cantidad", [-1, 10**12])
async def test_el_alta_con_una_cantidad_invalida_es_un_aviso_y_no_un_500(api, cantidad):
    """El alta llega como texto en un formulario (va con los planos) y el DTO se arma en el
    servicio: un ValidationError suelto era un 500. Ahora es el mismo 400 que el PUT, con
    el campo."""
    payload = _payload_del_front_viejo(id_otvieja=15999, cantidad_finalizada_parcial=cantidad)
    r = await api.post("/ordenes", data={"data": json.dumps(payload)})
    assert r.status_code == 400, r.text
    assert r.json()["errors"][0]["campo"] == "cantidad_finalizada_parcial"
    async with api.sesiones() as s:
        assert (await s.execute(select(OrdenTrabajo).where(OrdenTrabajo.id_otvieja == 15999))
                ).scalar_one_or_none() is None


async def test_el_alta_con_datos_ilegibles_es_un_aviso(api):
    r = await api.post("/ordenes", data={"data": "{roto"})
    assert r.status_code == 422, r.text


async def test_el_front_de_produccion_no_pone_en_cero_lo_que_no_conoce(api):
    """El modal de 3422285 manda la cabecera entera sin los campos nuevos. Si el backend
    se deploya antes que el front (o alguien tiene la pestaña vieja abierta), guardar una
    OT no puede desmarcarle Controlado ni borrarle la cantidad, ni cambiar quién la
    controló."""
    await _guardar(api, controlado=True, finalizado_para_pintar=True,
                   finalizado_tercerizacion_intermedia=True, finalizado_tercerizacion_final=True,
                   finalizadoparcial=True, cantidad_finalizada_parcial=5)
    antes = await _ot(api)

    await _guardar(api, **_payload_del_front_viejo(finalizadoparcial=1, detalle="otra cosa"))
    ot = await _ot(api)
    assert ot["detalle"] == "otra cosa", "no guardó lo que sí mandó"
    for campo in CASILLAS_DE_CONTROL:
        assert ot[campo] == 1, campo
    assert ot["cantidad_finalizada_parcial"] == 5
    assert ot["controlado_por"] == antes["controlado_por"] == LUCAS
    assert ot["controlado_en"] == antes["controlado_en"]


async def test_un_null_en_una_casilla_nueva_no_rompe_ni_la_borra(api):
    """Son NOT NULL en la base: un null explícito tumbaba el UPDATE con un error de la
    base. Se lee como «no sé» y se ignora; para desmarcar se manda false."""
    await _guardar(api, controlado=True)
    await _guardar(api, **{c: None for c in CASILLAS_DE_CONTROL}, unidades=12)
    ot = await _ot(api)
    assert ot["controlado"] == 1 and ot["unidades"] == 12


# ─────────────────────────── quién la controló ───────────────────────────

async def test_quien_marco_controlado_lo_pone_el_backend(api):
    antes = datetime.now()
    # Lo que mande el que llama no cuenta: el autor es el del token.
    await _guardar(api, controlado=True, controlado_por="Otro", controlado_en="2020-01-01T00:00:00")
    ot = await _ot(api)
    assert ot["controlado_por"] == LUCAS
    cuando = datetime.fromisoformat(ot["controlado_en"])
    assert cuando.tzinfo is None, "las fechas de la base son sin zona"
    assert cuando.year == antes.year and abs((cuando - antes).total_seconds()) < 60 * 60 * 4

    # Volver a guardar la OT (el modal manda todo) no le cambia el autor ni la hora.
    await _guardar(api, controlado=True, unidades=11)
    otra_vez = await _ot(api)
    assert (otra_vez["controlado_por"], otra_vez["controlado_en"]) == (LUCAS, ot["controlado_en"])

    # Desmarcarla borra los dos: una OT sin controlar no dice «controlada por».
    await _guardar(api, controlado=False)
    ot = await _ot(api)
    assert ot["controlado"] == 0 and ot["controlado_por"] is None and ot["controlado_en"] is None


async def test_un_guardado_que_no_es_de_una_persona_no_inventa_quien(base):
    """El sync y los scripts entran por update(..., estampar=False): que el sistema viejo
    traiga una OT controlada no dice quién la controló."""
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    async with base() as s:
        await OrdenTrabajoRepository(s).update(OT, {"controlado": 1}, usuario=None, estampar=False)
    async with base() as s:
        ot = await s.get(OrdenTrabajo, OT)
        assert ot.controlado == 1 and ot.controlado_por is None and ot.controlado_en is None


async def test_nacer_controlada_tambien_dice_quien(base):
    from backend.application.OrdenTrabajoService import OrdenTrabajoService

    payload = _payload_del_front_viejo(
        id_otvieja=0, controlado=True, finalizado_para_pintar=True, finalizadoparcial=True,
        cantidad_finalizada_parcial=2, procesos=[])
    async with base() as s:
        r = await OrdenTrabajoService(s).crearOrdenTrabajo(json.dumps(payload), [], user=dict(USUARIO))
        nueva = r.data["id"]
    async with base() as s:
        ot = await s.get(OrdenTrabajo, nueva)
        assert (ot.controlado, ot.finalizado_para_pintar, ot.finalizadoparcial) == (1, 1, 1)
        assert ot.cantidad_finalizada_parcial == 2
        assert ot.controlado_por == LUCAS and ot.controlado_en is not None
        assert (ot.finalizado_tercerizacion_final, ot.finalizado_tercerizacion_intermedia) == (0, 0)


# ─────────────────────────── Auditoría ───────────────────────────

async def test_auditoria_dice_que_la_marco_controlada(api):
    await _guardar(api, controlado=True)
    fila = await _ultima_fila(api)
    assert fila.descripcion == f"{LUCAS} marcó la OT {NUMERO} como Controlada"
    detalle = json.loads(fila.detalle)
    assert detalle["antes"] == {"controlada": "no"} and detalle["despues"] == {"controlada": "sí"}

    # Con otra cosa en el mismo guardado, lo de Controlada va primero y lo demás detrás.
    await _guardar(api, controlado=False)
    fila = await _ultima_fila(api)
    assert fila.descripcion == f"{LUCAS} le sacó la marca de Controlada a la OT {NUMERO}"
    await _guardar(api, controlado=True, unidades=12)
    fila = await _ultima_fila(api)
    assert fila.descripcion == (f"{LUCAS} marcó la OT {NUMERO} como Controlada; además: "
                                "unidades: 10 → 12")

    # Las otras casillas nuevas también quedan dichas, con su nombre en castellano.
    await _guardar(api, finalizado_para_pintar=True, cantidad_finalizada_parcial=4)
    fila = await _ultima_fila(api)
    assert json.loads(fila.detalle)["despues"] == {
        "cantidad terminada (parcial)": "4", "terminada para pintar": "sí"}

    # Y el historial de la OT en Auditoría lo cuenta así.
    r = await api.get(f"/auditoria/historial/ordenes/{OT}")
    assert r.status_code == 200, r.text
    titulos = [e["titulo"] for e in r.json()["eventos"]]
    assert titulos.count("marcó la OT como Controlada") == 2, titulos
    assert "le sacó la marca de Controlada a la OT" in titulos
    marcada = next(e for e in r.json()["eventos"] if e["titulo"] == "marcó la OT como Controlada"
                   and e["lineas"] and len(e["lineas"]) == 2)
    assert marcada["quien"] == LUCAS
    assert "controlada: no → sí" in marcada["lineas"] and "unidades: 10 → 12" in marcada["lineas"]


# ─────────────────────────── la lista de todas ───────────────────────────

async def test_la_lista_de_todas_trae_las_marcas_y_cuantas_hay(api):
    if api.sesiones.motor != "postgres":
        pytest.skip("/ordenes-resumen es SQL de Postgres (::text): sólo se prueba ahí")
    await _guardar(api, controlado=True, finalizado_tercerizacion_final=True,
                   finalizadoparcial=True, cantidad_finalizada_parcial=6)
    r = await api.get("/ordenes-resumen")
    assert r.status_code == 200, r.text
    datos = r.json()["data"]
    fila = next(o for o in datos["ordenes"] if o["id"] == OT)
    assert fila["controlado"] == 1 and fila["controlado_por"] == LUCAS
    assert fila["finalizado_tercerizacion_final"] == 1 and fila["finalizado_para_pintar"] == 0
    assert fila["finalizadoparcial"] == 1 and fila["cantidad_finalizada_parcial"] == 6
    assert datos["resumen"]["controladas"] == 1
    assert datos["resumen"]["tercerizacion_final"] == 1
    assert datos["resumen"]["para_pintar"] == 0 and datos["resumen"]["tercerizacion_intermedia"] == 0
