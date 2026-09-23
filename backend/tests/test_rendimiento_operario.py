"""El reporte de rendimiento de una persona, en su ficha (RF-07).

La fuente son los tiempos efectivos de RF-06 (test_tiempos_operario.py ya prueba a quién
se le cuenta cada paso y cómo se mide). Acá, lo que el reporte agrega encima:

  1. **Qué es «completada».** Terminada con el fin adentro del período. Un terminado sin
     fin no se puede ubicar ni medir: sale en la tabla y se cuenta aparte.
  2. **El promedio y la eficiencia no se dejan engañar.** Afuera: el que se marcó
     arranque y fin juntos (efectivo cero), el que no tiene fin. La eficiencia es suma de
     estimados sobre suma de efectivos, y sin estimado no entra en ella.
  3. **Las horas trabajadas son las del período y cada hora una vez**: un paso que
     arrancó el mes pasado aporta sólo lo de este; dos pasos abiertos a la vez no suman
     el doble.
  4. **Las pausas**: cuánto, cuántas (una pausa de la OT que para dos pasos es una) y
     por qué.
  5. **Los días de ausencia** salen de la asistencia; sin la tabla, el reporte sale igual
     y lo dice.
  6. **Un proceso repetido en la OT no se cuenta de más**, que es lo que le pasa al
     cuadro del Dashboard (cruza el plan por OT y proceso).
  7. **Vacío con explicación**: nunca se le marcó un paso, o no en este período.

El reloj se fija (jueves 24/09/2026 12:00) para que lo «en curso» no dependa de cuándo
se corre esto.
"""
import random
import uuid
from datetime import date, datetime, time, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.application import AusenciaService as ausencia_mod
from backend.application import RendimientoOperarioService as mod
from backend.application.RendimientoOperarioService import (
    RendimientoOperarioService,
    eficiencia_pct,
    fmt_minutos,
    leer_periodo,
    lectura_eficiencia,
    nivel_de,
)
from backend.application.TiempoEfectivo import (
    minutos,
    restar,
    tiempo_de_un_paso,
    tramos_de_un_paso,
)
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.domain.Articulo import Articulo
from backend.domain.AusenciaOperario import AusenciaOperario
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
from backend.presentation import RendimientoOperarioAPI
from backend.tests.conftest import TEST_TABLES

JUAN, ANA = 1, 2
AHORA = datetime(2026, 9, 24, 12, 0)  # jueves
SEMANA = {"desde": "2026-09-21", "hasta": "2026-09-27"}


def dia(d: int, hh: int, mm: int = 0, mes: int = 9) -> datetime:
    """Un momento de septiembre de 2026 (lunes 21 … domingo 27)."""
    return datetime(2026, mes, d, hh, mm)


@pytest.fixture(autouse=True)
def reloj_fijo(monkeypatch):
    monkeypatch.setattr(mod, "ahora_ar", lambda: AHORA)
    monkeypatch.setattr(ausencia_mod, "ahora_ar", lambda: AHORA)


async def _base(session):
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
    for i, (nom, ape) in {JUAN: ("JUAN", "PEREZ"), ANA: ("ANA", "GIL")}.items():
        session.add(Operario(id=i, nombre=nom, apellido=ape, categoria="OFICIAL", disponible=True,
                             hora_inicio=time(7), hora_fin=time(16)))
    await session.flush()
    for id_ot, nro in ((10, 15279), (11, 15280), (12, 7497)):
        session.add(OrdenTrabajo(id=id_ot, id_otvieja=nro, id_prioridad=1, id_sector=1, id_articulo=1,
                                 fecha_orden=dia(1, 0), fecha_entrada=dia(1, 0),
                                 fecha_prometida=dia(30, 0), finalizadototal=0))
    await session.flush()


def _paso(id_, ot, proceso, orden, estado, estimado, inicio, fin=None, quien=JUAN):
    return OrdenTrabajoProceso(id=id_, id_orden_trabajo=ot, id_proceso=proceso, orden=orden,
                               id_estado=estado, tiempo_proceso=estimado, id_operario=quien,
                               inicio_real=inicio, fin_real=fin)


async def _semana(session):
    """La semana de JUAN (todo elegido a mano en la OT, salvo lo que se dice)."""
    await _base(session)
    session.add_all([
        # 101: torno, 2 h estimadas; martes de 8 a 11 con la OT parada 9:30–10 y el
        #      torno roto 10–10:30. Efectivo 105 (ver test_tiempos_operario).
        _paso(101, 10, 150, 1, 3, 120, dia(22, 8), dia(22, 11)),
        # 102: soldadura, 1 h estimada; lunes de 8 a 9. Justo lo estimado.
        _paso(102, 10, 160, 2, 3, 60, dia(21, 8), dia(21, 9)),
        # 103: pintura, sigue en curso desde el miércoles a las 8.
        _paso(103, 10, 170, 3, 2, 90, dia(23, 8)),
        # 104: arranque y fin en el mismo minuto: se marcó de una. Efectivo cero.
        _paso(104, 11, 150, 1, 3, 30, dia(23, 13), dia(23, 13)),
        # 105: sin estimado en la OT; lunes de 10 a 11.
        _paso(105, 11, 160, 2, 3, None, dia(21, 10), dia(21, 11)),
        # 106: terminado y sin fin registrado.
        _paso(106, 11, 170, 3, 3, 45, dia(21, 13)),
        # 199: de ANA: no es de JUAN.
        _paso(199, 11, 150, 4, 3, 60, dia(22, 8), dia(22, 9), quien=ANA),
    ])
    await session.flush()
    session.add_all([
        PausaOrden(id=1, id_orden_trabajo=10, id_otp=None, motivo="ESPERA_CLIENTE",
                   desde=dia(22, 9, 30), hasta=dia(22, 10), cierre="REANUDADA"),
        PausaOrden(id=2, id_orden_trabajo=10, id_otp=101, paso=1, motivo="MAQUINA_ROTA",
                   desde=dia(22, 10), hasta=dia(22, 10, 30), cierre="REANUDADA"),
    ])
    await session.commit()


@pytest_asyncio.fixture
async def semana(session):
    await _semana(session)
    return session


async def _reporte(session, id_operario=JUAN, **periodo):
    r = await RendimientoOperarioService(session).reporte(id_operario, **periodo)
    assert r.status is True
    return r.data


def _por_paso(data) -> dict:
    return {t["id_otp"]: t for t in data["tareas"]}


# ─────────────────────── 1. las cuentas puras ───────────────────────

def test_la_eficiencia_es_estimado_sobre_efectivo():
    assert eficiencia_pct(120, 100) == 120
    assert eficiencia_pct(60, 60) == 100
    assert eficiencia_pct(90, 120) == 75
    # Sin alguno de los dos, no hay eficiencia (y nunca se divide por cero).
    assert eficiencia_pct(None, 60) is None
    assert eficiencia_pct(0, 60) is None
    assert eficiencia_pct(60, 0) is None
    assert eficiencia_pct(60, None) is None


def test_la_eficiencia_dicha_en_castellano():
    assert nivel_de(125) == "rapido" and nivel_de(100) == "parejo" and nivel_de(80) == "lento"
    assert nivel_de(110) == "parejo" and nivel_de(90) == "parejo" and nivel_de(None) is None
    assert lectura_eficiencia(120, 600, 500, 12) == \
        "Tardó menos de lo estimado: lo que se estimaba en 10 h le llevó 8 h 20 min (12 tareas)."
    assert lectura_eficiencia(80, 480, 600, 1) == \
        "Tardó más de lo estimado: lo que se estimaba en 8 h le llevó 10 h (1 tarea)."
    assert lectura_eficiencia(100, 60, 60, 2).startswith("Tardó más o menos lo estimado")
    assert lectura_eficiencia(None, 0, 0, 0).startswith("Todavía no se puede calcular")


def test_los_minutos_se_escriben_como_en_la_pantalla():
    assert [fmt_minutos(m) for m in (None, 0, 45, 60, 135, 2295)] == \
        ["—", "0 min", "45 min", "1 h", "2 h 15 min", "38 h 15 min"]


def test_el_periodo_por_defecto_y_sus_topes():
    hoy = date(2026, 9, 24)
    assert leer_periodo(None, None, hoy) == (date(2026, 8, 26), hoy), "los últimos 30 días"
    assert leer_periodo("2026-09-01", "2026-09-30", hoy) == (date(2026, 9, 1), date(2026, 9, 30))
    with pytest.raises(BusinessException):
        leer_periodo("2026-09-30", "2026-09-01", hoy)
    with pytest.raises(BusinessException):
        leer_periodo("2025-01-01", "2026-09-01", hoy)
    assert leer_periodo("2025-09-24", "2026-09-24", hoy)[0] == date(2025, 9, 24), "366 días, entra"


def test_restar_tramos():
    a = [(dia(21, 8), dia(21, 12))]
    assert restar(a, [(dia(21, 9), dia(21, 10))]) == [(dia(21, 8), dia(21, 9)), (dia(21, 10), dia(21, 12))]
    assert restar(a, [(dia(21, 7), dia(21, 13))]) == []
    assert restar(a, []) == a
    assert restar(a, [(dia(21, 7), dia(21, 9)), (dia(21, 11), dia(21, 13))]) == [(dia(21, 9), dia(21, 11))]


def test_los_tramos_dan_lo_mismo_que_los_minutos_de_rf06():
    """tramos_de_un_paso es la misma cuenta que tiempo_de_un_paso, con los tramos a la
    vista: se comparan en muchos casos al azar (con pausas que se pisan, abiertas, que
    empiezan antes y terminan después)."""
    azar = random.Random(7)
    base = dia(19, 0)
    for _ in range(400):
        ini = base + timedelta(minutes=azar.randrange(0, 60 * 24 * 9))
        fin = None if azar.random() < 0.2 else ini + timedelta(minutes=azar.randrange(0, 60 * 24 * 4))
        pausas = []
        for _ in range(azar.randrange(0, 4)):
            p_ini = ini + timedelta(minutes=azar.randrange(-600, 60 * 24 * 3))
            p_fin = None if azar.random() < 0.2 else p_ini + timedelta(minutes=azar.randrange(1, 900))
            pausas.append((p_ini, p_fin))
        ahora = dia(30, 12)
        feriados = [date(2026, 9, 24)] if azar.random() < 0.3 else []
        t = tiempo_de_un_paso(ini, fin, pausas, ahora=ahora, feriados=feriados)
        tr = tramos_de_un_paso(ini, fin, pausas, ahora=ahora, feriados=feriados)
        assert minutos(tr.efectivos) == t.efectivo
        assert minutos(tr.en_pausa) == t.en_pausa
        assert minutos(tr.jornada) == t.corrido - t.fuera_de_jornada
        assert len(tr.por_pausa) == len(pausas) and tr.en_curso == t.en_curso


# ─────────────────────── 2. completadas, promedio y eficiencia ───────────────────────

async def test_completadas_promedio_y_eficiencia(semana):
    data = await _reporte(semana, **SEMANA)
    r = data["resumen"]
    pasos = _por_paso(data)
    assert set(pasos) == {101, 102, 103, 104, 105, 106}, "199 es de ANA"
    assert r["tareas_trabajadas"] == 6
    # Terminadas con fin en el período: 101, 102, 104 y 105. El 106 no tiene fin.
    assert r["tareas_completadas"] == 4
    assert r["en_curso"] == 1 and r["sin_datos"] == 1
    # El 104 se marcó de una (efectivo cero): ni en el promedio ni en la eficiencia.
    assert r["sin_tiempo"] == 1 and pasos[104]["medible"] is False
    # Promedio: 101 (105), 102 (60) y 105 (60, sin estimado pero medido).
    assert r["tareas_medidas"] == 3 and r["tiempo_promedio_min"] == 75
    # Eficiencia: sólo los que tienen estimado. (120 + 60) / (105 + 60) = 109 %.
    assert r["sin_estimado"] == 1
    ef = r["eficiencia"]
    assert (ef["estimado_min"], ef["efectivo_min"], ef["tareas"], ef["pct"]) == (180, 165, 2, 109)
    assert ef["nivel"] == "parejo"
    assert ef["lectura"] == ("Tardó más o menos lo estimado: lo que se estimaba en 3 h le llevó "
                             "2 h 45 min (2 tareas).")
    # Por tarea.
    assert pasos[101]["eficiencia_pct"] == 114 and pasos[102]["eficiencia_pct"] == 100
    assert pasos[105]["eficiencia_pct"] is None and pasos[103]["eficiencia_pct"] is None


async def test_la_tabla_lo_en_curso_arriba_y_despues_lo_ultimo_que_termino(semana):
    data = await _reporte(semana, **SEMANA)
    assert [t["id_otp"] for t in data["tareas"]][:3] == [103, 104, 101]
    t = _por_paso(data)[101]
    assert t["numero_ot"] == 15279 and t["proceso"] == "TORNO CNC" and t["origen"] == "ot"
    assert t["terminada_en_periodo"] is True
    # Sin zona, como todas las fechas de la app.
    assert "Z" not in t["inicio_real"] and "+" not in data["generado"]


async def test_una_terminada_antes_del_periodo_no_es_completada_del_periodo(semana):
    data = await _reporte(semana, desde="2026-09-23", hasta="2026-09-27")
    r = data["resumen"]
    # Del miércoles en adelante: 103 (en curso) y 104 (terminada ese día). El 106
    # (terminado sin fin, arrancó el lunes) va sólo en el período en que arrancó: si no,
    # aparecería —y contaría como trabajado— en todos los que vienen.
    assert set(_por_paso(data)) == {103, 104}
    assert data["resumen"]["sin_datos"] == 0
    assert r["tareas_completadas"] == 1 and r["tiempo_promedio_min"] is None
    assert r["eficiencia"]["pct"] is None
    assert r["eficiencia"]["lectura"].startswith("Todavía no se puede calcular")


# ─────────────────────── 3. horas trabajadas ───────────────────────

async def test_las_horas_son_las_del_periodo_y_cada_hora_una_vez(session):
    await _base(session)
    session.add_all([
        # Arrancó el lunes 31/08 a las 8 y terminó el martes 1/09 a las 9. Del 31: 8–9,
        # 9:15–12 y 12:30–16 (435); del 1: 7–9 (120).
        _paso(301, 10, 150, 1, 3, 600, dia(31, 8, mes=8), dia(1, 9)),
        # Dos pasos abiertos a la vez el martes 8/09: el 302 de 8 a 11 y el 303 de 8 a 9.
        _paso(302, 11, 150, 1, 3, 120, dia(8, 8), dia(8, 11)),
        _paso(303, 11, 160, 2, 3, 60, dia(8, 8), dia(8, 9)),
    ])
    await session.commit()

    data = await _reporte(session, desde="2026-09-01", hasta="2026-09-30")
    r = data["resumen"]
    pasos = _por_paso(data)
    # El 301 terminó en septiembre: es una completada de septiembre, con su tiempo entero.
    assert pasos[301]["efectivo_min"] == 555 and pasos[301]["efectivo_en_periodo_min"] == 120
    assert pasos[301]["terminada_en_periodo"] is True
    # 302: 8–9 y 9:15–11 = 165; 303: 8–9 = 60, que ya estaba en el 302.
    assert pasos[302]["efectivo_en_periodo_min"] == 165 and pasos[303]["efectivo_en_periodo_min"] == 60
    assert r["horas_trabajadas_min"] == 120 + 165
    assert r["superpuesto_min"] == 60

    # En agosto, sólo lo del 31 (y no es completada de agosto).
    agosto = await _reporte(session, desde="2026-08-01", hasta="2026-08-31")
    assert agosto["resumen"]["horas_trabajadas_min"] == 435
    assert agosto["resumen"]["tareas_completadas"] == 0


async def test_lo_en_curso_suma_hasta_ahora_y_no_despues(semana):
    """103 sigue desde el miércoles a las 8; el reloj marca el jueves a las 12. Del
    miércoles: 8–9, 9:15–12 y 12:30–16 (435). Del jueves: 7–9 y 9:15–12 (285). Nada de
    lo que falta del período, que todavía no pasó."""
    data = await _reporte(semana, desde="2026-09-23", hasta="2026-09-30")
    assert _por_paso(data)[103]["efectivo_en_periodo_min"] == 435 + 285
    assert _por_paso(data)[103]["en_curso"] is True


# ─────────────────────── 4. pausas ───────────────────────

async def test_las_pausas_cuanto_cuantas_y_por_que(semana):
    p = (await _reporte(semana, **SEMANA))["resumen"]["pausas"]
    assert p["minutos"] == 60 and p["cantidad"] == 2
    assert {x["motivo"]: x["minutos"] for x in p["por_motivo"]} == {"ESPERA_CLIENTE": 30, "MAQUINA_ROTA": 30}
    assert {x["texto"] for x in p["por_motivo"]} == {"Espera del cliente", "Máquina rota"}


async def test_una_pausa_de_la_ot_que_para_dos_pasos_es_una_pausa(session):
    await _base(session)
    session.add_all([
        _paso(401, 10, 150, 1, 3, 60, dia(22, 8), dia(22, 12)),
        _paso(402, 10, 160, 2, 3, 60, dia(22, 8), dia(22, 12)),
    ])
    await session.flush()
    session.add(PausaOrden(id=9, id_orden_trabajo=10, id_otp=None, motivo="FALTA_MATERIAL",
                           desde=dia(22, 10), hasta=dia(22, 11), cierre="REANUDADA"))
    await session.commit()
    p = (await _reporte(session, **SEMANA))["resumen"]["pausas"]
    assert p["cantidad"] == 1 and p["minutos"] == 60


async def test_una_pausa_fuera_del_periodo_no_cuenta(semana):
    data = await _reporte(semana, desde="2026-09-23", hasta="2026-09-27")
    assert data["resumen"]["pausas"] == {"minutos": 0, "cantidad": 0, "por_motivo": []}


# ─────────────────────── 5. ausencias ───────────────────────

async def test_los_dias_de_ausencia_del_periodo(semana):
    semana.add(AusenciaOperario(id_operario=JUAN, desde=date(2026, 9, 25), vuelve=date(2026, 9, 29),
                                motivo="ENFERMEDAD", origen="CARGA", cargada_en=dia(24, 8)))
    await semana.commit()
    data = await _reporte(semana, **SEMANA)
    a = data["resumen"]["ausencias"]
    # Del 25 al 28 cargado; en la semana del 21 al 27 caen 25, 26 y 27 (viernes,
    # sábado, domingo): corridos 3, laborables 1 (trabaja de lunes a viernes).
    assert (a["dias"], a["dias_laborables"]) == (3, 1)
    assert a["por_motivo"][0]["motivo"] == "ENFERMEDAD"
    assert data["ausencias_disponibles"] is True


def _motor_sin(tabla: str):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})

    @event.listens_for(engine.sync_engine, "connect")
    def _fks(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    return engine, [t for t in TEST_TABLES if t.name != tabla]


@pytest_asyncio.fixture
async def semana_sin_ausencias():
    engine, tablas = _motor_sin("operario_ausencia")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tablas))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _semana(s)
        yield s
    await engine.dispose()


async def test_sin_la_tabla_de_ausencias_el_reporte_sale_igual_y_lo_dice(semana_sin_ausencias):
    data = await _reporte(semana_sin_ausencias, **SEMANA)
    assert data["ausencias_disponibles"] is False and data["resumen"]["ausencias"] is None
    assert data["resumen"]["tareas_completadas"] == 4


@pytest_asyncio.fixture
async def semana_sin_pausas():
    engine, tablas = _motor_sin("orden_trabajo_pausa")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tablas))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _base(s)
        s.add(_paso(101, 10, 150, 1, 3, 120, dia(22, 8), dia(22, 11)))
        await s.commit()
        yield s
    await engine.dispose()


async def test_sin_la_tabla_de_pausas_el_reporte_sale_igual_y_lo_dice(semana_sin_pausas):
    data = await _reporte(semana_sin_pausas, **SEMANA)
    assert data["pausas_disponibles"] is False
    assert data["resumen"]["pausas"]["minutos"] == 0
    assert _por_paso(data)[101]["efectivo_min"] == 165


# ─────────────────────── 6. un proceso repetido en la OT ───────────────────────

async def test_un_proceso_repetido_en_la_ot_no_se_cuenta_de_mas(session):
    """La 7497 tiene TORNO CNC muchas veces. El cuadro del Dashboard cruza el plan por
    (OT, proceso) y con dos pasadas y dos filas de plan cuenta cuatro. Acá, dos."""
    await _base(session)
    session.add_all([
        # Sin elegido a mano: se los da el plan.
        _paso(501, 12, 150, 1, 3, 60, dia(22, 8), dia(22, 9), quien=None),
        _paso(502, 12, 150, 2, 3, 60, dia(22, 9, 15), dia(22, 10, 15), quien=None),
    ])
    await session.flush()
    lote = str(uuid.uuid4())
    for pid, id_otp in ((1, 501), (2, 502)):
        session.add(Planificacion(id=pid, orden_id=12, proceso_id=150, id_orden_trabajo_proceso=id_otp,
                                  id_operario=JUAN, inicio_min=0, fin_min=60, duracion_min=60,
                                  prioridad_peso=1, id_planificacion_lote=lote, creado_en=dia(21, 10)))
    await session.commit()
    data = await _reporte(session, **SEMANA)
    r = data["resumen"]
    assert r["tareas_completadas"] == 2
    assert r["eficiencia"]["estimado_min"] == 120 and r["eficiencia"]["efectivo_min"] == 120
    assert {t["origen"] for t in data["tareas"]} == {"plan"}


# ─────────────────────── 7. vacío, con explicación ───────────────────────

async def test_nunca_se_le_marco_un_paso(semana):
    data = await _reporte(semana, id_operario=ANA, desde="2026-08-01", hasta="2026-08-31")
    assert data["tareas"] == [] and data["historial"]["pasos"] == 1
    assert data["historial"]["ultimo_arranque"].startswith("2026-09-22T08:00")
    r = data["resumen"]
    assert r["tareas_completadas"] == 0 and r["horas_trabajadas_min"] == 0
    assert r["tiempo_promedio_min"] is None and r["eficiencia"]["pct"] is None


async def test_una_persona_sin_ningun_paso(session):
    await _base(session)
    await session.commit()
    data = await _reporte(session, **SEMANA)
    assert data["historial"] == {"pasos": 0, "ultimo_arranque": None}
    assert data["tareas"] == [] and data["resumen"]["tareas_trabajadas"] == 0
    assert data["persona"] == "JUAN PEREZ"


# ─────────────────────── la API ───────────────────────

async def test_la_api_de_rendimiento(semana):
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(RendimientoOperarioAPI.router)

    async def _db():
        yield semana

    app.dependency_overrides[RendimientoOperarioAPI.get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get(f"/operarios/{JUAN}/rendimiento?desde=2026-09-21&hasta=2026-09-27")
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["periodo"] == {"desde": "2026-09-21", "hasta": "2026-09-27", "dias": 7}
        assert data["resumen"]["tareas_completadas"] == 4
        # Sin período: los últimos 30 días hasta hoy (el reloj fijo).
        r = await c.get(f"/operarios/{JUAN}/rendimiento")
        assert r.json()["data"]["periodo"]["hasta"] == "2026-09-24"
        assert r.json()["data"]["periodo"]["desde"] == "2026-08-26"
        r = await c.get(f"/operarios/{JUAN}/rendimiento?desde=2026-09-27&hasta=2026-09-21")
        assert r.status_code == 422
        r = await c.get(f"/operarios/{JUAN}/rendimiento?desde=21/09/2026")
        assert r.status_code == 422
        r = await c.get("/operarios/999/rendimiento")
        assert r.status_code == 404
