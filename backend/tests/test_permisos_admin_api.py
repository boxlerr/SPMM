"""
RF-24: la administración de permisos (PermisosAPI) y la lista de usuarios, contra la
app real, con una SQLite en memoria.

- Leer la matriz y los permisos de la gente es la sección confidencial «Usuarios y
  permisos»; cambiar algo es sólo del rol admin, mirado en la base.
- Las reglas de DJ: el rol admin no se configura; lo del rol en una sección no
  confidencial sólo restringe; los permisos de más suman, vencen y tienen que dar algo.
- Las de SPMM: nadie se da permisos a sí mismo ni se cambia el rol; a un administrador
  permanente no se le cambia el rol; nivel admin en Configuración es sólo del rol admin;
  sacarle la marca de confidencial a algo avisa quiénes lo pasarían a ver.
- La escalada de privilegios, por todos los caminos que hay.
- Todo queda en la auditoría, con quién le dio qué a quién y qué había antes.
"""
import json
from datetime import timedelta

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import insert, select, update

from backend.core.security import get_sesiones_permisos
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.Permisos import RolArea, RolSeccion, SeccionPermiso, UsuarioArea, UsuarioSeccion
from backend.domain.Usuario import Usuario
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.infrastructure.db import Base
from backend.presentation import AuthAPI, PermisosAPI, main
from backend.presentation.main import app
from backend.tests.test_permisos_api import ANA, JULIAN, LUCAS, MATIAS, SOFIA, _base, _token


@pytest_asyncio.fixture
async def cliente():
    engine, Sesion = await _base()
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=[AuditoriaMovimiento.__table__]))

    async def _db():
        async with Sesion() as s:
            yield s

    app.dependency_overrides[AuthAPI.get_db] = _db
    app.dependency_overrides[PermisosAPI.get_db] = _db
    app.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


def _msg(r) -> str:
    return r.json()["errors"][0]["message"]


async def _ejecutar(c, *sentencias):
    async with c.sesiones() as s:
        for sentencia in sentencias:
            await s.execute(sentencia)
        await s.commit()


async def _leer(c, consulta):
    async with c.sesiones() as s:
        return (await s.execute(consulta)).all()


async def _me(c, quien, rol):
    r = await c.get("/auth/me", headers=_token(quien, rol))
    assert r.status_code == 200, r.text
    return r.json()["data"]["permisos"]


ADMIN = _token(JULIAN)


# ─────────────────────────── leer ───────────────────────────


async def test_el_catalogo_lo_ve_cualquiera_con_cuenta_activa(cliente):
    r = await cliente.get("/permisos/catalogo", headers=_token(MATIAS, "operario"))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["niveles"] == ["none", "read", "write", "admin"]
    assert [a["codigo"] for a in data["areas"]][:2] == ["dashboard", "operaciones"]
    dashboard = data["areas"][0]["secciones"]
    assert dashboard == [{"codigo": "dashboard_rendimiento", "nombre": "Rendimiento por persona",
                          "orden": 10, "confidencial": True, "confidencial_por_defecto": True}]
    assert (await cliente.get("/permisos/catalogo", headers=_token(ANA, "operario"))).status_code == 401


async def test_la_matriz_la_ve_el_admin_y_otro_solo_si_se_la_dan(cliente):
    r = await cliente.get("/permisos/matriz", headers=ADMIN)
    assert r.status_code == 200, r.text
    roles = {x["codigo"]: x for x in r.json()["data"]["roles"]}
    assert list(roles) == ["admin", "supervisor", "operario"]
    assert set(roles["admin"]["areas"].values()) == {"admin"}
    assert roles["operario"]["secciones"] == {"operaciones_planificador": "none"}
    assert roles["operario"]["secciones_efectivas"]["operaciones_planificador"] == "none"
    assert roles["operario"]["secciones_efectivas"]["operaciones_ordenes"] == "read"
    assert roles["supervisor"]["secciones_efectivas"]["dashboard_rendimiento"] == "none"
    # Ana está inactiva: no cuenta.
    assert (roles["admin"]["usuarios_activos"], roles["supervisor"]["usuarios_activos"],
            roles["operario"]["usuarios_activos"]) == (2, 1, 1)

    for quien, rol in ((SOFIA, "supervisor"), (MATIAS, "operario")):
        for ruta in ("/permisos/matriz", "/permisos/overrides", f"/permisos/usuarios/{MATIAS}"):
            r = await cliente.get(ruta, headers=_token(quien, rol))
            assert r.status_code == 403, (rol, ruta)
            assert "«Usuarios y permisos»" in _msg(r)

    # Se le da la sección a Sofía, a ella sola: lee, pero no cambia nada.
    await _ejecutar(cliente, insert(UsuarioSeccion).values(
        id_usuario=SOFIA, seccion_codigo="configuracion_usuarios", nivel="read",
        otorgado_por=JULIAN, creado_en=ahora_ar()))
    assert (await cliente.get("/permisos/matriz", headers=_token(SOFIA, "supervisor"))).status_code == 200
    r = await cliente.put("/permisos/roles/operario/areas/clientes", headers=_token(SOFIA, "supervisor"),
                          json={"nivel": "read"})
    assert r.status_code == 403


async def test_la_lista_de_usuarios_es_la_seccion_confidencial(cliente):
    sofia = _token(SOFIA, "supervisor")
    assert (await cliente.get("/auth/usuarios", headers=sofia)).status_code == 403
    # Lo suyo lo ve siempre (es lo mismo que le da /auth/me); lo de otro, no.
    assert (await cliente.get(f"/auth/usuarios/{SOFIA}", headers=sofia)).status_code == 200
    assert (await cliente.get(f"/auth/usuarios/{MATIAS}", headers=sofia)).status_code == 403
    await _ejecutar(cliente, insert(UsuarioSeccion).values(
        id_usuario=SOFIA, seccion_codigo="configuracion_usuarios", nivel="read", creado_en=ahora_ar()))
    assert (await cliente.get("/auth/usuarios", headers=sofia)).status_code == 200
    assert (await cliente.get(f"/auth/usuarios/{MATIAS}", headers=sofia)).status_code == 200
    # Ver no es cambiar.
    r = await cliente.put(f"/auth/usuarios/{MATIAS}", headers=sofia, json={"nombre": "Otro"})
    assert r.status_code == 403
    assert (await cliente.get("/auth/usuarios", headers=ADMIN)).status_code == 200


async def test_la_lista_dice_quien_es_administrador_permanente(cliente):
    """El candado del selector de rol en la pantalla (DJ admins-permanentes.ts) sale de
    acá, para no preguntar persona por persona. La migración no prende a nadie."""
    r = await cliente.get("/auth/usuarios", headers=ADMIN)
    assert r.status_code == 200, r.text
    marcas = {u["id_usuario"]: u["admin_permanente"] for u in r.json()["data"]}
    assert marcas and set(marcas.values()) == {False}
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == LUCAS)
                    .values(admin_permanente=True))
    r = await cliente.get("/auth/usuarios", headers=ADMIN)
    marcas = {u["id_usuario"]: u["admin_permanente"] for u in r.json()["data"]}
    assert marcas[LUCAS] is True
    assert [i for i, m in marcas.items() if m] == [LUCAS]
    # Quien sólo ve la lista (sección otorgada) también ve el candado: es información,
    # no un permiso.
    await _ejecutar(cliente, insert(UsuarioSeccion).values(
        id_usuario=SOFIA, seccion_codigo="configuracion_usuarios", nivel="read", creado_en=ahora_ar()))
    r = await cliente.get("/auth/usuarios", headers=_token(SOFIA, "supervisor"))
    assert r.status_code == 200
    assert {u["id_usuario"]: u["admin_permanente"] for u in r.json()["data"]}[LUCAS] is True


# ─────────────────────────── la matriz ───────────────────────────


async def test_cambiar_el_nivel_de_un_rol_vale_desde_el_pedido_siguiente(cliente):
    assert (await _me(cliente, MATIAS, "operario"))["areas"]["clientes"] == "none"
    r = await cliente.put("/permisos/roles/operario/areas/clientes", headers=ADMIN, json={"nivel": "read"})
    assert r.status_code == 200, r.text
    assert r.json()["data"] == {"rol": "operario", "area": "clientes", "nivel": "read", "antes": "none"}
    assert (await _me(cliente, MATIAS, "operario"))["areas"]["clientes"] == "read"
    # Otra vez lo mismo: no cambia nada y contesta bien.
    r = await cliente.put("/permisos/roles/operario/areas/clientes", headers=ADMIN, json={"nivel": "read"})
    assert r.status_code == 200 and r.json()["data"]["antes"] == "read"


async def test_el_rol_admin_no_se_toca_y_los_codigos_se_validan(cliente):
    r = await cliente.put("/permisos/roles/admin/areas/clientes", headers=ADMIN, json={"nivel": "read"})
    assert r.status_code == 409 and "admin en todo por regla" in _msg(r)
    r = await cliente.put("/permisos/roles/admin/secciones/dashboard_rendimiento", headers=ADMIN,
                          json={"nivel": "none"})
    assert r.status_code == 409
    assert (await cliente.put("/permisos/roles/jefe/areas/clientes", headers=ADMIN,
                              json={"nivel": "read"})).status_code == 404
    assert (await cliente.put("/permisos/roles/operario/areas/inventada", headers=ADMIN,
                              json={"nivel": "read"})).status_code == 404
    assert (await cliente.put("/permisos/roles/operario/secciones/inventada", headers=ADMIN,
                              json={"nivel": "read"})).status_code == 404
    assert (await cliente.put("/permisos/roles/operario/areas/clientes", headers=ADMIN,
                              json={"nivel": "mucho"})).status_code == 400


async def test_nivel_admin_en_configuracion_es_solo_del_rol_admin(cliente):
    """Quien puede tocar permisos se hace admin solo: ni por rol ni por persona."""
    for ruta, cuerpo in (
        ("/permisos/roles/supervisor/areas/configuracion", {"nivel": "admin"}),
        ("/permisos/roles/supervisor/secciones/configuracion_usuarios", {"nivel": "write"}),
        (f"/permisos/usuarios/{SOFIA}/areas/configuracion", {"nivel": "admin"}),
        (f"/permisos/usuarios/{SOFIA}/secciones/configuracion_usuarios", {"nivel": "write"}),
    ):
        r = await cliente.put(ruta, headers=ADMIN, json=cuerpo)
        assert r.status_code == 409, ruta
        assert "sólo del rol Administrador" in _msg(r)
    # Hasta ahí sí: Configuración en editar, y ver la lista de usuarios.
    assert (await cliente.put("/permisos/roles/supervisor/areas/configuracion", headers=ADMIN,
                              json={"nivel": "write"})).status_code == 200
    assert (await cliente.put("/permisos/roles/supervisor/secciones/configuracion_usuarios",
                              headers=ADMIN, json={"nivel": "read"})).status_code == 200
    assert (await cliente.get("/auth/usuarios", headers=_token(SOFIA, "supervisor"))).status_code == 200


async def test_la_seccion_del_rol_solo_restringe_si_no_es_confidencial(cliente):
    # El operario ve Operaciones en «ver»: igualarlo o superarlo en una solapa no existe.
    for nivel in ("read", "write"):
        r = await cliente.put("/permisos/roles/operario/secciones/operaciones_ordenes",
                              headers=ADMIN, json={"nivel": nivel})
        assert r.status_code == 409, nivel
        assert "Hereda del área" in _msg(r)
    r = await cliente.put("/permisos/roles/operario/secciones/operaciones_ordenes",
                          headers=ADMIN, json={"nivel": "none"})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, MATIAS, "operario"))["secciones"]["operaciones_ordenes"] == "none"
    # «hereda» saca la restricción: vuelve a lo del área.
    r = await cliente.put("/permisos/roles/operario/secciones/operaciones_planificador",
                          headers=ADMIN, json={"nivel": "hereda"})
    assert r.status_code == 200 and r.json()["data"] == {
        "rol": "operario", "seccion": "operaciones_planificador", "nivel": "hereda", "antes": "none"}
    assert (await _me(cliente, MATIAS, "operario"))["secciones"]["operaciones_planificador"] == "read"
    # En una confidencial, lo del rol es lo que la abre.
    r = await cliente.put("/permisos/roles/supervisor/secciones/dashboard_rendimiento",
                          headers=ADMIN, json={"nivel": "read"})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, SOFIA, "supervisor"))["secciones"]["dashboard_rendimiento"] == "read"
    assert (await _me(cliente, MATIAS, "operario"))["secciones"]["dashboard_rendimiento"] == "none"


async def test_sacarle_la_marca_de_confidencial_avisa_quienes_la_verian(cliente):
    ruta = "/permisos/secciones/dashboard_rendimiento/confidencial"
    r = await cliente.put(ruta, headers=ADMIN, json={"confidencial": False})
    assert r.status_code == 409
    assert "Supervisor (1 persona)" in _msg(r) and "Operario (1 persona)" in _msg(r)
    assert (await _me(cliente, MATIAS, "operario"))["secciones"]["dashboard_rendimiento"] == "none"
    # «Igual».
    r = await cliente.put(ruta + "?forzar=true", headers=ADMIN, json={"confidencial": False})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, MATIAS, "operario"))["secciones"]["dashboard_rendimiento"] == "read"
    # Volver a marcarla no avisa nada: cierra.
    r = await cliente.put(ruta, headers=ADMIN, json={"confidencial": True})
    assert r.status_code == 200
    assert (await _me(cliente, MATIAS, "operario"))["secciones"]["dashboard_rendimiento"] == "none"

    # Marcar una que no era confidencial la cierra para el que la veía por el área, y
    # desmarcarla se la devolvería: avisa.
    ruta = "/permisos/secciones/recursos_rangos/confidencial"
    assert (await cliente.put(ruta, headers=ADMIN, json={"confidencial": True})).status_code == 200
    assert (await _me(cliente, SOFIA, "supervisor"))["secciones"]["recursos_rangos"] == "none"
    r = await cliente.put(ruta, headers=ADMIN, json={"confidencial": False})
    assert r.status_code == 409 and "Supervisor (1 persona)" in _msg(r)
    assert "Operario" not in _msg(r)  # el operario no tiene Recursos: no gana nada
    # Si no gana nadie (auditoría: nadie más que el admin tiene el área), no avisa.
    await _ejecutar(cliente, update(SeccionPermiso)
                    .where(SeccionPermiso.codigo == "auditoria_movimientos").values(confidencial=True))
    r = await cliente.put("/permisos/secciones/auditoria_movimientos/confidencial", headers=ADMIN,
                          json={"confidencial": False})
    assert r.status_code == 200, r.text


# ─────────────────────────── permisos de más de una persona ───────────────────────────


async def test_un_permiso_de_mas_con_vencimiento_motivo_y_quien_lo_dio(cliente):
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=ADMIN, json={
        # Como lo manda un navegador: con la Z de UTC. Se guarda en hora del taller.
        "nivel": "write", "vence_en": "2099-01-01T15:00:00.000Z", "motivo": "  cubre a Sofía  "})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["vence_en"] == "2099-01-01T12:00:00"
    assert data["motivo"] == "cubre a Sofía"
    assert data["efectivos"]["areas"]["clientes"] == "write"

    r = await cliente.get(f"/permisos/usuarios/{MATIAS}", headers=ADMIN)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["usuario"]["rol"] == "operario"
    [permiso] = data["areas"]
    assert (permiso["codigo"], permiso["nivel"], permiso["vigente"], permiso["otorgado_por"],
            permiso["otorgado_por_nombre"], permiso["motivo"]) == \
        ("clientes", "write", True, JULIAN, "Julian Prueba", "cubre a Sofía")
    assert data["efectivos"]["areas"]["clientes"] == "write"
    # Suma: lo que ya tenía por el rol sigue.
    assert data["efectivos"]["areas"]["operaciones"] == "read"

    # Una sección confidencial a él solo, sin vencimiento.
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/secciones/dashboard_rendimiento",
                          headers=ADMIN, json={"nivel": "read"})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, MATIAS, "operario"))["secciones"]["dashboard_rendimiento"] == "read"
    assert (await _me(cliente, SOFIA, "supervisor"))["secciones"]["dashboard_rendimiento"] == "none"

    # La lista de todos.
    r = await cliente.get("/permisos/overrides", headers=ADMIN)
    assert [(p["id_usuario"], p["codigo"]) for p in r.json()["data"]["areas"]] == [(MATIAS, "clientes")]
    assert [(p["id_usuario"], p["codigo"]) for p in r.json()["data"]["secciones"]] == \
        [(MATIAS, "dashboard_rendimiento")]


async def test_un_permiso_de_mas_vencido_se_ve_y_no_cuenta(cliente):
    await _ejecutar(cliente, insert(UsuarioArea).values(
        id_usuario=MATIAS, area_codigo="clientes", nivel="write", otorgado_por=JULIAN,
        vence_en=ahora_ar() - timedelta(hours=1), creado_en=ahora_ar() - timedelta(days=3)))
    data = (await cliente.get(f"/permisos/usuarios/{MATIAS}", headers=ADMIN)).json()["data"]
    assert data["areas"][0]["vigente"] is False
    assert data["efectivos"]["areas"]["clientes"] == "none"
    # Se lo renueva: la misma fila, que vuelve a contar.
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=ADMIN,
                          json={"nivel": "read"})
    assert r.status_code == 200 and r.json()["data"]["antes"]["nivel"] == "write"
    assert (await _me(cliente, MATIAS, "operario"))["areas"]["clientes"] == "read"
    assert len(await _leer(cliente, select(UsuarioArea.id))) == 1


async def test_lo_que_no_se_puede_dar(cliente):
    casos = [
        (f"/permisos/usuarios/{MATIAS}/areas/clientes", {"nivel": "none"}, 400, "quitar"),
        (f"/permisos/usuarios/{MATIAS}/areas/clientes",
         {"nivel": "read", "vence_en": (ahora_ar() - timedelta(minutes=5)).isoformat()}, 400, "ya pasó"),
        (f"/permisos/usuarios/{LUCAS}/areas/clientes", {"nivel": "read"}, 409, "ya puede todo"),
        (f"/permisos/usuarios/{JULIAN}/areas/clientes", {"nivel": "read"}, 409, "a vos mismo"),
        ("/permisos/usuarios/999/areas/clientes", {"nivel": "read"}, 404, "#999"),
        (f"/permisos/usuarios/{MATIAS}/secciones/inventada", {"nivel": "read"}, 404, "inventada"),
    ]
    for ruta, cuerpo, codigo, texto in casos:
        r = await cliente.put(ruta, headers=ADMIN, json=cuerpo)
        assert r.status_code == codigo, (ruta, cuerpo, r.text)
        assert texto in _msg(r), (ruta, _msg(r))
    assert not await _leer(cliente, select(UsuarioArea.id))


async def test_sacar_un_permiso_de_mas(cliente):
    await cliente.put(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=ADMIN, json={"nivel": "write"})
    r = await cliente.delete(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["antes"]["nivel"] == "write"
    assert r.json()["data"]["efectivos"]["areas"]["clientes"] == "none"
    # Otra vez: no había nada, contesta bien (la pantalla que revierte no falla).
    r = await cliente.delete(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=ADMIN)
    assert r.status_code == 200 and r.json()["data"]["antes"] is None


# ─────────────────────────── el rol ───────────────────────────


async def test_cambiar_el_rol_de_una_persona(cliente):
    token_matias = _token(MATIAS, "operario")
    assert (await _me(cliente, MATIAS, "operario"))["areas"]["clientes"] == "none"
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/rol", headers=ADMIN, json={"rol": "Supervisor"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["rol"] == "supervisor" and r.json()["data"]["antes"] == "operario"
    # Vale con el token que ya tenía.
    r = await cliente.get("/auth/me", headers=token_matias)
    assert r.json()["data"]["rol"] == "supervisor"
    assert r.json()["data"]["permisos"]["areas"]["clientes"] == "read"

    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/rol", headers=ADMIN, json={"rol": "jefe"})
    assert r.status_code == 400 and "no existe" in _msg(r)
    r = await cliente.put(f"/permisos/usuarios/{JULIAN}/rol", headers=ADMIN, json={"rol": "operario"})
    assert r.status_code == 409 and "tu propio rol" in _msg(r)


async def test_a_un_admin_permanente_no_se_le_cambia_el_rol_por_ningun_camino(cliente):
    # Los dos son dueños: con permanentes marcados, sólo ellos administran (DJ), así que
    # quien actúa también tiene que serlo para que la regla que se prueba sea ésta.
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario.in_([JULIAN, LUCAS]))
                    .values(admin_permanente=True))
    r = await cliente.put(f"/permisos/usuarios/{LUCAS}/rol", headers=ADMIN, json={"rol": "supervisor"})
    assert r.status_code == 409 and "administrador permanente" in _msg(r)
    r = await cliente.put(f"/auth/usuarios/{LUCAS}", headers=ADMIN, json={"rol": "supervisor"})
    assert r.status_code == 409 and "administrador permanente" in _msg(r)
    assert (await _leer(cliente, select(Usuario.rol).where(Usuario.id_usuario == LUCAS)))[0][0] == "admin"


# ─────────────────────────── escalada de privilegios ───────────────────────────


async def test_un_no_admin_no_puede_darse_nada_por_ningun_camino(cliente):
    """Sofía (supervisora) intenta subirse por todos los caminos que hay. Aun con
    permisos metidos a mano en la base que le dieran «admin» en Configuración y la
    sección de usuarios, y con un token que dice admin: cambiar es del ROL admin, mirado
    en la base."""
    await _ejecutar(
        cliente,
        update(RolArea).where(RolArea.rol_codigo == "supervisor", RolArea.area_codigo == "configuracion")
        .values(nivel="admin"),
        insert(UsuarioSeccion).values(id_usuario=SOFIA, seccion_codigo="configuracion_usuarios",
                                      nivel="admin", creado_en=ahora_ar()),
    )
    for token in (_token(SOFIA, "supervisor"), _token(SOFIA, "admin")):
        intentos = [
            ("PUT", f"/permisos/usuarios/{SOFIA}/areas/auditoria", {"nivel": "admin"}),
            ("PUT", f"/permisos/usuarios/{SOFIA}/secciones/dashboard_rendimiento", {"nivel": "read"}),
            ("PUT", f"/permisos/usuarios/{SOFIA}/rol", {"rol": "admin"}),
            ("PUT", f"/permisos/usuarios/{MATIAS}/rol", {"rol": "admin"}),
            ("PUT", "/permisos/roles/supervisor/areas/auditoria", {"nivel": "write"}),
            ("PUT", "/permisos/roles/supervisor/secciones/dashboard_rendimiento", {"nivel": "read"}),
            ("PUT", "/permisos/secciones/dashboard_rendimiento/confidencial?forzar=true",
             {"confidencial": False}),
            ("DELETE", f"/permisos/usuarios/{MATIAS}/areas/clientes", None),
            ("POST", "/auth/usuarios", {"username": "sofia2", "email": "s2@metlo.com.ar",
                                        "password": "123456", "nombre": "S", "apellido": "P",
                                        "rol": "admin"}),
            ("PUT", f"/auth/usuarios/{SOFIA}", {"rol": "admin"}),
            ("DELETE", f"/auth/usuarios/{JULIAN}", None),
        ]
        for metodo, ruta, cuerpo in intentos:
            r = await cliente.request(metodo, ruta, headers=token, json=cuerpo)
            assert r.status_code == 403, (metodo, ruta, r.status_code, r.text)

    # No cambió nada.
    assert (await _leer(cliente, select(Usuario.rol).where(Usuario.id_usuario == SOFIA)))[0][0] == "supervisor"
    assert (await _leer(cliente, select(Usuario.username).where(Usuario.username == "sofia2"))) == []
    assert not await _leer(cliente, select(UsuarioArea.id))
    assert (await _leer(cliente, select(RolArea.nivel).where(
        RolArea.rol_codigo == "supervisor", RolArea.area_codigo == "auditoria")))[0][0] == "none"
    assert not await _leer(cliente, select(RolSeccion).where(RolSeccion.rol_codigo == "supervisor"))
    # Lo que sí le dieron (leer la lista) lo puede usar.
    assert (await cliente.get("/permisos/matriz", headers=_token(SOFIA, "supervisor"))).status_code == 200


# ─────────────────────────── auditoría ───────────────────────────


async def test_la_auditoria_dice_quien_le_dio_que_a_quien_y_que_habia_antes(cliente, monkeypatch):
    monkeypatch.setattr(main, "SessionLocal", cliente.sesiones)

    await cliente.put(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=ADMIN,
                      json={"nivel": "write", "motivo": "cubre a Sofía"})
    await cliente.put(f"/permisos/usuarios/{MATIAS}/areas/clientes", headers=ADMIN,
                      json={"nivel": "read", "vence_en": "2099-03-01T10:00:00"})
    await cliente.put("/permisos/roles/operario/areas/auditoria", headers=ADMIN, json={"nivel": "read"})
    await cliente.put(f"/permisos/usuarios/{SOFIA}/rol", headers=_token(SOFIA, "supervisor"),
                      json={"rol": "admin"})

    filas = [f for (f,) in await _leer(cliente, select(AuditoriaMovimiento).order_by(AuditoriaMovimiento.id))]
    frases = [f.descripcion for f in filas]
    assert frases == [
        "Julian Prueba le dio a Matias Prueba «Clientes» para editar, sin vencimiento — cubre a Sofía",
        "Julian Prueba le dio a Matias Prueba «Clientes» para ver, hasta el 01/03/2099 10:00",
        "Julian Prueba cambió el permiso del rol «Operario» en «Auditoría»: sin acceso → ver",
        f"Sofia Prueba editó permisos › de una persona #{SOFIA} (no se pudo: error 403)",
    ]
    primero, segundo = (json.loads(f.detalle) for f in filas[:2])
    assert primero["antes"] is None
    assert primero["despues"]["nivel"] == "write" and primero["despues"]["otorgado_por"] == JULIAN
    assert segundo["antes"]["nivel"] == "write" and segundo["antes"]["motivo"] == "cubre a Sofía"
    assert segundo["despues"]["vence_en"] == "2099-03-01T10:00:00"
    assert all(f.id_usuario == JULIAN for f in filas[:3]) and filas[3].id_usuario == SOFIA
