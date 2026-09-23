"""
Quién administra usuarios y permisos: como en Don Joaquín (RF-24).

Revisión del 23/09. En DJ la gestión es sólo de los administradores permanentes
(requireDueño: «ni siquiera otro admin la maneja») y el rol Administrador no se da nunca
desde la pantalla («solo a mano en la base de datos»). En SPMM cualquier admin
administraba y cualquiera podía crear admins nuevos.

Ahora es lo de DJ, con una condición: que haya al menos un permanente marcado (la marca
se pone a mano en la base; ninguna migración la prende). Hasta entonces, como hoy:
administra cualquier admin y el rol Administrador se puede dar —si no, el día del deploy
nadie podría dar de alta a nadie—.
"""
from sqlalchemy import select, update

from backend.domain.Usuario import Usuario
from backend.tests.test_permisos_admin_api import _ejecutar, _leer, _msg, cliente  # noqa: F401
from backend.tests.test_permisos_api import CLAVE, JULIAN, LUCAS, MATIAS, SOFIA, _token

DUENO = _token(JULIAN)
OTRO_ADMIN = _token(LUCAS)


def _alta(username, rol):
    return {"username": username, "email": f"{username}@metlo.com.ar", "password": "123456",
            "nombre": username.title(), "apellido": "Prueba", "rol": rol}


async def _marcar_dueno(c, *ids):
    await _ejecutar(c, update(Usuario).where(Usuario.id_usuario.in_(ids)).values(admin_permanente=True))


async def _gestiona(c, token) -> bool:
    r = await c.get("/auth/me", headers=token)
    assert r.status_code == 200, r.text
    return r.json()["data"]["permisos"]["gestiona_usuarios"]


async def test_sin_duenos_marcados_administra_cualquier_admin_como_hoy(cliente):
    """Producción el día del deploy: todos admin, nadie marcado."""
    assert await _gestiona(cliente, OTRO_ADMIN) is True
    r = await cliente.post("/auth/usuarios", headers=OTRO_ADMIN, json=_alta("pedro", "operario"))
    assert r.status_code == 200, r.text
    # Y el rol Administrador se sigue pudiendo dar (lo que manda el front de antes).
    r = await cliente.post("/auth/usuarios", headers=OTRO_ADMIN, json=_alta("pablo", "admin"))
    assert r.status_code == 200, r.text
    m = (await cliente.get("/permisos/matriz", headers=OTRO_ADMIN)).json()["data"]
    assert m["admin_asignable"] is True


async def test_con_duenos_marcados_solo_ellos_administran(cliente):
    await _marcar_dueno(cliente, JULIAN)
    assert await _gestiona(cliente, DUENO) is True
    assert await _gestiona(cliente, OTRO_ADMIN) is False

    # Lucas sigue siendo admin en todo lo demás (ve la lista y la matriz)...
    assert (await cliente.get("/auth/usuarios", headers=OTRO_ADMIN)).status_code == 200
    assert (await cliente.get("/permisos/matriz", headers=OTRO_ADMIN)).status_code == 200
    # ...pero no cambia nada de usuarios ni de permisos, por ningún camino.
    intentos = [
        ("POST", "/auth/usuarios", _alta("pedro", "operario")),
        ("PUT", f"/auth/usuarios/{MATIAS}", {"nombre": "Otro"}),
        ("DELETE", f"/auth/usuarios/{MATIAS}", None),
        ("POST", f"/auth/usuarios/{MATIAS}/desbloquear", None),
        ("PUT", f"/permisos/usuarios/{MATIAS}/rol", {"rol": "supervisor"}),
        ("PUT", "/permisos/roles/operario/areas/clientes", {"nivel": "read"}),
        ("POST", "/permisos/roles", {"nombre": "Pañol"}),
        ("PUT", f"/permisos/usuarios/{SOFIA}/areas/clientes", {"nivel": "write"}),
    ]
    for metodo, ruta, cuerpo in intentos:
        r = await cliente.request(metodo, ruta, headers=OTRO_ADMIN, json=cuerpo)
        assert r.status_code == 403, (metodo, ruta, r.text)
        assert "administradores permanentes" in _msg(r)

    # El dueño, sí.
    for metodo, ruta, cuerpo in intentos[:1] + intentos[4:6]:
        r = await cliente.request(metodo, ruta, headers=DUENO, json=cuerpo)
        assert r.status_code == 200, (metodo, ruta, r.text)


async def test_con_duenos_marcados_el_rol_administrador_se_da_a_mano(cliente):
    await _marcar_dueno(cliente, JULIAN)
    m = (await cliente.get("/permisos/matriz", headers=DUENO)).json()["data"]
    assert m["admin_asignable"] is False

    r = await cliente.post("/auth/usuarios", headers=DUENO, json=_alta("pedro", "admin"))
    assert r.status_code == 400 and "a mano en la base" in _msg(r)
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/rol", headers=DUENO, json={"rol": "admin"})
    assert r.status_code == 400 and "a mano en la base" in _msg(r)
    r = await cliente.put(f"/auth/usuarios/{SOFIA}", headers=DUENO, json={"rol": "admin"})
    assert r.status_code == 400
    rol = await _leer(cliente, select(Usuario.rol).where(Usuario.id_usuario.in_([MATIAS, SOFIA])))
    assert "admin" not in {x[0] for x in rol}

    # Bajar a un admin que no es permanente sí (como DJ); volver a subirlo, ya no.
    r = await cliente.put(f"/permisos/usuarios/{LUCAS}/rol", headers=DUENO, json={"rol": "supervisor"})
    assert r.status_code == 200, r.text
    # Y editarle los datos a un admin con su mismo rol sigue andando (no se «asigna» nada).
    r = await cliente.put(f"/auth/usuarios/{JULIAN}", headers=DUENO, json={"nombre": "Julián", "rol": "admin"})
    assert r.status_code == 200, r.text


async def test_el_login_dice_si_administra(cliente):
    await _marcar_dueno(cliente, JULIAN)
    for username, esperado in (("julian", True), ("lucas", False), ("sofia", False)):
        r = await cliente.post("/auth/login", json={"username": username, "password": CLAVE})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["permisos"]["gestiona_usuarios"] is esperado, username
