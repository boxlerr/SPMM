"""El tiempo de cada paso que hizo una persona, en su ficha (RF-06).

La cuenta pura está en test_tiempo_efectivo.py. Acá, lo que la rodea:

  1. **A quién se le cuenta un paso.** No se registra quién lo hizo: se atribuye a la
     persona elegida a mano en la OT o, si no hay, a la del ÚLTIMO plan que lo incluyó
     (todas, si lleva varias). Un plan viejo no le roba el paso al nuevo.
  2. **Qué pasos.** Sólo los que arrancaron; el centinela del sistema viejo no es un
     arranque; uno terminado sin fin sale, pero sin minutos (no hay cuenta honesta).
  3. **Las pausas de RF-03 se descuentan**, las del paso y las de su OT. Sin la tabla
     de pausas, los tiempos salen igual y la respuesta lo dice.
"""
from datetime import datetime, time
import uuid

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.application.TiemposOperarioService import TiemposOperarioService, le_toca
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user
from backend.domain.Articulo import Articulo
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import PausaOrden
from backend.domain.Planificacion import Planificacion
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.infrastructure.db import Base
from backend.presentation import AsistenciaAPI
from backend.tests.conftest import TEST_TABLES

JUAN, ANA, BETO = 1, 2, 3
LOTE_VIEJO, LOTE_NUEVO = str(uuid.uuid4()), str(uuid.uuid4())


def dia(d: int, hh: int, mm: int = 0) -> datetime:
    return datetime(2026, 9, d, hh, mm)


def _plan(pid, orden_id, proceso_id, id_otp, id_operario, lote, creado):
    return Planificacion(id=pid, orden_id=orden_id, proceso_id=proceso_id,
                         id_orden_trabajo_proceso=id_otp, id_operario=id_operario,
                         inicio_min=0, fin_min=60, duracion_min=60, prioridad_peso=1,
                         id_planificacion_lote=lote, creado_en=creado)


async def _mundo(session, con_pausas=True):
    session.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja", abreviatura="BAND"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="En Proceso"),
        EstadoProceso(id=3, descripcion="Finalizado"),
        Proceso(id=150, nombre="TORNO CNC"),
        Proceso(id=160, nombre="SOLDADURA"),
        Proceso(id=170, nombre="PINTURA"),
    ])
    for i, (nom, ape) in {JUAN: ("JUAN", "PEREZ"), ANA: ("ANA", "GIL"), BETO: ("BETO", "SOSA")}.items():
        session.add(Operario(id=i, nombre=nom, apellido=ape, categoria="OFICIAL", disponible=True,
                             hora_inicio=time(7), hora_fin=time(16)))
    await session.flush()
    for id_ot, nro in ((10, 15279), (11, 15280), (12, 15281)):
        session.add(OrdenTrabajo(id=id_ot, id_otvieja=nro, id_prioridad=1, id_sector=1, id_articulo=1,
                                 fecha_orden=dia(1, 0), fecha_entrada=dia(1, 0),
                                 fecha_prometida=dia(30, 0), finalizadototal=0))
    await session.flush()
    session.add_all([
        # OT 10
        # 101: elegido JUAN, terminado el martes 22 de 8 a 11.
        OrdenTrabajoProceso(id=101, id_orden_trabajo=10, id_proceso=150, orden=1, id_estado=3,
                            tiempo_proceso=120, id_operario=JUAN,
                            inicio_real=dia(22, 8), fin_real=dia(22, 11)),
        # 102: sin elegido; el plan viejo se lo daba a JUAN, el nuevo a ANA.
        OrdenTrabajoProceso(id=102, id_orden_trabajo=10, id_proceso=160, orden=2, id_estado=3,
                            tiempo_proceso=60, inicio_real=dia(22, 11), fin_real=dia(22, 14)),
        # 103: sin elegido, de a dos: el plan nuevo se lo da a JUAN y a BETO. En curso
        # desde el martes 22 a las 14 (en el pasado de cualquier reloj que corra esto).
        OrdenTrabajoProceso(id=103, id_orden_trabajo=10, id_proceso=170, orden=3, id_estado=2,
                            tiempo_proceso=90, cant_operarios=2, inicio_real=dia(22, 14)),
        # 104: elegido JUAN pero no arrancó.
        OrdenTrabajoProceso(id=104, id_orden_trabajo=10, id_proceso=150, orden=4, id_estado=1,
                            tiempo_proceso=30, id_operario=JUAN),
        # 105: elegida ANA a mano; un plan (viejo para ella) decía JUAN.
        OrdenTrabajoProceso(id=105, id_orden_trabajo=10, id_proceso=160, orden=5, id_estado=3,
                            tiempo_proceso=30, id_operario=ANA,
                            inicio_real=dia(21, 8), fin_real=dia(21, 9)),
        # 106: elegido JUAN con el centinela del sistema viejo: no arrancó.
        OrdenTrabajoProceso(id=106, id_orden_trabajo=10, id_proceso=170, orden=6, id_estado=1,
                            id_operario=JUAN, inicio_real=datetime(1900, 1, 1)),
        # 107: elegido JUAN, terminado pero sin fin: dato roto.
        OrdenTrabajoProceso(id=107, id_orden_trabajo=10, id_proceso=150, orden=7, id_estado=3,
                            tiempo_proceso=45, id_operario=JUAN, inicio_real=dia(21, 10)),
        # OT 11: una sola pasada de TORNO; el plan viejo no dice de qué paso es.
        OrdenTrabajoProceso(id=201, id_orden_trabajo=11, id_proceso=150, orden=1, id_estado=3,
                            tiempo_proceso=60, inicio_real=dia(21, 13), fin_real=dia(21, 14)),
        # OT 12: DOS pasadas de TORNO y un plan viejo sin paso: no se adivina.
        OrdenTrabajoProceso(id=301, id_orden_trabajo=12, id_proceso=150, orden=1, id_estado=3,
                            inicio_real=dia(21, 8), fin_real=dia(21, 9)),
        OrdenTrabajoProceso(id=302, id_orden_trabajo=12, id_proceso=150, orden=2, id_estado=3,
                            inicio_real=dia(21, 9, 15), fin_real=dia(21, 10)),
    ])
    await session.flush()
    viejo, nuevo = dia(20, 10), dia(22, 10)
    session.add_all([
        _plan(1, 10, 160, 102, JUAN, LOTE_VIEJO, viejo),
        _plan(2, 10, 160, 102, ANA, LOTE_NUEVO, nuevo),
        _plan(3, 10, 170, 103, JUAN, LOTE_NUEVO, nuevo),
        _plan(4, 10, 170, 103, BETO, LOTE_NUEVO, nuevo),
        _plan(5, 10, 160, 105, JUAN, LOTE_NUEVO, nuevo),
        _plan(6, 11, 150, None, JUAN, LOTE_VIEJO, viejo),
        _plan(7, 12, 150, None, JUAN, LOTE_VIEJO, viejo),
    ])
    if con_pausas:
        session.add_all([
            # La OT entera de 9:30 a 10 y el torno (101) de 10 a 10:30.
            PausaOrden(id_orden_trabajo=10, id_otp=None, motivo="ESPERA_CLIENTE",
                       desde=dia(22, 9, 30), hasta=dia(22, 10), cierre="REANUDADA"),
            PausaOrden(id_orden_trabajo=10, id_otp=101, paso=1, motivo="MAQUINA_ROTA",
                       desde=dia(22, 10), hasta=dia(22, 10, 30), cierre="REANUDADA"),
            # Una del 102, que no es del 101.
            PausaOrden(id_orden_trabajo=10, id_otp=102, paso=2, motivo="FALTA_MATERIAL",
                       desde=dia(22, 11), hasta=dia(22, 11, 30), cierre="REANUDADA"),
        ])
    await session.commit()


@pytest_asyncio.fixture
async def taller(session):
    await _mundo(session)
    return session


async def _tareas(session, id_operario, **kw):
    r = await TiemposOperarioService(session).tareas(id_operario, **kw)
    assert r.status is True
    return r.data


def _por_paso(data) -> dict:
    return {t["id_otp"]: t for t in data["tareas"]}


# ─────────────────────── a quién se le cuenta ───────────────────────

async def test_a_juan_le_cuentan_lo_elegido_y_lo_del_ultimo_plan(taller):
    data = await _tareas(taller, JUAN)
    pasos = _por_paso(data)
    # 101 elegido; 103 del último plan (de a dos); 201 plan viejo sin paso pero único;
    # 107 elegido (dato roto, pero sale).
    assert set(pasos) == {101, 103, 107, 201}
    assert pasos[101]["origen"] == "ot" and pasos[103]["origen"] == "plan"
    assert pasos[201]["origen"] == "plan"


async def test_el_plan_viejo_no_le_roba_el_paso_al_nuevo(taller):
    assert 102 not in _por_paso(await _tareas(taller, JUAN))
    assert 102 in _por_paso(await _tareas(taller, ANA))


async def test_la_elegida_a_mano_manda_sobre_el_plan(taller):
    assert 105 not in _por_paso(await _tareas(taller, JUAN))
    assert _por_paso(await _tareas(taller, ANA))[105]["origen"] == "ot"


async def test_un_paso_de_a_dos_cuenta_para_los_dos(taller):
    assert 103 in _por_paso(await _tareas(taller, BETO))


async def test_un_plan_viejo_ambiguo_no_se_adivina(taller):
    pasos = _por_paso(await _tareas(taller, JUAN))
    assert 301 not in pasos and 302 not in pasos


def test_la_regla_de_a_quien_le_toca():
    # Elegido a mano, un solo operario: sólo él, aunque el plan diga otra cosa.
    assert le_toca(JUAN, JUAN, {ANA}, 1) == "ot"
    assert le_toca(ANA, JUAN, {ANA}, 1) is None
    # Sin elegido: el último plan.
    assert le_toca(ANA, None, {ANA}, 1) == "plan"
    assert le_toca(JUAN, None, {ANA}, 1) is None
    # De a dos, con el elegido adentro del plan: el equipo entero.
    assert le_toca(BETO, JUAN, {JUAN, BETO}, 2) == "plan"
    assert le_toca(JUAN, JUAN, {JUAN, BETO}, 2) == "ot"
    # De a dos, pero el elegido no está en ese plan (lo cambiaron después): sólo él.
    assert le_toca(BETO, JUAN, {ANA, BETO}, 2) is None


# ─────────────────────── qué pasos y cómo se miden ───────────────────────

async def test_los_que_no_arrancaron_no_salen(taller):
    pasos = _por_paso(await _tareas(taller, JUAN))
    assert 104 not in pasos, "sin arranque"
    assert 106 not in pasos, "el centinela 1900-01-01 no es un arranque"


async def test_el_tiempo_descuenta_las_pausas_del_paso_y_de_la_ot(taller):
    """101: de 8 a 11 el martes. Jornada 8–9 y 9:15–11 = 165. Parado de 9:30 a 10:30
    (la OT y después el torno) = 60. La pausa del 102 no es suya."""
    t = _por_paso(await _tareas(taller, JUAN))[101]
    assert (t["estimado_min"], t["corrido_min"], t["fuera_de_jornada_min"]) == (120, 180, 15)
    assert (t["pausa_min"], t["efectivo_min"]) == (60, 105)
    assert t["numero_ot"] == 15279 and t["proceso"] == "TORNO CNC" and t["paso"] == 1
    assert t["articulo"] == "Bandeja" and t["estado"] == "Terminado" and t["en_curso"] is False
    # Sin zona.
    assert "Z" not in t["inicio_real"] and "+" not in t["inicio_real"]


async def test_en_curso_cuenta_hasta_ahora(taller):
    t = _por_paso(await _tareas(taller, JUAN))[103]
    assert t["en_curso"] is True and t["fin_real"] is None
    assert t["corrido_min"] > 0 and t["efectivo_min"] <= t["corrido_min"]


async def test_terminado_sin_fin_sale_sin_minutos_y_fuera_de_los_totales(taller):
    data = await _tareas(taller, JUAN)
    t = _por_paso(data)[107]
    assert t["sin_datos"] is True and t["efectivo_min"] is None and t["corrido_min"] is None
    con = [x for x in data["tareas"] if not x["sin_datos"]]
    assert data["resumen"]["efectivo_min"] == sum(x["efectivo_min"] for x in con)
    assert data["resumen"]["estimado_min"] == sum(x["estimado_min"] or 0 for x in con)
    assert data["resumen"]["terminadas"] == 3 and data["resumen"]["en_curso"] == 1


async def test_el_periodo_deja_lo_que_se_trabajo_en_el(taller):
    data = await _tareas(taller, JUAN, desde="2026-09-23", hasta="2026-09-23")
    assert set(_por_paso(data)) == {103, 107}, "103 sigue en curso; 107 no tiene fin y sigue abierto"
    data = await _tareas(taller, JUAN, desde="2026-09-21", hasta="2026-09-21")
    assert set(_por_paso(data)) == {107, 201}


async def test_los_mas_nuevos_primero_y_la_jornada_dicha(taller):
    data = await _tareas(taller, JUAN)
    arranques = [t["inicio_real"] for t in data["tareas"]]
    assert arranques == sorted(arranques, reverse=True)
    assert data["jornada"].startswith("Lunes a viernes 07:00")
    assert data["pausas_disponibles"] is True


# ─────────────────────── sin la tabla de pausas ───────────────────────

@pytest_asyncio.fixture
async def taller_sin_pausas():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})

    @event.listens_for(engine.sync_engine, "connect")
    def _fks(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    tablas = [t for t in TEST_TABLES if t.name != "orden_trabajo_pausa"]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tablas))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _mundo(s, con_pausas=False)
        yield s
    await engine.dispose()


async def test_sin_la_tabla_de_pausas_los_tiempos_salen_igual_y_lo_dice(taller_sin_pausas):
    data = await _tareas(taller_sin_pausas, JUAN)
    assert data["pausas_disponibles"] is False
    t = _por_paso(data)[101]
    assert (t["pausa_min"], t["efectivo_min"]) == (0, 165)


# ─────────────────────── la API ───────────────────────

async def test_la_api_de_tiempos(taller):
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(AsistenciaAPI.router)

    async def _db():
        yield taller

    app.dependency_overrides[AsistenciaAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: {"id_usuario": 1, "username": "x"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get(f"/operarios/{JUAN}/tiempos?desde=2026-09-22&hasta=2026-09-22")
        assert r.status_code == 200, r.text
        assert [t["id_otp"] for t in r.json()["data"]["tareas"]] == [103, 101, 107]
        r = await c.get(f"/operarios/{JUAN}/tiempos?desde=2026-09-22&hasta=2026-09-01")
        assert r.status_code == 422
        r = await c.get("/operarios/999/tiempos")
        assert r.status_code == 404
