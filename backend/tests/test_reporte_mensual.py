"""
RF-21, el reporte mensual: que los totales cierren, que el mes se corte en hora del
taller y que cada parte respete los permisos. Y el mail: se ARMA, no se manda.

LA BASE DE ABAJO: dos meses del taller (julio y agosto de 2026) con lo que pasa de
verdad — una OT entregada el 31 a las 23:30, una que entró el 31/07 a las 23:59, una
entregada el mismo día prometido, una sin fecha prometida, una finalizada sin fecha de
entrega, un paso que cruza el fin de mes (y un sábado), un feriado (17/08), una pausa
por máquina rota adentro de un paso, una por falta de material de un fin de semana, una
que cruza de julio a agosto, un paso terminado sin fin (dato roto), uno sin estimado,
uno todavía en proceso, vacaciones de cinco días, un día de enfermedad, no
conformidades con y sin persona, y consumos en dos unidades (uno anulado).

«Ahora» es el miércoles 02/09/2026 a las 10:00: agosto está cerrado y septiembre en curso.

CONTRA QUÉ BASE

SQLite en memoria siempre. Y, con SPMM_PG_PRUEBAS apuntando a un Postgres DESCARTABLE en
localhost, todo otra vez ahí, con el reloj de la base en UTC como Supabase: si algo del
reporte usara now() / CURRENT_DATE de la base, la OT del 31 a las 23:30 caería en
septiembre. Esa base se BORRA ENTERA (DROP SCHEMA public CASCADE): sólo localhost.

    SPMM_PG_PRUEBAS=postgresql+asyncpg://spmm@127.0.0.1:55421/rf_21_mensual pytest ...
"""
import os
from datetime import date, datetime, time
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.application import AusenciaService as ausencia_mod
from backend.application import RendimientoOperarioService as rendimiento_mod
from backend.application import ReporteMensualService as rm
from backend.application.ReporteMensualService import (
    Alcance,
    ReporteMensualService,
    alcance_de,
    armar_mail_del_reporte,
    csv_del_reporte,
    preparar_mails_del_mes,
)
from backend.commons.exceptions.BusinessException import BusinessException
from backend.core.permisos import DatosDePermisos, MATRIZ_ROL_AREA, permisos_de
from backend.domain.Articulo import Articulo
from backend.domain.AusenciaOperario import AusenciaOperario
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import PausaOrden
from backend.domain.Pieza import Pieza
from backend.domain.Planificacion import Planificacion
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.domain.Usuario import Usuario
from backend.infrastructure.db import Base
from backend.presentation import DashboardAPI as api
from backend.tests.conftest import TEST_TABLES

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url: str) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


MOTORES = ["sqlite"] + (["postgres"] if PG_URL and _pg_seguro(PG_URL) else [])

AHORA = datetime(2026, 9, 2, 10, 0)
VIEJA = datetime(1950, 1, 1)
NUEVA = datetime(3000, 1, 1)
TABLAS = TEST_TABLES + [Usuario.__table__]


def dt(mes: int, dia: int, h: int = 0, m: int = 0) -> datetime:
    return datetime(2026, mes, dia, h, m)


# (id, entrada, prometida, entrega, finalizada, cliente, artículo)
OTS = [
    (201, dt(7, 3), dt(7, 20), dt(7, 18, 11), 1, 1, 1),        # julio, a tiempo
    (202, dt(7, 10), dt(7, 25), dt(8, 4, 9), 1, 2, 2),         # sale en agosto, 10 días tarde
    (203, dt(7, 15), dt(7, 31), None, 0, 2, 1),                # abierta y vencida
    (204, dt(8, 1), dt(8, 20), dt(8, 31, 23, 30), 1, 1, 3),    # entregada el 31 a las 23:30
    (205, dt(8, 5), dt(8, 28), dt(8, 28, 17), 1, 3, 1),        # el mismo día: a tiempo
    (206, dt(8, 10), dt(9, 15), None, 0, 1, 2),                # abierta, no vencida
    (207, dt(7, 31, 23, 59), dt(8, 10), dt(9, 1, 0, 30), 1, 3, 3),  # entra en julio, sale en sept.
    (208, dt(8, 12), VIEJA, dt(8, 25, 15), 1, 2, 1),           # sin fecha prometida
    (209, dt(6, 1), dt(6, 20), VIEJA, 1, 1, 1),                # finalizada sin fecha de entrega
    (210, dt(6, 15), NUEVA, None, 0, 1, 2),                    # abierta, prometida «3000»
]

# (id, OT, proceso, paso, estado, estimado, elegido, inicio, fin)
PASOS = [
    (3001, 204, 150, 1, 3, 120, 1, dt(8, 4, 7), dt(8, 4, 10)),        # 165 min
    (3002, 204, 160, 2, 3, 60, 2, dt(8, 5, 13), dt(8, 5, 14)),        # 60
    (3003, 205, 150, 1, 3, 240, None, dt(7, 31, 14), dt(8, 3, 9)),    # 120 jul + 420 ago (sábado)
    (3004, 206, 151, 1, 3, 100, 1, dt(8, 17, 8), dt(8, 18, 8, 40)),   # feriado + 30 min de pausa: 70
    (3005, 206, 160, 2, 2, 90, 2, dt(8, 31, 15), None),               # en proceso: 60 en agosto
    (3006, 203, 150, 1, 3, 60, 1, dt(7, 20, 7), dt(7, 20, 8, 30)),    # julio: 90
    (3007, 207, 151, 1, 3, None, 2, dt(8, 10, 7), dt(8, 10, 8)),      # sin estimado: 60
    (3008, 210, 150, 1, 3, 30, 1, dt(8, 20, 7), None),                # terminado sin fin: roto
    (3009, 209, 150, 1, 3, 30, 1, datetime(1900, 1, 1), datetime(1900, 1, 1)),  # centinela viejo
]


async def _sembrar(s):
    s.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Mecanizado"),
        Articulo(id=1, cod_articulo="EJ-50", descripcion="Eje 50 mm", abreviatura="EJE"),
        Articulo(id=2, cod_articulo="BR-8", descripcion="Brida 8 agujeros", abreviatura="BRI"),
        Articulo(id=3, cod_articulo="EN-20", descripcion="Engranaje Z20", abreviatura="ENG"),
        Cliente(id=1, nombre="ACME Agro"),
        Cliente(id=2, nombre="Molinos del Sur"),
        Cliente(id=3, nombre="Frigorífico Norte"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="En Proceso"),
        EstadoProceso(id=3, descripcion="Finalizado"),
        Proceso(id=150, nombre="TORNO CNC"),
        Proceso(id=151, nombre="FRESADORA"),
        Proceso(id=160, nombre="SOLDADURA"),
        Operario(id=1, nombre="JUAN", apellido="PEREZ", categoria="OFICIAL",
                 hora_inicio=time(7), hora_fin=time(16)),
        Operario(id=2, nombre="ANA", apellido="GOMEZ", categoria="OFICIAL",
                 hora_inicio=time(7), hora_fin=time(16)),
        Operario(id=3, nombre="LUIS", apellido="DIAZ", categoria="MEDIO OFICIAL",
                 hora_inicio=time(7), hora_fin=time(16)),
        Pieza(id=1, cod_pieza="SAE1045-50", descripcion="Barra SAE 1045 Ø50", unidad="KG"),
        Pieza(id=2, cod_pieza="CH-3", descripcion="Chapa 3 mm", unidad="UN"),
        Usuario(id_usuario=1, username="julian", email="julian@metlo.com.ar", password_hash="x",
                nombre="Julián", apellido="Boxler", rol="admin", activo=True),
        Usuario(id_usuario=2, username="lucas", email="lucas@metlo.com.ar", password_hash="x",
                nombre="Lucas", apellido="L", rol="admin", activo=True),
        Usuario(id_usuario=3, username="viejo", email="viejo@metlo.com.ar", password_hash="x",
                nombre="Ex", apellido="Admin", rol="admin", activo=False),
        Usuario(id_usuario=4, username="super", email="super@metlo.com.ar", password_hash="x",
                nombre="Sup", apellido="Er", rol="supervisor", activo=True),
    ])
    await s.flush()
    for (id_, entrada, prometida, entrega, fin, cliente, articulo) in OTS:
        s.add(OrdenTrabajo(
            id=id_, id_otvieja=15000 + id_, finalizadototal=fin, fecha_entrega=entrega,
            fecha_prometida=prometida, fecha_orden=entrada, fecha_entrada=entrada,
            id_sector=1, id_prioridad=1, id_articulo=articulo, id_cliente=cliente, unidades=1,
        ))
    await s.flush()
    for (id_, ot, proceso, paso, estado, estimado, elegido, inicio, fin) in PASOS:
        s.add(OrdenTrabajoProceso(
            id=id_, id_orden_trabajo=ot, id_proceso=proceso, orden=paso, id_estado=estado,
            tiempo_proceso=estimado, id_operario=elegido, inicio_real=inicio, fin_real=fin,
        ))
    await s.flush()
    # El 3003 no tiene a nadie elegido: se lo dio el plan a ANA.
    s.add(Planificacion(orden_id=205, proceso_id=150, id_orden_trabajo_proceso=3003,
                        id_operario=2, inicio_min=0, fin_min=240, duracion_min=240,
                        prioridad_peso=3, creado_en=dt(7, 30)))
    s.add_all([
        # Adentro del paso 3004 (el 18/08 de 07:00 a 07:30): se descuenta del paso.
        PausaOrden(id_orden_trabajo=206, id_otp=3004, paso=1, nombre_proceso="FRESADORA",
                   motivo="MAQUINA_ROTA", desde=dt(8, 18, 7), hasta=dt(8, 18, 7, 30),
                   cierre="REANUDADA"),
        # La OT entera, de un viernes al lunes: 210 + 300 (sábado) + 120 minutos de jornada.
        PausaOrden(id_orden_trabajo=206, motivo="FALTA_MATERIAL", desde=dt(8, 21, 12),
                   hasta=dt(8, 24, 9), cierre="REANUDADA"),
        # Cruza de julio a agosto: 555 en julio, 360 en agosto.
        PausaOrden(id_orden_trabajo=203, motivo="ESPERA_CLIENTE", desde=dt(7, 30, 15),
                   hasta=dt(8, 3, 8), cierre="REANUDADA"),
    ])
    s.add_all([
        AusenciaOperario(id_operario=3, desde=date(2026, 8, 10), vuelve=date(2026, 8, 15),
                         motivo="VACACIONES", origen="CARGA", cargada_en=dt(8, 1, 9)),
        AusenciaOperario(id_operario=1, desde=date(2026, 8, 19), vuelve=date(2026, 8, 20),
                         motivo="ENFERMEDAD", origen="CARGA", cargada_en=dt(8, 19, 8)),
    ])
    s.add_all([
        IncidenciaProceso(id_orden_trabajo=204, id_proceso=150, id_operario=1,
                          tipo="MEDIDA_FUERA_DE_TOLERANCIA", gravedad="MEDIA", piezas_afectadas=3,
                          minutos_perdidos=45, estado="ABIERTA", fecha_registro=dt(8, 6, 10)),
        # El 31 a las 23:10: es de agosto.
        IncidenciaProceso(id_orden_trabajo=205, id_proceso=150, id_operario=2,
                          tipo="INTERPRETACION_PLANOS", gravedad=None, piezas_afectadas=None,
                          minutos_perdidos=30, estado="ABIERTA", fecha_registro=dt(8, 31, 23, 10)),
        IncidenciaProceso(id_orden_trabajo=206, id_operario=None,
                          tipo="MEDIDA_FUERA_DE_TOLERANCIA", gravedad="GRAVE", piezas_afectadas=2,
                          minutos_perdidos=0, estado="CERRADA", fecha_registro=dt(8, 20, 11),
                          fecha_cierre=dt(8, 22, 9)),
        IncidenciaProceso(id_orden_trabajo=203, id_operario=1, tipo="MATERIAL_NO_CONFORME",
                          piezas_afectadas=5, minutos_perdidos=20, estado="ABIERTA",
                          fecha_registro=dt(7, 15, 9)),
        # El 1° de septiembre a las 00:05: NO es de agosto.
        IncidenciaProceso(id_orden_trabajo=206, tipo="OTRO", minutos_perdidos=0,
                          estado="ABIERTA", fecha_registro=dt(9, 1, 0, 5)),
    ])
    s.add_all([
        ConsumoMaterial(id_orden_trabajo=204, id_pieza=1, cantidad=12.5, unidad="KG",
                        fecha=dt(8, 4, 8), anulado=0),
        ConsumoMaterial(id_orden_trabajo=204, id_pieza=1, cantidad=7.5, unidad=" kg ",
                        fecha=dt(8, 6, 8), anulado=0),
        ConsumoMaterial(id_orden_trabajo=205, id_pieza=2, cantidad=3, unidad="UN",
                        fecha=dt(8, 10, 9), anulado=0),
        # Anulado: no suma.
        ConsumoMaterial(id_orden_trabajo=205, id_pieza=2, cantidad=99, unidad="UN",
                        fecha=dt(8, 11, 9), anulado=1, anulado_en=dt(8, 11, 10),
                        motivo_anulacion="cargado de más"),
        ConsumoMaterial(id_orden_trabajo=203, id_pieza=1, cantidad=4, unidad="KG",
                        fecha=dt(7, 20, 8), anulado=0),
    ])
    await s.commit()
    # El calendario del taller: el 17/08 es feriado.
    await s.execute(text("CREATE TABLE IF NOT EXISTS dia_bloqueado (fecha DATE PRIMARY KEY, "
                         "creado_en TIMESTAMP)"))
    await s.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES ('2026-08-17')"))
    await s.commit()


@pytest_asyncio.fixture(params=MOTORES)
async def base(request):
    motor = request.param
    if motor == "postgres":
        engine = create_async_engine(PG_URL, poolclass=NullPool)
    else:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                     connect_args={"check_same_thread": False})

        @event.listens_for(engine.sync_engine, "connect")
        def _fks(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    async with engine.begin() as conn:
        if motor == "postgres":
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.execute(text("SET TIME ZONE 'UTC'"))
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLAS))

    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _sembrar(s)
    Sesion.motor = motor
    yield Sesion
    await engine.dispose()


@pytest.fixture(autouse=True)
def reloj(monkeypatch):
    """El reloj del taller, el mismo para el reporte y para lo que reusa (RF-06/07)."""
    monkeypatch.setattr(rendimiento_mod, "ahora_ar", lambda: AHORA)
    monkeypatch.setattr(ausencia_mod, "ahora_ar", lambda: AHORA)
    monkeypatch.setattr(api, "ahora_ar", lambda: AHORA)


async def _armar(Sesion, anio=2026, mes=8, alcance=None):
    async with Sesion() as s:
        if Sesion.motor == "postgres":
            await s.execute(text("SET TIME ZONE 'UTC'"))
        return await ReporteMensualService(s).armar(anio, mes, alcance or Alcance.todo(), ahora=AHORA)


# ─────────────────────────── el mes y el corte ───────────────────────────


async def test_la_entregada_el_31_a_las_2330_es_de_ese_mes(base):
    agosto = await _armar(base)
    septiembre = await _armar(base, 2026, 9)
    de_agosto = {f["numero"] for f in agosto["ordenes"]["entregadas"]}
    de_septiembre = {f["numero"] for f in septiembre["ordenes"]["entregadas"]}
    assert 15204 in de_agosto and 15204 not in de_septiembre
    # Y la del 1° a las 00:30, al revés.
    assert 15207 in de_septiembre and 15207 not in de_agosto
    # La que entró el 31/07 a las 23:59 es de julio; la del 01/08 00:00, de agosto.
    julio = await _armar(base, 2026, 7)
    assert julio["ordenes"]["resumen"]["ingresadas"] == 4      # 201, 202, 203, 207
    assert agosto["ordenes"]["resumen"]["ingresadas"] == 4     # 204, 205, 206, 208
    # La no conformidad del 31 a las 23:10 es de agosto; la del 1° a las 00:05, no.
    assert agosto["calidad"]["resumen"]["total"] == 3
    assert septiembre["calidad"]["resumen"]["total"] == 1
    fila = next(f for f in agosto["ordenes"]["entregadas"] if f["numero"] == 15204)
    assert fila["fecha_entrega"] == "2026-08-31T23:30:00"


async def test_el_mes_en_curso_se_corta_en_ahora_y_lo_dice(base):
    r = await _armar(base, 2026, 9)
    assert r["periodo"]["parcial"] is True
    assert r["periodo"]["corte"] == "2026-09-02T10:00:00"
    assert r["anterior"]["titulo"] == "agosto de 2026" and r["anterior"]["parcial"] is False
    assert any("todavía no terminó" in a for a in r["avisos"])
    # Las atrasadas del mes en curso se cuentan contra HOY, no contra el 1° de octubre:
    # la 206 (prometida el 15/09) todavía no está atrasada.
    atrasadas = {f["numero"] for f in r["ordenes"]["atrasadas"]}
    assert atrasadas == {15203}


async def test_un_mes_que_no_empezo_o_que_no_es_un_mes_no_se_arma(base):
    for anio, mes in ((2026, 10), (2026, 13), (2026, 0), (1999, 5), ("x", 3)):
        with pytest.raises(BusinessException):
            await _armar(base, anio, mes)


def test_el_mes_por_defecto_es_el_anterior():
    assert rm.mes_por_defecto(datetime(2026, 9, 2)) == (2026, 8)
    assert rm.mes_por_defecto(datetime(2027, 1, 1, 0, 5)) == (2026, 12)
    assert rm.limites_del_mes(2026, 12) == (datetime(2026, 12, 1), datetime(2027, 1, 1))


# ─────────────────────────── los totales cierran ───────────────────────────


async def test_ordenes(base):
    r = await _armar(base)
    o, ant = r["ordenes"]["resumen"], r["ordenes"]["anterior"]
    assert o == {
        "ingresadas": 4,
        "entregadas": 4,                 # 202, 204, 205, 208
        "a_tiempo": 1,                   # 205, el mismo día
        "con_atraso": 2,                 # 202 (10 días), 204 (11 días)
        "sin_fecha_prometida": 1,        # 208
        "pct_a_tiempo": 33.3,
        "dias_atraso_promedio": 10.5,
        "abiertas_al_cierre": 4,         # 203, 206, 207 (salió el 1/9), 210
        "atrasadas_al_cierre": 2,        # 203, 207
    }
    assert o["a_tiempo"] + o["con_atraso"] + o["sin_fecha_prometida"] == o["entregadas"]
    assert len(r["ordenes"]["entregadas"]) == o["entregadas"]
    assert len(r["ordenes"]["atrasadas"]) == o["atrasadas_al_cierre"]
    assert {(f["numero"], f["dias_atraso"]) for f in r["ordenes"]["atrasadas"]} == {
        (15203, 32), (15207, 22)}
    assert ant == {
        "ingresadas": 4, "entregadas": 1, "a_tiempo": 1, "con_atraso": 0,
        "sin_fecha_prometida": 0, "pct_a_tiempo": 100.0, "dias_atraso_promedio": None,
        "abiertas_al_cierre": 4,         # 202, 203, 207, 210
        "atrasadas_al_cierre": 2,        # 202, 203
    }
    assert r["ordenes"]["top_clientes"] == [
        {"cliente": "ACME Agro", "ingresadas": 2, "entregadas": 1},
        {"cliente": "Molinos del Sur", "ingresadas": 1, "entregadas": 2},
        {"cliente": "Frigorífico Norte", "ingresadas": 1, "entregadas": 1},
    ]
    # La finalizada sin fecha de entrega no está en ningún lado, y se avisa.
    assert any("sin fecha de entrega" in a for a in r["avisos"])


async def test_produccion(base):
    r = await _armar(base)
    p = r["produccion"]
    por = {f["proceso"]: f for f in p["por_proceso"]}
    assert por["TORNO CNC"]["horas_min"] == 165 + 420          # 3008 está roto: sin horas
    assert por["TORNO CNC"]["sin_datos"] == 1
    assert (por["TORNO CNC"]["estimado_min"], por["TORNO CNC"]["real_min"]) == (360, 705)
    assert por["TORNO CNC"]["desvio_pct"] == 95.8
    assert por["FRESADORA"]["horas_min"] == 70 + 60            # feriado y pausa descontados
    assert (por["FRESADORA"]["estimado_min"], por["FRESADORA"]["real_min"]) == (100, 70)
    assert por["FRESADORA"]["desvio_pct"] == -30.0
    assert por["FRESADORA"]["sin_estimado"] == 1
    assert por["SOLDADURA"]["horas_min"] == 60 + 60            # uno sigue en proceso
    assert por["SOLDADURA"]["pasos_terminados"] == 1
    # Lo de cada proceso suma el total.
    res = p["resumen"]
    for clave in ("horas_min", "pasos_trabajados", "pasos_terminados", "estimado_min",
                  "real_min", "sin_estimado", "sin_datos"):
        assert res[clave] == sum(f[clave] for f in p["por_proceso"]), clave
    assert res["horas_min"] == 835
    assert res["desvio_pct"] == 60.6
    # Julio: el 3003 (la parte de julio, sin terminar) y el 3006.
    assert p["anterior"]["horas_min"] == 120 + 90
    assert (p["anterior"]["estimado_min"], p["anterior"]["real_min"]) == (60, 90)
    # Las OT con más horas, la más cargada primero.
    assert [f["numero"] for f in p["top_ot"]] == [15205, 15204, 15206, 15207, 15210]
    assert p["top_ot"][0]["horas_min"] == 420


async def test_pausas(base):
    r = await _armar(base)
    pa = r["produccion"]["pausas"]
    assert pa["disponibles"] is True
    por = {f["motivo"]: f for f in pa["por_motivo"]}
    assert por["FALTA_MATERIAL"]["minutos"] == 210 + 300 + 120
    assert por["ESPERA_CLIENTE"]["minutos"] == 360            # la parte de agosto
    assert por["ESPERA_CLIENTE"]["iniciadas"] == 0            # arrancó en julio
    assert por["MAQUINA_ROTA"]["minutos"] == 30
    assert pa["minutos"] == sum(f["minutos"] for f in pa["por_motivo"]) == 1020
    assert pa["cantidad"] == 3 and pa["iniciadas"] == 2
    assert r["produccion"]["anterior"]["pausas_min"] == 555


async def test_personas_es_el_reporte_de_cada_uno_con_el_mes_como_periodo(base):
    r = await _armar(base)
    pe = r["personas"]
    por = {f["persona"]: f for f in pe["filas"]}
    assert [f["persona"] for f in pe["filas"]] == ["ANA GOMEZ", "JUAN PEREZ", "LUIS DIAZ"]
    assert por["ANA GOMEZ"]["horas_trabajadas_min"] == 60 + 420 + 60 + 60
    assert por["ANA GOMEZ"]["tareas_completadas"] == 3
    assert por["ANA GOMEZ"]["eficiencia_pct"] == 50           # 300 estimados en 600
    assert por["JUAN PEREZ"]["horas_trabajadas_min"] == 165 + 70
    assert por["JUAN PEREZ"]["eficiencia_pct"] == 94          # 220 en 235
    assert por["JUAN PEREZ"]["ausencias"]["dias"] == 1
    assert por["LUIS DIAZ"]["horas_trabajadas_min"] == 0
    assert por["LUIS DIAZ"]["ausencias"]["dias"] == 5
    assert por["LUIS DIAZ"]["ausencias"]["dias_laborables"] == 5
    res = pe["resumen"]
    assert res["personas"] == 3
    assert res["horas_trabajadas_min"] == sum(f["horas_trabajadas_min"] for f in pe["filas"]) == 835
    assert res["tareas_completadas"] == 5
    assert res["eficiencia_pct"] == 62                        # 520 en 835
    assert res["dias_ausencia"] == 6
    # Julio: JUAN (el 3006) y ANA (la parte de julio del 3003). LUIS no tuvo nada.
    assert pe["anterior"]["personas"] == 2
    assert pe["anterior"]["horas_trabajadas_min"] == 90 + 120
    assert pe["anterior"]["eficiencia_pct"] == 67

    # Y es el MISMO número que la ficha de la persona (RF-07), no una segunda cuenta.
    async with base() as s:
        ficha = (await rendimiento_mod.RendimientoOperarioService(s).reporte(
            2, "2026-08-01", "2026-08-31")).data
    assert ficha["resumen"]["horas_trabajadas_min"] == por["ANA GOMEZ"]["horas_trabajadas_min"]
    assert ficha["resumen"]["eficiencia"]["pct"] == por["ANA GOMEZ"]["eficiencia_pct"]


async def test_calidad(base):
    r = await _armar(base)
    c = r["calidad"]
    # Con RF-12 el resumen suma de cuántas controladas y cuántas OT; ninguna NC de la base
    # dice de cuántas controladas, así que no hay porcentaje (no un 0 %).
    assert c["resumen"] == {"total": 3, "abiertas": 2, "cerradas": 1,
                            "minutos_perdidos": 75, "piezas_afectadas": 5,
                            "piezas_controladas": 0, "porcentaje_rechazo": None, "ordenes": 3}
    assert c["anterior"]["total"] == 1 and c["anterior"]["piezas_afectadas"] == 5
    for grupo in ("por_tipo", "por_persona", "por_gravedad"):
        assert sum(g["cantidad"] for g in c[grupo]) == c["resumen"]["total"], grupo
        assert sum(g["piezas"] for g in c[grupo]) == c["resumen"]["piezas_afectadas"], grupo
    tipos = {g["texto"]: g for g in c["por_tipo"]}
    assert tipos["Medida fuera de tolerancia"]["cantidad"] == 2
    assert tipos["Medida fuera de tolerancia"]["piezas"] == 5
    personas = {g["texto"]: g["cantidad"] for g in c["por_persona"]}
    assert personas == {"JUAN PEREZ": 1, "ANA GOMEZ": 1, "Sin persona asignada": 1}
    assert {g["texto"] for g in c["por_gravedad"]} == {"Media", "Grave", "Sin clasificar"}
    assert len(c["lista"]) == 3
    # Agosto es de antes del 22/09/2026: se avisa lo de las NC guardadas en UTC.
    assert any("Greenwich" in a for a in r["avisos"])


async def test_materiales(base):
    r = await _armar(base)
    m = r["materiales"]
    assert m["resumen"] == {"cargas": 3, "materiales": 2, "ordenes": 2}
    assert m["anterior"] == {"cargas": 1, "materiales": 1, "ordenes": 1}
    por = {(f["cod_pieza"], f["unidad"]): f for f in m["por_material"]}
    # « kg » y «KG» son la misma unidad; el anulado (99 UN) no suma.
    assert por[("SAE1045-50", "KG")]["cantidad"] == 20.0
    assert por[("SAE1045-50", "KG")]["cargas"] == 2
    assert por[("CH-3", "UN")]["cantidad"] == 3.0
    assert sum(f["cargas"] for f in m["por_material"]) == m["resumen"]["cargas"]
    assert sum(f["cargas"] for f in m["por_ot"]) == m["resumen"]["cargas"]


async def test_maquinas_sin_uso_registrado_sale_vacia_sin_inventar_nada(base):
    r = await _armar(base)
    m = r["maquinas"]
    assert m["disponible"] is True
    assert m["filas"] == [] and m["mantenimientos"] == []
    assert m["resumen"] == {"maquinas": 0, "horas_min": 0, "mantenimientos": 0, "avisos": 0}


async def test_maquinas_con_las_horas_de_rf10_y_los_mantenimientos_del_mes(base):
    """El cruce RF-10 × RF-21: las horas efectivas de uso_maquina recortadas al mes (la
    misma cuenta de la solapa Uso) y los mantenimientos registrados con fecha del mes."""
    from backend.domain.MantenimientoMaquina import MantenimientoHecho
    from backend.domain.Maquinaria import Maquinaria
    from backend.domain.UsoMaquina import NO_SUMA_FUERA_DE_SERVICIO, UsoMaquina

    def uso(id_otp, inicio, fin, no_suma=None, maquina=7):
        return UsoMaquina(id_maquinaria=maquina, origen_maquina="OT", id_orden_trabajo=201,
                          numero_ot=15201, id_otp=id_otp, paso=1, nombre_proceso="TORNO CNC",
                          inicio=inicio, fin=fin, no_suma=no_suma)

    async with base() as s:
        s.add_all([Maquinaria(id=7, nombre="TORNO CNC 1"), Maquinaria(id=8, nombre="FRESADORA 2")])
        await s.flush()
        s.add_all([
            # Martes 04/08 de 08 a 10: 105 min de jornada (el corte de 09:00 a 09:15).
            uso(9001, dt(8, 4, 8), dt(8, 4, 10)),
            # Viernes 31/07 14:00 → lunes 03/08 09:00: 120 en julio (hasta las 16) y 420 en
            # agosto (el sábado de 07 a 12 y el lunes de 07 a 09; el domingo no es jornada).
            uso(9002, dt(7, 31, 14), dt(8, 3, 9)),
            # Arrancado con la máquina fuera de servicio: no suma.
            uso(9003, dt(8, 5, 8), dt(8, 5, 12), NO_SUMA_FUERA_DE_SERVICIO),
            MantenimientoHecho(id_maquinaria=8, fecha=date(2026, 8, 15), hecho_por="Técnico Ruiz",
                               nota="Cambio de aceite", cargado_en=dt(8, 15, 10)),
            # De septiembre: no es del mes.
            MantenimientoHecho(id_maquinaria=7, fecha=date(2026, 9, 1), cargado_en=dt(9, 1, 10)),
        ])
        await s.commit()

    r = await _armar(base)
    m = r["maquinas"]
    assert m["disponible"] is True
    assert m["resumen"] == {"maquinas": 1, "horas_min": 525, "mantenimientos": 1, "avisos": 0}
    assert m["anterior"] == {"maquinas": 1, "horas_min": 120, "mantenimientos": 0}
    assert m["filas"] == [{"id_maquinaria": 7, "maquina": "TORNO CNC 1", "horas_min": 525,
                           "tareas": 2, "horas_min_anterior": 120, "mantenimientos": 0}]
    assert [(x["maquina"], x["fecha"], x["hecho_por"]) for x in m["mantenimientos"]] == [
        ("FRESADORA 2", "2026-08-15", "Técnico Ruiz")]
    csv_ = csv_del_reporte(r)
    assert "TORNO CNC 1;8,75;2;2,00;0" in csv_
    assert "15/08/2026;FRESADORA 2;Técnico Ruiz;Cambio de aceite" in csv_


# ─────────────────────────── permisos ───────────────────────────


def _permisos(rol, areas=None, secciones=None):
    datos = DatosDePermisos(rol=rol, rol_areas=areas if areas is not None else MATRIZ_ROL_AREA.get(rol, {}),
                            usuario_secciones=secciones or {})
    return permisos_de(datos, id_usuario=9, username="x")


def test_el_alcance_sale_del_mapa_de_permisos():
    assert alcance_de(None) == Alcance()
    assert alcance_de(_permisos("admin")) == Alcance.todo()

    sup = alcance_de(_permisos("supervisor"))
    assert sup.ordenes and sup.clientes and sup.calidad and sup.materiales and sup.pausas
    assert not sup.personas and not sup.ausencias       # la sección es confidencial

    op = alcance_de(_permisos("operario"))
    assert op.ordenes and op.calidad
    assert not op.clientes                               # sin Clientes, sin ranking
    assert not op.personas

    # Con «Rendimiento por persona» dada a mano ve las personas; y como tiene
    # Operaciones, también sus ausencias.
    op_mas = alcance_de(_permisos("operario", secciones={"dashboard_rendimiento": "read"}))
    assert op_mas.personas and op_mas.ausencias

    # Sólo el tablero y la sección confidencial: las personas sí, sus ausencias no (el
    # motivo puede ser una enfermedad: eso pide Recursos u Operaciones).
    solo = alcance_de(_permisos("x", areas={"dashboard": "read"},
                                secciones={"dashboard_rendimiento": "read"}))
    assert solo.personas and not solo.ausencias
    assert not solo.ordenes and not solo.calidad and not solo.materiales

    nada = alcance_de(_permisos("x", areas={"dashboard": "read"}))
    assert not nada.algo

    # Las máquinas piden lo mismo que la solapa de RF-10 (Recursos › Recurso maquinaria).
    maq = alcance_de(_permisos("x", areas={"dashboard": "read"},
                               secciones={"recursos_maquinaria": "read"}))
    assert maq.maquinas and not maq.ordenes and not maq.personas
    assert not alcance_de(_permisos("x", areas={"dashboard": "read", "operaciones": "read"},
                                    secciones={"recursos_maquinaria": "none"})).maquinas


async def test_sin_la_seccion_confidencial_las_personas_no_se_leen_ni_se_mandan(base, monkeypatch):
    async def no_se_llama(*_a, **_k):
        raise AssertionError("sin permiso no se lee el rendimiento de nadie")

    monkeypatch.setattr(rendimiento_mod.RendimientoOperarioService, "reporte", no_se_llama)
    r = await _armar(base, alcance=alcance_de(_permisos("operario")))
    assert r["personas"] is None
    assert r["ordenes"] is not None and r["ordenes"]["top_clientes"] is None
    assert r["calidad"] is not None
    assert "ANA GOMEZ" not in str(r["produccion"])            # producción no nombra a nadie
    assert not any("Personas" in n for n in r["como_se_cuenta"])


async def test_personas_sin_asistencia_no_llevan_ausencias(base):
    solo = alcance_de(_permisos("x", areas={"dashboard": "read"},
                                secciones={"dashboard_rendimiento": "read"}))
    r = await _armar(base, alcance=solo)
    assert r["ordenes"] is None and r["produccion"] is None and r["calidad"] is None
    pe = r["personas"]
    assert pe["ausencias_visibles"] is False
    assert all(f["ausencias"] is None for f in pe["filas"])
    assert pe["resumen"]["dias_ausencia"] is None
    # LUIS sólo tenía vacaciones: sin ver las ausencias, no aparece.
    assert [f["persona"] for f in pe["filas"]] == ["ANA GOMEZ", "JUAN PEREZ"]


async def test_el_endpoint_arma_el_mes_pedido_con_los_permisos_de_quien_pide(base):
    async with base() as s:
        r = await api.get_reporte_mensual(anio=2026, mes=8, db=s, permisos=_permisos("supervisor"))
    assert r["success"] is True
    assert r["data"]["titulo"] == "agosto de 2026"
    assert r["data"]["personas"] is None and r["data"]["ordenes"] is not None
    # Sin mes: el anterior al de hoy.
    async with base() as s:
        r = await api.get_reporte_mensual(anio=None, mes=None, db=s, permisos=_permisos("admin"))
    assert (r["data"]["anio"], r["data"]["mes"]) == (2026, 8)
    # Un mes que no empezó: 422 con el porqué (lo contesta el handler de BusinessException).
    async with base() as s:
        with pytest.raises(BusinessException):
            await api.get_reporte_mensual(anio=2026, mes=11, db=s, permisos=_permisos("admin"))


# ─────────────────────────── el mail: se arma, no se manda ───────────────────────────


async def test_el_mail_se_arma_y_no_se_manda(base):
    r = await _armar(base)
    mail = armar_mail_del_reporte(r, para=["lucas@metlo.com.ar"], url_app="https://www.metlosys.com/")
    assert mail["enviado"] is False
    assert mail["asunto"] == "SPMM · Reporte mensual de agosto de 2026"
    assert mail["link"] == "https://www.metlosys.com/dashboard/reporte-mensual?anio=2026&mes=8"
    assert "Reporte mensual de agosto de 2026" in mail["html"]
    assert "Comparado con julio de 2026" in mail["html"]
    assert mail["link"] in mail["texto"]
    (adjunto,) = mail["adjuntos"]
    assert adjunto["nombre"] == "reporte_mensual_2026-08.csv"
    csv_texto = adjunto["contenido"].decode("utf-8")
    assert csv_texto.startswith("﻿") and "Órdenes entregadas" in csv_texto
    assert "15204" in csv_texto and "ANA GOMEZ" in csv_texto


async def test_el_mail_lleva_solo_lo_que_el_reporte_trae_y_escapa_los_textos(base):
    r = await _armar(base, alcance=alcance_de(_permisos("supervisor")))
    r["avisos"].append("<script>alert(1)</script>")
    mail = armar_mail_del_reporte(r, para=["x@y.com"], url_app="https://a.b")
    assert "Personas" not in mail["html"] and "Eficiencia" not in mail["html"]
    # Sin la sección confidencial no va la tabla de personas (horas y eficiencia de cada
    # uno) ni la calidad agrupada por persona: RF-12 pide esa misma sección para las
    # piezas rechazadas por persona (/incidencias/por-persona).
    adjunto = mail["adjuntos"][0]["contenido"].decode("utf-8")
    assert "\r\nPersonas\r\n" not in adjunto and "Eficiencia" not in adjunto
    assert "Calidad por persona" not in adjunto and "Calidad por tipo" in adjunto
    assert r["calidad"]["por_persona"] is None and r["calidad"]["por_tipo"]
    assert "<script>" not in mail["html"] and "&lt;script&gt;" in mail["html"]


def test_el_csv_neutraliza_formulas():
    r = {"titulo": "agosto de 2026", "anterior": {"titulo": "julio de 2026"},
         "materiales": {"disponible": True, "resumen": {"cargas": 1, "materiales": 1, "ordenes": 1},
                        "por_material": [{"cod_pieza": "=HYPERLINK(1)", "descripcion": "+x",
                                          "unidad": "KG", "cantidad": 1.5, "cargas": 1, "ordenes": 1}]}}
    texto = csv_del_reporte(r)
    assert "'=HYPERLINK(1)" in texto and ";'+x;" in texto and ";1,5;" in texto


async def test_preparar_los_mails_del_mes_va_a_los_admin_activos(base):
    async with base() as s:
        mails = await preparar_mails_del_mes(s, url_app="https://www.metlosys.com", ahora=AHORA)
    (mail,) = mails
    assert mail["para"] == ["julian@metlo.com.ar", "lucas@metlo.com.ar"]
    assert mail["asunto"].endswith("agosto de 2026")          # el mes que cerró
    assert mail["enviado"] is False
    async with base() as s:
        assert await preparar_mails_del_mes(s, para=[], ahora=AHORA) == []


async def test_un_mail_con_destinatarios_a_mano_no_lleva_lo_confidencial(base):
    """Con `para` puesto a mano no se sabe qué permisos tiene cada dirección: el reporte
    sale sin la sección «Rendimiento por persona» (personas, ausencias y calidad por
    persona). Los de por defecto son admin y les va todo."""
    async with base() as s:
        (mail,) = await preparar_mails_del_mes(s, para=["super@metlo.com.ar"], ahora=AHORA)
    adjunto = mail["adjuntos"][0]["contenido"].decode("utf-8")
    assert "Eficiencia" not in adjunto and "Calidad por persona" not in adjunto
    assert "Órdenes entregadas" in adjunto
    async with base() as s:
        (mail,) = await preparar_mails_del_mes(s, ahora=AHORA)
    assert "Calidad por persona" in mail["adjuntos"][0]["contenido"].decode("utf-8")


# ─────────────────────────── la ruta, con los permisos de verdad ───────────────────────────
#
# El espejo de la app de test_permisos_rutas: las MISMAS dependencias colgadas en cada
# ruta, con un cuerpo que no lee nada. Lo que pasa la política recibe 200.

from backend.tests.test_permisos_rutas import espejo  # noqa: E402,F401  (el fixture)
from backend.tests.test_permisos_api import MATIAS, SOFIA, _token  # noqa: E402


async def test_la_ruta_pide_el_dashboard_y_nada_mas(espejo):  # noqa: F811
    from sqlalchemy import update as _update

    from backend.domain.Permisos import RolArea

    ruta = "/api/dashboard/reporte-mensual?anio=2026&mes=8"
    # El supervisor y el operario ven el Dashboard: la abren (adentro, cada parte pide lo
    # suyo: ver test_el_alcance_sale_del_mapa_de_permisos).
    assert (await espejo.get(ruta, headers=_token(SOFIA, "supervisor"))).status_code == 200
    assert (await espejo.get(ruta, headers=_token(MATIAS, "operario"))).status_code == 200
    # Sin el Dashboard, no.
    async with espejo.sesiones() as s:
        await s.execute(_update(RolArea).where(RolArea.rol_codigo == "operario",
                                               RolArea.area_codigo == "dashboard")
                        .values(nivel="none"))
        await s.commit()
    r = await espejo.get(ruta, headers=_token(MATIAS, "operario"))
    assert r.status_code == 403
    # Y sin sesión, tampoco.
    assert (await espejo.get(ruta)).status_code in (401, 403)


async def test_el_enganche_de_rf10_ya_lo_leen_el_mail_y_el_csv(base, monkeypatch):
    """Cuando RF-10 complete _maquinas() con la forma de su docstring, el mail y el CSV
    la muestran sin tocarlos."""
    async def con_rf10(self, actual, anterior):
        return {"disponible": True, "texto": None,
                "resumen": {"maquinas": 1, "horas_min": 600, "mantenimientos": 1, "avisos": 0},
                "anterior": {"maquinas": 1, "horas_min": 300, "mantenimientos": 0},
                "filas": [{"id_maquinaria": 7, "maquina": "TORNO CNC 1", "horas_min": 600,
                           "tareas": 4, "horas_min_anterior": 300, "mantenimientos": 1}],
                "mantenimientos": []}

    monkeypatch.setattr(ReporteMensualService, "_maquinas", con_rf10)
    r = await _armar(base)
    mail = armar_mail_del_reporte(r, para=["x@y.com"], url_app="https://a.b")
    assert "Máquinas" in mail["html"] and "10 h" in mail["html"]
    assert "TORNO CNC 1;10,00;4;5,00;1" in mail["adjuntos"][0]["contenido"].decode("utf-8")


async def test_los_pasos_de_cada_persona_se_leen_una_vez_para_los_dos_meses(base, monkeypatch):
    """El reporte de RF-07 se pide por persona para este mes y para el anterior; lo pesado
    (sus pasos de toda la historia) se lee una sola vez."""
    from backend.application.TiemposOperarioService import TiemposOperarioService

    leidas = []
    original = TiemposOperarioService.pasos_atribuidos

    async def contar(self, id_operario):
        leidas.append(id_operario)
        return await original(self, id_operario)

    monkeypatch.setattr(TiemposOperarioService, "pasos_atribuidos", contar)
    r = await _armar(base)
    assert r["personas"]["resumen"]["personas"] == 3 and r["personas"]["anterior"]["personas"] == 2
    assert sorted(leidas) == [1, 2, 3]
