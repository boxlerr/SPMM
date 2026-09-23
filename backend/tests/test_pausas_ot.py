"""Pausar y reanudar una OT o un paso (RF-03).

El SRS: «permitir pausar y reanudar órdenes de producción, registrando el motivo de la
pausa y quién la ejecutó». Lo que persigue este archivo son las formas en que una pausa
deja de servir:

  1. **Que se pierda quién y cuándo.** Usuario del token y hora del taller sin zona;
     sin token, nadie (nunca un autor inventado).
  2. **Que pausar rompa lo que ya andaba.** El estado de los pasos y sus ids no se
     tocan: un paso en proceso que se pausa sigue en proceso, con su arranque.
  3. **Que se pueda pausar lo pausado o reanudar lo que anda.** 409 con el porqué.
  4. **Que un paso terminado quede diciendo «pausado» para siempre.** Terminarlo (o
     ponerlo en proceso) cierra su pausa; terminar toda la OT cierra la de la OT.
  5. **Que la pausa trabe otra cosa.** Sin la tabla (migración sin correr) cambiar el
     estado de un paso tiene que seguir andando; borrar una OT pausada también.
  6. **Que no quede en el historial.** Se engancha a la misma auditoría de pasos.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.application.PausaService import PausaService, minutos_en_pausa, pausas_del_paso
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user
from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import PausaOrden, duracion_corta
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.infrastructure import auditoria_movimientos as auditoria_mov
from backend.infrastructure import auditoria_procesos as auditoria_proc
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.infrastructure.PausaRepository import PausaRepository
from backend.infrastructure.db import Base
from backend.presentation import PausaAPI
from backend.tests.conftest import TEST_TABLES

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

LUCAS = {"id_usuario": 4, "username": "lucas", "nombre": "Lucas", "apellido": "Gómez", "rol": "supervisor"}
MATIAS = {"id_usuario": 5, "username": "matias", "nombre": "Matías", "apellido": "Ruiz", "rol": "supervisor"}

# La OT 10 (número visible 15279) tiene tres pasos: torno pendiente, soldadura en proceso
# y pintura pendiente. La 11 ya se entregó; la 12 tiene todo terminado.
OT, NUMERO = 10, 15279
TORNO, SOLDADURA, PINTURA = 101, 102, 103
ARRANQUE_SOLDADURA = datetime(2026, 9, 22, 8, 15)


def _ahora_ar() -> datetime:
    return datetime.now(_TZ_AR).replace(tzinfo=None)


async def _mundo(session):
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
    await session.flush()
    dia = datetime(2026, 9, 1)
    for id_ot, nro, entregada in ((OT, NUMERO, None), (11, 15280, datetime(2026, 9, 20)),
                                  (12, 15281, datetime(1950, 1, 1))):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=nro, id_prioridad=1, id_sector=1, id_articulo=1,
            fecha_orden=dia, fecha_entrada=dia, fecha_prometida=dia + timedelta(days=30),
            fecha_entrega=entregada, finalizadototal=0,
        ))
    await session.flush()
    session.add_all([
        OrdenTrabajoProceso(id=TORNO, id_orden_trabajo=OT, id_proceso=150, orden=1, id_estado=1,
                            tiempo_proceso=60),
        OrdenTrabajoProceso(id=SOLDADURA, id_orden_trabajo=OT, id_proceso=160, orden=2, id_estado=2,
                            tiempo_proceso=120, inicio_real=ARRANQUE_SOLDADURA),
        OrdenTrabajoProceso(id=PINTURA, id_orden_trabajo=OT, id_proceso=170, orden=3, id_estado=1,
                            tiempo_proceso=30),
        OrdenTrabajoProceso(id=201, id_orden_trabajo=11, id_proceso=150, orden=1, id_estado=1),
        OrdenTrabajoProceso(id=301, id_orden_trabajo=12, id_proceso=150, orden=1, id_estado=3),
    ])
    await session.commit()


@pytest_asyncio.fixture
async def taller(session):
    await _mundo(session)
    return session


async def _pausas(session) -> list[PausaOrden]:
    session.expire_all()
    return (await session.execute(select(PausaOrden).order_by(PausaOrden.id))).scalars().all()


async def _conflicto(corrutina) -> str:
    with pytest.raises(HTTPException) as e:
        await corrutina
    assert e.value.status_code == 409
    return e.value.detail["message"]


# ─────────────────────── pausar ───────────────────────

async def test_pausar_la_ot_guarda_motivo_quien_y_hora_del_taller(taller):
    r = await PausaService(taller).pausar(OT, "falta_material", "  sin chapa de 3mm  ", usuario=LUCAS)

    (p,) = await _pausas(taller)
    assert p.id_orden_trabajo == OT and p.id_otp is None
    assert p.motivo == "FALTA_MATERIAL"
    assert p.observacion == "sin chapa de 3mm"
    assert p.usuario_pausa == "Lucas Gómez" and p.id_usuario_pausa == 4
    assert p.hasta is None and p.cierre is None
    # Hora del taller y sin zona: Cloud Run corre en UTC.
    assert p.desde.tzinfo is None
    assert abs((p.desde - _ahora_ar()).total_seconds()) < 120, (
        f"quedó {p.desde} y en el taller son las {_ahora_ar()}: se está estampando en UTC")

    # Lo que devuelve la API: el número que conoce el taller y qué pasos se pararon.
    assert r.data["numero_ot"] == NUMERO
    assert r.data["abierta"] is True and r.data["alcance"] == "ot"
    assert r.data["motivo_texto"] == "Falta material"
    assert r.data["pasos_en_proceso"] == [2]


async def test_pausar_no_le_toca_el_estado_ni_el_arranque_a_ningun_paso(taller):
    """El tablero, el planificador y el sync dependen del 1-2-3: la pausa vive aparte."""
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", usuario=LUCAS)
    await PausaService(taller).reanudar(OT, usuario=LUCAS)

    taller.expire_all()
    pasos = {p.id: p for p in (await taller.execute(
        select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id_orden_trabajo == OT)
    )).scalars().all()}
    assert {i: p.id_estado for i, p in pasos.items()} == {TORNO: 1, SOLDADURA: 2, PINTURA: 1}
    assert pasos[SOLDADURA].inicio_real == ARRANQUE_SOLDADURA
    assert pasos[SOLDADURA].fin_real is None


async def test_pausar_la_ot_deja_el_sello_de_quien_la_toco(taller):
    await PausaService(taller).pausar(OT, "ESPERA_CLIENTE", usuario=LUCAS)
    orden = (await taller.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == OT))).scalar_one()
    await taller.refresh(orden)
    assert orden.modificado_por == "Lucas Gómez"
    assert orden.modificado_en is not None


async def test_sin_token_no_se_inventa_un_autor(taller):
    await PausaService(taller).pausar(OT, "CAMBIO_PRIORIDAD", usuario=None)
    (p,) = await _pausas(taller)
    assert p.usuario_pausa is None and p.id_usuario_pausa is None


async def test_el_motivo_es_de_la_lista_cerrada(taller):
    with pytest.raises(BusinessException):
        await PausaService(taller).pausar(OT, "SE_FUE_LA_LUZ", usuario=LUCAS)
    with pytest.raises(BusinessException):
        await PausaService(taller).pausar(OT, "", usuario=LUCAS)
    assert await _pausas(taller) == []


async def test_otro_pide_que_se_cuente_por_que(taller):
    with pytest.raises(BusinessException):
        await PausaService(taller).pausar(OT, "OTRO", "   ", usuario=LUCAS)
    r = await PausaService(taller).pausar(OT, "OTRO", "se cortó la luz", usuario=LUCAS)
    assert r.data["observacion"] == "se cortó la luz"


async def test_pausar_un_paso_suelto_copia_el_paso_y_el_proceso(taller):
    r = await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=TORNO, usuario=LUCAS)

    (p,) = await _pausas(taller)
    assert p.id_otp == TORNO and p.paso == 1 and p.nombre_proceso == "TORNO CNC"
    assert r.data["alcance"] == "paso"
    assert "pasos_en_proceso" not in r.data


async def test_un_paso_de_otra_ot_no_se_pausa(taller):
    with pytest.raises(NotFoundException):
        await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=201, usuario=LUCAS)
    with pytest.raises(NotFoundException):
        await PausaService(taller).pausar(999, "MAQUINA_ROTA", usuario=LUCAS)


# ─────────────────────── lo que no se puede ───────────────────────

async def test_no_se_pausa_lo_que_ya_esta_pausado(taller):
    await PausaService(taller).pausar(OT, "FALTA_MATERIAL", usuario=LUCAS)
    msj = await _conflicto(PausaService(taller).pausar(OT, "MAQUINA_ROTA", usuario=MATIAS))
    assert f"La OT {NUMERO} ya está pausada" in msj and "falta material" in msj

    await PausaService(taller).reanudar(OT, usuario=LUCAS)
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=TORNO, usuario=LUCAS)
    msj = await _conflicto(PausaService(taller).pausar(OT, "OTRO", "x", id_otp=TORNO, usuario=LUCAS))
    assert "El paso 1 ya está pausado" in msj


async def test_un_paso_de_una_ot_pausada_ya_esta_parado(taller):
    await PausaService(taller).pausar(OT, "ESPERA_CLIENTE", usuario=LUCAS)
    msj = await _conflicto(PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=TORNO, usuario=LUCAS))
    assert "entera está pausada" in msj


async def test_no_se_reanuda_lo_que_no_esta_pausado(taller):
    msj = await _conflicto(PausaService(taller).reanudar(OT, usuario=LUCAS))
    assert msj == f"La OT {NUMERO} no está pausada."
    msj = await _conflicto(PausaService(taller).reanudar(OT, id_otp=TORNO, usuario=LUCAS))
    assert msj == "Ese paso no está pausado."


async def test_reanudar_la_ot_con_un_paso_pausado_dice_cual(taller):
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=PINTURA, usuario=LUCAS)
    msj = await _conflicto(PausaService(taller).reanudar(OT, usuario=LUCAS))
    assert "no está pausada entera" in msj and "paso 3" in msj


async def test_el_paso_parado_por_la_ot_se_reanuda_desde_la_ot(taller):
    await PausaService(taller).pausar(OT, "ESPERA_CLIENTE", usuario=LUCAS)
    msj = await _conflicto(PausaService(taller).reanudar(OT, id_otp=SOLDADURA, usuario=LUCAS))
    assert "reanudá la OT" in msj


async def test_no_se_pausa_lo_terminado_ni_lo_entregado(taller):
    msj = await _conflicto(PausaService(taller).pausar(11, "FALTA_MATERIAL", usuario=LUCAS))
    assert "ya se entregó" in msj
    msj = await _conflicto(PausaService(taller).pausar(12, "FALTA_MATERIAL", usuario=LUCAS))
    assert "todos los pasos terminados" in msj
    msj = await _conflicto(PausaService(taller).pausar(12, "FALTA_MATERIAL", id_otp=301, usuario=LUCAS))
    assert "ya está terminado" in msj
    assert await _pausas(taller) == []


async def test_dos_pausas_abiertas_de_lo_mismo_las_frena_la_base(taller):
    """El servicio lo mira antes; esto es para dos personas apretando a la vez."""
    ahora = _ahora_ar()
    taller.add(PausaOrden(id_orden_trabajo=OT, motivo="OTRO", observacion="a", desde=ahora))
    await taller.commit()
    taller.add(PausaOrden(id_orden_trabajo=OT, motivo="OTRO", observacion="b", desde=ahora))
    with pytest.raises(IntegrityError):
        await taller.commit()
    await taller.rollback()

    taller.add(PausaOrden(id_orden_trabajo=OT, id_otp=TORNO, motivo="OTRO", observacion="c", desde=ahora))
    await taller.commit()
    taller.add(PausaOrden(id_orden_trabajo=OT, id_otp=TORNO, motivo="OTRO", observacion="d", desde=ahora))
    with pytest.raises(IntegrityError):
        await taller.commit()
    await taller.rollback()


async def test_la_base_no_acepta_un_motivo_inventado(taller):
    taller.add(PausaOrden(id_orden_trabajo=OT, motivo="LLUVIA", desde=_ahora_ar()))
    with pytest.raises(IntegrityError):
        await taller.commit()
    await taller.rollback()


# ─────────────────────── reanudar ───────────────────────

async def test_reanudar_cierra_la_pausa_con_quien_y_cuando(taller):
    await PausaService(taller).pausar(OT, "FALTA_MATERIAL", usuario=LUCAS)
    r = await PausaService(taller).reanudar(OT, usuario=MATIAS)

    (p,) = await _pausas(taller)
    assert p.hasta is not None and p.hasta >= p.desde
    assert p.cierre == "REANUDADA"
    assert p.usuario_reanuda == "Matías Ruiz" and p.id_usuario_reanuda == 5
    assert r.data["abierta"] is False and r.data["cierre_texto"] == "Reanudada"
    # Se puede volver a pausar: es un historial, no una marca.
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", usuario=LUCAS)
    assert len(await _pausas(taller)) == 2


async def test_reanudar_la_ot_deja_pausado_el_paso_que_tiene_su_propia_pausa(taller):
    """El torno roto (el paso) y el cliente que no contesta (la OT) son dos cosas."""
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=TORNO, usuario=LUCAS)
    await PausaService(taller).pausar(OT, "ESPERA_CLIENTE", usuario=LUCAS)
    r = await PausaService(taller).reanudar(OT, usuario=LUCAS)

    assert r.data["pasos_que_siguen_pausados"] == [1]
    abiertas = [p for p in await _pausas(taller) if p.hasta is None]
    assert [p.id_otp for p in abiertas] == [TORNO]


# ─────────────────────── al mover los pasos ───────────────────────

async def test_terminar_el_paso_pausado_cierra_su_pausa(taller):
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=TORNO, usuario=LUCAS)
    await OrdenTrabajoRepository(taller).update_proceso_status(OT, 150, 3, id_otp=TORNO, usuario=MATIAS)

    (p,) = await _pausas(taller)
    assert p.hasta is not None
    assert p.cierre == "PASO_TERMINADO"
    assert p.usuario_reanuda == "Matías Ruiz"


async def test_poner_en_proceso_el_paso_pausado_cierra_su_pausa(taller):
    await PausaService(taller).pausar(OT, "FALTA_MATERIAL", id_otp=PINTURA, usuario=LUCAS)
    await OrdenTrabajoRepository(taller).update_proceso_status(OT, 170, 2, id_otp=PINTURA, usuario=MATIAS)
    (p,) = await _pausas(taller)
    assert p.cierre == "PASO_EN_PROCESO"


async def test_elegir_otra_vez_el_mismo_estado_no_reanuda_nada(taller):
    """La soldadura ya estaba en proceso: volver a elegir «en proceso» no es arrancarla."""
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=SOLDADURA, usuario=LUCAS)
    await OrdenTrabajoRepository(taller).update_proceso_status(OT, 160, 2, id_otp=SOLDADURA, usuario=MATIAS)
    (p,) = await _pausas(taller)
    assert p.hasta is None


async def test_arrancar_un_paso_no_reanuda_la_ot_entera(taller):
    """Que se arranque un paso no dice que se destrabó lo que paró la OT."""
    await PausaService(taller).pausar(OT, "ESPERA_CLIENTE", usuario=LUCAS)
    await OrdenTrabajoRepository(taller).update_proceso_status(OT, 150, 2, id_otp=TORNO, usuario=MATIAS)
    (p,) = await _pausas(taller)
    assert p.hasta is None


async def test_terminar_el_ultimo_paso_cierra_la_pausa_de_la_ot(taller):
    await PausaService(taller).pausar(OT, "ESPERA_CLIENTE", usuario=LUCAS)
    repo = OrdenTrabajoRepository(taller)
    await repo.update_proceso_status(OT, 150, 3, id_otp=TORNO, usuario=MATIAS)
    await repo.update_proceso_status(OT, 160, 3, id_otp=SOLDADURA, usuario=MATIAS)
    assert (await _pausas(taller))[0].hasta is None, "faltaba la pintura: la OT sigue pausada"

    await repo.update_proceso_status(OT, 170, 3, id_otp=PINTURA, usuario=MATIAS)
    (p,) = await _pausas(taller)
    assert p.cierre == "OT_TERMINADA" and p.usuario_reanuda == "Matías Ruiz"


async def test_marcar_varias_como_terminadas_cierra_todas_sus_pausas(taller):
    """El estado masivo va en SQL de Postgres (ANY); acá se prueba el cierre que llama."""
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=TORNO, usuario=LUCAS)
    await PausaService(taller).pausar(OT, "ESPERA_CLIENTE", usuario=LUCAS)
    await PausaRepository(taller).cerrar_al_marcar_varias(
        ordenes_ids=[OT], id_estado=2, cuando=_ahora_ar(), id_usuario=5, usuario="Matías Ruiz")
    await taller.commit()
    por_cierre = {p.id_otp: p.cierre for p in await _pausas(taller)}
    assert por_cierre == {TORNO: "PASO_EN_PROCESO", None: None}, (
        "en proceso cierra la del paso, no la de la OT")

    await PausaRepository(taller).cerrar_al_marcar_varias(
        ordenes_ids=[OT], id_estado=3, cuando=_ahora_ar(), id_usuario=5, usuario="Matías Ruiz")
    await taller.commit()
    assert {p.cierre for p in await _pausas(taller)} == {"PASO_EN_PROCESO", "OT_TERMINADA"}


# ─────────────────────── que no trabe otra cosa ───────────────────────

@pytest_asyncio.fixture
async def taller_sin_tabla_de_pausas():
    """Backend nuevo contra una base donde la migración todavía no corrió."""
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
        await _mundo(s)
        yield s
    await engine.dispose()


async def test_sin_la_tabla_de_pausas_cambiar_el_estado_sigue_andando(taller_sin_tabla_de_pausas):
    s = taller_sin_tabla_de_pausas
    paso = await OrdenTrabajoRepository(s).update_proceso_status(OT, 150, 3, id_otp=TORNO, usuario=LUCAS)
    assert paso and paso.id_estado == 3 and paso.fin_real is not None
    s.expire_all()
    guardado = (await s.execute(select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id == TORNO))).scalar_one()
    assert guardado.id_estado == 3


async def test_sin_la_tabla_de_pausas_el_planificador_lee_nada_y_sigue(taller_sin_tabla_de_pausas):
    s = taller_sin_tabla_de_pausas
    assert await PausaRepository(s).abiertas_sin_romper([OT]) is None
    # La sesión sigue sirviendo después del fallo (savepoint).
    assert (await s.execute(text("SELECT count(*) FROM orden_trabajo"))).scalar() == 3


async def test_borrar_una_ot_pausada_se_lleva_sus_pausas(taller):
    await PausaService(taller).pausar(OT, "FALTA_MATERIAL", usuario=LUCAS)
    assert await OrdenTrabajoRepository(taller).delete(OT) is True
    assert await _pausas(taller) == []


async def test_la_pausa_de_un_paso_que_ya_no_esta_no_sale_en_las_vigentes(taller):
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=PINTURA, usuario=LUCAS)
    paso = (await taller.execute(select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id == PINTURA))).scalar_one()
    await taller.delete(paso)
    await taller.commit()

    assert (await PausaService(taller).activas()).data == []
    # En el historial de la OT sigue, con el nombre copiado.
    (h,) = (await PausaService(taller).de_la_orden(OT)).data
    assert h["nombre_proceso"] == "PINTURA" and h["paso"] == 3


# ─────────────────────── el historial y la auditoría ───────────────────────

async def test_pausar_y_reanudar_quedan_en_el_historial_de_la_ot(taller):
    token = auditoria_proc.poner_contexto(usuario=LUCAS, metodo="POST", ruta=f"/ordenes/{OT}/pausar")
    try:
        await PausaService(taller).pausar(OT, "FALTA_MATERIAL", "sin chapa", usuario=LUCAS)
    finally:
        auditoria_proc.limpiar_contexto(token)
    token = auditoria_proc.poner_contexto(usuario=MATIAS, metodo="POST", ruta=f"/ordenes/{OT}/reanudar")
    try:
        await PausaService(taller).reanudar(OT, usuario=MATIAS)
    finally:
        auditoria_proc.limpiar_contexto(token)

    filas = (await taller.execute(
        select(AuditoriaProcesoOT).where(AuditoriaProcesoOT.accion.in_(("pausa", "reanuda")))
        .order_by(AuditoriaProcesoOT.id)
    )).scalars().all()
    assert [(f.accion, f.usuario, f.origen) for f in filas] == [
        ("pausa", "Lucas Gómez", "Pausar"),
        ("reanuda", "Matías Ruiz", "Reanudar"),
    ]
    assert filas[0].descripcion == "pausó la OT: Falta material"
    assert filas[1].descripcion.startswith("reanudó la OT (estuvo parada")
    assert all(f.id_orden_trabajo == OT for f in filas)


async def test_el_cierre_solo_al_terminar_el_paso_tambien_queda(taller):
    await PausaService(taller).pausar(OT, "MAQUINA_ROTA", id_otp=TORNO, usuario=LUCAS)
    token = auditoria_proc.poner_contexto(
        usuario=MATIAS, metodo="PUT", ruta=f"/ordenes/{OT}/procesos/150/estado")
    try:
        await OrdenTrabajoRepository(taller).update_proceso_status(OT, 150, 3, id_otp=TORNO, usuario=MATIAS)
    finally:
        auditoria_proc.limpiar_contexto(token)

    (fila,) = (await taller.execute(
        select(AuditoriaProcesoOT).where(AuditoriaProcesoOT.accion == "reanuda")
    )).scalars().all()
    assert fila.usuario == "Matías Ruiz" and fila.origen == "Cambio de estado"
    assert fila.descripcion.startswith("terminó el paso 1 — TORNO CNC, que estaba pausado")


def test_el_registro_de_movimientos_dice_pauso_y_reanudo():
    """«POST /ordenes/5/pausar» por método sería «creó orden de trabajo #5»."""
    _, _, _, frase = auditoria_mov.describir("POST", "/ordenes/5/pausar", 409, "Lucas Gómez")
    assert frase == "Lucas Gómez pausó orden de trabajo #5 (no se pudo: error 409)"
    _, _, _, frase = auditoria_mov.describir("POST", "/ordenes/5/reanudar", 200, "Lucas Gómez")
    assert frase == "Lucas Gómez reanudó orden de trabajo #5"


# ─────────────────────── la API ───────────────────────

def _cliente(session, usuario) -> AsyncClient:
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(PausaAPI.router)

    async def _db():
        yield session

    app.dependency_overrides[PausaAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: usuario
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_la_api_pausa_lista_y_reanuda(taller):
    async with _cliente(taller, LUCAS) as c:
        r = await c.post(f"/ordenes/{OT}/pausar", json={"motivo": "MAQUINA_ROTA", "id_otp": TORNO})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["nombre_proceso"] == "TORNO CNC"

        r = await c.get("/ordenes-pausadas")
        (vigente,) = r.json()["data"]
        assert vigente["id_orden_trabajo"] == OT and vigente["numero_ot"] == NUMERO
        assert vigente["id_otp"] == TORNO and vigente["motivo_texto"] == "Máquina rota"
        # Sin zona: el front la lee como hora local, que es la del taller.
        assert "Z" not in vigente["desde"] and "+" not in vigente["desde"]

        r = await c.post(f"/ordenes/{OT}/reanudar", json={"id_otp": TORNO})
        assert r.status_code == 200
        assert (await c.get("/ordenes-pausadas")).json()["data"] == []

        (h,) = (await c.get(f"/ordenes/{OT}/pausas")).json()["data"]
        assert h["abierta"] is False and h["usuario_reanuda"] == "Lucas Gómez"


async def test_la_api_contesta_409_con_el_porque(taller):
    async with _cliente(taller, LUCAS) as c:
        r = await c.post(f"/ordenes/{OT}/reanudar")
        assert r.status_code == 409
        assert r.json()["errors"][0]["message"] == f"La OT {NUMERO} no está pausada."
        r = await c.post(f"/ordenes/{OT}/pausar", json={"motivo": "NADA"})
        assert r.status_code == 422


async def test_la_api_deja_dicho_que_paso_para_la_auditoria(taller):
    visto = {}
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(PausaAPI.router)

    @app.middleware("http")
    async def _espiar(request, call_next):
        respuesta = await call_next(request)
        visto["frase"] = (getattr(request.state, "auditoria", None) or {}).get("frase")
        return respuesta

    async def _db():
        yield taller

    app.dependency_overrides[PausaAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: LUCAS
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post(f"/ordenes/{OT}/pausar", json={"motivo": "FALTA_MATERIAL", "id_otp": PINTURA})
    assert visto["frase"] == f"pausó el paso 3 (PINTURA) de la OT {NUMERO} — Falta material"


# ─────────────────────── el tiempo en pausa (lo usa RF-06) ───────────────────────

def test_minutos_en_pausa_une_los_tramos_que_se_pisan():
    h = lambda hh, mm=0: datetime(2026, 9, 22, hh, mm)
    # El torno se rompió de 9 a 11 y el cliente pidió esperar de 10 a 12: son 3 horas
    # paradas, no 4.
    tramos = [(h(9), h(11)), (h(10), h(12))]
    assert minutos_en_pausa(tramos, h(8), h(16)) == 180
    # Sólo cuenta lo que cae adentro del paso.
    assert minutos_en_pausa(tramos, h(10, 30), h(11, 30)) == 60
    # Una pausa abierta cuenta hasta ahora.
    assert minutos_en_pausa([(h(14), None)], h(8), h(16), ahora=h(15)) == 60
    assert minutos_en_pausa([], h(8), h(16)) == 0


def test_las_pausas_de_un_paso_son_las_suyas_y_las_de_su_ot():
    de_la_ot = PausaOrden(id_orden_trabajo=OT, id_otp=None, motivo="OTRO", desde=_ahora_ar())
    del_torno = PausaOrden(id_orden_trabajo=OT, id_otp=TORNO, motivo="OTRO", desde=_ahora_ar())
    de_la_pintura = PausaOrden(id_orden_trabajo=OT, id_otp=PINTURA, motivo="OTRO", desde=_ahora_ar())
    assert pausas_del_paso([de_la_ot, del_torno, de_la_pintura], TORNO) == [de_la_ot, del_torno]


def test_la_duracion_se_dice_como_en_el_taller():
    assert duracion_corta(45) == "45 min"
    assert duracion_corta(135) == "2 h 15 min"
    assert duracion_corta(120) == "2 h"
    assert duracion_corta(24 * 60) == "1 día"
    assert duracion_corta(3 * 24 * 60 + 100) == "3 días"
