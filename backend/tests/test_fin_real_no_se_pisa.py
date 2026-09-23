"""El fin de un paso terminado no se corre, y lo que estuvo terminado no cuenta como trabajo.

RF-07 pone al lado de un nombre un número de eficiencia que sale del fin y el arranque
de cada paso (RF-06). Había dos maneras de inflarlo sin que nadie trabajara un minuto:

  1. **Marcar como terminada una OT con pasos que ya estaban terminados.** El UPDATE
     masivo escribía `fin_real = ahora` en TODOS los pasos: uno terminado el lunes
     pasaba a «terminar» el jueves y sumaba tres días de trabajo. Lo mismo al volver a
     elegir «terminado» sobre un paso terminado.
  2. **Reabrir un paso y volver a terminarlo.** La columna guarda un solo arranque y un
     solo fin: el paso «duraba» desde el primer arranque hasta el último fin, con los
     días en que estuvo terminado adentro. Ahora eso sale del historial de pasos de la
     OT (auditoria_proceso_ot) y no se cuenta.

El UPDATE masivo usa `= ANY(:ordenes)`, que es de Postgres. Para correrlo acá, sobre
SQLite, se traduce al vuelo a `IN (SELECT value FROM json_each(?))`: es la misma
consulta, con el mismo CASE que se quiere probar.
"""
import json
import re
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import event, select

from backend.application import AusenciaService as ausencia_mod
from backend.application import RendimientoOperarioService as rend_mod
from backend.application import TiemposOperarioService as tiempos_mod
from backend.application.TiempoEfectivo import tiempo_de_un_paso
from backend.application.TiemposOperarioService import TiemposOperarioService, cerrados_del_historial
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.infrastructure import OrdenTrabajoRepository as repo_mod
from backend.infrastructure import auditoria_procesos as auditoria_proc
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.tests.test_rendimiento_operario import AHORA, JUAN, SEMANA, _por_paso, _reporte, _semana, dia


class _Reloj:
    """La hora del taller que ven el repositorio de OT, la auditoría y los reportes."""

    def __init__(self, cuando):
        self.cuando = cuando

    def __call__(self):
        return self.cuando


@pytest.fixture
def reloj(monkeypatch):
    r = _Reloj(AHORA)
    for mod, nombre in ((repo_mod, "_ahora_ar"), (auditoria_proc, "ahora_ar"),
                        (rend_mod, "ahora_ar"), (tiempos_mod, "ahora_ar"), (ausencia_mod, "ahora_ar")):
        monkeypatch.setattr(mod, nombre, r)
    return r


def _any_a_sqlite(conn, cursor, statement, parameters, context, executemany):
    """`x = ANY(?)` con una lista (Postgres) → `x IN (SELECT value FROM json_each(?))`."""
    if "= ANY(" not in statement:
        return statement, parameters
    statement = re.sub(r"= ANY\(\?\)", "IN (SELECT value FROM json_each(?))", statement)
    parameters = tuple(json.dumps(list(p)) if isinstance(p, (list, tuple)) else p for p in parameters)
    return statement, parameters


@pytest_asyncio.fixture
async def semana(session, reloj):
    event.listen(session.bind.sync_engine, "before_cursor_execute", _any_a_sqlite, retval=True)
    await _semana(session)
    yield session
    event.remove(session.bind.sync_engine, "before_cursor_execute", _any_a_sqlite)


async def _paso(session, id_otp) -> OrdenTrabajoProceso:
    session.expire_all()
    return (await session.execute(
        select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id == id_otp))).scalar_one()


async def _tiempos(session, **kw) -> dict:
    return {t["id_otp"]: t for t in (await TiemposOperarioService(session).tareas(JUAN, **kw)).data["tareas"]}


# ─────────────────────── 1. no se corre el fin ───────────────────────

async def test_marcar_la_ot_terminada_no_le_corre_el_fin_a_los_pasos_ya_terminados(semana):
    """El caso de la verificación: la semana de JUAN y «marcar como terminada» la OT 10.
    El 101 (fin martes 11:00) y el 102 (fin lunes 9:00) quedaban con fin el jueves a las
    12: el promedio pasaba de 75 a 904 y la eficiencia de 109 % a 8 %."""
    antes = _por_paso(await _reporte(semana, **SEMANA))
    assert (antes[101]["efectivo_min"], antes[102]["efectivo_min"]) == (105, 60)

    r = await OrdenTrabajoRepository(semana).marcar_estado_de_ordenes([10], 3)
    assert r["procesos"] == 3

    assert (await _paso(semana, 101)).fin_real == dia(22, 11)
    assert (await _paso(semana, 102)).fin_real == dia(21, 9)
    # El que estaba en curso sí se termina ahora.
    assert (await _paso(semana, 103)).fin_real == AHORA

    despues = _por_paso(await _reporte(semana, **SEMANA))
    assert (despues[101]["efectivo_min"], despues[102]["efectivo_min"]) == (105, 60)
    assert despues[101]["eficiencia_pct"] == 114 and despues[102]["eficiencia_pct"] == 100
    assert not despues[101]["reabierto"] and not despues[102]["reabierto"]

    # Y el historial no anota un cambio de fin que no hubo.
    fines = (await semana.execute(
        select(AuditoriaProcesoOT.id_otp).where(AuditoriaProcesoOT.cambios.like("%fin real%"))
    )).scalars().all()
    assert sorted(fines) == [103]


async def test_volver_a_elegir_terminado_no_pisa_el_fin(semana, reloj):
    reloj.cuando = dia(24, 15)
    await OrdenTrabajoRepository(semana).update_proceso_status(10, 150, 3, id_otp=101)
    assert (await _paso(semana, 101)).fin_real == dia(22, 11)
    assert (await _tiempos(semana))[101]["efectivo_min"] == 105


# ─────────────────────── 2. lo reabierto ───────────────────────

async def test_reabrir_y_volver_a_terminar_no_cuenta_lo_que_estuvo_terminado(semana, reloj):
    """102: soldadura del lunes de 8 a 9 (60). Se reabre el miércoles a las 10 y se
    termina de nuevo a las 11. Trabajó 60 + 60 = 120, no de lunes a miércoles (1155)."""
    repo = OrdenTrabajoRepository(semana)
    reloj.cuando = dia(23, 10)
    await repo.update_proceso_status(10, 160, 2, id_otp=102)
    reloj.cuando = dia(23, 11)
    await repo.update_proceso_status(10, 160, 3, id_otp=102)

    p = await _paso(semana, 102)
    assert (p.inicio_real, p.fin_real) == (dia(21, 8), dia(23, 11)), "el arranque y el fin, como siempre"

    reloj.cuando = AHORA
    t = (await _tiempos(semana))[102]
    assert t["efectivo_min"] == 120
    assert t["reabierto"] is True and t["cerrado_min"] == (dia(23, 10) - dia(21, 9)).total_seconds() // 60
    assert t["corrido_min"] == t["efectivo_min"] + t["pausa_min"] + t["fuera_de_jornada_min"] + t["cerrado_min"]

    r = _por_paso(await _reporte(semana, **SEMANA))[102]
    assert r["efectivo_min"] == 120 and r["eficiencia_pct"] == 50 and r["reabierto"] is True


async def test_reabrir_desde_marcar_varias_tambien_se_ve(semana, reloj):
    """El mismo caso por el camino masivo (SQL crudo y anotado a mano en el historial):
    101, torno del martes de 8 a 11 (105 efectivos), reabierto el miércoles a las 13 y
    terminado a las 14."""
    repo = OrdenTrabajoRepository(semana)
    reloj.cuando = dia(23, 13)
    await repo.marcar_estado_de_ordenes([10], 2)
    reloj.cuando = dia(23, 14)
    await repo.marcar_estado_de_ordenes([10], 3)

    reloj.cuando = AHORA
    t = (await _tiempos(semana))[101]
    assert t["reabierto"] is True
    assert t["efectivo_min"] == 105 + 60


async def test_el_reabierto_que_sigue_abierto_cuenta_desde_que_lo_reabrieron(semana, reloj):
    reloj.cuando = dia(23, 13)
    await OrdenTrabajoRepository(semana).update_proceso_status(10, 160, 2, id_otp=102)
    reloj.cuando = dia(23, 15)
    t = (await _tiempos(semana))[102]
    assert t["en_curso"] is True and t["efectivo_min"] == 60 + 120


# ─────────────────────── el historial, puro ───────────────────────

def test_el_historial_dice_cuando_estuvo_terminado():
    filas = [
        # Por el ORM: fechas en castellano.
        (7, datetime(2026, 9, 23, 10, 0, 12), json.dumps([
            {"campo": "estado", "antes": "Finalizado", "despues": "En Proceso"},
            {"campo": "fin real", "antes": "21/09/2026 09:00", "despues": None}])),
        # Por el UPDATE masivo en SQLite: la fecha como la devuelve la base.
        (8, datetime(2026, 9, 24, 12, 0), json.dumps([
            {"campo": "fin real", "antes": "2026-09-22 11:00:00.000000", "despues": "24/09/2026 12:00"}])),
        # Un fin que se pone por primera vez no es un cierre.
        (9, datetime(2026, 9, 24, 12, 0), json.dumps([
            {"campo": "fin real", "antes": None, "despues": "24/09/2026 12:00"}])),
        # El centinela del sistema viejo tampoco.
        (9, datetime(2026, 9, 24, 12, 0), json.dumps([
            {"campo": "fin real", "antes": "01/01/1900 00:00", "despues": None}])),
        (9, datetime(2026, 9, 24, 12, 0), "esto no es JSON"),
    ]
    assert cerrados_del_historial(filas) == {
        7: [(datetime(2026, 9, 21, 9), datetime(2026, 9, 23, 10, 0, 12))],
        8: [(datetime(2026, 9, 22, 11), datetime(2026, 9, 24, 12))],
    }


def test_un_fin_pisado_antes_del_arreglo_se_corrige_con_el_historial():
    """Los pasos a los que el UPDATE masivo ya les corrió el fin (antes de este arreglo)
    dejaron el fin viejo en el historial: el tiempo entre los dos no se cuenta."""
    cerrado = cerrados_del_historial([(8, dia(24, 12), json.dumps([
        {"campo": "fin real", "antes": "22/09/2026 11:00", "despues": "24/09/2026 12:00"}]))])[8]
    t = tiempo_de_un_paso(dia(22, 8), dia(24, 12), ahora=AHORA, cerrado=cerrado)
    assert t.efectivo == 60 + 105
    assert t.corrido == t.efectivo + t.en_pausa + t.fuera_de_jornada + t.cerrado
