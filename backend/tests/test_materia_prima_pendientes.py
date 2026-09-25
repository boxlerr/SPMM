"""Pendientes (spec §2.3): qué OT entran, la semana por el plan, los filtros y el resumen.

Lo que persigue este archivo:

  1. **Que la semana diga otra cosa que el Gantt.** Una OT «es de la semana» si algún
     proceso planificado arranca antes de que termine el domingo, y ese arranque se calcula
     con LA MISMA conversión que GET /planificacion (minutos de trabajo → fecha, desde el
     arranque guardado del plan o, en los planes viejos, desde su creado_en; salteando
     domingos y días bloqueados). Las que se arrastran de semanas anteriores entran.
  2. **Que se cuele lo que no se compra**: OT terminadas, suspendidas o marcadas «No lleva
     materias primas», y líneas que no se usan.
  3. **Que el resumen de las tarjetas dependa del radio** (se cuenta antes), o que el orden
     no ponga primero lo que falta pedir.
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import text

from backend.application import MateriaPrimaPendientesService as modulo_pendientes
from backend.application import PlanificacionService
from backend.application.MateriaPrimaPendientesService import MateriaPrimaPendientesService
from backend.commons.exceptions.BusinessException import BusinessException
from backend.domain.CaneraOcupacion import CaneraOcupacion
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Planificacion import Planificacion
from backend.domain.Proceso import Proceso
from backend.tests.test_materia_prima_ot import (
    BARRA, BULON, CHAPA, OT_A, OT_B, OT_C, PROV, cliente, linea, mensaje, mundo,
)

# Más OT (números 15020..): una arrastrada de la semana anterior, una terminada, una
# suspendida, una que no lleva materia prima y una del sábado.
OT_D, OT_E, OT_F, OT_G, OT_H = 20, 21, 22, 23, 24

# El viernes 18/09 a las 10: el plan guardado ese día arranca el lunes 21 a las 07:00
# (inicio_del_plan: la jornada ya empezó, el sábado y el domingo no cuentan).
VIERNES_18 = datetime(2026, 9, 18, 10, 0)
VIERNES_11 = datetime(2026, 9, 11, 10, 0)   # → arranca el lunes 14


def plan(orden_id, inicio_min, creado_en=VIERNES_18):
    return Planificacion(orden_id=orden_id, proceso_id=100, inicio_min=inicio_min,
                         fin_min=inicio_min + 60, duracion_min=60, prioridad_peso=3,
                         creado_en=creado_en)


async def taller(session):
    await mundo(session)
    for id_ot, extra in ((OT_D, {}), (OT_E, {"finalizadototal": 1}), (OT_F, {"suspendida": 1}),
                         (OT_G, {"no_lleva_materia_prima": 1}), (OT_H, {})):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=15000 + id_ot, id_prioridad=1, id_sector=1, id_articulo=2,
            id_cliente=1, unidades=1, fecha_orden=datetime(2026, 9, 10),
            fecha_entrada=datetime(2026, 9, 10), fecha_prometida=datetime(2026, 10, 15), **extra))
    await session.flush()
    session.add_all([
        # A: dos procesos; el primero arranca el martes 22 a las 08:45 (600 min).
        plan(OT_A, 1000), plan(OT_A, 600),
        plan(OT_B, 2775),                        # lunes 28: la semana que viene
        plan(OT_D, 500, VIERNES_11),             # martes 15: se arrastra
        plan(OT_E, 0), plan(OT_F, 0), plan(OT_G, 0),
        plan(OT_H, 2475),                        # sábado 26 a las 07:00: entra
        # OT_C: sin plan.
        linea(1, OT_A, BARRA, 5, orden=2),
        linea(2, OT_A, BULON, 10, "Un", orden=1, pedido=1, id_proveedor=PROV, proveedor="ACEROS CAS SA"),
        linea(3, OT_A, CHAPA, 2, "Un", orden=3, pedido=1, disponible=1),
        linea(4, OT_A, CHAPA, 9, "Un", orden=4, usado=0),                   # no se usa
        linea(5, OT_D, BARRA, 3, reserva=1, cantidad_reservada=1, proveedor="METALÚRGICA JR"),
        linea(6, OT_H, BULON, 4, "Un", orden=1, pedido=1, disponible=1),
        linea(7, OT_H, CHAPA, 1, "Un", orden=2, pedido=1, disponible=1),
        linea(8, OT_B, BARRA, 1),
        linea(9, OT_C, BULON, 2, "Un"),
        linea(10, OT_G, BARRA, 1),                                          # no lleva
        linea(11, OT_E, BULON, 1, "Un"),                                    # terminada
        CaneraOcupacion(columna="E", fila=4, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 20)),
        CaneraOcupacion(columna="C", fila=7, id_orden_trabajo=OT_A, desde=datetime(2026, 9, 20)),
        Proceso(id=100, nombre="TORNO"),
        EstadoProceso(id=1, descripcion="Pendiente"), EstadoProceso(id=2, descripcion="En curso"),
    ])
    await session.flush()
    session.add(OrdenTrabajoProceso(id_orden_trabajo=OT_D, id_proceso=100, orden=1, id_estado=2))
    await session.commit()


def ids(datos):
    return [l["id"] for l in datos["lineas"]]


@pytest.mark.asyncio
async def test_la_semana_sale_del_plan(session):
    await taller(session)
    async with cliente(session) as c:
        # Un miércoles: se normaliza al lunes.
        r = await c.get("/materia-prima/pendientes", params={"semana": "2026-09-23", "filtro": "todas"})
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["semana"] == {"desde": "2026-09-21", "hasta": "2026-09-27"}
        # A (martes), D (arrastrada del martes 15) y H (sábado). No B (lunes 28), ni C (sin
        # plan), ni la terminada, la suspendida o la que no lleva.
        assert [(o["numero_ot"], o["fecha_requerida"]) for o in d["ots"]] == [
            (15010, "2026-09-22"), (15020, "2026-09-15"), (15024, "2026-09-26")]
        a = d["ots"][0]
        assert a == {"id": OT_A, "numero_ot": 15010, "cliente": "ACME SRL", "articulo": "Bandeja de acero",
                     "unidades": 3, "fecha_ot": "2026-09-01", "fecha_prometida": "2026-10-01",
                     "fecha_requerida": "2026-09-22", "prioridad": "Normal", "celdas": ["C7", "E4"],
                     "ot_en_curso": False, "lineas_total": 3, "lineas_listas": 1}
        assert d["ots"][1]["ot_en_curso"] is True
        # Lo que falta pedir primero; después por OT y en el orden de carga. La que no se
        # usa no está.
        assert ids(d) == [1, 5, 2, 3, 6, 7]
        # La 5 está reservada 1 de 3: todavía falta pedir 2, así que cuenta como «a pedir».
        assert d["resumen"] == {"ot_count": 3, "lineas_a_pedir": 2, "lineas_esperando": 1,
                                "lineas_listas": 3}

        # La semana siguiente: entra B, y A, D y H siguen (se arrastran).
        d = (await c.get("/materia-prima/pendientes",
                         params={"semana": "2026-09-28", "filtro": "todas"})).json()["data"]
        assert [o["numero_ot"] for o in d["ots"]] == [15010, 15011, 15020, 15024]
        # La anterior: sólo la que ya arrancaba el martes 15.
        d = (await c.get("/materia-prima/pendientes", params={"semana": "2026-09-14"})).json()["data"]
        assert [o["numero_ot"] for o in d["ots"]] == [15020]


@pytest.mark.asyncio
async def test_sin_semana_es_la_de_hoy(session, monkeypatch):
    await taller(session)
    monkeypatch.setattr(modulo_pendientes, "ahora_ar", lambda: datetime(2026, 9, 26, 11, 0))
    d = await MateriaPrimaPendientesService(session).pendientes()
    assert d["semana"] == {"desde": "2026-09-21", "hasta": "2026-09-27"}
    assert [o["numero_ot"] for o in d["ots"]] == [15010, 15020, 15024]


@pytest.mark.asyncio
async def test_la_conversion_es_la_del_planificador(session, monkeypatch):
    """No una copia: la función de PlanificacionService, con el arranque de cada plan y
    los días bloqueados en el mismo formato que le pasa GET /planificacion."""
    await taller(session)
    llamadas = []
    original = PlanificacionService._convertir_minutos_a_fecha

    def espia(minutos, base, feriados, *args, **kwargs):
        llamadas.append((minutos, base, list(feriados)))
        return original(minutos, base, feriados, *args, **kwargs)

    monkeypatch.setattr(PlanificacionService, "_convertir_minutos_a_fecha", espia)
    inicios = await MateriaPrimaPendientesService(session).inicios_estimados([OT_A, OT_B])
    assert inicios == {OT_A: datetime(2026, 9, 22, 8, 45), OT_B: datetime(2026, 9, 28, 7, 0)}
    # Una conversión por OT (la del proceso que arranca primero), no una por proceso.
    assert sorted(llamadas) == [(600, datetime(2026, 9, 21, 7, 0), []),
                                (2775, datetime(2026, 9, 21, 7, 0), [])]


@pytest.mark.asyncio
async def test_los_dias_bloqueados_corren_la_semana(session):
    await taller(session)
    # El lunes 21 no se trabaja: el plan del viernes arranca el martes y la A, un día después.
    await session.execute(text("CREATE TABLE dia_bloqueado (fecha DATE PRIMARY KEY, creado_en TIMESTAMP)"))
    await session.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES ('2026-09-21')"))
    await session.commit()
    inicios = await MateriaPrimaPendientesService(session).inicios_estimados([OT_A])
    assert inicios == {OT_A: datetime(2026, 9, 23, 8, 45)}


@pytest.mark.asyncio
async def test_el_arranque_guardado_del_plan_manda_sobre_su_creado_en(session):
    """Desde el 11/09 cada plan guarda su T=0 (planificacion.inicio_base). El modelo no lo
    declara; en la base está. Con la columna, manda ella (como en GET /planificacion)."""
    await taller(session)
    await session.execute(text("ALTER TABLE planificacion ADD COLUMN inicio_base DATETIME"))
    # El plan de B se guardó el viernes 18, pero para arrancar el lunes 5/10.
    await session.execute(text("UPDATE planificacion SET inicio_base = :base WHERE orden_id = :ot"),
                          {"base": datetime(2026, 10, 5, 7, 0), "ot": OT_B})
    await session.commit()
    inicios = await MateriaPrimaPendientesService(session).inicios_estimados([OT_A, OT_B])
    # 2775 minutos son la semana entera (5 × 495 + los 300 del sábado): desde el lunes 5,
    # el lunes 12. Por su creado_en habría sido el lunes 28/09.
    assert inicios[OT_B] == datetime(2026, 10, 12, 7, 0)
    assert inicios[OT_A] == datetime(2026, 9, 22, 8, 45)   # sin arranque guardado: su creado_en
    async with cliente(session) as c:
        for semana, entra in (("2026-09-28", False), ("2026-10-05", False), ("2026-10-12", True)):
            d = (await c.get("/materia-prima/pendientes", params={"semana": semana})).json()["data"]
            assert (15011 in [o["numero_ot"] for o in d["ots"]]) is entra, semana


@pytest.mark.asyncio
async def test_todas_las_abiertas_y_una_ot_sola(session):
    await taller(session)
    async with cliente(session) as c:
        d = (await c.get("/materia-prima/pendientes",
                         params={"todas_abiertas": "true", "filtro": "todas"})).json()["data"]
        assert d["semana"] is None
        assert [(o["numero_ot"], o["fecha_requerida"]) for o in d["ots"]] == [
            (15010, "2026-09-22"), (15011, "2026-09-28"), (15012, None), (15020, "2026-09-15"),
            (15024, "2026-09-26")]
        assert d["resumen"]["ot_count"] == 5
        assert 9 in ids(d) and 10 not in ids(d) and 11 not in ids(d)

        # Por número: esa OT, aunque esté terminada, y sin mirar la semana.
        d = (await c.get("/materia-prima/pendientes",
                         params={"ot": "15021", "semana": "2026-09-21"})).json()["data"]
        assert d["semana"] is None and [o["numero_ot"] for o in d["ots"]] == [15021] and ids(d) == [11]
        # La que no lleva materia prima no tiene nada que comprar; la que no existe, tampoco.
        for numero in ("15023", "99999"):
            d = (await c.get("/materia-prima/pendientes", params={"ot": numero})).json()["data"]
            assert d["ots"] == [] and d["lineas"] == [] and d["resumen"]["ot_count"] == 0
        r = await c.get("/materia-prima/pendientes", params={"ot": "15O10"})
        assert r.status_code == 422 and "no es un número de OT" in mensaje(r)


@pytest.mark.asyncio
async def test_filtros_de_radio_falta_y_resumen(session):
    await taller(session)
    semana = {"semana": "2026-09-21"}
    async with cliente(session) as c:
        async def pedir(**params):
            r = await c.get("/materia-prima/pendientes", params={**semana, **params})
            assert r.status_code == 200, r.text
            return r.json()["data"]

        # Por defecto, lo que no está disponible.
        d = await pedir()
        assert ids(d) == [1, 5, 2]
        falta = {l["id"]: l["falta"] for l in d["lineas"]}
        # 1: nada pedido → la cantidad; 5: reservada 1 de 3 → 2; 2: pedida → 0.
        assert falta == {1: 5.0, 5: 2.0, 2: 0.0}
        l1 = d["lineas"][0]
        assert (l1["numero_ot"], l1["fecha_ot"], l1["fecha_requerida"], l1["celdas"], l1["ot_en_curso"]) == \
            (15010, "2026-09-01", "2026-09-22", ["C7", "E4"], False)
        assert l1["stock_libre"] == 9.0                      # 10 − 1 reservado por la D
        # El resumen no depende del radio: las tarjetas SON el radio.
        todas = await pedir(filtro="todas")
        assert d["resumen"] == todas["resumen"]

        # Parciales: TODAS las líneas de las OT con parte lista y parte no (sólo la A: la H
        # está completa y la D no tiene nada listo).
        assert ids(await pedir(filtro="parciales")) == [1, 2, 3]
        r = await c.get("/materia-prima/pendientes", params={**semana, "filtro": "otra"})
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_buscador_y_proveedor(session):
    await taller(session)
    async with cliente(session) as c:
        async def pedir(**params):
            r = await c.get("/materia-prima/pendientes",
                            params={"semana": "2026-09-21", "filtro": "todas", **params})
            return r.json()["data"]

        # Todos los tokens, en código, descripción o proveedor, sin mayúsculas ni acentos.
        assert ids(await pedir(search="bul  m8")) == [2, 6]
        assert ids(await pedir(search="abr203 metalurgica")) == [5]
        assert ids(await pedir(search="cas")) == [2]
        assert ids(await pedir(search="nada que ver")) == []
        d = await pedir(search="BULON")
        # Con un buscador, las tarjetas cuentan lo que se está mirando.
        assert d["resumen"] == {"ot_count": 2, "lineas_a_pedir": 0, "lineas_esperando": 1,
                                "lineas_listas": 1}
        assert ids(await pedir(id_proveedor=PROV)) == [2]
        assert ids(await pedir(proveedor="metalúrgica")) == [5]


@pytest.mark.asyncio
async def test_sin_plan_la_semana_esta_vacia(session):
    await mundo(session)
    session.add(linea(1, OT_A, BARRA, 1))
    await session.commit()
    d = await MateriaPrimaPendientesService(session).pendientes(semana=date(2026, 9, 21))
    assert d["ots"] == [] and d["lineas"] == []
    assert d["resumen"] == {"ot_count": 0, "lineas_a_pedir": 0, "lineas_esperando": 0, "lineas_listas": 0}
    with pytest.raises(BusinessException):
        await MateriaPrimaPendientesService(session).pendientes(filtro="cualquiera")


# ─────────────────────── la semana, contra el Gantt de verdad ───────────────────────


class _ComoPostgres:
    """La sesión de SQLite, pero el SELECT crudo devuelve las fechas como datetime, que
    es lo que devuelve asyncpg en producción.

    GET /planificacion arma el plan con `text()` y usa `creado_en`/`inicio_base` como
    datetime; SQLite los devuelve como texto y el endpoint no podría correr acá. Esto
    convierte sólo esas dos columnas: el resto del endpoint corre tal cual."""

    _FECHAS = ("creado_en", "inicio_base")

    def __init__(self, session):
        self._s = session

    def __getattr__(self, nombre):
        return getattr(self._s, nombre)

    async def execute(self, *args, **kwargs):
        from types import SimpleNamespace
        filas = (await self._s.execute(*args, **kwargs)).fetchall()
        convertidas = []
        for fila in filas:
            m = dict(fila._mapping)
            for campo in self._FECHAS:
                if isinstance(m.get(campo), str):
                    m[campo] = datetime.fromisoformat(m[campo])
            convertidas.append(SimpleNamespace(_mapping=m))
        return SimpleNamespace(fetchall=lambda: convertidas)


@pytest.mark.asyncio
async def test_la_semana_es_la_del_gantt_con_un_plan_guardado_por_el_planificador(session, monkeypatch):
    """Pendientes dice «esta OT es de la semana» con el MISMO inicio estimado que muestra
    el Gantt (GET /planificacion → fecha_inicio_estimada): acá los dos se calculan sobre
    un plan guardado por el camino real del planificador
    (PlanificacionRepository.insertar_planificacion_lote, con su arranque guardado), más
    filas de un plan viejo sin arranque (se ubican por su creado_en), y un feriado."""
    from backend.infrastructure.DiaBloqueadoRepository import DiaBloqueadoRepository
    from backend.infrastructure.PlanificacionRepository import PlanificacionRepository
    from backend.presentation.PlanificacionAPI import obtener_planificacion

    await taller(session)
    # La base de producción tiene el arranque guardado (migración 2026-09-11) y los días
    # bloqueados en su tabla. El jueves 24/09 no se trabaja.
    await session.execute(text("ALTER TABLE planificacion ADD COLUMN inicio_base DATETIME"))
    await session.execute(text("CREATE TABLE dia_bloqueado (fecha DATE PRIMARY KEY, creado_en TIMESTAMP)"))
    await session.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES ('2026-09-24')"))
    await session.execute(text("DELETE FROM planificacion"))
    await session.commit()

    def paso(orden_id, inicio, duracion=90):
        return {"orden_id": orden_id, "proceso_id": 100, "inicio_min": inicio,
                "fin_min": inicio + duracion, "duracion_min": duracion, "prioridad_peso": 3}

    # Un plan confirmado para arrancar el lunes 21 a las 07:00. Los minutos caen en los
    # bordes que importan: 495 es la apertura del martes (no el cierre del lunes); 1485
    # cae en el jueves feriado y pasa al viernes; 2475 sería el sábado, pero el feriado
    # lo empuja a la semana siguiente.
    await PlanificacionRepository(session).insertar_planificacion_lote(
        [paso(OT_A, 1000), paso(OT_A, 495), paso(OT_B, 2775), paso(OT_C, 1485),
         paso(OT_H, 2475), paso(OT_H, 3000)],
        inicio_base=datetime(2026, 9, 21, 7, 0))
    # Uno que se guardó para arrancar el lunes 5/10.
    await PlanificacionRepository(session).insertar_planificacion_lote(
        [paso(OT_B, 60)], inicio_base=datetime(2026, 10, 5, 7, 0))
    # Filas de un plan viejo (antes del 11/09): sin arranque, se leen por su creado_en.
    session.add_all([plan(OT_D, 500, VIERNES_11), plan(OT_C, 3500, VIERNES_18)])
    await session.commit()

    # El Gantt, tal cual lo arma GET /planificacion.
    async def _feriados(self):
        return ["2026-09-24"]
    monkeypatch.setattr(DiaBloqueadoRepository, "listar", _feriados)
    gantt = await obtener_planificacion(db=_ComoPostgres(session))
    esperado: dict[int, datetime] = {}
    for fila in gantt:
        inicio = datetime.fromisoformat(fila["fecha_inicio_estimada"])
        if fila["orden_id"] not in esperado or inicio < esperado[fila["orden_id"]]:
            esperado[fila["orden_id"]] = inicio
    # Las cuentas a mano, para que el oráculo no sea sólo «lo mismo que el otro»:
    # (una jornada de lunes a viernes son 495 minutos; el sábado, 300)
    assert esperado == {
        OT_A: datetime(2026, 9, 22, 7, 0),     # 495 = la apertura del martes
        OT_B: datetime(2026, 9, 29, 7, 0),     # 2775 = lu+ma+mi+vi+sá (2280) + el lunes 28 entero
        OT_C: datetime(2026, 9, 25, 7, 0),     # 1485: el jueves 24 no se trabaja
        OT_D: datetime(2026, 9, 15, 7, 5),     # plan viejo del viernes 11: lunes 14 + 500
        OT_H: datetime(2026, 9, 28, 10, 30),   # 2475 = 2280 + 195 del lunes 28 (+ la pausa)
    }

    servicio = MateriaPrimaPendientesService(session)
    assert await servicio.inicios_estimados(list(esperado)) == esperado

    # Y la semana de Pendientes es exactamente «el inicio del Gantt antes del lunes
    # siguiente», para cada semana (con las abiertas que llevan material).
    abiertas = {OT_A, OT_B, OT_C, OT_D, OT_H}
    numero = {OT_A: 15010, OT_B: 15011, OT_C: 15012, OT_D: 15020, OT_H: 15024}
    for lunes in (date(2026, 9, 14), date(2026, 9, 21), date(2026, 9, 28), date(2026, 10, 5)):
        corte = datetime.combine(lunes + timedelta(days=7), datetime.min.time())
        deberian = sorted(numero[i] for i in abiertas if esperado[i] < corte)
        d = await servicio.pendientes(semana=lunes, filtro="todas")
        assert [o["numero_ot"] for o in d["ots"]] == deberian, lunes
        assert {o["numero_ot"]: o["fecha_requerida"] for o in d["ots"]} == \
            {numero[i]: esperado[i].date().isoformat() for i in abiertas if esperado[i] < corte}


# ─────────────────────── sin una consulta por línea ───────────────────────


@pytest.mark.asyncio
async def test_pendientes_no_hace_una_consulta_por_linea(session):
    """En producción son ~900 líneas de ~220 OT. Con 5 OT o con 40 (cada una con sus
    líneas, cortes, consumos, casilleros, procesos y plan) tienen que salir las MISMAS
    consultas: si crecen con las OT, la pantalla de Maxi se cuelga."""
    from sqlalchemy import event

    from backend.domain.ConsumoMaterial import ConsumoMaterial
    from backend.domain.OrdenTrabajoPiezaCorte import OrdenTrabajoPiezaCorte
    from backend.domain.PiezaRecorte import PiezaRecorte

    await mundo(session)
    session.add_all([Proceso(id=100, nombre="TORNO"), EstadoProceso(id=1, descripcion="Pendiente"),
                     EstadoProceso(id=2, descripcion="En curso"),
                     PiezaRecorte(id_pieza=BARRA, largo_mm=500, cantidad=1)])
    await session.commit()

    siguiente = {"linea": 1000}

    async def sembrar(desde, hasta):
        for i in range(desde, hasta):
            id_ot = 100 + i
            session.add(OrdenTrabajo(
                id=id_ot, id_otvieja=16000 + i, id_prioridad=1, id_sector=1, id_articulo=1,
                id_cliente=1, unidades=2, fecha_orden=datetime(2026, 9, 1),
                fecha_entrada=datetime(2026, 9, 1), fecha_prometida=datetime(2026, 10, 1)))
        await session.flush()
        for i in range(desde, hasta):
            id_ot = 100 + i
            session.add_all([plan(id_ot, 100 + i), plan(id_ot, 900 + i),
                             OrdenTrabajoProceso(id_orden_trabajo=id_ot, id_proceso=100, orden=1,
                                                 id_estado=2 if i % 2 else 1)])
            if i < 15:  # la cañera tiene 15 columnas × 9 filas: no todas entran
                session.add(CaneraOcupacion(columna="ABCDEFGHIJKLMNO"[i], fila=1 + (i % 9),
                                            id_orden_trabajo=id_ot, desde=datetime(2026, 9, 20)))
            for pieza, cantidad, marcas in ((BARRA, 2, {"reserva": 1, "cantidad_reservada": 1}),
                                            (BULON, 8, {"pedido": 1}), (CHAPA, 1, {"disponible": 1}),
                                            (BARRA, 3, {})):
                siguiente["linea"] += 1
                id_linea = siguiente["linea"]
                session.add(linea(id_linea, id_ot, pieza, cantidad, **marcas))
                await session.flush()
                session.add_all([
                    OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=id_linea, cantidad=2, largo_mm=700),
                    ConsumoMaterial(id_orden_trabajo=id_ot, id_pieza=pieza, id_orden_trabajo_pieza=id_linea,
                                    cantidad=0.5, fecha=datetime(2026, 9, 22), anulado=0),
                ])
        await session.commit()

    motor = session.bind.sync_engine
    consultas: list[str] = []

    def _contar(conn, cursor, statement, *args):
        consultas.append(statement)

    servicio = MateriaPrimaPendientesService(session)
    await sembrar(0, 5)
    event.listen(motor, "before_cursor_execute", _contar)
    try:
        d5 = await servicio.pendientes(todas_abiertas=True, filtro="todas")
        con_5 = len(consultas)
    finally:
        event.remove(motor, "before_cursor_execute", _contar)
    await sembrar(5, 40)
    consultas.clear()
    event.listen(motor, "before_cursor_execute", _contar)
    try:
        d40 = await servicio.pendientes(todas_abiertas=True, filtro="todas")
        con_40 = len(consultas)
    finally:
        event.remove(motor, "before_cursor_execute", _contar)

    assert (len(d5["lineas"]), len(d40["lineas"])) == (20, 160)
    assert len(d40["ots"]) == 43                      # las 40 + las tres de `mundo`
    assert con_5 == con_40, (con_5, con_40, consultas)
    assert con_40 <= 16, (con_40, consultas)


# ─────────────────────── números de OT imposibles ───────────────────────


@pytest.mark.asyncio
async def test_un_numero_de_ot_imposible_no_rompe(session):
    """id_otvieja es INTEGER: en Postgres un número más grande ni siquiera se puede
    mandar (asyncpg no lo codifica y el pedido termina en 500). No existe: se contesta
    como tal. Y «²» pasa str.isdigit() pero no es un número de OT."""
    await taller(session)
    async with cliente(session) as c:
        r = await c.get("/materia-prima/pendientes", params={"ot": "99999999999999"})
        assert r.status_code == 200 and r.json()["data"]["ots"] == []
        r = await c.get("/materia-prima/pendientes", params={"ot": "15²"})
        assert r.status_code == 422
        r = await c.post("/materia-prima/canera", json={"celda": "A1", "numero_ot": 99999999999999})
        assert r.status_code == 409 and "No existe la OT 99999999999999 en SPMM" in mensaje(r)


# ─────────────────── la semana con el Integral como dueño: su plan semanal ───────────────────
#
# Durante la prueba piloto el planificador de SPMM no tiene plan (el 25/09 la tabla estaba
# vacía en producción) y «Semana del …» salía en 0. Con el Integral como dueño la semana es
# la de su plan semanal (plan_semanal, lo trae el espejo del sync de dbo.plansemanal), como
# en su pantalla; con SPMM como dueño, el planificador, como hasta ahora. La respuesta dice
# de dónde salió (`fuente_semana`) para que la pantalla lo cuente.


async def plan_del_integral(session):
    from backend.domain.PlanSemanal import PlanSemanal

    lunes, siguiente = date(2026, 9, 21), date(2026, 9, 28)

    def fila(semana, numero, id_ot, **extra):
        return PlanSemanal(semana=semana, fecha_original=semana, numero_ot=numero,
                           id_orden_trabajo=id_ot, prioridad="Normal", origen="legacy", **extra)
    session.add_all([
        fila(lunes, 15012, OT_C),           # sin plan en SPMM: entra igual
        fila(lunes, 15020, OT_D),
        fila(lunes, 15021, OT_E),           # terminada
        fila(lunes, 15022, OT_F),           # suspendida
        fila(lunes, 15023, OT_G),           # no lleva materia prima
        fila(lunes, 99999, None),           # no está en SPMM (o no es la del Integral)
        fila(siguiente, 15011, OT_B),
        fila(siguiente, 15020, OT_D),       # se arrastra: el taller la vuelve a cargar
    ])
    await session.commit()


@pytest.mark.asyncio
async def test_con_el_integral_como_dueno_la_semana_es_su_plan_semanal(session, monkeypatch):
    await taller(session)
    await plan_del_integral(session)
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    async with cliente(session) as c:
        r = await c.get("/materia-prima/pendientes", params={"semana": "2026-09-23", "filtro": "todas"})
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["fuente_semana"] == "integral"
        assert d["semana"] == {"desde": "2026-09-21", "hasta": "2026-09-27"}
        # C y D. No A ni H aunque el planificador de SPMM las tenga esta semana; ni la
        # terminada, la suspendida o la que no lleva; ni la que SPMM no tiene.
        assert [o["numero_ot"] for o in d["ots"]] == [15012, 15020]
        assert ids(d) == [9, 5]                  # por número de OT (ninguna pedida)
        assert d["resumen"]["ot_count"] == 2
        # El resto de la fila de la OT, como siempre (la fecha requerida sigue saliendo del
        # planificador de SPMM: la D tiene plan, la C no).
        assert [o["fecha_requerida"] for o in d["ots"]] == [None, "2026-09-15"]

        d = (await c.get("/materia-prima/pendientes",
                         params={"semana": "2026-09-28", "filtro": "todas"})).json()["data"]
        assert [o["numero_ot"] for o in d["ots"]] == [15011, 15020]
        d = (await c.get("/materia-prima/pendientes", params={"semana": "2026-10-05"})).json()["data"]
        assert d["ots"] == [] and d["fuente_semana"] == "integral"

        # Por número o todas las abiertas: no hay semana, y no importa el dueño.
        d = (await c.get("/materia-prima/pendientes", params={"ot": "15010"})).json()["data"]
        assert d["fuente_semana"] is None and [o["numero_ot"] for o in d["ots"]] == [15010]
        d = (await c.get("/materia-prima/pendientes", params={"todas_abiertas": "true"})).json()["data"]
        assert d["fuente_semana"] is None and len(d["ots"]) == 5


@pytest.mark.asyncio
async def test_con_spmm_como_dueno_la_semana_sigue_siendo_la_del_planificador(session):
    await taller(session)
    await plan_del_integral(session)
    d = await MateriaPrimaPendientesService(session).pendientes(semana=date(2026, 9, 21), filtro="todas")
    assert d["fuente_semana"] == "spmm"
    assert [o["numero_ot"] for o in d["ots"]] == [15010, 15020, 15024]


@pytest.mark.asyncio
async def test_sin_plan_semanal_legible_la_semana_del_integral_sale_vacia(session, monkeypatch):
    """Si la migración del plan semanal no se aplicó, la pantalla sale vacía en vez de dar 500
    (y la sesión sigue viva para lo que venga después)."""
    await taller(session)
    await session.execute(text("DROP TABLE plan_semanal"))
    await session.commit()
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    servicio = MateriaPrimaPendientesService(session)
    d = await servicio.pendientes(semana=date(2026, 9, 21))
    assert d["ots"] == [] and d["fuente_semana"] == "integral"
    d = await servicio.pendientes(todas_abiertas=True)
    assert len(d["ots"]) == 5
