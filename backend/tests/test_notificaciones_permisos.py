"""
La campanita y los permisos (RF-24), contra la app real.

Revisión del 23/09. El mapa dejaba /notificaciones libre para leer y para escribir
(«cada uno la suya»), pero la campanita es UNA para todo el taller. Con el token de un
operario sin ningún permiso:
  · GET /notificaciones traía «Usuario 'x' (X Y) fue creado exitosamente», que sale de
    la sección confidencial «Usuarios y permisos»;
  · POST /notificaciones con {"id_usuario_creador": 1} dejaba un aviso firmado por Julián
    («Se cambió tu contraseña, entrá acá»);
  · DELETE /notificaciones vaciaba la campanita de todos.

Ahora: leer y marcar como leída, todos (menos los avisos de usuarios, que ve sólo quien
ve la sección); crear, quien edita personas en Recursos, firmado por la sesión y sólo
los avisos de la pantalla; borrar, sólo el admin.

Base: SQLite en memoria (el armado de test_permisos_api).
"""
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from backend.domain.Notificacion import Notificacion
from backend.domain.Permisos import UsuarioSeccion
from backend.presentation import NotificacionAPI
from backend.presentation.main import app
from backend.tests.test_permisos_api import (
    JULIAN,
    LUCAS,
    MATIAS,
    SOFIA,
    _base,
    _enchufar,
    _token,
)

ADMIN = _token(JULIAN)
SUPERVISOR = _token(SOFIA, "supervisor")
OPERARIO = _token(MATIAS, "operario")

DE_USUARIOS = "Usuario 'nuevo' (Nuevo Prueba) fue creado exitosamente"
DE_PERSONAS = "Recurso humano Juan actualizado a Activo"


@pytest_asyncio.fixture
async def cliente():
    engine, Sesion = await _base()
    _enchufar(app, Sesion)

    async def _db():
        async with Sesion() as s:
            yield s

    app.dependency_overrides[NotificacionAPI.get_db] = _db
    async with Sesion() as s:
        s.add_all([
            Notificacion(mensaje=DE_USUARIOS, tipo="usuario_created", leida=False,
                         id_usuario_creador=JULIAN),
            Notificacion(mensaje=DE_PERSONAS, tipo="operario_updated", leida=False,
                         id_usuario_creador=LUCAS),
        ])
        await s.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


async def _mensajes(c, headers):
    r = await c.get("/notificaciones", headers=headers)
    assert r.status_code == 200, r.text
    return [n["mensaje"] for n in r.json()["data"]]


async def _cuantas(c) -> int:
    async with c.sesiones() as s:
        return (await s.execute(select(func.count()).select_from(Notificacion))).scalar()


async def _id_de(c, tipo) -> int:
    async with c.sesiones() as s:
        return (await s.execute(select(Notificacion.id_notificacion)
                                .where(Notificacion.tipo == tipo))).scalar_one()


# ─────────────────────────── leer ───────────────────────────


async def test_los_avisos_de_usuarios_los_ve_solo_quien_ve_la_seccion(cliente):
    assert set(await _mensajes(cliente, ADMIN)) == {DE_USUARIOS, DE_PERSONAS}
    # El operario y el supervisor no tienen «Usuarios y permisos» (confidencial).
    assert await _mensajes(cliente, OPERARIO) == [DE_PERSONAS]
    assert await _mensajes(cliente, SUPERVISOR) == [DE_PERSONAS]

    # Se le abre la sección a Sofía, a ella sola: desde el pedido siguiente los ve.
    async with cliente.sesiones() as s:
        s.add(UsuarioSeccion(id_usuario=SOFIA, seccion_codigo="configuracion_usuarios",
                             nivel="read", otorgado_por=JULIAN, motivo="da de alta a la gente"))
        await s.commit()
    assert set(await _mensajes(cliente, SUPERVISOR)) == {DE_USUARIOS, DE_PERSONAS}
    assert await _mensajes(cliente, OPERARIO) == [DE_PERSONAS]


async def test_el_contador_y_la_lectura_por_id_tampoco_los_muestran(cliente):
    r = await cliente.get("/notificaciones/contador/no-leidas", headers=OPERARIO)
    assert r.json()["data"]["count"] == 1
    r = await cliente.get("/notificaciones/contador/no-leidas", headers=ADMIN)
    assert r.json()["data"]["count"] == 2

    oculto = await _id_de(cliente, "usuario_created")
    r = await cliente.get(f"/notificaciones/{oculto}", headers=OPERARIO)
    assert r.json()["status"] is False and DE_USUARIOS not in r.text
    r = await cliente.get(f"/notificaciones/{oculto}", headers=ADMIN)
    assert r.json()["data"]["mensaje"] == DE_USUARIOS


async def test_marcar_como_leidas_no_toca_lo_que_no_se_ve(cliente):
    """Leída es leída para todos: un operario no puede dejarle leído al admin un aviso
    que él ni ve."""
    oculto = await _id_de(cliente, "usuario_created")
    r = await cliente.put(f"/notificaciones/{oculto}/leida", headers=OPERARIO)
    assert r.json()["status"] is False

    r = await cliente.put("/notificaciones/leer-todas", headers=OPERARIO)
    assert r.status_code == 200 and r.json()["data"]["marcadas"] == 1

    r = await cliente.get("/notificaciones/contador/no-leidas", headers=ADMIN)
    assert r.json()["data"]["count"] == 1  # el de usuarios sigue sin leer para el admin
    r = await cliente.put("/notificaciones/leer-todas", headers=ADMIN)
    assert r.json()["data"]["marcadas"] == 1


# ─────────────────────────── crear ───────────────────────────


async def test_crear_un_aviso_pide_editar_personas(cliente):
    cuerpo = {"mensaje": "Recurso humano Pedro creado", "tipo": "operario_created"}
    for quien in (OPERARIO, SUPERVISOR):  # Recursos: none y read
        r = await cliente.post("/notificaciones", headers=quien, json=cuerpo)
        assert r.status_code == 403, r.text
    assert await _cuantas(cliente) == 2

    r = await cliente.post("/notificaciones", headers=ADMIN, json=cuerpo)
    assert r.status_code == 200, r.text


async def test_el_aviso_lo_firma_la_sesion_no_el_cuerpo(cliente):
    r = await cliente.post("/notificaciones", headers=_token(LUCAS), json={
        "mensaje": "Recurso humano Pedro creado", "tipo": "operario_created",
        "id_usuario_creador": JULIAN})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["id_usuario_creador"] == LUCAS


async def test_los_avisos_del_sistema_no_se_fabrican_a_mano(cliente):
    """Ni siquiera el admin: «Se cambió tu contraseña, entrá acá» con tipo de aviso de
    usuarios lo escribe sólo el ABM de usuarios."""
    for tipo in ("usuario_updated", "ot_retrasada", "WORK_ORDER_CREATED"):
        r = await cliente.post("/notificaciones", headers=ADMIN, json={
            "mensaje": "Se cambió tu contraseña, entrá acá", "tipo": tipo})
        assert r.status_code == 422, (tipo, r.text)
    assert await _cuantas(cliente) == 2


# ─────────────────────────── borrar ───────────────────────────


async def test_vaciar_o_borrar_avisos_es_solo_del_admin(cliente):
    un_id = await _id_de(cliente, "operario_updated")
    for quien in (OPERARIO, SUPERVISOR):
        r = await cliente.delete("/notificaciones", headers=quien)
        assert r.status_code == 403, r.text
        r = await cliente.delete(f"/notificaciones/{un_id}", headers=quien)
        assert r.status_code == 403, r.text
    assert await _cuantas(cliente) == 2

    r = await cliente.delete("/notificaciones", headers=ADMIN)
    assert r.status_code == 200 and r.json()["data"]["eliminadas"] == 2
    assert await _cuantas(cliente) == 0
