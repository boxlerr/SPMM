"""Las horas de uso de cada máquina y su mantenimiento preventivo (RF-10).

Lo que persigue este archivo son las formas concretas en que el registro deja de servir:

  1. **El registro no se escribe o dice otra máquina.** Arrancar un paso con una máquina
     elegida a mano, o con la del plan, tiene que dejar su tramo, con el origen dicho; y
     un plan que cambia DESPUÉS no puede reescribir lo que pasó.
  2. **Horas de más.** La noche, lo que volvió a Pendiente, lo arrancado con la máquina
     fuera de servicio, dos pasos a la vez en la misma máquina: nada de eso es uso.
  3. **El aviso que se repite o que no llega a quien tiene que llegar.** Una sola vez por
     vencimiento; el email a los elegidos y a nadie más; sin elegidos, a nadie; sin
     servicio de mail o con el servicio caído, la corrida sigue y queda anotado.
  4. **Permisos.** Sin escritura en Recurso maquinaria no se configura nada, y la lista
     de usuarios no le muestra los emails a quien no ve «Usuarios y permisos».

Todo sobre SQLite en memoria. El UPDATE masivo de «marcar varias OT» usa `= ANY()`, que
es de Postgres: ese camino se probó contra un Postgres descartable (ver el reporte de
la rama), no acá.
"""
from datetime import date, datetime, time
import uuid

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.application import MantenimientoMaquinaService as MMS
from backend.application import UsoMaquinaService as UMS
from backend.application.MantenimientoMaquinaService import (
    MantenimientoMaquinaService,
    avisos_que_tocan,
    calcular_estado,
    enmascarar,
)
from backend.application.UsoMaquinaService import UsoMaquinaService
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.permisos import DatosDePermisos, permisos_de
from backend.core.permisos_rutas import POLITICAS, permite
from backend.core.security import get_current_user, get_permisos_actuales
from backend.domain.Articulo import Articulo
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.MantenimientoMaquina import MantenimientoAviso
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Notificacion import Notificacion
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Planificacion import Planificacion
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.domain.UsoMaquina import UsoMaquina
from backend.domain.Usuario import Usuario
from backend.infrastructure import OrdenTrabajoRepository as OTR
from backend.infrastructure.db import Base
from backend.infrastructure.notifications import email as correo
from backend.presentation import UsoMaquinaAPI
from backend.tests.conftest import TEST_TABLES

TORNO, FRESA, PRENSA, TORNO_VIEJO = 1, 2, 3, 4
JUAN, ANA = 1, 2
LUCAS, SOFIA, BETO = 7, 8, 9
OT = 10
LOTE_VIEJO, LOTE_NUEVO = str(uuid.uuid4()), str(uuid.uuid4())
QUIEN = {"id_usuario": LUCAS, "nombre": "Lucas", "apellido": "Martínez", "username": "lucas"}


def lunes(hh: int, mm: int = 0) -> datetime:
    """El lunes 21/09/2026: un día hábil entero de jornada."""
    return datetime(2026, 9, 21, hh, mm)


@pytest_asyncio.fixture
async def s():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})

    @event.listens_for(engine.sync_engine, "connect")
    def _fks(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TEST_TABLES + [Usuario.__table__]))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as sesion:
        yield sesion
    await engine.dispose()


def _plan(pid, id_otp, proceso, id_operario, id_maquina, lote, creado):
    return Planificacion(id=pid, orden_id=OT, proceso_id=proceso, id_orden_trabajo_proceso=id_otp,
                         id_operario=id_operario, id_maquinaria=id_maquina,
                         sin_maquinaria=id_maquina is None, inicio_min=0, fin_min=60,
                         duracion_min=60, prioridad_peso=1, id_planificacion_lote=lote,
                         creado_en=creado)


async def _mundo(s):
    s.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja", abreviatura="BAND"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="En Proceso"),
        EstadoProceso(id=3, descripcion="Finalizado"),
        Proceso(id=150, nombre="TORNO CNC"),
        Proceso(id=160, nombre="FRESADO"),
        Operario(id=JUAN, nombre="JUAN", apellido="PEREZ", categoria="OFICIAL", disponible=True,
                 hora_inicio=time(7), hora_fin=time(16)),
        Operario(id=ANA, nombre="ANA", apellido="GIL", categoria="OFICIAL", disponible=True,
                 hora_inicio=time(7), hora_fin=time(16)),
        Maquinaria(id=TORNO, nombre="TORNO 1", estado_operativo="operativa"),
        Maquinaria(id=FRESA, nombre="FRESADORA 2", estado_operativo="operativa"),
        Maquinaria(id=PRENSA, nombre="PRENSA 3", estado_operativo="operativa"),
        Maquinaria(id=TORNO_VIEJO, nombre="TORNO VIEJO", estado_operativo="fuera_de_servicio"),
    ])
    await s.flush()
    s.add(OrdenTrabajo(id=OT, id_otvieja=15279, id_prioridad=1, id_sector=1, id_articulo=1,
                       fecha_orden=lunes(0), fecha_entrada=lunes(0), fecha_prometida=datetime(2026, 9, 30),
                       finalizadototal=0))
    await s.flush()
    s.add_all([
        # 101: TORNO 1 elegido a mano, JUAN elegido a mano.
        OrdenTrabajoProceso(id=101, id_orden_trabajo=OT, id_proceso=150, orden=1, id_estado=1,
                            tiempo_proceso=120, id_maquinaria=TORNO, id_operario=JUAN),
        # 102: sin nada elegido; el plan viejo decía PRENSA/JUAN y el nuevo FRESADORA/ANA.
        OrdenTrabajoProceso(id=102, id_orden_trabajo=OT, id_proceso=160, orden=2, id_estado=1,
                            tiempo_proceso=60),
        # 103: ni elegida ni planificada.
        OrdenTrabajoProceso(id=103, id_orden_trabajo=OT, id_proceso=150, orden=3, id_estado=1),
        # 104: se hace a mano (aunque el plan viejo le diera una máquina).
        OrdenTrabajoProceso(id=104, id_orden_trabajo=OT, id_proceso=150, orden=4, id_estado=1,
                            no_lleva_maquina=1),
        # 105: elegida a mano una máquina que está fuera de servicio.
        OrdenTrabajoProceso(id=105, id_orden_trabajo=OT, id_proceso=150, orden=5, id_estado=1,
                            id_maquinaria=TORNO_VIEJO),
    ])
    await s.flush()
    s.add_all([
        _plan(1, 102, 160, JUAN, PRENSA, LOTE_VIEJO, datetime(2026, 9, 18, 10)),
        _plan(2, 102, 160, ANA, FRESA, LOTE_NUEVO, datetime(2026, 9, 20, 10)),
        _plan(3, 104, 150, JUAN, PRENSA, LOTE_NUEVO, datetime(2026, 9, 20, 10)),
    ])
    await s.commit()


def _reloj(monkeypatch, cuando: datetime):
    monkeypatch.setattr(OTR, "_ahora_ar", lambda: cuando)


async def _mover(s, monkeypatch, id_otp: int, estado: int, cuando: datetime):
    _reloj(monkeypatch, cuando)
    paso = await s.get(OrdenTrabajoProceso, id_otp)
    await OTR.OrdenTrabajoRepository(s).update_proceso_status(
        OT, paso.id_proceso, estado, id_otp=id_otp, usuario=QUIEN)


async def _usos(s) -> list[UsoMaquina]:
    s.expire_all()
    return list((await s.execute(select(UsoMaquina).order_by(UsoMaquina.id))).scalars().all())


# ─────────────────────────── 1. el registro al arrancar y al terminar ───────────────────────────


@pytest.mark.asyncio
async def test_arrancar_con_la_maquina_elegida_abre_el_registro_y_terminar_lo_cierra(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 101, 2, lunes(8))

    [u] = await _usos(s)
    paso = await s.get(OrdenTrabajoProceso, 101)
    assert (u.id_maquinaria, u.origen_maquina) == (TORNO, "OT")
    assert u.inicio == paso.inicio_real == lunes(8), "la misma hora que el arranque del paso"
    assert u.fin is None and u.no_suma is None
    assert (u.numero_ot, u.paso, u.nombre_proceso) == (15279, 1, "TORNO CNC")
    assert (u.id_operario, u.operario) == (JUAN, "JUAN PEREZ")
    assert u.usuario_inicio == "Lucas Martínez"

    await _mover(s, monkeypatch, 101, 3, lunes(10))
    [u] = await _usos(s)
    paso = await s.get(OrdenTrabajoProceso, 101)
    assert u.fin == paso.fin_real == lunes(10)
    # De 8 a 10: 120 de reloj; efectivo 8–9 y 9:15–10 (el desayuno de 9 a 9:15 no es uso).
    assert (u.corrido_min, u.efectivo_min) == (120, 105)
    assert u.usuario_fin == "Lucas Martínez"


@pytest.mark.asyncio
async def test_sin_maquina_elegida_va_la_del_ultimo_plan_y_no_cambia_si_despues_cambia_el_plan(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 102, 2, lunes(8))
    [u] = await _usos(s)
    assert (u.id_maquinaria, u.origen_maquina) == (FRESA, "PLAN"), "el lote más nuevo, no el primero"
    assert (u.id_operario, u.operario) == (ANA, "ANA GIL")

    # Se replanifica con el paso en marcha: el registro dice lo que pasó, no el plan nuevo.
    s.add(_plan(9, 102, 160, JUAN, PRENSA, str(uuid.uuid4()), lunes(9)))
    await s.commit()
    await _mover(s, monkeypatch, 102, 3, lunes(11))
    [u] = await _usos(s)
    assert (u.id_maquinaria, u.operario, u.fin) == (FRESA, "ANA GIL", lunes(11))


@pytest.mark.asyncio
async def test_sin_maquina_o_a_mano_no_hay_registro_y_el_paso_se_mueve_igual(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 103, 2, lunes(8))
    await _mover(s, monkeypatch, 104, 2, lunes(8))
    assert await _usos(s) == []
    for id_otp in (103, 104):
        assert (await s.get(OrdenTrabajoProceso, id_otp)).id_estado == 2


@pytest.mark.asyncio
async def test_reabrir_abre_otro_tramo_y_lo_terminado_no_cuenta(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 101, 2, lunes(8))
    await _mover(s, monkeypatch, 101, 3, lunes(10))
    await _mover(s, monkeypatch, 101, 2, lunes(13))   # se reabre
    await _mover(s, monkeypatch, 101, 2, lunes(13, 5))  # elegir otra vez «en proceso»: nada
    await _mover(s, monkeypatch, 101, 3, lunes(14))

    usos = await _usos(s)
    assert [(u.inicio, u.fin) for u in usos] == [(lunes(8), lunes(10)), (lunes(13), lunes(14))]
    assert [u.efectivo_min for u in usos] == [105, 60]


@pytest.mark.asyncio
async def test_volver_a_pendiente_cierra_el_tramo_y_no_suma(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 101, 2, lunes(8))
    await _mover(s, monkeypatch, 101, 1, lunes(9))
    [u] = await _usos(s)
    assert (u.fin, u.no_suma) == (lunes(9), "VUELTA_A_PENDIENTE")

    monkeypatch.setattr(UMS, "ahora_ar", lambda: lunes(15))
    data = (await UsoMaquinaService(s).uso_de_la_maquina(TORNO, "2026-09-01", "2026-09-30")).data
    assert data["resumen"]["efectivo_min"] == 0 and data["resumen"]["no_suman"] == 1
    assert data["usos"][0]["suma"] is False and data["usos"][0]["no_suma_texto"]


@pytest.mark.asyncio
async def test_una_maquina_fuera_de_servicio_no_suma_uso_nuevo_pero_queda_dicho(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 105, 2, lunes(8))
    await _mover(s, monkeypatch, 105, 3, lunes(12))
    [u] = await _usos(s)
    assert (u.id_maquinaria, u.no_suma) == (TORNO_VIEJO, "FUERA_DE_SERVICIO")

    monkeypatch.setattr(UMS, "ahora_ar", lambda: lunes(15))
    data = (await UsoMaquinaService(s).uso_de_la_maquina(TORNO_VIEJO, "2026-09-01", "2026-09-30")).data
    assert data["resumen"]["efectivo_min"] == 0
    assert data["resumen"]["fuera_de_servicio"] == 1
    assert len(data["usos"]) == 1, "se ve en la lista aunque no sume"


@pytest.mark.asyncio
async def test_si_el_registro_falla_el_paso_se_mueve_igual(s, monkeypatch):
    """El registro va en un savepoint: sin su tabla (la migración sin correr) el cambio
    de estado del paso, que es lo más usado del sistema, no puede dejar de andar."""
    await _mundo(s)
    from sqlalchemy import text
    await s.execute(text("DROP TABLE uso_maquina"))
    await s.commit()
    await _mover(s, monkeypatch, 101, 2, lunes(8))
    s.expire_all()
    paso = await s.get(OrdenTrabajoProceso, 101)
    assert (paso.id_estado, paso.inicio_real) == (2, lunes(8))


# ─────────────────────────── 2. las horas de un período ───────────────────────────


async def _tramo(s, inicio, fin, maquina=TORNO, id_otp=900, **extra):
    s.add(UsoMaquina(id_maquinaria=maquina, origen_maquina="OT", id_orden_trabajo=OT, numero_ot=15279,
                     id_otp=id_otp, inicio=inicio, fin=fin, **extra))
    await s.commit()


@pytest.mark.asyncio
async def test_horas_en_el_periodo_recortadas_y_cada_hora_una_vez(s, monkeypatch):
    await _mundo(s)
    # Del lunes 31/08 a las 14 al martes 1/09 a las 9: 2 h en agosto y 2 h en septiembre.
    await _tramo(s, datetime(2026, 8, 31, 14), datetime(2026, 9, 1, 9), id_otp=901)
    # Miércoles 2/09 de 8 a 10 (1 h 45 efectivas) y, pisándolo, de 9:30 a 10:30 (1 h).
    await _tramo(s, datetime(2026, 9, 2, 8), datetime(2026, 9, 2, 10), id_otp=902)
    await _tramo(s, datetime(2026, 9, 2, 9, 30), datetime(2026, 9, 2, 10, 30), id_otp=903)
    # Otra máquina: no se mezcla.
    await _tramo(s, datetime(2026, 9, 2, 8), datetime(2026, 9, 2, 12), maquina=FRESA, id_otp=904)
    monkeypatch.setattr(UMS, "ahora_ar", lambda: datetime(2026, 9, 23, 12))
    svc = UsoMaquinaService(s)

    sep = (await svc.uso_de_la_maquina(TORNO, "2026-09-01", "2026-09-30")).data["resumen"]
    # 120 del martes + la unión de 8 a 10:30 del miércoles (60 + 75) = 255; lo pisado, 30.
    assert (sep["efectivo_min"], sep["superpuesto_min"], sep["pasos"]) == (255, 30, 3)
    ago = (await svc.uso_de_la_maquina(TORNO, "2026-08-01", "2026-08-31")).data["resumen"]
    assert (ago["efectivo_min"], ago["pasos"]) == (120, 1)

    # La columna de la tabla dice lo mismo que el detalle.
    ini, fin = datetime(2026, 9, 1), datetime(2026, 10, 1)
    horas = await svc.horas_por_maquina(ini, fin, datetime(2026, 9, 23, 12))
    assert horas[TORNO]["efectivo_min"] == 255 and horas[FRESA]["efectivo_min"] == 225


@pytest.mark.asyncio
async def test_un_tramo_abierto_de_un_paso_que_ya_no_esta_en_proceso_no_suma(s, monkeypatch):
    await _mundo(s)
    # El 103 está Pendiente (lo movieron por un camino que no avisa, o lo borraron).
    await _tramo(s, lunes(8), None, id_otp=103)
    monkeypatch.setattr(UMS, "ahora_ar", lambda: lunes(15))
    data = (await UsoMaquinaService(s).uso_de_la_maquina(TORNO, "2026-09-01", "2026-09-30")).data
    assert data["resumen"]["efectivo_min"] == 0
    assert data["usos"][0]["no_suma"] == "SIN_CIERRE"


@pytest.mark.asyncio
async def test_un_tramo_en_curso_cuenta_hasta_ahora(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 101, 2, lunes(8))
    monkeypatch.setattr(UMS, "ahora_ar", lambda: lunes(10))
    data = (await UsoMaquinaService(s).uso_de_la_maquina(TORNO, "2026-09-21", "2026-09-21")).data
    assert data["resumen"]["efectivo_min"] == 105 and data["resumen"]["en_curso"] == 1
    assert data["usos"][0]["en_curso"] is True


# ─────────────────────────── 3. la próxima fecha ───────────────────────────


def _estado(**kw):
    base = dict(frecuencia_dias=None, cada_horas=None, dias_aviso=None, ultimo_hecho=None,
                contar_desde=None, usado_min=None, hoy=date(2026, 9, 28))
    base.update(kw)
    return calcular_estado(**base)


def test_proxima_fecha_por_dias():
    e = _estado(frecuencia_dias=30, ultimo_hecho=date(2026, 9, 1))
    assert (e["proxima_fecha"], e["dias_restantes"], e["estado"]) == (date(2026, 10, 1), 3, "proximo")
    assert _estado(frecuencia_dias=30, ultimo_hecho=date(2026, 9, 1), hoy=date(2026, 9, 20))["estado"] == "al_dia"
    vencido = _estado(frecuencia_dias=30, ultimo_hecho=date(2026, 9, 1), hoy=date(2026, 10, 2))
    assert (vencido["estado"], vencido["vencido_por"]) == ("vencido", ["fecha"])
    # Con cuántos días avisar es de cada máquina.
    assert _estado(frecuencia_dias=30, ultimo_hecho=date(2026, 9, 1), dias_aviso=1)["estado"] == "al_dia"


def test_se_cuenta_desde_lo_mas_nuevo_y_sin_base_no_hay_fecha_ni_aviso():
    e = _estado(frecuencia_dias=30, ultimo_hecho=date(2026, 8, 1), contar_desde=date(2026, 9, 10))
    assert (e["base"], e["base_origen"], e["proxima_fecha"]) == (date(2026, 9, 10), "contar_desde", date(2026, 10, 10))
    e = _estado(frecuencia_dias=30, ultimo_hecho=date(2026, 9, 10), contar_desde=date(2026, 8, 1))
    assert e["base_origen"] == "hecho"
    sin_base = _estado(frecuencia_dias=30)
    assert (sin_base["estado"], sin_base["proxima_fecha"]) == ("sin_base", None)
    assert avisos_que_tocan(sin_base) == []
    assert _estado()["estado"] == "sin_configurar"


def test_proxima_por_horas_de_uso():
    e = _estado(cada_horas=10, contar_desde=date(2026, 9, 1), usado_min=599)
    assert (e["estado"], e["horas_restantes_min"]) == ("al_dia", 1)
    e = _estado(cada_horas=10, contar_desde=date(2026, 9, 1), usado_min=600)
    assert (e["estado"], e["vencido_por"]) == ("vencido", ["horas"])
    assert avisos_que_tocan(e) == [("horas:2026-09-01:10", "VENCIDO_HORAS", None)]


# ─────────────────────────── 4. el aviso ───────────────────────────


class _Correo:
    """Un servicio de mail de mentira que anota a quién se le habría mandado."""

    def __init__(self, configurado=True, falla=False):
        self._configurado, self.falla, self.a_quien = configurado, falla, []

    def configurado(self):
        return self._configurado

    async def enviar_uno(self, para, asunto, texto):
        if self.falla:
            raise ConnectionError("sin red")
        self.a_quien.append((para, asunto))


async def _usuarios(s):
    s.add_all([
        Usuario(id_usuario=LUCAS, username="lucas", email="lucas@metlo.com", password_hash="x",
                nombre="Lucas", apellido="Martínez", rol="admin", activo=True),
        Usuario(id_usuario=SOFIA, username="sofia", email="sofia@metlo.com", password_hash="x",
                nombre="Sofía", apellido="Paz", rol="supervisor", activo=True),
        Usuario(id_usuario=BETO, username="beto", email="beto@metlo.com", password_hash="x",
                nombre="Beto", apellido="Sosa", rol="operario", activo=True),
    ])
    await s.commit()


async def _configurar(s, maquina, **cambios):
    return (await MantenimientoMaquinaService(s).configurar(
        maquina, cambios, id_usuario=LUCAS, usuario="Lucas Martínez", ve_emails=True)).data


async def _avisar(s, ahora):
    return (await MantenimientoMaquinaService(s).detectarYAvisar(ahora=ahora)).data


async def _avisos(s):
    s.expire_all()
    return list((await s.execute(select(MantenimientoAviso).order_by(MantenimientoAviso.id))).scalars().all())


@pytest.mark.asyncio
async def test_el_aviso_sale_una_sola_vez_y_el_email_solo_a_los_elegidos(s, monkeypatch):
    await _mundo(s)
    await _usuarios(s)
    falso = _Correo()
    monkeypatch.setattr(correo, "ENVIADOR", falso)
    await _configurar(s, TORNO, frecuencia_dias=30, contar_desde="2026-09-01",
                      destinatarios=[LUCAS, BETO])
    # Beto deja de trabajar acá después de que lo eligieron: no le llega.
    (await s.get(Usuario, BETO)).activo = False
    await s.commit()

    # 28/09: le toca el 1/10, faltan 3 días (el aviso por defecto).
    r = await _avisar(s, datetime(2026, 9, 28, 7))
    assert r["creadas"] == 1 and r["emails"]["enviados"] == 1
    assert [p for p, _ in falso.a_quien] == ["lucas@metlo.com"], "sólo el elegido activo; Sofía no"
    [aviso] = await _avisos(s)
    assert (aviso.motivo, aviso.vence, aviso.email_estado) == ("PROXIMO", date(2026, 10, 1), "ENVIADO")
    notif = await s.get(Notificacion, aviso.id_notificacion)
    assert notif.tipo == "MANTENIMIENTO_MAQUINA" and "TORNO 1" in notif.mensaje
    assert notif.fecha_creacion == datetime(2026, 9, 28, 7)

    # Corre de nuevo el mismo día y después, ya vencido: es el MISMO vencimiento.
    assert (await _avisar(s, datetime(2026, 9, 28, 12)))["creadas"] == 0
    assert (await _avisar(s, datetime(2026, 10, 3, 7)))["creadas"] == 0
    assert len(falso.a_quien) == 1 and len(await _avisos(s)) == 1

    # Se registra el mantenimiento hecho: cuenta de nuevo, y avisa el próximo vencimiento.
    monkeypatch.setattr(MMS, "ahora_ar", lambda: datetime(2026, 10, 3, 9))
    await MantenimientoMaquinaService(s).registrar_hecho(
        TORNO, {"fecha": "2026-10-03", "hecho_por": "Técnico de afuera", "nota": "Cambio de aceite"},
        id_usuario=LUCAS, usuario="Lucas Martínez", ve_emails=True)
    assert (await _avisar(s, datetime(2026, 10, 3, 10)))["creadas"] == 0, "recién hecho: al día"
    assert (await _avisar(s, datetime(2026, 10, 31, 7)))["creadas"] == 1
    assert [a.vence for a in await _avisos(s)] == [date(2026, 10, 1), date(2026, 11, 2)]


@pytest.mark.asyncio
async def test_sin_elegidos_el_aviso_va_a_la_campanita_y_a_nadie_por_email(s, monkeypatch):
    await _mundo(s)
    await _usuarios(s)
    falso = _Correo()
    monkeypatch.setattr(correo, "ENVIADOR", falso)
    await _configurar(s, FRESA, frecuencia_dias=30, contar_desde="2026-08-01")

    r = await _avisar(s, datetime(2026, 9, 28, 7))
    assert r["creadas"] == 1 and falso.a_quien == []
    [aviso] = await _avisos(s)
    assert (aviso.motivo, aviso.email_estado) == ("VENCIDO_FECHA", "SIN_DESTINATARIOS")


@pytest.mark.asyncio
async def test_sin_servicio_de_mail_o_con_el_servicio_caido_la_corrida_sigue(s, monkeypatch):
    await _mundo(s)
    await _usuarios(s)
    await _configurar(s, TORNO, frecuencia_dias=30, contar_desde="2026-08-01", destinatarios=[LUCAS])
    await _configurar(s, FRESA, frecuencia_dias=30, contar_desde="2026-08-01", destinatarios=[LUCAS])

    # El de verdad, sin RESEND_API_KEY (la guardia de los tests la vacía): no intenta.
    monkeypatch.setattr(correo, "ENVIADOR", correo.EnviadorResend())
    monkeypatch.setattr(MMS, "ahora_ar", lambda: datetime(2026, 9, 28, 7))
    r = await _avisar(s, datetime(2026, 9, 28, 7))
    assert r["creadas"] == 2 and r["emails"]["sin_configurar"] == 2
    assert {a.email_estado for a in await _avisos(s)} == {"SIN_CONFIGURAR"}

    # Con el servicio caído: queda anotado y la campanita tiene su aviso igual.
    monkeypatch.setattr(correo, "ENVIADOR", _Correo(falla=True))
    await _configurar(s, PRENSA, frecuencia_dias=30, contar_desde="2026-08-01", destinatarios=[LUCAS])
    r = await _avisar(s, datetime(2026, 9, 28, 8))
    assert r["creadas"] == 1 and r["emails"]["fallidos"] == 1
    ultimo = (await _avisos(s))[-1]
    assert (ultimo.email_estado, ultimo.email_fallidos) == ("FALLO", 1)
    assert "sin red" not in (ultimo.email_detalle or ""), "el motivo es corto y sin datos"
    assert await s.get(Notificacion, ultimo.id_notificacion) is not None


@pytest.mark.asyncio
async def test_el_aviso_por_horas_de_uso(s, monkeypatch):
    await _mundo(s)
    monkeypatch.setattr(correo, "ENVIADOR", _Correo())
    await _configurar(s, TORNO, cada_horas=2, contar_desde="2026-09-01")
    await _tramo(s, datetime(2026, 9, 2, 8), datetime(2026, 9, 2, 10), id_otp=902)  # 105 min
    assert (await _avisar(s, datetime(2026, 9, 3, 7)))["creadas"] == 0
    await _tramo(s, datetime(2026, 9, 3, 8), datetime(2026, 9, 3, 9), id_otp=903)   # +60
    assert (await _avisar(s, datetime(2026, 9, 3, 12)))["creadas"] == 1
    assert (await _avisar(s, datetime(2026, 9, 4, 12)))["creadas"] == 0
    [aviso] = await _avisos(s)
    assert aviso.motivo == "VENCIDO_HORAS" and aviso.clave == "horas:2026-09-01:2"


@pytest.mark.asyncio
async def test_el_disparador_de_siempre_corre_tambien_el_de_mantenimiento(s, monkeypatch):
    from backend.presentation import main

    await _mundo(s)
    monkeypatch.setattr(correo, "ENVIADOR", _Correo())
    await _configurar(s, TORNO, frecuencia_dias=1, contar_desde="2026-01-01")
    monkeypatch.setenv("SYNC_TOKEN", "el-de-verdad")

    async def _db():
        yield s

    main.app.dependency_overrides[main.get_db_interno] = _db
    try:
        async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://t") as c:
            r = await c.post("/internal/alertas", headers={"x-sync-token": "el-de-verdad"})
    finally:
        main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    assert r.json()["mantenimiento"]["creadas"] == 1 and r.json()["fallas"] == {}


# ─────────────────────────── 5. configurar y permisos ───────────────────────────


@pytest.mark.asyncio
async def test_solo_se_puede_elegir_usuarios_activos_con_email_y_por_defecto_nadie(s, monkeypatch):
    from backend.commons.exceptions.BusinessException import BusinessException

    await _mundo(s)
    await _usuarios(s)
    data = (await MantenimientoMaquinaService(s).ver(TORNO, ve_emails=True)).data
    assert data["destinatarios"] == [] and data["estado"]["estado"] == "sin_configurar"
    (await s.get(Usuario, BETO)).activo = False
    await s.commit()
    with pytest.raises(BusinessException):
        await _configurar(s, TORNO, destinatarios=[LUCAS, BETO])
    with pytest.raises(BusinessException):
        await _configurar(s, TORNO, destinatarios=[999])
    data = await _configurar(s, TORNO, destinatarios=[LUCAS, LUCAS])
    assert [d["id_usuario"] for d in data["destinatarios"]] == [LUCAS]
    # Lo que no vino no se toca: cambiar los días de aviso no borra a quién le llega.
    data = await _configurar(s, TORNO, dias_aviso=5)
    assert data["config"]["dias_aviso"] == 5 and len(data["destinatarios"]) == 1
    data = await _configurar(s, TORNO, destinatarios=[])
    assert data["destinatarios"] == []


@pytest.mark.asyncio
async def test_registrar_mantenimiento_valida_la_fecha_y_se_puede_borrar(s, monkeypatch):
    from backend.commons.exceptions.BusinessException import BusinessException

    await _mundo(s)
    monkeypatch.setattr(MMS, "ahora_ar", lambda: datetime(2026, 9, 23, 10))
    svc = MantenimientoMaquinaService(s)
    with pytest.raises(BusinessException):
        await svc.registrar_hecho(TORNO, {"fecha": "2026-09-24"}, id_usuario=LUCAS,
                                  usuario="Lucas Martínez", ve_emails=True)
    await _configurar(s, TORNO, frecuencia_dias=90)
    data = (await svc.registrar_hecho(TORNO, {"fecha": "2026-09-20", "nota": "Engrase"},
                                      id_usuario=LUCAS, usuario="Lucas Martínez", ve_emails=True)).data
    [h] = data["historial"]
    assert (h["fecha"], h["nota"], h["usuario_carga"]) == ("2026-09-20", "Engrase", "Lucas Martínez")
    assert data["estado"]["proxima_fecha"] == "2026-12-19"
    data = (await svc.borrar_hecho(TORNO, h["id"], ve_emails=True)).data
    assert data["historial"] == [] and data["estado"]["estado"] == "sin_base"


def _permisos(**areas_y_secciones):
    areas = {k: v for k, v in areas_y_secciones.items() if "_" not in k}
    secciones = {k: v for k, v in areas_y_secciones.items() if "_" in k}
    return permisos_de(DatosDePermisos(rol="x", rol_areas=areas, rol_secciones=secciones), 50, "x")


def test_sin_escritura_en_recurso_maquinaria_no_se_configura_ni_se_ve_la_lista_de_usuarios():
    politica = POLITICAS["maquinas_uso"]
    solo_ver = _permisos(recursos="read")
    edita = _permisos(recursos="write")
    for metodo, ruta in (("PUT", "/maquinarias/{id_maquinaria}/mantenimiento"),
                         ("POST", "/maquinarias/{id_maquinaria}/mantenimientos"),
                         ("DELETE", "/maquinarias/{id_maquinaria}/mantenimientos/{id_registro}"),
                         ("GET", "/maquinarias-mantenimiento/destinatarios")):
        assert not permite(politica.requisitos(metodo, ruta), solo_ver, {}), (metodo, ruta)
        assert permite(politica.requisitos(metodo, ruta), edita, {}), (metodo, ruta)
    # Leer el uso y el mantenimiento: con ver la solapa alcanza; sin Recursos, no.
    for ruta in ("/maquinarias/{id_maquinaria}/uso", "/maquinarias/{id_maquinaria}/mantenimiento",
                 "/maquinarias-uso"):
        assert permite(politica.requisitos("GET", ruta), solo_ver, {})
        assert not permite(politica.requisitos("GET", ruta), _permisos(operaciones="write"), {})


def _app(s, permisos) -> FastAPI:
    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(UsoMaquinaAPI.router)

    async def _db():
        yield s

    app.dependency_overrides[UsoMaquinaAPI.get_db] = _db
    app.dependency_overrides[get_permisos_actuales] = lambda: permisos
    app.dependency_overrides[get_current_user] = lambda: QUIEN
    return app


@pytest.mark.asyncio
async def test_los_emails_salen_tapados_para_quien_no_ve_usuarios_y_permisos(s):
    await _mundo(s)
    await _usuarios(s)
    await _configurar(s, TORNO, destinatarios=[LUCAS])

    sin_usuarios = _permisos(recursos="write")
    con_usuarios = _permisos(recursos="write", configuracion="read", configuracion_usuarios="read")
    assert con_usuarios.tiene_seccion("configuracion_usuarios")

    enteros = {LUCAS: "lucas@metlo.com", SOFIA: "sofia@metlo.com", BETO: "beto@metlo.com"}
    tapados = {LUCAS: "l•••@metlo.com", SOFIA: "s•••@metlo.com", BETO: "b•••@metlo.com"}
    for permisos, esperado in ((sin_usuarios, tapados), (con_usuarios, enteros)):
        async with AsyncClient(transport=ASGITransport(app=_app(s, permisos)), base_url="http://t") as c:
            lista = (await c.get("/maquinarias-mantenimiento/destinatarios")).json()["data"]
            det = (await c.get(f"/maquinarias/{TORNO}/mantenimiento")).json()["data"]
        assert {u["id_usuario"]: u["email"] for u in lista} == esperado
        assert det["destinatarios"][0]["email"] == esperado[LUCAS]
        assert det["emails_visibles"] is (permisos is con_usuarios)
    assert enmascarar("julian@hotmail.com") == "j•••@hotmail.com"


@pytest.mark.asyncio
async def test_la_api_del_uso_y_del_resumen_contesta(s, monkeypatch):
    await _mundo(s)
    await _mover(s, monkeypatch, 101, 2, lunes(8))
    await _mover(s, monkeypatch, 101, 3, lunes(10))
    monkeypatch.setattr(UsoMaquinaAPI, "ahora_ar", lambda: lunes(15))
    monkeypatch.setattr(UMS, "ahora_ar", lambda: lunes(15))
    async with AsyncClient(transport=ASGITransport(app=_app(s, _permisos(recursos="read"))),
                           base_url="http://t") as c:
        r = await c.get(f"/maquinarias/{TORNO}/uso", params={"desde": "2026-09-01", "hasta": "2026-09-30"})
        assert r.status_code == 200, r.text
        u = r.json()["data"]["usos"][0]
        assert (u["numero_ot"], u["proceso"], u["operario"], u["efectivo_min"]) == (15279, "TORNO CNC", "JUAN PEREZ", 105)
        assert "Z" not in u["inicio"] and "+" not in u["inicio"], "fechas sin zona"
        r = await c.get("/maquinarias-uso", params={"desde": "2026-09-01", "hasta": "2026-09-30"})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["horas"][str(TORNO)]["efectivo_min"] == 105
        assert r.json()["data"]["mantenimiento"][str(TORNO)]["estado"] == "sin_configurar"
        assert (await c.get("/maquinarias/999/uso")).status_code == 404
        assert (await c.get(f"/maquinarias/{TORNO}/uso", params={"desde": "2026-09-30",
                                                                 "hasta": "2026-09-01"})).status_code == 422


@pytest.mark.asyncio
async def test_borrar_una_maquina_con_historial_avisa_y_con_forzar_se_lleva_su_uso(s, monkeypatch):
    from backend.application.MaquinariaService import MaquinariaService
    from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException

    await _mundo(s)
    # PRENSA no tiene pasos elegidos ni rangos: lo único que tiene es historial.
    await _tramo(s, lunes(8), lunes(9), maquina=PRENSA, id_otp=950)
    with pytest.raises(ConfirmacionRequeridaException) as e:
        await MaquinariaService(s).eliminarMaquinaria(PRENSA)
    assert "1 registro de uso" in str(e.value)
    await MaquinariaService(s).eliminarMaquinaria(PRENSA, forzar=True)
    s.expire_all()
    assert (await s.execute(select(UsoMaquina).where(UsoMaquina.id_maquinaria == PRENSA))).first() is None


# ─────────────────────────── 6. el front y el back hablan de lo mismo ───────────────────────────


def test_el_front_conoce_los_mismos_motivos_y_el_mismo_tipo_de_aviso():
    """Un motivo de «no suma» nuevo en el backend que el front no conoce se vería como un
    cartelito vacío; un tipo de aviso que la campanita no conoce, con la campana gris y
    sin llevar a las máquinas."""
    import re
    from pathlib import Path

    front = Path(__file__).resolve().parents[2] / "frontend" / "src"
    if not front.exists():
        pytest.skip("sin el frontend en el repo")
    lib = (front / "lib" / "usoMaquina.ts").read_text(encoding="utf-8")
    union = re.search(r"export type MotivoNoSuma = ([^;]+);", lib).group(1)
    assert set(re.findall(r'"([A-Z_]+)"', union)) == set(UMS.NO_SUMA_TEXTO)
    assert f'"{MMS.TIPO_ALERTA}"' in (front / "components" / "Topbar.tsx").read_text(encoding="utf-8")
