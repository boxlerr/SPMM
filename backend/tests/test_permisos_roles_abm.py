"""
Crear, renombrar y borrar roles (RF-24): el ABM de roles de Don Joaquín
(crearRolAction, renombrarRolAction, eliminarRolAction), contra la app real.

Revisión del 23/09: SPMM tenía fijos los tres roles sembrados —POST /permisos/roles daba
404— aunque la ayuda y _orden_de_rol hablaban de «los que se creen».

Las reglas, las de DJ: un rol nuevo arranca sin ningún permiso; el código sale del
nombre y no cambia al renombrar; el Administrador no se renombra ni se borra; un rol con
gente no se borra. Y las de SPMM: dos roles no se llaman igual, y «con gente» incluye a
los que no tienen acceso (se les puede devolver, y tienen que volver con un rol que
exista).
"""
import re

import pytest
from sqlalchemy import select, update

from backend.core.permisos import codigo_para_rol
from backend.domain.Permisos import Rol, RolArea
from backend.domain.Usuario import Usuario
from backend.dto.UsuarioRequestDTO import _FORMA_DE_ROL
from backend.tests.test_permisos_admin_api import _ejecutar, _leer, _me, _msg, cliente  # noqa: F401
from backend.tests.test_permisos_api import ANA, JULIAN, MATIAS, SOFIA, _token

ADMIN = _token(JULIAN)


# ─────────────────────────── el código, sacado del nombre ───────────────────────────


@pytest.mark.parametrize("nombre, usados, codigo", [
    ("Pañol", set(), "panol"),
    ("Jefe de planta", set(), "jefe_de_planta"),
    ("  Control   de calidad!! ", set(), "control_de_calidad"),
    ("Pañol", {"panol"}, "panol_2"),
    ("Pañol", {"panol", "panol_2"}, "panol_3"),
    ("Admin", set(), "rol_admin"),
    ("ADMIN", set(), "rol_admin"),
    ("3er turno", set(), "rol_3er_turno"),
    ("Encargado de mantenimiento preventivo", set(), "encargado_de_manteni"),
    ("Encargado de mantenimiento preventivo", {"encargado_de_manteni"}, "encargado_de_mante_2"),
    ("Ñ", set(), "rol_n"),
    ("¿¿??", set(), "rol"),
])
def test_el_codigo_sale_del_nombre(nombre, usados, codigo):
    assert codigo_para_rol(nombre, usados) == codigo
    # Siempre con la forma que acepta el alta de usuarios (usuario.rol es VARCHAR(20)).
    assert _FORMA_DE_ROL.match(codigo)


# ─────────────────────────── crear ───────────────────────────


async def _matriz(c):
    r = await c.get("/permisos/matriz", headers=ADMIN)
    assert r.status_code == 200, r.text
    return {x["codigo"]: x for x in r.json()["data"]["roles"]}


async def test_crear_un_rol_arranca_sin_ningun_permiso(cliente):
    r = await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "Pañol"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["codigo"] == "panol"

    roles = await _matriz(cliente)
    assert roles["panol"]["nombre"] == "Pañol"
    assert set(roles["panol"]["areas"].values()) == {"none"}
    assert roles["panol"]["usuarios"] == 0
    assert (await cliente.get("/permisos/matriz", headers=ADMIN)).json()["data"]["abm_de_roles"] is True

    # Se le asigna a alguien, se le da un área, y vale desde el pedido siguiente.
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/rol", headers=ADMIN, json={"rol": "panol"})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, MATIAS, "panol"))["areas"]["operaciones"] == "none"
    r = await cliente.put("/permisos/roles/panol/areas/operaciones", headers=ADMIN, json={"nivel": "read"})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, MATIAS, "panol"))["areas"]["operaciones"] == "read"
    # Y el alta de usuarios lo acepta.
    r = await cliente.post("/auth/usuarios", headers=ADMIN, json={
        "username": "pedro", "email": "pedro@metlo.com.ar", "password": "123456",
        "nombre": "Pedro", "apellido": "Prueba", "rol": "panol"})
    assert r.status_code == 200, r.text


async def test_dos_roles_no_se_llaman_igual_y_el_codigo_no_se_repite(cliente):
    assert (await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "Pañol"})).status_code == 200
    r = await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "pañol"})
    assert r.status_code == 409 and "Ya hay un rol" in _msg(r)
    r = await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "Supervisor"})
    assert r.status_code == 409
    # Un nombre distinto que da el mismo código: otro código.
    r = await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "Panol"})
    assert r.status_code == 200 and r.json()["data"]["codigo"] == "panol_2"


async def test_un_codigo_que_tiene_alguien_no_se_reusa(cliente):
    """Un rol viejo borrado a mano que alguien todavía tiene: crear uno con ese nombre no
    le da sus permisos a esa persona sin que nadie lo decida."""
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == ANA).values(rol="jefe"))
    r = await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "Jefe"})
    assert r.status_code == 200 and r.json()["data"]["codigo"] == "jefe_2"


async def test_el_nombre_tiene_que_decir_algo(cliente):
    for nombre in ("", " ", "a"):
        r = await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": nombre})
        assert r.status_code == 400, nombre  # el formato de validación de la app


# ─────────────────────────── renombrar ───────────────────────────


async def test_renombrar_no_cambia_el_codigo(cliente):
    await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "Pañol"})
    await cliente.put(f"/permisos/usuarios/{MATIAS}/rol", headers=ADMIN, json={"rol": "panol"})
    r = await cliente.put("/permisos/roles/panol", headers=ADMIN, json={"nombre": "Pañol y depósito"})
    assert r.status_code == 200, r.text
    roles = await _matriz(cliente)
    assert roles["panol"]["nombre"] == "Pañol y depósito"
    rol_de_matias = (await _leer(cliente, select(Usuario.rol).where(Usuario.id_usuario == MATIAS)))[0][0]
    assert rol_de_matias == "panol"

    r = await cliente.put("/permisos/roles/panol", headers=ADMIN, json={"nombre": "Operario"})
    assert r.status_code == 409
    r = await cliente.put("/permisos/roles/admin", headers=ADMIN, json={"nombre": "Jefe"})
    assert r.status_code == 409 and "no se renombra" in _msg(r)
    assert (await cliente.put("/permisos/roles/noexiste", headers=ADMIN, json={"nombre": "X y"})).status_code == 404


# ─────────────────────────── borrar ───────────────────────────


async def test_un_rol_con_gente_no_se_borra_aunque_no_tengan_acceso(cliente):
    await cliente.post("/permisos/roles", headers=ADMIN, json={"nombre": "Pañol"})
    await cliente.put("/permisos/roles/panol/areas/planos", headers=ADMIN, json={"nivel": "read"})
    await cliente.put(f"/permisos/usuarios/{MATIAS}/rol", headers=ADMIN, json={"rol": "panol"})
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == ANA).values(rol="panol"))

    r = await cliente.delete("/permisos/roles/panol", headers=ADMIN)
    assert r.status_code == 409
    assert "2 personas (1 sin acceso)" in _msg(r)
    assert (await _matriz(cliente))["panol"]["usuarios"] == 2

    await cliente.put(f"/permisos/usuarios/{MATIAS}/rol", headers=ADMIN, json={"rol": "operario"})
    await cliente.put(f"/permisos/usuarios/{ANA}/rol", headers=ADMIN, json={"rol": "operario"})
    r = await cliente.delete("/permisos/roles/panol", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert "panol" not in await _matriz(cliente)
    assert await _leer(cliente, select(RolArea).where(RolArea.rol_codigo == "panol")) == []
    assert await _leer(cliente, select(Rol).where(Rol.codigo == "panol")) == []


async def test_los_sembrados_se_pueden_borrar_pero_el_administrador_no(cliente):
    r = await cliente.delete("/permisos/roles/admin", headers=ADMIN)
    assert r.status_code == 409 and "Administrador no se puede borrar" in _msg(r)
    # El Supervisor tiene a Sofía: primero hay que pasarla a otro rol.
    r = await cliente.delete("/permisos/roles/supervisor", headers=ADMIN)
    assert r.status_code == 409 and "1 persona." in _msg(r)
    assert (await cliente.delete("/permisos/roles/noexiste", headers=ADMIN)).status_code == 404


# ─────────────────────────── quién ───────────────────────────


async def test_el_abm_de_roles_es_del_admin(cliente):
    """Aunque se le abra «Usuarios y permisos» para ver, cambiar sigue siendo del admin."""
    from backend.domain.Permisos import UsuarioSeccion
    async with cliente.sesiones() as s:
        s.add(UsuarioSeccion(id_usuario=SOFIA, seccion_codigo="configuracion_usuarios", nivel="read",
                             otorgado_por=JULIAN, motivo="mira la lista"))
        await s.commit()
    sofia = _token(SOFIA, "supervisor")
    assert (await cliente.get("/permisos/matriz", headers=sofia)).status_code == 200
    assert (await cliente.post("/permisos/roles", headers=sofia, json={"nombre": "Pañol"})).status_code == 403
    assert (await cliente.put("/permisos/roles/operario", headers=sofia, json={"nombre": "Op"})).status_code == 403
    assert (await cliente.delete("/permisos/roles/operario", headers=sofia)).status_code == 403
    assert not re.search("panol", str(await _matriz(cliente)))
