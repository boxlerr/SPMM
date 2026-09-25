"""El plan semanal del Integral (dbo.plansemanal → plan_semanal; pedido de la reunión con
Lucas: Maxi elige «Semana del …» y ve las materias primas de las OT programadas esa semana).

Lo trae el ESPEJO del sync (paso plan_semanal de scripts/importar_materia_prima_legacy.py) y
lo lee Pendientes con el Integral como dueño (tests/test_materia_prima_pendientes.py). Lo
que persigue este archivo:

  1. **Que la semana quede mal armada**: una fecha que no es lunes (18 semanas del Integral)
     tiene que caer en el lunes de su semana; la basura (2000-01-01) y las filas sin OT no
     entran; un (semana, OT) repetido queda una vez, siempre la misma.
  2. **Que el espejo no deje la ventana igual al Integral** (agrega, corrige y borra) o que
     toque lo de afuera: las semanas fuera de la ventana y lo cargado en SPMM.
  3. **Que se enlace una OT que no es la del Integral** (misma identidad que el resto del
     espejo: número, artículo, cliente y fecha) o que no se enlace cuando pasa a coincidir.
  4. **Que una lectura vacía borre el plan**, o que --ots toque otras OT.
  5. **Que la escritura de verdad (Postgres) no sea idempotente**, o que la base acepte una
     semana que no es lunes, o que borrar la OT se lleve el plan (sólo con SPMM_PG_PRUEBAS).
"""
from __future__ import annotations

import os
from datetime import date, datetime
from urllib.parse import urlparse

import pytest
from sqlalchemy import text

from backend.application.materia_prima.legado import (
    SEMANAS_ADELANTE,
    SEMANAS_ATRAS,
    lunes_de,
    plan_semanal_desde_legacy,
    ventana_plan_semanal,
)
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.PlanSemanal import PlanSemanal
from backend.infrastructure import migraciones
from backend.scripts import importar_materia_prima_legacy as I
from backend.tests.test_materia_prima_importacion import HOY, _correr, _spmm, _viejo

VENTANA = ventana_plan_semanal(HOY)          # del lunes 27/07 al lunes 16/11
LUNES = date(2026, 9, 21)


# ─────────────────────────── 1. la semana, sola ───────────────────────────


def test_la_ventana_es_de_lunes_a_lunes_alrededor_de_hoy():
    assert (SEMANAS_ATRAS, SEMANAS_ADELANTE) == (8, 8)
    assert VENTANA == (date(2026, 7, 27), date(2026, 11, 16))
    # Un domingo es de la semana que termina ese día; un lunes arranca la suya.
    assert ventana_plan_semanal(date(2026, 9, 27)) == VENTANA
    assert ventana_plan_semanal(date(2026, 9, 28))[0] == date(2026, 8, 3)
    assert lunes_de(datetime(2026, 9, 11, 15, 0)) == date(2026, 9, 7)


def test_la_consulta_pide_hasta_el_domingo_de_la_ultima_semana():
    """Las fechas en 'yyyymmdd' (este SQL Server lee 'yyyy-mm-dd' como año-día-mes) y hasta
    el lunes siguiente al último, sin incluirlo: un viernes de la última semana entra."""
    q = I.q_plan_semanal(VENTANA)
    assert "fecha >= '20260727' AND fecha < '20261123'" in q
    assert q.strip().upper().startswith("SELECT FECHA, OT, PRIORIDAD")


@pytest.mark.parametrize("fecha, entra", [
    (datetime(2026, 7, 27), True),        # el primer lunes
    (datetime(2026, 7, 26), False),       # el domingo antes
    (datetime(2026, 11, 22), True),       # el domingo de la última semana (→ lunes 16/11)
    (datetime(2026, 11, 23), False),      # el lunes siguiente
    (datetime(2000, 1, 1), False),        # la basura del Integral
    (None, False),
    ("2026-09-22", True),                 # texto ISO (lo que devuelve una base en crudo)
    ("22/09/2026", False),                # otro texto: no se adivina
])
def test_que_fechas_entran(fecha, entra):
    deseadas, descartes = plan_semanal_desde_legacy([{"fecha": fecha, "ot": 1}], VENTANA)
    assert bool(deseadas) is entra
    assert sum(descartes.values()) == (0 if entra else 1)


def test_una_semana_repetida_queda_una_vez_y_siempre_la_misma():
    """La 11/09 del Integral es un viernes con 5 OT, y esas OT también están el lunes 07/09
    de la misma semana: queda la fila del lunes. Sin la del lunes, la del día más temprano.
    Da lo mismo en cualquier orden (el Integral no tiene clave: el orden físico cambia)."""
    filas = [
        {"fecha": datetime(2026, 9, 11), "ot": 15001, "PRIORIDAD": "Urgente"},
        {"fecha": datetime(2026, 9, 7), "ot": 15001, "PRIORIDAD": "Normal"},
        {"fecha": datetime(2026, 9, 12), "ot": 15002, "PRIORIDAD": "Normal"},
        {"fecha": datetime(2026, 9, 11), "ot": 15002, "PRIORIDAD": "Urgente 2"},
        {"fecha": datetime(2026, 9, 21), "ot": "15003", "PRIORIDAD": " "},
        {"fecha": datetime(2026, 9, 21), "ot": 0, "PRIORIDAD": "Normal"},
        {"fecha": datetime(2026, 9, 21), "ot": "abc", "PRIORIDAD": "Normal"},
    ]
    esperado = {
        (date(2026, 9, 7), 15001): {"fecha_original": date(2026, 9, 7), "prioridad": "Normal"},
        (date(2026, 9, 7), 15002): {"fecha_original": date(2026, 9, 11), "prioridad": "Urgente 2"},
        (date(2026, 9, 21), 15003): {"fecha_original": date(2026, 9, 21), "prioridad": None},
    }
    for orden in (filas, list(reversed(filas))):
        deseadas, descartes = plan_semanal_desde_legacy(orden, VENTANA)
        assert deseadas == esperado
        assert descartes == {"repetidas (misma semana y OT: queda una)": 2, "sin número de OT": 2}


# ─────────────────────────── 2 a 4. el paso del espejo (en seco, SQLite) ───────────────────────────


def _plan(est):
    return {(I._dia(r["semana"]), r["numero_ot"]): (I._dia(r["fecha_original"]), r["prioridad"],
                                                   r["id_orden_trabajo"], r["origen"])
            for r in est.plan_semanal}


@pytest.mark.asyncio
async def test_deja_la_ventana_igual_al_integral_y_no_toca_lo_de_afuera(session):
    await _spmm(session)
    session.add_all([
        # Fuera de la ventana (enero): el Integral ya no la manda en la lectura, y queda.
        PlanSemanal(semana=date(2026, 1, 5), fecha_original=date(2026, 1, 5), numero_ot=15692,
                    id_orden_trabajo=10, prioridad="Normal", origen="legacy"),
        # En la ventana y en el Integral, con otra prioridad: se corrige.
        PlanSemanal(semana=LUNES, fecha_original=LUNES, numero_ot=15692, id_orden_trabajo=10,
                    prioridad="Urgente", origen="legacy"),
        # En la ventana y ya no en el Integral: se borra.
        PlanSemanal(semana=date(2026, 9, 14), fecha_original=date(2026, 9, 14), numero_ot=15000,
                    origen="legacy"),
        # Cargada en SPMM: no se pisa aunque el Integral tenga esa semana y OT.
        PlanSemanal(semana=date(2026, 9, 28), fecha_original=date(2026, 9, 28), numero_ot=14534,
                    id_orden_trabajo=12, prioridad="Urgente", origen="spmm"),
    ])
    await session.commit()
    ctx, pasos = await _correr(session, _viejo())
    c = pasos["plan_semanal"].conteos
    assert c["OT de una semana que se agregan (INSERT)"] == 3        # 15917, 99999 y 14534 del 07/09
    assert c["OT de una semana que cambian (UPDATE)"] == 1           # 15692: Urgente → Normal
    assert c["OT de una semana que ya no están en el Integral (DELETE)"] == 1   # 15000
    assert any("14534" in a and "SPMM" in a for a in pasos["plan_semanal"].advertencias)
    plan = _plan(ctx.estado)
    assert plan[(date(2026, 1, 5), 15692)] == (date(2026, 1, 5), "Normal", 10, "legacy")
    assert plan[(LUNES, 15692)] == (LUNES, "Normal", 10, "legacy")
    assert (date(2026, 9, 14), 15000) not in plan
    assert plan[(date(2026, 9, 28), 14534)] == (date(2026, 9, 28), "Urgente", 12, "spmm")
    assert plan[(date(2026, 9, 7), 14534)] == (date(2026, 9, 11), "Urgente 1", 12, "legacy")

    # Otra corrida con el Integral igual: nada.
    _, pasos = await _correr(session, _viejo(), estado=ctx.estado)
    for clave in I.CAMBIOS["plan_semanal"]:
        assert pasos["plan_semanal"].conteos[clave] == 0, clave


@pytest.mark.asyncio
async def test_la_ot_se_enlaza_cuando_pasa_a_ser_la_del_integral(session):
    """15917 en SPMM es de otro artículo: queda con el número y sin OT. Cuando se corrige en
    SPMM (o se da de alta la de verdad), la pasada siguiente la enlaza."""
    await _spmm(session)
    ctx, _ = await _correr(session, _viejo())
    assert _plan(ctx.estado)[(LUNES, 15917)][2] is None
    ctx.estado.ots[15917]["cod_articulo"] = "C-VIEJO"
    _, pasos = await _correr(session, _viejo(), estado=ctx.estado)
    assert pasos["plan_semanal"].conteos["OT de una semana que cambian (UPDATE)"] == 1
    assert _plan(ctx.estado)[(LUNES, 15917)][2] == 11


@pytest.mark.asyncio
async def test_una_lectura_vacia_no_borra_el_plan(session):
    await _spmm(session)
    ctx, _ = await _correr(session, _viejo())
    antes = _plan(ctx.estado)
    _, pasos = await _correr(session, dict(_viejo(), plansemanal=[]), estado=ctx.estado)
    assert _plan(ctx.estado) == antes and antes
    assert pasos["plan_semanal"].conteos["OT de una semana que ya no están en el Integral (DELETE)"] == 0
    assert pasos["plan_semanal"].alertas


@pytest.mark.asyncio
async def test_con_ots_solo_se_tocan_esas_ot(session):
    """--ots 14534: su plan como en el Integral; el de 15692 no se mira aunque no esté en lo
    leído (se leyó sólo lo de 14534)."""
    await _spmm(session)
    ctx, _ = await _correr(session, _viejo())
    viejo = _viejo()
    viejo["plansemanal"] = [f for f in viejo["plansemanal"]
                            if not (f["ot"] == 14534 and f["fecha"] == datetime(2026, 9, 28))]
    _, pasos = await _correr(session, viejo, estado=ctx.estado, ots=[14534])
    c = pasos["plan_semanal"].conteos
    assert c["OT de una semana que ya no están en el Integral (DELETE)"] == 1
    plan = _plan(ctx.estado)
    assert (date(2026, 9, 28), 14534) not in plan
    assert (LUNES, 15692) in plan and (LUNES, 99999) in plan


def test_el_paso_es_del_espejo_y_lee_la_cabecera():
    assert "plan_semanal" in I.PASOS_ESPEJO and I.PASOS[-1] == "plan_semanal"
    assert "plan_semanal" in I.LECTURAS["otrabajo"][1], "para saber si la OT es la del Integral"
    assert I.LECTURAS["plansemanal"][1] == ("plan_semanal",)


def test_borrar_una_ot_no_se_lleva_el_plan_en_el_modelo():
    fk = next(iter(PlanSemanal.__table__.c.id_orden_trabajo.foreign_keys))
    assert fk.column.table.name == "orden_trabajo" and fk.ondelete == "SET NULL"


@pytest.mark.asyncio
async def test_borrar_una_ot_deja_el_numero_en_el_plan(session):
    from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

    await _spmm(session)
    session.add(PlanSemanal(semana=LUNES, fecha_original=LUNES, numero_ot=15917,
                            id_orden_trabajo=11, origen="legacy"))
    await session.commit()
    await OrdenTrabajoRepository(session).delete(11)
    session.expunge_all()
    fila = (await session.execute(text(
        "SELECT numero_ot, id_orden_trabajo FROM plan_semanal"))).one()
    assert tuple(fila) == (15917, None)
    assert await session.get(OrdenTrabajo, 11) is None


# ─────────────── 5. contra un Postgres de verdad (descartable, SPMM_PG_PRUEBAS) ───────────────
#
# La escritura es SQL de Postgres (unnest, ANY, la migración con su CHECK de lunes): esto
# corre sólo con SPMM_PG_PRUEBAS apuntando a un Postgres LOCAL descartable (le borra el
# esquema public), como test_sync_huella.

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


pg = pytest.mark.skipif(not (PG_URL and _pg_seguro(PG_URL)), reason="sin SPMM_PG_PRUEBAS local")


@pg
@pytest.mark.asyncio
async def test_pg_el_paso_con_aplicar_es_idempotente_y_la_base_cuida_la_semana():
    import asyncpg
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    from backend.infrastructure.db import Base
    from backend.tests.conftest import TEST_TABLES

    motor = create_async_engine(PG_URL, poolclass=NullPool)
    try:
        async with motor.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            # Todo menos plan_semanal desde los modelos; plan_semanal desde la migración (con
            # su CHECK de lunes, que el modelo no declara porque SQLite no lo entiende).
            tablas = [t for t in TEST_TABLES if t.name != "plan_semanal"]
            await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tablas))
            for s in dict(migraciones.MIGRACIONES)["2026-09-25_plan_semanal"]:
                await conn.execute(text(s))
            for s in ("INSERT INTO prioridad (id, descripcion) VALUES (1, 'Normal')",
                      "INSERT INTO sector (id, nombre) VALUES (1, 'Taller')",
                      "INSERT INTO articulo (id, cod_articulo, descripcion, abreviatura) "
                      "VALUES (1, 'A-100', 'Bandeja', 'B')",
                      "INSERT INTO cliente (id, id_viejo, nombre) VALUES (1, 4, 'ACME')",
                      "INSERT INTO orden_trabajo (id, id_otvieja, id_prioridad, id_sector, "
                      "id_articulo, id_cliente, no_lleva_plano, no_lleva_materia_prima, ttt1, fc, "
                      "fecha_orden, fecha_entrada, fecha_prometida) VALUES "
                      "(10, 15692, 1, 1, 1, 1, 0, 0, 0, 0, '2026-09-01', '2026-09-01', '2026-10-01'), "
                      "(12, 14534, 1, 1, 1, 1, 0, 0, 0, 0, '2026-09-01', '2026-09-01', '2026-10-01')"):
                await conn.execute(text(s))

        url = I._para_asyncpg(PG_URL)
        viejo = _viejo()

        async def correr(viejo):
            conn = I._Escrituras(await asyncpg.connect(url))
            try:
                tx = conn.transaction()
                await tx.start()
                ctx = I.Contexto(conn, viejo, True, 10, respaldar=False, ventana=VENTANA)
                ctx.estado = await I.Estado().cargar(conn)
                await I.paso_plan_semanal(ctx)
                await tx.commit()
                filas = await conn.fetch("SELECT semana, numero_ot, fecha_original, prioridad, "
                                         "id_orden_trabajo, origen FROM plan_semanal")
                return ctx.pasos[-1].conteos, {(f["semana"], f["numero_ot"]): tuple(f)[2:] for f in filas}
            finally:
                await conn.close()

        c, plan = await correr(viejo)
        assert c["OT de una semana que se agregan (INSERT)"] == 5
        assert plan[(date(2026, 9, 7), 14534)] == (date(2026, 9, 11), "Urgente 1", 12, "legacy")
        assert plan[(LUNES, 15917)] == (LUNES, "Urgente", None, "legacy")

        c, plan2 = await correr(viejo)
        assert plan2 == plan
        assert sum(c[k] for k in I.CAMBIOS["plan_semanal"]) == 0, "idempotente"

        viejo["plansemanal"] = [f for f in viejo["plansemanal"] if f["ot"] != 99999]
        for f in viejo["plansemanal"]:
            if f["ot"] == 15692:
                f["PRIORIDAD"] = "Urgente"      # las dos filas repetidas del 21/09
        c, plan3 = await correr(viejo)
        assert (c["OT de una semana que cambian (UPDATE)"],
                c["OT de una semana que ya no están en el Integral (DELETE)"]) == (1, 1)
        assert plan3[(LUNES, 15692)][1] == "Urgente" and (LUNES, 99999) not in plan3

        conn = await asyncpg.connect(url)
        try:
            with pytest.raises(asyncpg.CheckViolationError):
                await conn.execute("INSERT INTO plan_semanal (semana, numero_ot) VALUES ('2026-09-22', 1)")
            with pytest.raises(asyncpg.UniqueViolationError):
                await conn.execute("INSERT INTO plan_semanal (semana, numero_ot) VALUES ('2026-09-21', 15692)")
            # Borrar la OT suelta la FK y deja el número.
            await conn.execute("DELETE FROM orden_trabajo WHERE id = 12")
            filas = await conn.fetch("SELECT numero_ot, id_orden_trabajo FROM plan_semanal WHERE numero_ot = 14534")
            assert [tuple(f) for f in filas] == [(14534, None), (14534, None)]
        finally:
            await conn.close()
    finally:
        await motor.dispose()
