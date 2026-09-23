"""RF-25: la búsqueda de Auditoría se hace en el servidor, de a páginas, con fechas.

Hasta el 23/09 la pantalla traía los últimos 300 movimientos y filtraba en el
navegador: lo que alguien hizo hace un mes no aparecía aunque estuviera guardado, y no
había filtro de fechas. Estos tests arman un registro más grande que eso y exigen que
se llegue a cualquier fila: por página, por fecha, por persona, por texto.

También la «Actividad por persona»: cada usuario con su último ingreso y, en el
período, cuántas veces entró, cuántas acciones hizo y cuántos intentos fallidos tuvo.

Las mismas consultas corrieron contra un Postgres 16 descartable con 60.000 filas
antes del commit (SQLite no reproduce los errores de dialecto): ver el mensaje.
"""
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.security import get_current_user
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.Usuario import Usuario
from backend.infrastructure.db import Base
from backend.presentation import AuditoriaAPI

HOY = datetime(2026, 9, 23, 10, 0)


def _mov(cuando, *, id_usuario=None, usuario=None, accion="editó", entidad="orden de trabajo",
         id_entidad=None, descripcion=None, estado=200, detalle='{"datos": 1}'):
    return AuditoriaMovimiento(
        creado_en=cuando, id_usuario=id_usuario, usuario=usuario, accion=accion,
        entidad=entidad, id_entidad=id_entidad,
        descripcion=descripcion or f"{usuario or 'alguien'} {accion} {entidad}",
        metodo="PUT", ruta="/x", estado=estado, duracion_ms=5, detalle=detalle,
    )


def _registro() -> list[AuditoriaMovimiento]:
    """450 movimientos: 400 de Julián en los últimos 40 días (10 por día) —más que los
    300 de antes—, uno viejo de Matías con un texto único, y los ingresos de Lucas."""
    filas = []
    for dia in range(40):
        for h in range(10):
            filas.append(_mov(HOY - timedelta(days=dia, hours=h), id_usuario=1,
                              usuario="Julián Boxler", id_entidad=str(1000 + dia),
                              descripcion=f"Julián Boxler editó orden de trabajo #{1000 + dia}"))
    # Hace 80 días: con los 300 de antes, no aparecía nunca.
    filas.append(_mov(HOY - timedelta(days=80), id_usuario=4, usuario="Matías Gómez",
                      accion="eliminó", entidad="máquina", id_entidad="12",
                      descripcion="Matías Gómez eliminó máquina #12 — FRESADORA CNC"))
    # Las dos puntas de un día: 23:59 del 10/09 entra en «hasta el 10/09»; 00:00 del 11 no.
    filas.append(_mov(datetime(2026, 9, 10, 23, 59), id_usuario=4, usuario="Matías Gómez",
                      descripcion="Matías Gómez editó al filo del día"))
    filas.append(_mov(datetime(2026, 9, 11, 0, 0), id_usuario=4, usuario="Matías Gómez",
                      descripcion="Matías Gómez editó al arrancar el día"))
    # Lucas: entra, le fallan intentos (sin autor: van a su cuenta), lo bloquean y lo
    # desbloquea Julián.
    filas += [
        _mov(HOY - timedelta(days=2), accion="intento fallido", entidad="sesión", id_entidad="2",
             estado=401, descripcion="Intento fallido de entrar como «lucas» (Lucas Longchamps)"),
        _mov(HOY - timedelta(days=2, minutes=-1), accion="bloqueó", entidad="usuario",
             id_entidad="2", estado=None, descripcion="Se bloqueó el usuario lucas"),
        _mov(HOY - timedelta(days=2, minutes=-5), id_usuario=1, usuario="Julián Boxler",
             accion="desbloqueó", entidad="usuario", id_entidad="2",
             descripcion="Julián Boxler desbloqueó la cuenta de «lucas»"),
        _mov(HOY - timedelta(days=1), id_usuario=2, usuario="Lucas Longchamps", accion="ingresó",
             entidad="sesión", id_entidad="2", descripcion="Lucas Longchamps entró al sistema"),
        _mov(HOY - timedelta(days=1, minutes=-30), id_usuario=2, usuario="Lucas Longchamps",
             accion="creó", entidad="cliente", descripcion="Lucas Longchamps creó cliente — 50%_OFF"),
        _mov(HOY - timedelta(days=1, minutes=-40), id_usuario=2, usuario="Lucas Longchamps",
             accion="editó", entidad="cliente", id_entidad="9", estado=409,
             descripcion="Lucas Longchamps editó cliente #9 (no se pudo: error 409)"),
        _mov(HOY - timedelta(days=60), id_usuario=2, usuario="Lucas Longchamps", accion="ingresó",
             entidad="sesión", id_entidad="2", descripcion="Lucas Longchamps entró al sistema"),
        # Un error del sistema al entrar no es un intento fallido de nadie.
        _mov(HOY - timedelta(days=3), accion="intento fallido", entidad="sesión", id_entidad="2",
             estado=503, descripcion="Intento fallido de entrar como «lucas»: error del sistema"),
        # Alguien probando con un usuario que no existe.
        _mov(HOY - timedelta(days=4), accion="intento fallido", entidad="sesión", estado=401,
             descripcion="Intento fallido de entrar con un usuario que no existe («adm…»)"),
        # Un movimiento sin persona (el /planificar viejo, sin token).
        _mov(HOY - timedelta(days=5), accion="creó", entidad="planificación",
             descripcion="alguien creó planificación"),
    ]
    return filas


@pytest_asyncio.fixture
async def cliente():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=[Usuario.__table__, AuditoriaMovimiento.__table__]))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        s.add_all(_registro())
        s.add_all([
            Usuario(id_usuario=1, username="julian", email="j@x.com", password_hash="x",
                    nombre="Julián", apellido="Boxler", rol="admin", activo=True),
            Usuario(id_usuario=2, username="lucas", email="l@x.com", password_hash="x",
                    nombre="Lucas", apellido="Longchamps", rol="admin", activo=True),
            # Nunca entró desde que se registran los ingresos: su último ingreso sale de
            # la ficha, que se guardaba en UTC (utcnow) -> 3 horas menos.
            Usuario(id_usuario=5, username="sofia", email="s@x.com", password_hash="x",
                    nombre="Sofía", apellido="Ruiz", rol="supervisor", activo=True,
                    ultimo_login=datetime(2026, 9, 1, 15, 30)),
            # Sin acceso y sin nada en el período: no aparece en la actividad.
            Usuario(id_usuario=6, username="viejo", email="v@x.com", password_hash="x",
                    nombre="Ex", apellido="Empleado", rol="operario", activo=False),
        ])
        await s.commit()

    async def _db():
        async with Sesion() as s:
            yield s

    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(AuditoriaAPI.router)
    app.dependency_overrides[AuditoriaAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: {"id_usuario": 1, "username": "julian"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c
    await engine.dispose()


async def _pedir(cliente, **params):
    r = await cliente.get("/auditoria/movimientos", params=params)
    assert r.status_code == 200, r.text
    return r.json()


TOTAL = len(_registro())


# ─────────────────────────── la pantalla de antes sigue andando ───────────────────────────

async def test_sin_parametros_contesta_como_antes(cliente):
    """El front que está en producción pide `?limite=300` y lee estas claves."""
    j = await _pedir(cliente, limite=300)
    assert len(j["movimientos"]) == 300
    assert j["tope"] == 300
    assert {"entidades", "usuarios"} <= set(j)
    assert "Julián Boxler" in j["usuarios"]
    fechas = [m["cuando"] for m in j["movimientos"]]
    assert fechas == sorted(fechas, reverse=True)
    # Y lo nuevo, que el front nuevo usa para saber que el backend ya busca solo.
    assert j["total"] == TOTAL and j["hay_mas"] is True


# ─────────────────────────── llegar a cualquier fila ───────────────────────────

async def test_las_paginas_recorren_todo_sin_repetir_ni_saltear(cliente):
    vistos = []
    desplazamiento = 0
    while True:
        j = await _pedir(cliente, limite=100, desplazamiento=desplazamiento, opciones="false")
        assert j["total"] == TOTAL
        assert "entidades" not in j  # opciones=false: al pasar de página no se repiten
        vistos += [m["id"] for m in j["movimientos"]]
        if not j["hay_mas"]:
            break
        desplazamiento += 100
    assert len(vistos) == TOTAL == len(set(vistos))


async def test_lo_de_hace_80_dias_aparece_aunque_haya_mas_de_300_despues(cliente):
    j = await _pedir(cliente, buscar="fresadora", opciones="false")
    assert j["total"] == 1
    assert j["movimientos"][0]["descripcion"].endswith("FRESADORA CNC")


async def test_el_rango_de_fechas_incluye_los_dos_dias_enteros(cliente):
    j = await _pedir(cliente, desde="2026-09-10", hasta="2026-09-10", usuario="Matías Gómez",
                     opciones="false")
    assert [m["descripcion"] for m in j["movimientos"]] == ["Matías Gómez editó al filo del día"]

    j = await _pedir(cliente, desde="2026-09-11", hasta="2026-09-11", usuario="Matías Gómez",
                     opciones="false")
    assert [m["descripcion"] for m in j["movimientos"]] == ["Matías Gómez editó al arrancar el día"]

    # Un día de Julián: sus 10 del día y nada más.
    j = await _pedir(cliente, desde="2026-09-20", hasta="2026-09-20", id_usuario=1, opciones="false")
    assert j["total"] == 10
    assert all(m["cuando"].startswith("2026-09-20") for m in j["movimientos"])


async def test_desde_despues_de_hasta_se_rechaza_con_un_mensaje(cliente):
    r = await cliente.get("/auditoria/movimientos", params={"desde": "2026-09-20", "hasta": "2026-09-01"})
    assert r.status_code == 400
    assert "posterior" in r.text


# ─────────────────────────── los filtros ───────────────────────────

async def test_por_persona_trae_lo_que_hizo_y_lo_que_le_paso_a_su_cuenta(cliente):
    j = await _pedir(cliente, id_usuario=2, limite=50, opciones="false")
    acciones = sorted(m["accion"] for m in j["movimientos"])
    # Lo suyo (2 ingresos, creó, editó) + lo de su cuenta sin autor o de otro autor
    # (2 intentos fallidos, el bloqueo y el desbloqueo que hizo Julián).
    assert acciones == sorted(["ingresó", "ingresó", "creó", "editó", "intento fallido",
                               "intento fallido", "bloqueó", "desbloqueó"])
    # Lo que Julián hizo sobre OTRAS cosas no entra por tener id_entidad "2"… nunca.
    assert all(m["accion"] != "editó" or m["id_usuario"] == 2 for m in j["movimientos"])


async def test_la_vista_ingresos_y_los_fallidos(cliente):
    j = await _pedir(cliente, tipo="ingresos", limite=50, opciones="false")
    assert {m["accion"] for m in j["movimientos"]} == {"ingresó", "intento fallido", "bloqueó",
                                                         "desbloqueó"}
    assert j["total"] == 7
    j = await _pedir(cliente, tipo="ingresos", solo_fallidos="true", opciones="false")
    assert {m["accion"] for m in j["movimientos"]} == {"intento fallido"}
    assert j["total"] == 3


async def test_varias_acciones_juntas(cliente):
    j = await _pedir(cliente, accion="bloqueó,desbloqueó", opciones="false")
    assert sorted(m["accion"] for m in j["movimientos"]) == ["bloqueó", "desbloqueó"]


async def test_buscar_un_comodin_lo_busca_como_letra(cliente):
    """«50%_» no puede ser «cualquier cosa»: se busca tal cual."""
    j = await _pedir(cliente, buscar="50%_", opciones="false")
    assert [m["descripcion"] for m in j["movimientos"]] == ["Lucas Longchamps creó cliente — 50%_OFF"]
    j = await _pedir(cliente, buscar="%", opciones="false")
    assert j["total"] == 1


async def test_buscar_un_numero_encuentra_la_cosa(cliente):
    j = await _pedir(cliente, buscar="1005", opciones="false")
    assert j["total"] == 10 and all(m["id_entidad"] == "1005" for m in j["movimientos"])


async def test_los_desplegables_traen_a_cada_persona_con_su_nombre_de_hoy(cliente):
    j = await _pedir(cliente, limite=1)
    personas = {p["id_usuario"]: p for p in j["personas"]}
    assert personas[2]["nombre"] == "Lucas Longchamps" and personas[2]["username"] == "lucas"
    assert personas[4]["nombre"] == "Matías Gómez"  # sólo en el registro, no en `usuario`
    assert personas[5]["nombre"] == "Sofía Ruiz"  # sin nada en el registro, igual se elige


# ─────────────────────────── exportar ───────────────────────────

async def test_exportar_trae_todo_lo_filtrado_sin_el_detalle(cliente):
    j = await _pedir(cliente, limite=10_000, con_detalle="false", opciones="false")
    assert len(j["movimientos"]) == TOTAL and j["hay_mas"] is False
    assert all(m["detalle"] is None for m in j["movimientos"])
    assert j["tope_exportar"] == AuditoriaAPI.TOPE_EXPORTAR


async def test_el_tope_de_exportar_se_respeta(cliente):
    r = await cliente.get("/auditoria/movimientos", params={"limite": AuditoriaAPI.TOPE_EXPORTAR + 1})
    assert r.status_code in (400, 422)


# ─────────────────────────── actividad por persona ───────────────────────────

async def test_actividad_por_persona_en_el_periodo(cliente):
    r = await cliente.get("/auditoria/actividad", params={"desde": "2026-09-14", "hasta": "2026-09-23"})
    assert r.status_code == 200, r.text
    j = r.json()
    p = {x["id_usuario"]: x for x in j["personas"]}

    # Julián: 10 por día en los 10 días del período + el desbloqueo (que es una acción).
    assert p[1]["acciones"] == 101 and p[1]["ingresos"] == 0
    # Lucas: entró 1 vez en el período (la de hace 60 días no cuenta), hizo 2 cosas, una
    # no se pudo; su cuenta tuvo 1 intento fallido (el 503 no es suyo) y 1 bloqueo.
    assert (p[2]["ingresos"], p[2]["acciones"], p[2]["acciones_fallidas"]) == (1, 2, 1)
    assert (p[2]["intentos_fallidos"], p[2]["bloqueos"]) == (1, 1)
    assert p[2]["ultimo_ingreso"].startswith((HOY - timedelta(days=1)).date().isoformat())
    assert p[2]["ultimo_ingreso_de_la_ficha"] is False
    # Sofía: nada en el registro; su último ingreso sale de la ficha, pasado a hora local.
    assert p[5]["acciones"] == 0
    assert p[5]["ultimo_ingreso"] == "2026-09-01T12:30:00"
    assert p[5]["ultimo_ingreso_de_la_ficha"] is True
    # Sin acceso y sin nada en el período: no aparece.
    assert 6 not in p
    # Matías no hizo nada en el período y no está en `usuario`: no aparece.
    assert 4 not in p

    assert j["intentos_sin_cuenta"] == 1
    assert j["acciones_sin_persona"] == 1
    # Ordenada por lo que más hizo.
    assert j["personas"][0]["id_usuario"] == 1


async def test_actividad_desde_siempre(cliente):
    j = (await cliente.get("/auditoria/actividad")).json()
    p = {x["id_usuario"]: x for x in j["personas"]}
    assert p[2]["ingresos"] == 2
    assert p[4]["acciones"] == 3 and p[4]["nombre"] == "Matías Gómez"
    assert p[1]["acciones"] == 401


async def test_actividad_con_fechas_al_reves_se_rechaza(cliente):
    r = await cliente.get("/auditoria/actividad", params={"desde": "2026-09-20", "hasta": "2026-09-01"})
    assert r.status_code == 400
