"""
RF-23: el armador de reportes personalizados del Dashboard.

Lo que se prueba:

1. **El catálogo es cerrado.** Una fuente, una columna, un filtro, una agrupación o una
   cuenta que no están en el catálogo son un 422, no SQL nuevo; un campo de más en el
   pedido también. Los valores de los filtros viajan como parámetros: un texto con SQL
   adentro se busca como texto.
2. **Cada fuente pide lo de su pantalla**, con los permisos de QUIEN PIDE: sin
   Operaciones no hay órdenes; sin Auditoría no hay auditoría (y sin «Ingresos» no van las
   entradas y salidas, sin «asistencia» no van las ausencias); la eficiencia de cada
   persona es de la sección confidencial «Rendimiento por persona». Lo que no puede ver
   no aparece en el catálogo y el servidor lo rechaza (403), también en un reporte
   compartido por un admin.
3. **Las cuentas dan bien**: filtros, período (atajos), agrupar por una y por dos
   columnas con cantidad, suma, promedio, mínimo y máximo, los totales de TODO lo filtrado
   (no de la vista previa), el orden, el tope de filas con su aviso y el de tiempo.
4. **Los reportes guardados**: de quien los guardó (sólo esa persona los cambia o los
   borra), compartir es de un admin y un compartido sólo lo ve quien puede leer su fuente.

CONTRA QUÉ BASE

SQLite en memoria siempre. Y, si está SPMM_PG_PRUEBAS con la URL de un Postgres
DESCARTABLE en localhost, todo otra vez ahí: es donde se ven los errores de dialecto (las
horas entre dos fechas, el mes, el statement_timeout). Esa base se BORRA ENTERA (DROP
SCHEMA public CASCADE): por eso sólo se acepta localhost. Nunca Supabase.

    SPMM_PG_PRUEBAS=postgresql+asyncpg://yo@127.0.0.1:55423/spmm_pruebas pytest ...

El reloj se fija: miércoles 23/09/2026 a las 12:00.
"""
import asyncio
import json
import os
from datetime import date, datetime, time
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.application import ReportesCatalogo as cat
from backend.application import ReportesGuardadosService as guardados_mod
from backend.application import ReportesService as rs
from backend.application.ReportesService import ReporteSinPermiso
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.permisos import (
    MATRIZ_ROL_AREA,
    MATRIZ_ROL_SECCION,
    DatosDePermisos,
    permisos_de,
)
from backend.core.permisos_rutas import POLITICAS
from backend.core.security import UsuarioActual
from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.AusenciaOperario import AusenciaOperario
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import PausaOrden
from backend.domain.Pieza import Pieza
from backend.domain.Planificacion import Planificacion
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.ReporteGuardado import ReporteGuardado
from backend.domain.Sector import Sector
from backend.infrastructure.db import Base
from backend.presentation import ReportesAPI
from backend.tests.conftest import TEST_TABLES

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url: str) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


MOTORES = ["sqlite"] + (["postgres"] if PG_URL and _pg_seguro(PG_URL) else [])
TABLAS = TEST_TABLES + [AuditoriaMovimiento.__table__, ReporteGuardado.__table__]

AHORA = datetime(2026, 9, 23, 12, 0)
VIEJA, NUEVA = datetime(1950, 1, 1), datetime(3000, 1, 1)
JUAN, ANA = 1, 2


def d(mes, dia, hh=0, mm=0):
    return datetime(2026, mes, dia, hh, mm)


# ─────────────────────────── quiénes piden ───────────────────────────


def _permisos(rol, areas=None, secciones=None, id_usuario=50):
    return permisos_de(DatosDePermisos(rol=rol, rol_areas=areas or {}, rol_secciones=secciones or {}),
                       id_usuario, rol)


ADMIN = permisos_de(DatosDePermisos(rol="admin"), 1, "julian")
SUPERVISOR = _permisos("supervisor", MATRIZ_ROL_AREA["supervisor"], id_usuario=3)
OPERARIO = _permisos("operario", MATRIZ_ROL_AREA["operario"], MATRIZ_ROL_SECCION["operario"], id_usuario=4)
SOLO_TABLERO = _permisos("tablero", {"dashboard": "read"}, id_usuario=6)
AUDITOR = _permisos("auditor", {"dashboard": "read", "auditoria": "read"}, id_usuario=7)
AUDITOR_CON_OPERACIONES = _permisos("auditor2", {"dashboard": "read", "auditoria": "read",
                                                 "operaciones": "read"}, id_usuario=8)
JEFE_CON_RENDIMIENTO = _permisos("jefe", {"dashboard": "read", "recursos": "read"},
                                 {"dashboard_rendimiento": "read"}, id_usuario=9)


# ─────────────────────────── la base ───────────────────────────


async def _sembrar(s):
    s.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Prioridad(id=2, descripcion="Urgente"),
        Sector(id=1, nombre="Mecanizado"),
        Articulo(id=1, cod_articulo="A-1", descripcion="Eje", abreviatura="EJE"),
        Articulo(id=2, cod_articulo="A-2", descripcion="Brida", abreviatura="BRI"),
        Articulo(id=3, cod_articulo="A-3", descripcion="Tubo 100% acero", abreviatura="TUB"),
        Cliente(id=1, nombre="ACME"),
        Cliente(id=2, nombre="Beta SA"),
        Cliente(id=3, nombre="Cien Real"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="En Proceso"),
        EstadoProceso(id=3, descripcion="Finalizado"),
        Proceso(id=150, nombre="TORNO CNC"),
        Proceso(id=160, nombre="SOLDADURA"),
        Operario(id=JUAN, nombre="JUAN", apellido="PEREZ", categoria="OFICIAL", disponible=False,
                 hora_inicio=time(7), hora_fin=time(16), dni="20111222", telefono="555-1234"),
        Operario(id=ANA, nombre="ANA", apellido="GIL", categoria="MEDIO OFICIAL", disponible=True,
                 hora_inicio=time(7), hora_fin=time(16)),
        Maquinaria(id=7, nombre="TORNO 1", tipo="Torno", estado_operativo="operativa"),
        Maquinaria(id=8, nombre="SOLDADORA", tipo="Soldadora", estado_operativo="en_mantenimiento"),
        Pieza(id=1, cod_pieza="CH-18", descripcion="CHAPA 1/8", unidad="kg", stockactual=5, stock_minimo=10,
              unitario=100),
        Pieza(id=2, cod_pieza="BA-1", descripcion="BARRA", unidad="m", stockactual=20, stock_minimo=5),
        Pieza(id=3, cod_pieza="TO-1", descripcion="TORNILLO", unidad="u", stockactual=0),
    ])
    await s.flush()
    # (id, número, cliente, prioridad, artículo, unidades, entregadas, finalizada, entrada,
    #  prometida, entrega, reclamo)
    for (id_, cliente, prio, art, uni, ent, fin, entrada, prometida, entrega, reclamo) in (
        (10, 1, 1, 1, 5, 5, 1, d(8, 20), d(9, 6), d(9, 5), 0),
        (11, 1, 2, 2, 3, 3, 1, d(8, 21), d(9, 16), d(9, 15), 0),
        (12, 2, 1, 1, 10, 10, 1, d(8, 1), d(8, 30), d(8, 30), 0),
        # Vencida y sin arrancar: retrasada. Entrega = centinela del sistema viejo.
        (13, 2, 1, 1, 7, 0, 0, d(9, 1), d(9, 10), VIEJA, 1),
        # Sin cliente, con un paso en proceso: en curso.
        (14, None, 2, 2, 1, 0, 0, d(9, 2), d(10, 1), None, 0),
        # Prometida = 3000-01-01: sin fecha, pendiente.
        (15, 3, 1, 1, 2, 0, 0, d(9, 3), NUEVA, None, 0),
        (16, 2, 2, 3, 4, 4, 1, d(9, 4), d(9, 21), d(9, 20), 0),
    ):
        s.add(OrdenTrabajo(id=id_, id_otvieja=15000 + id_, id_cliente=cliente, id_prioridad=prio,
                           id_sector=1, id_articulo=art, unidades=uni, cantidad_entregada=ent,
                           finalizadototal=fin, fecha_orden=entrada, fecha_entrada=entrada,
                           fecha_prometida=prometida, fecha_entrega=entrega, reclamo=reclamo))
    await s.flush()
    s.add_all([
        # (paso, OT, proceso, orden, estado, estimado min, arranque, fin, elegido, máquina)
        OrdenTrabajoProceso(id=101, id_orden_trabajo=10, id_proceso=150, orden=1, id_estado=3,
                            tiempo_proceso=120, inicio_real=d(9, 1, 8), fin_real=d(9, 1, 11),
                            id_operario=JUAN, id_maquinaria=7),
        OrdenTrabajoProceso(id=102, id_orden_trabajo=10, id_proceso=160, orden=2, id_estado=3,
                            tiempo_proceso=60, inicio_real=d(9, 2, 8), fin_real=d(9, 2, 9, 30)),
        OrdenTrabajoProceso(id=103, id_orden_trabajo=11, id_proceso=150, orden=1, id_estado=3,
                            tiempo_proceso=90, inicio_real=d(9, 3, 8), fin_real=d(9, 3, 10),
                            id_operario=JUAN),
        OrdenTrabajoProceso(id=104, id_orden_trabajo=14, id_proceso=150, orden=1, id_estado=2,
                            tiempo_proceso=30, inicio_real=d(9, 22, 8)),
        OrdenTrabajoProceso(id=105, id_orden_trabajo=12, id_proceso=160, orden=1, id_estado=3,
                            tiempo_proceso=180, inicio_real=d(8, 28, 8), fin_real=d(8, 28, 12),
                            id_operario=ANA),
        # Arranque = centinela: no arrancó.
        OrdenTrabajoProceso(id=106, id_orden_trabajo=13, id_proceso=150, orden=1, id_estado=1,
                            tiempo_proceso=60, inicio_real=VIEJA),
    ])
    await s.flush()
    s.add_all([
        # El 102 no tiene a nadie elegido: manda el ÚLTIMO plan (ANA con la soldadora), no
        # el viejo (JUAN).
        Planificacion(orden_id=10, proceso_id=160, id_orden_trabajo_proceso=102, id_operario=JUAN,
                      inicio_min=0, fin_min=60, duracion_min=60, prioridad_peso=1, creado_en=d(8, 1)),
        Planificacion(orden_id=10, proceso_id=160, id_orden_trabajo_proceso=102, id_operario=ANA,
                      id_maquinaria=8, inicio_min=0, fin_min=60, duracion_min=60, prioridad_peso=1,
                      creado_en=d(9, 1)),
        # El 101 tiene a JUAN elegido a mano: el plan (ANA) no lo pisa.
        Planificacion(orden_id=10, proceso_id=150, id_orden_trabajo_proceso=101, id_operario=ANA,
                      inicio_min=0, fin_min=60, duracion_min=60, prioridad_peso=1, creado_en=d(9, 1)),
        AusenciaOperario(id_operario=JUAN, desde=date(2026, 9, 14), vuelve=date(2026, 9, 16),
                         motivo="ENFERMEDAD", origen="CARGA", cargada_en=d(9, 14)),
        AusenciaOperario(id_operario=JUAN, desde=date(2026, 9, 22), vuelve=None, origen="ESTADO",
                         cargada_en=d(9, 22)),
        AusenciaOperario(id_operario=ANA, desde=date(2026, 8, 30), vuelve=date(2026, 9, 2),
                         motivo="VACACIONES", origen="CARGA", cargada_en=d(8, 29)),
        ConsumoMaterial(id=1, id_orden_trabajo=10, id_pieza=1, cantidad=2.5, unidad="kg",
                        fecha=d(9, 1, 10), usuario="Sofía", anulado=0),
        ConsumoMaterial(id=2, id_orden_trabajo=10, id_pieza=1, cantidad=1.5, fecha=d(9, 2, 10), anulado=0),
        ConsumoMaterial(id=3, id_orden_trabajo=10, id_pieza=1, cantidad=100, fecha=d(9, 2, 11), anulado=1),
        ConsumoMaterial(id=4, id_orden_trabajo=11, id_pieza=2, cantidad=3, fecha=d(9, 10, 9), anulado=0),
        IncidenciaProceso(id=1, id_orden_trabajo=10, id_proceso=150, id_operario=JUAN,
                          tipo="MEDIDA_FUERA_DE_TOLERANCIA", gravedad="GRAVE", minutos_perdidos=30,
                          piezas_afectadas=2, fecha_registro=d(9, 5, 10)),
        IncidenciaProceso(id=2, id_orden_trabajo=11, id_operario=JUAN, minutos_perdidos=15,
                          fecha_registro=d(9, 6, 10)),
        IncidenciaProceso(id=3, id_orden_trabajo=12, id_operario=ANA, minutos_perdidos=45,
                          piezas_afectadas=1, fecha_registro=d(8, 1, 10)),
        IncidenciaProceso(id=4, id_orden_trabajo=13, minutos_perdidos=10, fecha_registro=d(9, 7, 10)),
        PausaOrden(id=1, id_orden_trabajo=10, motivo="FALTA_MATERIAL", desde=d(9, 1, 8),
                   hasta=d(9, 1, 10), cierre="REANUDADA"),
        # Sigue abierta: cuenta hasta ahora (12:00).
        PausaOrden(id=2, id_orden_trabajo=14, id_otp=104, paso=1, nombre_proceso="TORNO CNC",
                   motivo="MAQUINA_ROTA", desde=d(9, 23, 9)),
        AuditoriaMovimiento(id=1, creado_en=d(9, 20, 8), usuario="Julián", accion="ingresó",
                            entidad="sesión", descripcion="Julián ingresó", metodo="POST",
                            ruta="/auth/login", estado=200),
        AuditoriaMovimiento(id=2, creado_en=d(9, 21, 9), usuario="Julián", accion="creó",
                            entidad="orden de trabajo", descripcion="Julián creó orden de trabajo",
                            metodo="POST", ruta="/ordenes", estado=200),
        AuditoriaMovimiento(id=3, creado_en=d(9, 21, 10), usuario="Julián", accion="creó",
                            entidad="persona › ausencias", id_entidad="1",
                            descripcion="Julián cargó una ausencia de Juan Pérez (enfermedad)",
                            metodo="POST", ruta="/operarios/1/ausencias", estado=200),
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

        @event.listens_for(engine.sync_engine, "connect")
        def _fks(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    async with engine.begin() as conn:
        if motor == "postgres":
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLAS))

    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _sembrar(s)
    Sesion.motor = motor
    yield Sesion
    await engine.dispose()


@pytest.fixture(autouse=True)
def reloj(monkeypatch):
    monkeypatch.setattr(rs, "ahora_ar", lambda: AHORA)
    monkeypatch.setattr(guardados_mod, "ahora_ar", lambda: AHORA)


async def correr(Sesion, config, permisos=ADMIN, vista_previa=False):
    """Cada corrida con su sesión, como en la app."""
    async with Sesion() as s:
        return await rs.ejecutar(s, config, permisos, vista_previa=vista_previa)


def _cfg(fuente, columnas=(), **extra):
    return {"fuente": fuente, "columnas": list(columnas), **extra}


def _col(r, codigo):
    return [f[codigo] for f in r["filas"]]


# ─────────────────────────── 1. el catálogo es cerrado ───────────────────────────


def test_cada_fuente_pide_lo_de_su_pantalla_y_no_una_copia():
    """Las políticas son las del mapa (el mismo objeto): si una pantalla cambia lo que
    pide, la fuente cambia con ella."""
    f = cat.FUENTE_POR_CODIGO
    assert f["ordenes"].requisitos is POLITICAS["ordenes"].leer
    assert f["pasos"].requisitos is POLITICAS["ordenes"].leer
    assert f["personas"].requisitos is POLITICAS["asistencia"].leer
    assert f["ausencias"].requisitos is POLITICAS["asistencia"].leer
    assert f["consumos"].requisitos is POLITICAS["consumos_material"].leer
    assert f["no_conformidades"].requisitos is POLITICAS["incidencias"].leer
    assert f["pausas"].requisitos is POLITICAS["pausas"].leer
    assert f["auditoria"].requisitos is POLITICAS["auditoria"].leer
    assert f["maquinas"].requisitos is POLITICAS["maquinarias"].leer
    assert f["stock"].requisitos is POLITICAS["piezas"].leer
    assert f["personas"].columna("eficiencia").requisitos is POLITICAS["rendimiento_operario"].leer


def test_el_catalogo_no_trae_datos_personales_ni_secretos():
    """Ninguna columna de ninguna fuente lee el DNI, el teléfono, el mail ni una clave, ni
    la tabla de usuarios."""
    prohibidas = ("dni", "telefono", "celular", "email", "password", "token", "mail", "cuit",
                  "detalle", "usuario.")
    ctx = cat.Contexto(ahora=AHORA)
    for fuente in cat.FUENTES:
        consulta = select(*[c.expr(ctx).label(c.codigo) for c in fuente.columnas]).select_from(
            fuente.origen(ctx))
        sql = str(consulta.compile(dialect=postgresql.dialect())).lower()
        for p in prohibidas:
            assert f".{p}" not in sql and f" {p}" not in sql.replace(" as ", " "), (fuente.codigo, p)


def test_los_ejemplos_son_utiles_y_pasan_la_validacion():
    assert 4 <= len(cat.EJEMPLOS) <= 6
    nombres = {e["nombre"] for e in cat.EJEMPLOS}
    for pedido in ("OT entregadas por cliente este mes", "Horas por persona y proceso",
                   "Consumo de material por OT", "No conformidades por persona"):
        assert pedido in nombres
    for e in cat.EJEMPLOS:
        rs.validar(e["config"], ADMIN, AHORA.date())


def test_los_atajos_del_periodo():
    hoy = date(2026, 9, 23)
    assert cat.rango_del_atajo("este_mes", hoy) == (date(2026, 9, 1), date(2026, 9, 30))
    assert cat.rango_del_atajo("mes_pasado", hoy) == (date(2026, 8, 1), date(2026, 8, 31))
    assert cat.rango_del_atajo("ultimos_30", hoy) == (date(2026, 8, 25), hoy)
    assert cat.rango_del_atajo("ultimos_90", hoy) == (date(2026, 6, 26), hoy)
    assert cat.rango_del_atajo("este_anio", hoy) == (date(2026, 1, 1), date(2026, 12, 31))
    # Enero: el mes pasado es diciembre del año anterior; febrero bisiesto.
    assert cat.rango_del_atajo("mes_pasado", date(2026, 1, 10)) == (date(2025, 12, 1), date(2025, 12, 31))
    assert cat.rango_del_atajo("este_mes", date(2028, 2, 3)) == (date(2028, 2, 1), date(2028, 2, 29))


INVENTADOS = [
    (_cfg("usuarios", ["username"]), "No existe la fuente"),
    (_cfg("ordenes", ["numero", "password_hash"]), "no tiene la columna «password_hash»"),
    (_cfg("ordenes", ["numero; DROP TABLE orden_trabajo"]), "no tiene la columna"),
    ({**_cfg("ordenes", ["numero"]), "sql": "select * from usuario"}, "forma esperada"),
    (_cfg("ordenes", ["numero"], filtros=[{"columna": "dni", "op": "contiene", "valor": "2"}]),
     "no tiene la columna «dni»"),
    (_cfg("ordenes", ["numero"], filtros=[{"columna": "cliente", "op": "contiene", "valor": "AC"}]),
     "se filtra con «en»"),
    (_cfg("ordenes", ["numero"], filtros=[{"columna": "cliente", "op": "en", "valores": ["1 OR 1=1"]}]),
     "no es uno de los valores posibles"),
    (_cfg("ordenes", ["numero"], filtros=[{"columna": "estado", "op": "en", "valores": ["borradas"]}]),
     "no es uno de los valores posibles"),
    (_cfg("ordenes", ["numero"], filtros=[{"columna": "unidades", "op": "entre", "desde": "mucho"}]),
     "no es un número"),
    (_cfg("ordenes", ["numero"], filtros=[{"columna": "unidades", "op": "raw", "valor": "1"}]),
     "forma esperada"),
    (_cfg("ordenes", ["numero"], agrupar=["observaciones"]), "No se puede agrupar"),
    (_cfg("ordenes", ["numero"], agrupar=["cliente", "estado", "prioridad"]), "forma esperada"),
    (_cfg("ordenes", ["numero"], agrupar=["cliente"], medidas=[{"funcion": "suma", "columna": "cliente"}]),
     "no se le puede pedir suma"),
    (_cfg("ordenes", ["numero"], agrupar=["cliente"], medidas=[{"funcion": "mediana", "columna": "unidades"}]),
     "forma esperada"),
    (_cfg("ordenes", ["numero"], agrupar=["cliente"], orden={"por": "m3", "direccion": "asc"}),
     "se ordena por"),
    (_cfg("ordenes", ["numero"], orden={"por": "clave_fila"}), "no tiene la columna"),
    (_cfg("maquinas", ["maquina"], periodo={"atajo": "este_mes"}), "no tiene fechas"),
    (_cfg("ordenes", ["numero"], periodo={"columna": "unidades", "atajo": "este_mes"}), "no se acota por"),
    (_cfg("ordenes", ["numero"], periodo={"atajo": "siempre"}), "forma esperada"),
    (_cfg("ordenes", []), "Elegí al menos una columna"),
    (_cfg("ordenes", ["numero", "numero"]), "dos veces"),
]


@pytest.mark.parametrize("config,mensaje", INVENTADOS)
def test_lo_que_no_esta_en_el_catalogo_se_rechaza(config, mensaje):
    with pytest.raises(BusinessException) as e:
        rs.validar(config, ADMIN, AHORA.date())
    assert mensaje in e.value.message


def test_un_pedido_que_no_es_json_o_es_enorme():
    with pytest.raises(BusinessException, match="JSON"):
        rs.validar("{no es json", ADMIN)
    with pytest.raises(BusinessException, match="largo"):
        rs.validar("x" * (rs.LARGO_MAXIMO_CONFIG + 1), ADMIN)


async def test_un_texto_con_sql_se_busca_como_texto(base):
    malo = "'; DROP TABLE orden_trabajo; --"
    config = _cfg("ordenes", ["numero"], filtros=[{"columna": "articulo", "op": "contiene", "valor": malo}])
    plan = rs.validar(config, ADMIN, AHORA.date())
    consultas = rs.armar_consultas(plan, cat.Contexto(ahora=AHORA), ADMIN, 10)
    sql = str(consultas["filas"].compile(dialect=postgresql.dialect()))
    assert "DROP" not in sql, "el valor tiene que ir como parámetro, no pegado al SQL"
    r = await correr(base, config)
    assert r["filas"] == [] and r["total_filas"] == 0
    async with base() as s:
        assert (await s.execute(select(func.count()).select_from(OrdenTrabajo))).scalar() == 7


# ─────────────────────────── 2. permisos por fuente ───────────────────────────


def _fuentes(permisos):
    return {f["codigo"]: f for f in rs.catalogo(permisos)["fuentes"]}


def test_el_catalogo_trae_solo_lo_que_cada_uno_puede_ver():
    assert set(_fuentes(ADMIN)) == {f.codigo for f in cat.FUENTES}
    # Sólo el Dashboard: los catálogos libres y nada más.
    assert set(_fuentes(SOLO_TABLERO)) == {"maquinas", "stock"}
    assert [e["codigo"] for e in rs.catalogo(SOLO_TABLERO)["ejemplos"]] == ["materia_prima_bajo_minimo"]
    # El operario y el supervisor (matriz sembrada): todo menos la auditoría, y sin la
    # eficiencia de cada persona.
    for quien in (OPERARIO, SUPERVISOR):
        fuentes = _fuentes(quien)
        assert "auditoria" not in fuentes and "ordenes" in fuentes and "personas" in fuentes
        assert "eficiencia" not in {c["codigo"] for c in fuentes["personas"]["columnas"]}
    assert "eficiencia" in {c["codigo"] for c in _fuentes(JEFE_CON_RENDIMIENTO)["personas"]["columnas"]}
    assert set(_fuentes(AUDITOR)) == {"maquinas", "stock", "auditoria"}


@pytest.mark.parametrize("permisos,config,mensaje", [
    (SOLO_TABLERO, _cfg("ordenes", ["numero"]), "«Órdenes de trabajo»"),
    (SOLO_TABLERO, _cfg("personas", ["persona"]), "«Personas»"),
    (OPERARIO, _cfg("auditoria", ["cuando"]), "«Auditoría»"),
    (SUPERVISOR, _cfg("personas", ["persona", "eficiencia"]), "«Eficiencia»"),
    # También escondida en un filtro, en una agrupación o en el orden.
    (SUPERVISOR, _cfg("personas", ["persona"], filtros=[
        {"columna": "eficiencia", "op": "entre", "desde": 100}]), "«Eficiencia»"),
    (SUPERVISOR, _cfg("personas", ["persona"], orden={"por": "eficiencia"}), "«Eficiencia»"),
])
def test_lo_que_no_puede_ver_es_un_403(permisos, config, mensaje):
    with pytest.raises(ReporteSinPermiso) as e:
        rs.validar(config, permisos, AHORA.date())
    assert mensaje in e.value.message


async def test_la_eficiencia_con_la_seccion_confidencial(base):
    r = await correr(base, _cfg("personas", ["persona", "eficiencia"], periodo={"atajo": "este_mes"}),
                     JEFE_CON_RENDIMIENTO)
    assert dict(zip(_col(r, "persona"), _col(r, "eficiencia"))) == pytest.approx(
        {"ANA GIL": 66.666667, "JUAN PEREZ": 70.0}, rel=1e-4)


async def test_la_auditoria_esconde_lo_mismo_que_su_pantalla(base):
    cfg = _cfg("auditoria", ["accion", "entidad"], orden={"por": "cuando", "direccion": "asc"})
    # El admin ve todo.
    assert _col(await correr(base, cfg, ADMIN), "entidad") == [
        "sesión", "orden de trabajo", "persona › ausencias"]
    # Con Auditoría y nada más: ni los ingresos (sección confidencial) ni las ausencias
    # (política «asistencia»).
    assert _col(await correr(base, cfg, AUDITOR), "entidad") == ["orden de trabajo"]
    # Con Operaciones, que abre la asistencia, las ausencias sí.
    assert _col(await correr(base, cfg, AUDITOR_CON_OPERACIONES), "entidad") == [
        "orden de trabajo", "persona › ausencias"]
    # Y agrupando no se cuela nada.
    r = await correr(base, _cfg("auditoria", agrupar=["entidad"]), AUDITOR)
    assert r["totales"]["m0"] == 1 and r["total_grupos"] == 1


# ─────────────────────────── 3. las cuentas ───────────────────────────


async def test_filas_con_totales_de_todo_lo_filtrado(base):
    cfg = _cfg("ordenes", ["numero", "cliente", "estado", "unidades", "fecha_entrega"],
               orden={"por": "numero", "direccion": "asc"})
    r = await correr(base, cfg)
    assert r["modo"] == "filas" and r["total_filas"] == 7 and not r["recortado"]
    assert _col(r, "numero") == [15010, 15011, 15012, 15013, 15014, 15015, 15016]
    # El estado es el de las tarjetas del Dashboard.
    assert _col(r, "estado") == ["Completada", "Completada", "Completada", "Retrasada", "En curso",
                                 "Pendiente", "Completada"]
    # Los centinelas del sistema viejo salen vacíos, no como 01/01/1950.
    assert _col(r, "fecha_entrega") == ["2026-09-05", "2026-09-15", "2026-08-30", None, None, None,
                                        "2026-09-20"]
    assert _col(r, "cliente")[4] is None
    assert r["totales"] == {"unidades": 32}
    assert [c["clave"] for c in r["columnas"]] == ["numero", "cliente", "estado", "unidades", "fecha_entrega"]


async def test_la_vista_previa_trae_pocas_filas_y_los_totales_de_todo(base, monkeypatch):
    monkeypatch.setattr(rs, "FILAS_VISTA_PREVIA", 2)
    r = await correr(base, _cfg("ordenes", ["numero", "unidades"]), vista_previa=True)
    assert len(r["filas"]) == 2 and r["total_filas"] == 7 and r["totales"] == {"unidades": 32}
    assert r["recortado"] and r["aviso"] is None, "la vista previa no avisa del tope: es a propósito"
    # El orden de siempre de la fuente: el número más nuevo arriba.
    assert _col(r, "numero") == [15016, 15015]


async def test_el_tope_de_filas_avisa(base, monkeypatch):
    monkeypatch.setattr(rs, "TOPE_FILAS", 3)
    r = await correr(base, _cfg("ordenes", ["numero"]))
    assert len(r["filas"]) == 3 and r["total_filas"] == 7 and r["recortado"]
    assert "Hay 7 filas" in r["aviso"] and "primeras 3" in r["aviso"]


@pytest.mark.parametrize("filtros,esperado", [
    ([{"columna": "estado", "op": "en", "valores": ["retrasadas", "pendientes"]}], [15013, 15015]),
    ([{"columna": "cliente", "op": "en", "valores": [None]}], [15014]),
    ([{"columna": "cliente", "op": "en", "valores": [1, None]}], [15010, 15011, 15014]),
    ([{"columna": "articulo", "op": "contiene", "valor": "EJE"}], [15010, 15012, 15013, 15015]),
    # El % se busca como letra, no como comodín.
    ([{"columna": "articulo", "op": "contiene", "valor": "%"}], [15016]),
    ([{"columna": "unidades", "op": "entre", "desde": 3, "hasta": 7}], [15010, 15011, 15013, 15016]),
    ([{"columna": "unidades", "op": "entre", "desde": 7}], [15012, 15013]),
    ([{"columna": "reclamo", "op": "es", "valor": True}], [15013]),
    ([{"columna": "fecha_prometida", "op": "entre", "desde": "2026-09-06", "hasta": "2026-09-16"}],
     [15010, 15011, 15013]),
    # Dos filtros juntos.
    ([{"columna": "prioridad", "op": "en", "valores": [2]},
      {"columna": "estado", "op": "en", "valores": ["completadas"]}], [15011, 15016]),
])
async def test_los_filtros(base, filtros, esperado):
    r = await correr(base, _cfg("ordenes", ["numero"], filtros=filtros, orden={"por": "numero"}))
    assert _col(r, "numero") == esperado


async def test_el_periodo_con_atajo_y_con_fechas(base):
    r = await correr(base, _cfg("ordenes", ["numero"], periodo={"columna": "fecha_entrega", "atajo": "este_mes"},
                                orden={"por": "numero"}))
    assert _col(r, "numero") == [15010, 15011, 15016]
    assert r["periodo"] == {"desde": "2026-09-01", "hasta": "2026-09-30", "atajo": "este_mes",
                            "columna": "fecha_entrega"}
    r = await correr(base, _cfg("ordenes", ["numero"], periodo={"columna": "fecha_entrega", "atajo": "mes_pasado"}))
    assert _col(r, "numero") == [15012]
    # «hasta» incluye el día entero.
    r = await correr(base, _cfg("ordenes", ["numero"], orden={"por": "numero"},
                                periodo={"columna": "fecha_entrada", "desde": "2026-08-20", "hasta": "2026-08-21"}))
    assert _col(r, "numero") == [15010, 15011]


async def test_agrupar_por_una_columna_con_todas_las_cuentas(base):
    r = await correr(base, _cfg("ordenes", agrupar=["cliente"], medidas=[
        {"funcion": "conteo"}, {"funcion": "suma", "columna": "unidades"},
        {"funcion": "promedio", "columna": "unidades"}, {"funcion": "minimo", "columna": "unidades"},
        {"funcion": "maximo", "columna": "unidades"}, {"funcion": "maximo", "columna": "fecha_entrega"},
    ]))
    assert r["modo"] == "grupos" and r["total_grupos"] == 4 and r["total_filas"] == 7
    assert [c["nombre"] for c in r["columnas"]] == [
        "Cliente", "Cantidad", "Unidades (suma)", "Unidades (promedio)", "Unidades (mínimo)",
        "Unidades (máximo)", "Fecha de entrega (máximo)"]
    filas = [[f["cliente"], f["m0"], f["m1"], f["m2"], f["m3"], f["m4"], f["m5"]] for f in r["filas"]]
    assert filas == [
        ["ACME", 2, 8, pytest.approx(4.0), 3, 5, "2026-09-15"],
        ["Beta SA", 3, 21, pytest.approx(7.0), 4, 10, "2026-09-20"],
        ["Cien Real", 1, 2, pytest.approx(2.0), 2, 2, None],
        # Sin cliente es un grupo más, al final.
        [None, 1, 1, pytest.approx(1.0), 1, 1, None],
    ]
    assert r["totales"] == {"m0": 7, "m1": 32, "m2": pytest.approx(32 / 7, rel=1e-4), "m3": 1, "m4": 10,
                            "m5": "2026-09-20"}


async def test_agrupar_por_dos_columnas_y_ordenar_por_una_cuenta(base):
    r = await correr(base, _cfg("ordenes", agrupar=["prioridad", "estado"],
                                medidas=[{"funcion": "conteo"}], orden={"por": "m0", "direccion": "desc"}))
    assert [(f["prioridad"], f["estado"], f["m0"]) for f in r["filas"]] == [
        ("Normal", "Completada", 2), ("Urgente", "Completada", 2),
        ("Normal", "Pendiente", 1), ("Normal", "Retrasada", 1), ("Urgente", "En curso", 1),
    ]
    assert r["total_grupos"] == 5 and r["totales"] == {"m0": 7}


async def test_sin_cuentas_una_agrupacion_cuenta_filas(base):
    r = await correr(base, _cfg("ordenes", agrupar=["prioridad"]))
    assert [(f["prioridad"], f["m0"]) for f in r["filas"]] == [("Normal", 4), ("Urgente", 3)]


async def test_los_pasos_persona_maquina_y_horas(base):
    r = await correr(base, _cfg("pasos", ["numero", "persona", "persona_segun", "maquina", "estado", "inicio",
                                          "horas_estimadas", "horas_reales"],
                                orden={"por": "inicio", "direccion": "asc"}))
    por_paso = {(f["numero"], f["inicio"]): f for f in r["filas"]}
    p101 = por_paso[(15010, "2026-09-01T08:00:00")]
    assert (p101["persona"], p101["persona_segun"], p101["maquina"]) == ("JUAN PEREZ", "La OT", "TORNO 1")
    p102 = por_paso[(15010, "2026-09-02T08:00:00")]
    # Nadie elegido: la del ÚLTIMO plan, con su máquina.
    assert (p102["persona"], p102["persona_segun"], p102["maquina"]) == ("ANA GIL", "El plan", "SOLDADORA")
    assert (p101["horas_reales"], p101["horas_estimadas"]) == (pytest.approx(3.0), pytest.approx(2.0))
    # El arranque centinela sale vacío (y ordena al final); sin fin no hay horas reales.
    ultimo = r["filas"][-1]
    assert ultimo["numero"] == 15013 and ultimo["inicio"] is None and ultimo["horas_reales"] is None
    assert ultimo["estado"] == "Pendiente"
    assert r["totales"] == {"horas_estimadas": pytest.approx(9.0), "horas_reales": pytest.approx(10.5)}


async def test_horas_por_persona_y_proceso_el_ejemplo(base):
    ejemplo = next(e for e in cat.EJEMPLOS if e["codigo"] == "horas_por_persona_y_proceso")
    r = await correr(base, ejemplo["config"])
    assert [(f["persona"], f["proceso"], f["m0"], f["m1"], f["m2"]) for f in r["filas"]] == [
        ("ANA GIL", "SOLDADURA", 1, pytest.approx(1.5), pytest.approx(1.0)),
        ("JUAN PEREZ", "TORNO CNC", 2, pytest.approx(5.0), pytest.approx(3.5)),
    ]
    assert r["totales"] == {"m0": 3, "m1": pytest.approx(6.5), "m2": pytest.approx(4.5)}


async def test_ot_entregadas_por_cliente_el_ejemplo(base):
    ejemplo = next(e for e in cat.EJEMPLOS if e["codigo"] == "ot_entregadas_por_cliente")
    r = await correr(base, ejemplo["config"])
    assert [(f["cliente"], f["m0"], f["m1"], f["m2"]) for f in r["filas"]] == [
        ("ACME", 2, 8, 8), ("Beta SA", 1, 4, 4)]
    assert r["totales"] == {"m0": 3, "m1": 12, "m2": 12}
    assert r["criterios"]["lineas"][:2] == [
        "Datos: Órdenes de trabajo",
        "Período: este mes (del 01/09/2026 al 30/09/2026), según fecha de entrega"]


async def test_las_personas_con_el_periodo_adentro(base):
    cols = ["persona", "pasos_terminados", "horas_reales", "horas_estimadas", "ausencias", "dias_ausente"]
    r = await correr(base, _cfg("personas", cols, periodo={"atajo": "este_mes"}))
    assert {f["persona"]: [f[c] for c in cols[1:]] for f in r["filas"]} == {
        # 101 y 103; ausente del 14 al 16 (2 días) y desde el 22 hasta hoy (2).
        "JUAN PEREZ": [2, pytest.approx(5.0), pytest.approx(3.5), 2, 4],
        # 102 (por el plan); las vacaciones del 30/08 al 02/09 tocan septiembre un día.
        "ANA GIL": [1, pytest.approx(1.5), pytest.approx(1.0), 1, 1],
    }
    r = await correr(base, _cfg("personas", cols, periodo={"atajo": "mes_pasado"}))
    assert {f["persona"]: [f[c] for c in cols[1:]] for f in r["filas"]} == {
        "JUAN PEREZ": [0, None, None, 0, 0],
        "ANA GIL": [1, pytest.approx(4.0), pytest.approx(3.0), 1, 2],
    }
    # Sin período: todo, y las ausencias hasta hoy.
    r = await correr(base, _cfg("personas", cols))
    assert {f["persona"]: [f[c] for c in cols[1:]] for f in r["filas"]} == {
        "JUAN PEREZ": [2, pytest.approx(5.0), pytest.approx(3.5), 2, 4],
        "ANA GIL": [2, pytest.approx(5.5), pytest.approx(4.0), 1, 3],
    }
    assert "periodo" not in r["criterios"] or r["criterios"]["periodo"] is None


async def test_las_ausencias(base):
    r = await correr(base, _cfg("ausencias", ["persona", "desde", "dias", "motivo", "sigue_ausente"],
                                periodo={"atajo": "este_mes"}, orden={"por": "desde"}))
    assert [(f["persona"], f["desde"], f["dias"], f["motivo"], f["sigue_ausente"]) for f in r["filas"]] == [
        ("JUAN PEREZ", "2026-09-14", 2, "Enfermedad", False),
        ("JUAN PEREZ", "2026-09-22", 2, None, True),
    ]


async def test_consumo_de_material_por_ot_el_ejemplo(base):
    ejemplo = next(e for e in cat.EJEMPLOS if e["codigo"] == "consumo_por_ot")
    r = await correr(base, ejemplo["config"])
    # Sin la carga anulada de 100 kg.
    assert [(f["numero"], f["material_y_unidad"], f["m0"], f["m1"]) for f in r["filas"]] == [
        (15011, "BARRA (m)", pytest.approx(3.0), 1),
        (15010, "CHAPA 1/8 (kg)", pytest.approx(4.0), 2),
    ]
    sin_filtro = {**ejemplo["config"], "filtros": []}
    r = await correr(base, sin_filtro)
    assert r["totales"]["m0"] == pytest.approx(107.0)


async def test_stock_bajo_el_minimo_el_ejemplo(base):
    ejemplo = next(e for e in cat.EJEMPLOS if e["codigo"] == "materia_prima_bajo_minimo")
    r = await correr(base, ejemplo["config"], SOLO_TABLERO)
    assert [(f["codigo"], f["faltante"]) for f in r["filas"]] == [("CH-18", pytest.approx(5.0))]


async def test_no_conformidades_por_persona_el_ejemplo(base):
    ejemplo = next(e for e in cat.EJEMPLOS if e["codigo"] == "no_conformidades_por_persona")
    r = await correr(base, ejemplo["config"], OPERARIO)
    assert [(f["persona"], f["m0"], f["m1"], f["m2"]) for f in r["filas"]] == [
        ("JUAN PEREZ", 2, 45, 2), ("ANA GIL", 1, 45, 1), (None, 1, 10, None)]
    r = await correr(base, _cfg("no_conformidades", ["gravedad", "tipo"], orden={"por": "fecha"}))
    # Por fecha: la de agosto, la GRAVE del 05/09, la del 06/09 y la del 07/09. Las viejas sin
    # gravedad salen vacías (nunca se completa por default).
    assert [(f["gravedad"], f["tipo"]) for f in r["filas"]] == [
        (None, "Interpretación de planos"), ("Grave", "Medida fuera de tolerancia"),
        (None, "Interpretación de planos"), (None, "Interpretación de planos")]


async def test_pausas_por_motivo_el_ejemplo(base):
    ejemplo = next(e for e in cat.EJEMPLOS if e["codigo"] == "pausas_por_motivo")
    r = await correr(base, ejemplo["config"])
    # La abierta cuenta hasta ahora (09:00 a 12:00).
    assert [(f["motivo"], f["m0"], f["m1"]) for f in r["filas"]] == [
        ("Máquina rota", 1, pytest.approx(3.0)), ("Falta material", 1, pytest.approx(2.0))]


async def test_todos_los_ejemplos_corren_con_quien_los_ve(base):
    for quien in (ADMIN, SUPERVISOR, OPERARIO, SOLO_TABLERO, AUDITOR):
        for e in rs.catalogo(quien)["ejemplos"]:
            r = await correr(base, e["config"], quien)
            assert r["filas"] is not None


async def test_todas_las_columnas_de_todas_las_fuentes_corren(base):
    """Cada columna, pedida sola y agrupada, en la base de verdad: una expresión que un
    dialecto no entiende salta acá y no en la pantalla."""
    for fuente in cat.FUENTES:
        todas = [c.codigo for c in fuente.columnas]
        await correr(base, _cfg(fuente.codigo, todas))
        for c in fuente.columnas:
            if c.agrupable:
                medidas = [{"funcion": "conteo"}] + [
                    {"funcion": fn, "columna": m.codigo}
                    for m in fuente.columnas for fn in m.funciones()][:7]
                await correr(base, _cfg(fuente.codigo, agrupar=[c.codigo], medidas=medidas))


async def test_los_criterios_dichos_en_castellano(base):
    r = await correr(base, _cfg("ordenes", ["numero"], filtros=[
        {"columna": "cliente", "op": "en", "valores": [2, None]},
        {"columna": "articulo", "op": "contiene", "valor": "eje"},
        {"columna": "unidades", "op": "entre", "desde": 1, "hasta": 1000.5},
        {"columna": "reclamo", "op": "es", "valor": False},
    ], agrupar=["estado"], medidas=[{"funcion": "conteo"}], orden={"por": "m0", "direccion": "desc"}))
    assert r["criterios"]["lineas"] == [
        "Datos: Órdenes de trabajo",
        "Período: todas las fechas",
        "Cliente: Beta SA, (sin dato)",
        "Artículo contiene «eje»",
        "Unidades: de 1 a 1.000,5",
        "Con reclamo: No",
        "Agrupado por Estado · Cuentas: Cantidad",
        "Ordenado por Cantidad (de mayor a menor)",
    ]


async def test_el_tope_de_tiempo(monkeypatch):
    """Si la base no contesta a tiempo, el pedido se corta con un aviso claro."""
    monkeypatch.setattr(rs, "TOPE_SEGUNDOS", 0.05)

    class _Lenta:
        def get_bind(self):
            raise RuntimeError("sin base")

        async def execute(self, *_):
            await asyncio.sleep(1)

    with pytest.raises(BusinessException, match="tardó más"):
        await rs.ejecutar(_Lenta(), _cfg("maquinas", ["maquina"]), ADMIN)


async def test_en_postgres_el_tope_lo_pone_la_base(base):
    if base.motor != "postgres":
        pytest.skip("sólo Postgres tiene statement_timeout")
    async with base() as s:
        await rs.ejecutar(s, _cfg("maquinas", ["maquina"]), ADMIN)
        # En la misma transacción: el SET LOCAL quedó puesto para este pedido.
        assert (await s.execute(text("SHOW statement_timeout"))).scalar() == f"{rs.TOPE_SEGUNDOS_SQL}s"
    async with base() as s:
        # Y la próxima transacción arranca sin él.
        assert (await s.execute(text("SHOW statement_timeout"))).scalar() == "0"


# ─────────────────────────── 4. la API y los guardados ───────────────────────────


class _Quien:
    """Quién pide en la API de prueba (se cambia entre pedidos)."""

    def __init__(self):
        self.usar(1, "admin", ADMIN)

    def usar(self, id_usuario, rol, permisos, nombre="Julián", apellido="Boxler"):
        self.id_usuario, self.rol, self.permisos = id_usuario, rol, permisos
        self.nombre, self.apellido = nombre, apellido


@pytest_asyncio.fixture
async def api(base):
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(ReportesAPI.router)
    quien = _Quien()

    async def _db():
        async with base() as s:
            yield s

    app.dependency_overrides[ReportesAPI.get_db] = _db
    app.dependency_overrides[ReportesAPI.get_permisos_actuales] = lambda: quien.permisos
    app.dependency_overrides[ReportesAPI.get_usuario_actual] = lambda: UsuarioActual(
        id_usuario=quien.id_usuario, username=quien.rol, rol=quien.rol)
    app.dependency_overrides[ReportesAPI.get_current_user] = lambda: {
        "username": quien.rol, "id_usuario": quien.id_usuario, "rol": quien.rol,
        "nombre": quien.nombre, "apellido": quien.apellido}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        c.quien = quien
        c.sesiones = base
        yield c


def _q(config) -> dict:
    return {"config": json.dumps(config)}


async def test_la_api_de_datos(api):
    r = await api.get("/reportes/personalizados/datos",
                      params={**_q(_cfg("ordenes", ["numero", "unidades"])), "vista_previa": "true"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["total_filas"] == 7 and r.json()["data"]["vista_previa"] is True
    # Inventado: 422. Sin permiso: 403, con el formato de siempre.
    r = await api.get("/reportes/personalizados/datos", params=_q(_cfg("ordenes", ["dni"])))
    assert r.status_code == 422 and "no tiene la columna" in r.json()["errors"][0]["message"]
    r = await api.get("/reportes/personalizados/datos", params={"config": "{roto"})
    assert r.status_code == 422
    api.quien.usar(4, "operario", OPERARIO)
    r = await api.get("/reportes/personalizados/datos", params=_q(_cfg("auditoria", ["cuando"])))
    assert r.status_code == 403 and r.json()["errors"][0]["campo"] == "permiso"
    # Demasiado largo para una dirección: lo corta FastAPI antes de leerlo.
    r = await api.get("/reportes/personalizados/datos", params={"config": "x" * 9000})
    assert r.status_code == 400


async def test_la_api_de_catalogo_y_opciones(api):
    r = await api.get("/reportes/personalizados/catalogo")
    assert r.status_code == 200 and r.json()["data"]["tope_filas"] == 20_000
    r = await api.get("/reportes/personalizados/opciones", params={"fuente": "ordenes"})
    opciones = r.json()["data"]
    assert [o["texto"] for o in opciones["cliente"]] == ["ACME", "Beta SA", "Cien Real"]
    assert {o["valor"] for o in opciones["estado"]} == {"pendientes", "en_curso", "retrasadas", "completadas"}
    r = await api.get("/reportes/personalizados/opciones", params={"fuente": "pasos"})
    assert [o["texto"] for o in r.json()["data"]["persona"]] == ["ANA GIL", "JUAN PEREZ"]
    api.quien.usar(6, "tablero", SOLO_TABLERO)
    r = await api.get("/reportes/personalizados/opciones", params={"fuente": "ordenes"})
    assert r.status_code == 403
    r = await api.get("/reportes/personalizados/opciones", params={"fuente": "inventada"})
    assert r.status_code == 422


def _guardar(nombre, config, **extra):
    return {"nombre": nombre, "config": config, **extra}


async def test_los_guardados_son_de_quien_los_guardo(api):
    base_cfg = _cfg("ordenes", ["numero", "cliente"], periodo={"columna": "fecha_entrega", "atajo": "este_mes"})
    # Julián (admin) guarda uno suyo y uno compartido de Auditoría y otro compartido de órdenes.
    r = await api.post("/reportes/personalizados/guardados", json=_guardar("Mis entregas", base_cfg))
    assert r.status_code == 200, r.text
    mio = r.json()["data"]
    assert mio["es_mio"] and not mio["compartido"] and mio["autor"] == "Julián Boxler"
    assert mio["creado_en"] == "2026-09-23T12:00:00" and mio["fuente"] == "ordenes"
    # Se guarda la receta limpia (sin los campos vacíos), no lo que haya mandado la pantalla.
    assert mio["config"]["periodo"] == {"columna": "fecha_entrega", "atajo": "este_mes"}
    r = await api.post("/reportes/personalizados/guardados", json=_guardar(
        "Auditoría del mes", _cfg("auditoria", ["cuando", "usuario"]), compartido=True))
    auditoria = r.json()["data"]
    r = await api.post("/reportes/personalizados/guardados", json=_guardar(
        "Entregas del taller", base_cfg, compartido=True))
    del_taller = r.json()["data"]
    # El mismo nombre dos veces, no.
    r = await api.post("/reportes/personalizados/guardados", json=_guardar(" mis  ENTREGAS ", base_cfg))
    assert r.status_code == 422 and "Ya tenés un reporte" in r.json()["errors"][0]["message"]
    # Inventado, tampoco se guarda.
    r = await api.post("/reportes/personalizados/guardados", json=_guardar("Malo", _cfg("ordenes", ["dni"])))
    assert r.status_code == 422

    # Matías (operario): ve el compartido de órdenes; el de Auditoría no existe para él; el
    # que Julián no compartió, tampoco.
    api.quien.usar(4, "operario", OPERARIO, "Matías", "Gómez")
    r = await api.get("/reportes/personalizados/guardados")
    vistos = {g["nombre"]: g for g in r.json()["data"]}
    assert set(vistos) == {"Entregas del taller"}
    assert not vistos["Entregas del taller"]["es_mio"] and vistos["Entregas del taller"]["disponible"]
    # Y si igual corre la receta del de Auditoría (la sacó de algún lado), el servidor dice no.
    r = await api.get("/reportes/personalizados/datos", params=_q(auditoria["config"]))
    assert r.status_code == 403
    # No cambia ni borra lo de otro: el compartido es 403, el no compartido ni existe.
    r = await api.put(f"/reportes/personalizados/guardados/{del_taller['id']}",
                      json=_guardar("Lo cambio yo", base_cfg))
    assert r.status_code == 403 and "Sólo quien guardó" in r.json()["errors"][0]["message"]
    r = await api.delete(f"/reportes/personalizados/guardados/{del_taller['id']}")
    assert r.status_code == 403
    r = await api.delete(f"/reportes/personalizados/guardados/{mio['id']}")
    assert r.status_code == 404
    # Guarda uno suyo, pero compartirlo es de un admin.
    r = await api.post("/reportes/personalizados/guardados", json=_guardar("Para todos", base_cfg, compartido=True))
    assert r.status_code == 403
    r = await api.post("/reportes/personalizados/guardados", json=_guardar("Mis entregas", base_cfg))
    assert r.status_code == 200, "el mismo nombre que el de otra persona se puede"
    suyo = r.json()["data"]
    r = await api.put(f"/reportes/personalizados/guardados/{suyo['id']}",
                      json=_guardar("Mis entregas", base_cfg, compartido=True))
    assert r.status_code == 403
    r = await api.put(f"/reportes/personalizados/guardados/{suyo['id']}",
                      json=_guardar("Entregas por cliente", {**base_cfg, "agrupar": ["cliente"]},
                                    descripcion="Para el lunes"))
    assert r.status_code == 200
    cambiado = r.json()["data"]
    assert cambiado["nombre"] == "Entregas por cliente" and cambiado["config"]["agrupar"] == ["cliente"]
    assert cambiado["modificado_en"] == "2026-09-23T12:00:00" and cambiado["descripcion"] == "Para el lunes"
    r = await api.delete(f"/reportes/personalizados/guardados/{suyo['id']}")
    assert r.status_code == 200
    r = await api.get("/reportes/personalizados/guardados")
    assert {g["nombre"] for g in r.json()["data"]} == {"Entregas del taller"}

    # Julián sigue teniendo los suyos, y deja de compartir uno (es admin).
    api.quien.usar(1, "admin", ADMIN)
    r = await api.put(f"/reportes/personalizados/guardados/{del_taller['id']}",
                      json=_guardar("Entregas del taller", base_cfg, compartido=False))
    assert r.status_code == 200 and r.json()["data"]["compartido"] is False
    r = await api.get("/reportes/personalizados/guardados")
    assert [g["nombre"] for g in r.json()["data"]] == ["Auditoría del mes", "Entregas del taller", "Mis entregas"]


async def test_un_guardado_que_dejo_de_poder_correr_se_ve_marcado(api):
    """A quien le sacaron un permiso: su reporte sigue en la lista (para poder borrarlo),
    marcado como no disponible."""
    api.quien.usar(9, "jefe", JEFE_CON_RENDIMIENTO)
    cfg = _cfg("personas", ["persona", "eficiencia"])
    r = await api.post("/reportes/personalizados/guardados", json=_guardar("Eficiencia", cfg))
    assert r.status_code == 200
    api.quien.usar(9, "jefe", _permisos("jefe", {"dashboard": "read", "recursos": "read"}, id_usuario=9))
    r = await api.get("/reportes/personalizados/guardados")
    [g] = r.json()["data"]
    assert g["es_mio"] and g["disponible"] is False and "Eficiencia" in g["motivo"]
    r = await api.delete(f"/reportes/personalizados/guardados/{g['id']}")
    assert r.status_code == 200
