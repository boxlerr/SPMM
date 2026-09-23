"""
RF-02, el Dashboard de órdenes: que ande sobre Postgres y que los números cierren.

Lo que se prueba, contra la base de abajo:

1. **Las cuatro tarjetas suman el total** y cada OT cae en una sola.
2. **La lista de cada tarjeta trae exactamente lo que la tarjeta cuenta.** Hasta el 23/09
   Pendientes y Retrasadas comparaban contra GETDATE, de SQL Server: en Postgres daban
   error y se abrían vacías.
3. **Los centinelas no son fechas.** 1950-01-01 y 3000-01-01 salen como «sin fecha»; una
   OT abierta con fecha_entrega = 1950-01-01 NO es «Completada» (lo era: el rótulo tomaba
   cualquier fecha_entrega cargada).
4. **«Hoy» es el del taller.** A las 22:30 de acá (01:30 del día siguiente en UTC, que es
   la hora de Supabase y de Cloud Run) una OT prometida para hoy sigue pendiente.
5. **Críticas, línea de entregas y lista de un día dicen lo mismo**: por entregar (ni
   finalizada ni con una entrega real), de hoy a hoy + 7, días enteros.
6. **Las listas por prioridad suman lo que dice «Órdenes por prioridad».**
7. **/ordenes-estadisticas/***: los estados son los del tablero (antes una OT con entrega
   NULL no caía en ninguno y otras se contaban dos veces), la ocupación por sector no da
   500 y suma las abiertas, y las críticas no tiran TypeError al restar fechas.
8. **Ningún resto de SQL Server** en el SQL del backend.

CONTRA QUÉ BASE

SQLite en memoria siempre. Y, si está la variable SPMM_PG_PRUEBAS con la URL de un
Postgres DESCARTABLE en localhost, todo otra vez ahí — es donde fallaba el GETDATE y
donde se ven los errores de dialecto que SQLite no reproduce. Esa base se BORRA ENTERA
(DROP SCHEMA public CASCADE): por eso sólo se acepta localhost. Nunca Supabase.

    SPMM_PG_PRUEBAS=postgresql+asyncpg://yo@127.0.0.1:55471/spmm_pruebas pytest ...
"""
import os
import re
from datetime import datetime, time
from pathlib import Path
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.application.OrdenTrabajoService import OrdenTrabajoService
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Planificacion import Planificacion
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.infrastructure import estado_ordenes
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

# Jueves 24/09/2026 a las 22:30 en el taller: en UTC ya es viernes 25.
AHORA = datetime(2026, 9, 24, 22, 30)
VIEJA = datetime(1950, 1, 1)
NUEVA = datetime(3000, 1, 1)


def d(mes: int, dia: int) -> datetime:
    return datetime(2026, mes, dia)


# (id, finalizadototal, fecha_entrega, fecha_prometida, id_sector, id_prioridad,
#  id_articulo, id_cliente, unidades, estados de sus pasos, estado esperado)
OTS = [
    (101, 1, d(9, 10), d(9, 12), 1, 1, 1, 1, 5, [3, 3], "completadas"),
    # Finalizada y sin entrega cargada: completada, y NO «por entregar».
    (102, 1, None, d(9, 26), 1, 2, 2, 1, None, [], "completadas"),
    # Abierta del sistema viejo: entrega = 1950-01-01. Antes salía «Completada».
    (103, 0, VIEJA, d(9, 20), 2, 1, 1, 1, 3, [1], "retrasadas"),
    # Abierta con los dos centinelas «nuevos»: sin fecha, pendiente.
    (104, 0, NUEVA, NUEVA, 2, 1, 1, 1, 1, [], "pendientes"),
    # Vencida pero con un paso en proceso: en curso, no retrasada.
    (105, 0, None, d(9, 1), 1, 2, 1, 1, 2, [3, 2, 1], "en_curso"),
    # Prometida HOY: a las 22:30 sigue pendiente (con CURRENT_DATE de UTC era retrasada).
    (106, 0, None, d(9, 24), 1, 1, 1, 1, 4, [1, 1], "pendientes"),
    # Prometida = 1950-01-01: sin fecha, pendiente (no retrasada desde 1950).
    (107, 0, VIEJA, VIEJA, 1, 1, 1, None, 1, [], "pendientes"),
    # Sin cliente y sin pasos, dentro de la semana.
    (108, 0, None, d(9, 28), 2, 2, 2, None, 8, [], "pendientes"),
    # Fuera de la semana.
    (109, 0, None, d(10, 15), 1, 1, 1, 1, 1, [], "pendientes"),
    # Venció ayer.
    (110, 0, None, d(9, 23), 1, 2, 1, 1, 1, [1], "retrasadas"),
    # Todos sus pasos terminados pero sin finalizar: en curso, mañana.
    (111, 0, None, d(9, 25), 2, 1, 2, 1, 2, [3], "en_curso"),
    # Con una entrega REAL y sin finalizar: la tarjeta la cuenta abierta (regla de
    # siempre) pero ya salió: no es «por entregar».
    (112, 0, d(9, 22), d(9, 25), 1, 1, 1, 1, 6, [], "pendientes"),
    # El último día de la ventana (hoy + 7) entra; el siguiente no.
    (113, 0, None, d(10, 1), 1, 1, 1, 1, 1, [], "pendientes"),
    (114, 0, None, d(10, 2), 1, 1, 1, 1, 1, [], "pendientes"),
]

POR_ESTADO = {e: [o[0] for o in OTS if o[-1] == e] for e in estado_ordenes.ESTADOS}
# Por entregar, de hoy (24/09) a hoy + 7 (01/10), la más próxima primero.
CRITICAS = [(106, 0), (111, 1), (108, 4), (113, 7)]


def _numero(id_: int) -> int:
    return 15000 + id_


async def _sembrar(s):
    s.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Prioridad(id=2, descripcion="Urgente"),
        Sector(id=1, nombre="Mecanizado"),
        Sector(id=2, nombre="Soldadura"),
        Sector(id=3, nombre="Pintura"),  # sin OT: la ocupación lo muestra en 0
        Articulo(id=1, cod_articulo="A-1", descripcion="Eje", abreviatura="EJE"),
        Articulo(id=2, cod_articulo="A-2", descripcion="Brida", abreviatura="BRI"),
        Cliente(id=1, nombre="ACME"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="En Proceso"),
        EstadoProceso(id=3, descripcion="Finalizado"),
        Proceso(id=150, nombre="TORNO CNC"),
        Proceso(id=160, nombre="SOLDADURA"),
        Operario(id=1, nombre="JUAN", apellido="PEREZ", categoria="OFICIAL",
                 hora_inicio=time(7), hora_fin=time(16)),
    ])
    await s.flush()
    otp = 1000
    for (id_, fin, entrega, prometida, sector, prioridad, articulo, cliente, unidades,
         pasos, _) in OTS:
        s.add(OrdenTrabajo(
            id=id_, id_otvieja=_numero(id_), finalizadototal=fin, fecha_entrega=entrega,
            fecha_prometida=prometida, fecha_orden=d(9, 1), fecha_entrada=d(9, 2),
            id_sector=sector, id_prioridad=prioridad, id_articulo=articulo,
            id_cliente=cliente, unidades=unidades,
        ))
        await s.flush()
        for i, estado in enumerate(pasos, start=1):
            otp += 1
            s.add(OrdenTrabajoProceso(
                id=otp, id_orden_trabajo=id_, id_proceso=150 if i % 2 else 160, orden=i,
                id_estado=estado, tiempo_proceso=60,
                inicio_real=d(9, 20).replace(hour=8) if estado > 1 else None,
                fin_real=d(9, 20).replace(hour=9, minute=30) if estado == 3 else None,
            ))
    await s.flush()
    # Un plan para la 101, para el cuadro de rendimiento por persona.
    s.add(Planificacion(orden_id=101, proceso_id=150, id_orden_trabajo_proceso=1001,
                        id_operario=1, inicio_min=0, fin_min=60, duracion_min=60,
                        prioridad_peso=3))
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
            # Como Supabase: el reloj de la base en UTC. Si algo del Dashboard volviera a
            # usar CURRENT_DATE / now(), a las 22:30 de acá ya sería mañana.
            await conn.execute(text("SET TIME ZONE 'UTC'"))
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TEST_TABLES))

    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _sembrar(s)
    Sesion.motor = motor
    yield Sesion
    await engine.dispose()


@pytest.fixture(autouse=True)
def reloj(monkeypatch):
    monkeypatch.setattr(estado_ordenes, "ahora_ar", lambda: AHORA)


async def _pedir(Sesion, endpoint, *args):
    """Cada llamada con su sesión, como en la app: si una falla en Postgres no deja la
    transacción envenenada para la siguiente."""
    async with Sesion() as s:
        if Sesion.motor == "postgres":
            await s.execute(text("SET TIME ZONE 'UTC'"))
        r = await endpoint(*args, db=s)
    assert r["success"], r.get("error")
    return r["data"]


# ─────────────────────────── 1 y 2. tarjetas y listas ───────────────────────────


async def test_las_cuatro_tarjetas_suman_el_total(base):
    e = await _pedir(base, api.get_estadisticas)
    assert e["total"] == len(OTS)
    assert e["completadas"] == len(POR_ESTADO["completadas"])
    assert e["en_proceso"] == len(POR_ESTADO["en_curso"])
    assert e["pendientes"] == len(POR_ESTADO["pendientes"])
    assert e["retrasadas"] == len(POR_ESTADO["retrasadas"])
    assert e["completadas"] + e["en_proceso"] + e["pendientes"] + e["retrasadas"] == e["total"]


async def test_cada_lista_trae_lo_que_cuenta_su_tarjeta(base):
    e = await _pedir(base, api.get_estadisticas)
    cuenta = {"completadas": e["completadas"], "en_curso": e["en_proceso"],
              "pendientes": e["pendientes"], "retrasadas": e["retrasadas"]}
    vistas = []
    for estado, esperado in POR_ESTADO.items():
        filas = await _pedir(base, api.get_ordenes_por_estado, estado)
        assert sorted(f["id"] for f in filas) == sorted(esperado), estado
        assert len(filas) == cuenta[estado], estado
        # Y cada fila dice el estado de la tarjeta que la abrió.
        assert {f["estado"] for f in filas} == {estado_ordenes.ROTULO[estado]}
        assert {f["estado_codigo"] for f in filas} == {estado}
        vistas += [f["id"] for f in filas]
    # Ninguna OT en dos listas, ninguna afuera.
    assert sorted(vistas) == sorted(o[0] for o in OTS)


async def test_en_proceso_es_el_nombre_viejo_de_en_curso(base):
    viejo = await _pedir(base, api.get_ordenes_por_estado, "en_proceso")
    nuevo = await _pedir(base, api.get_ordenes_por_estado, "EN_CURSO")
    assert [f["id"] for f in viejo] == [f["id"] for f in nuevo] == POR_ESTADO["en_curso"]


async def test_estado_desconocido_avisa(base):
    async with base() as s:
        r = await api.get_ordenes_por_estado("todas", db=s)
    assert r == {"success": False, "error": "Estado no válido"}


async def test_las_listas_abiertas_arrancan_por_la_mas_urgente_y_sin_fecha_al_final(base):
    pendientes = await _pedir(base, api.get_ordenes_por_estado, "pendientes")
    assert [f["id"] for f in pendientes] == [106, 112, 108, 113, 114, 109, 104, 107]
    retrasadas = await _pedir(base, api.get_ordenes_por_estado, "retrasadas")
    assert [f["id"] for f in retrasadas] == [103, 110]
    # Las completadas, la última entregada arriba; las sin entrega cargada, al final.
    completadas = await _pedir(base, api.get_ordenes_por_estado, "completadas")
    assert [f["id"] for f in completadas] == [101, 102]


# ─────────────────────────── 3. centinelas ───────────────────────────


async def test_los_centinelas_no_son_fechas_ni_entregas(base):
    filas = {f["id"]: f for e in estado_ordenes.ESTADOS
             for f in await _pedir(base, api.get_ordenes_por_estado, e)}
    # La OT abierta del sistema viejo (entrega 1950-01-01) es Retrasada, no Completada.
    assert filas[103]["estado"] == "Retrasada"
    assert filas[103]["fecha_entrega"] is None
    assert filas[103]["fecha_prometida"] == "2026-09-20"
    # 3000-01-01 en las dos: sin fecha, pendiente.
    assert filas[104]["estado"] == "Pendiente"
    assert filas[104]["fecha_entrega"] is None and filas[104]["fecha_prometida"] is None
    assert filas[107]["fecha_prometida"] is None
    # Una entrega real se muestra como entrega; una abierta no hereda la prometida ahí.
    assert filas[101]["fecha_entrega"] == "2026-09-10"
    assert filas[112]["fecha_entrega"] == "2026-09-22"
    assert filas[106]["fecha_entrega"] is None
    # Ninguna OT abierta dice «Completada».
    abiertas = [f for f in filas.values() if f["estado_codigo"] != "completadas"]
    assert all(f["estado"] != "Completada" for f in abiertas)


async def test_las_filas_traen_el_numero_del_taller_y_los_datos_de_la_ot(base):
    filas = {f["id"]: f for f in await _pedir(base, api.get_ordenes_por_estado, "en_curso")}
    f = filas[105]
    assert f["numero"] == _numero(105)
    assert f["proceso_actual"] == "SOLDADURA"  # el paso 2, el que está en proceso
    assert f["procesos_totales"] == 3 and f["procesos_pendientes"] == 2
    assert f["cantidad"] == 2 and f["cliente"] == "ACME" and f["sector"] == "Mecanizado"
    assert f["cod_articulo"] == "A-1" and f["fecha_entrada"] == "2026-09-02"
    sin_cliente = {f["id"]: f for f in await _pedir(base, api.get_ordenes_por_estado, "pendientes")}
    assert sin_cliente[108]["cliente"] == "Sin Cliente"


# ─────────────────────────── 4. el «hoy» del taller ───────────────────────────


async def test_prometida_hoy_sigue_pendiente_a_la_noche(base):
    pendientes = [f["id"] for f in await _pedir(base, api.get_ordenes_por_estado, "pendientes")]
    retrasadas = [f["id"] for f in await _pedir(base, api.get_ordenes_por_estado, "retrasadas")]
    assert 106 in pendientes and 106 not in retrasadas
    # Y la de ayer sí está retrasada.
    assert 110 in retrasadas


# ─────────────────────────── 5. críticas, línea de entregas, día ───────────────────────────


async def test_criticas_son_las_por_entregar_de_la_semana(base):
    criticas = await _pedir(base, api.get_ordenes_criticas)
    assert [(c["id"], c["dias_restantes"]) for c in criticas] == CRITICAS
    por_id = {c["id"]: c for c in criticas}
    assert por_id[106]["fecha_entrega"] == "2026-09-24"  # la prometida: la tarjeta la lee así
    assert por_id[106]["estado"] == "Pendiente"
    assert por_id[111]["estado"] == "En Curso"
    assert por_id[106]["numero"] == _numero(106)
    assert por_id[108]["prioridad"] == "Urgente"


async def test_la_linea_de_entregas_y_la_lista_de_cada_dia_cierran(base):
    linea = await _pedir(base, api.get_timeline_entregas)
    assert linea == [{"fecha": "2026-09-24", "ordenes": 1}, {"fecha": "2026-09-25", "ordenes": 1},
                     {"fecha": "2026-09-28", "ordenes": 1}, {"fecha": "2026-10-01", "ordenes": 1}]
    for dia in linea:
        lista = await _pedir(base, api.get_ordenes_por_fecha, dia["fecha"])
        assert len(lista) == dia["ordenes"], dia
    # La 112 ya salió (entrega real) y la 102 está finalizada: no están en su día.
    assert [f["id"] for f in await _pedir(base, api.get_ordenes_por_fecha, "2026-09-25")] == [111]
    assert await _pedir(base, api.get_ordenes_por_fecha, "2026-09-26") == []
    async with base() as s:
        r = await api.get_ordenes_por_fecha("24/09/2026", db=s)
    assert r["success"] is False


# ─────────────────────────── 6. prioridades ───────────────────────────


async def test_las_listas_por_prioridad_suman_la_distribucion(base):
    dist = await _pedir(base, api.get_distribucion_prioridades)
    assert sum(p["cantidad"] for p in dist) == len(OTS)
    for p in dist:
        lista = await _pedir(base, api.get_ordenes_por_prioridad, p["prioridad"])
        assert len(lista) == p["cantidad"], p
    normales = {f["id"]: f for f in await _pedir(base, api.get_ordenes_por_prioridad, "Normal")}
    # El rótulo es el del tablero, no «Completada» por tener un 1950 en la entrega.
    assert normales[103]["estado"] == "Retrasada"
    # Esta lista muestra UNA fecha: la entrega si salió, si no la prometida, o nada.
    assert normales[103]["fecha_entrega"] == "2026-09-20"
    assert normales[101]["fecha_entrega"] == "2026-09-10"
    assert normales[104]["fecha_entrega"] is None
    assert normales[101]["cantidad"] == 5


# ─────────────────────────── el resto de las tarjetas ───────────────────────────


async def test_top_articulos_no_pone_arriba_al_que_no_tiene_unidades(base):
    top = await _pedir(base, api.get_top_articulos)
    # La 102 (Brida) está finalizada sin unidades: en Postgres un SUM nulo iba PRIMERO
    # con ORDER BY DESC.
    assert top == [{"articulo": "Eje", "cantidad": 5}, {"articulo": "Brida", "cantidad": 0}]


async def test_clientes_y_tiempo_promedio_andan(base):
    clientes = await _pedir(base, api.get_clientes_mayor_volumen)
    assert clientes == [{"cliente": "ACME", "cantidad": len([o for o in OTS if o[7] == 1])}]
    tiempo = await _pedir(base, api.get_tiempo_promedio)
    assert set(tiempo) == {"dias", "horas"}


async def test_rendimiento_anda_en_postgres(base):
    if base.motor != "postgres":
        pytest.skip("EXTRACT(EPOCH ...) es de Postgres: SQLite no lo tiene")
    procesos = await _pedir(base, api.get_rendimiento_procesos)
    # Terminados: TORNO en la 101, la 105 y la 111; SOLDADURA en la 101. 90' cada uno.
    assert [(p["proceso"], p["cantidad"], p["real_min"], p["estimado_min"]) for p in procesos] == [
        ("TORNO CNC", 3, 270, 180), ("SOLDADURA", 1, 90, 60)]
    operarios = await _pedir(base, api.get_rendimiento_operarios)
    assert [(o["operario"], o["cantidad"]) for o in operarios] == [("JUAN PEREZ", 1)]


# ─────────────────────────── 7. /ordenes-estadisticas/* ───────────────────────────


async def test_estadisticas_de_ordenes_dicen_lo_mismo_que_el_tablero(base):
    tablero = await _pedir(base, api.get_estadisticas)
    async with base() as s:
        r = await OrdenTrabajoService(s).obtenerEstadisticasEstados()
    e = r.data
    assert e == {"completadas": tablero["completadas"], "en_proceso": tablero["en_proceso"],
                 "pendientes": tablero["pendientes"], "retrasadas": tablero["retrasadas"],
                 "total": tablero["total"]}


async def test_ocupacion_por_sector_no_da_500_y_suma_las_abiertas(base):
    tablero = await _pedir(base, api.get_estadisticas)
    async with base() as s:
        r = await OrdenTrabajoService(s).obtenerOcupacionPorSector()
    ocupacion = {o["sector"]: o for o in r.data}
    assert set(ocupacion) == {"Mecanizado", "Soldadura", "Pintura"}
    assert ocupacion["Pintura"]["ordenes_activas"] == 0
    abiertas = [o for o in OTS if o[-1] != "completadas"]
    assert ocupacion["Mecanizado"]["ordenes_activas"] == len([o for o in abiertas if o[4] == 1])
    assert sum(o["ordenes_activas"] for o in r.data) == tablero["total"] - tablero["completadas"]
    assert abs(sum(o["porcentaje"] for o in r.data) - 100) < 0.5


async def test_criticas_y_proximas_entregas_de_ordenes(base):
    async with base() as s:
        criticas = (await OrdenTrabajoService(s).obtenerOrdenesCriticas(7)).data
    assert [(c["id"], c["dias_restantes"]) for c in criticas] == CRITICAS
    assert criticas[0]["numero"] == _numero(106)
    async with base() as s:
        linea = (await OrdenTrabajoService(s).obtenerProximasEntregasTimeline(7)).data
    assert [x["fecha"] for x in linea][0] == "2026-09-24" and len(linea) == 8
    assert {x["fecha"]: x["cantidad_ordenes"] for x in linea if x["cantidad_ordenes"]} == {
        "2026-09-24": 1, "2026-09-25": 1, "2026-09-28": 1, "2026-10-01": 1}


# ─────────────────────────── 8. restos de SQL Server ───────────────────────────


RAIZ = Path(__file__).resolve().parents[1]
SQL_SERVER = re.compile(
    r"GETDATE\s*\(|GETUTCDATE\s*\(|ISNULL\s*\(|DATEADD\s*\(|DATEDIFF\s*\(|SELECT\s+TOP\s"
    r"|\bCONVERT\s*\(\s*(N?VARCHAR|DATE|INT)|\bNEWID\s*\(|WITH\s*\(NOLOCK\)", re.I)


def test_no_quedan_funciones_de_sql_server_en_el_backend():
    """Producción corre en Postgres desde el 28/07. Los scripts de migración desde el
    sistema viejo (backend/scripts) hablan con SQL Server a propósito y quedan afuera."""
    malos = []
    for archivo in RAIZ.rglob("*.py"):
        rel = archivo.relative_to(RAIZ).as_posix()
        if rel.startswith(("scripts/", "tests/")):
            continue
        for n, linea in enumerate(archivo.read_text(encoding="utf-8").splitlines(), 1):
            if SQL_SERVER.search(linea):
                malos.append(f"{rel}:{n}: {linea.strip()}")
    assert not malos, "SQL de SQL Server en el backend:\n" + "\n".join(malos)


def test_los_centinelas_en_python():
    assert estado_ordenes.fecha_o_nada(datetime(1950, 1, 1)) is None
    assert estado_ordenes.fecha_o_nada(datetime(3000, 1, 1)) is None
    assert estado_ordenes.fecha_o_nada(None) is None
    assert estado_ordenes.fecha_o_nada("2026-09-24 00:00:00.000000") == "2026-09-24"
    assert estado_ordenes.fecha_o_nada(datetime(2026, 9, 24, 13, 5)) == "2026-09-24"
    assert estado_ordenes.hoy_ar() == datetime(2026, 9, 24)
