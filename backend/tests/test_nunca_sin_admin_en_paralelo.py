"""
«El sistema nunca queda sin admin», con pedidos que llegan a la vez (RF-24).

Revisión del 23/09. La regla cuenta los otros admins activos y después escribe, en
otra transacción y sin candado. Con dos admins (Julián y Lucas), a la vez:
    PUT /permisos/usuarios/2/rol {"rol": "operario"}   con el token de Julián
    PUT /permisos/usuarios/1/rol {"rol": "operario"}   con el token de Lucas
daba «200 200 | admins activos al final: 0». Lo mismo mezclando PUT /auth/usuarios
(rol o activo) con DELETE /auth/usuarios. Ahora esos cambios van de a uno
(reglas_de_roles.de_a_uno): el segundo lee y cuenta con lo del primero ya guardado.

En SQLite lo que los ordena es el candado de asyncio; en Postgres, además,
pg_advisory_xact_lock (entre instancias). Lo del Postgres se probó contra uno local
descartable, con el candado de asyncio apagado.
"""
import asyncio

from sqlalchemy import func, select

from backend.domain.Usuario import Usuario
from backend.tests.test_permisos_admin_api import cliente  # noqa: F401  (fixture)
from backend.tests.test_permisos_api import JULIAN, LUCAS, _token


async def _admins_activos(c) -> int:
    async with c.sesiones() as s:
        return (await s.execute(
            select(func.count()).select_from(Usuario)
            .where(Usuario.rol == "admin", Usuario.activo == True)  # noqa: E712
        )).scalar()


async def test_dos_admins_que_se_bajan_uno_al_otro_a_la_vez(cliente):
    a, b = await asyncio.gather(
        cliente.put(f"/permisos/usuarios/{LUCAS}/rol", headers=_token(JULIAN), json={"rol": "operario"}),
        cliente.put(f"/permisos/usuarios/{JULIAN}/rol", headers=_token(LUCAS), json={"rol": "operario"}),
    )
    assert await _admins_activos(cliente) == 1
    assert sorted([a.status_code, b.status_code]) == [200, 409], (a.text, b.text)
    perdio = a if a.status_code == 409 else b
    assert "único administrador activo" in perdio.json()["errors"][0]["message"]


async def test_desactivar_y_eliminar_a_la_vez_tampoco(cliente):
    a, b = await asyncio.gather(
        cliente.put(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN), json={"activo": False}),
        cliente.delete(f"/auth/usuarios/{JULIAN}", headers=_token(LUCAS)),
    )
    assert await _admins_activos(cliente) == 1
    # Uno pasa. El otro, 409 (la regla) o 401 (si cuando llegó su actor ya estaba dado de
    # baja): nunca los dos adentro.
    estados = sorted([a.status_code, b.status_code])
    assert estados[0] == 200 and estados[1] in (401, 409), (a.text, b.text)


async def test_por_los_dos_caminos_a_la_vez_tampoco(cliente):
    """La regla es la misma por /auth/usuarios y por /permisos: el candado también."""
    a, b = await asyncio.gather(
        cliente.put(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN), json={"rol": "supervisor"}),
        cliente.put(f"/permisos/usuarios/{JULIAN}/rol", headers=_token(LUCAS), json={"rol": "operario"}),
    )
    assert await _admins_activos(cliente) == 1
    assert sorted([a.status_code, b.status_code])[0] == 200, (a.text, b.text)
    assert sorted([a.status_code, b.status_code])[1] in (403, 409), (a.text, b.text)


async def test_uno_por_vez_sigue_andando(cliente):
    """El candado no traba el caso normal: bajar a uno con otro admin activo."""
    r = await cliente.put(f"/permisos/usuarios/{LUCAS}/rol", headers=_token(JULIAN), json={"rol": "operario"})
    assert r.status_code == 200, r.text
    # Y dejarlo con el rol que tenía no guarda nada ni deja el candado tomado.
    r = await cliente.put(f"/permisos/usuarios/{LUCAS}/rol", headers=_token(JULIAN), json={"rol": "operario"})
    assert r.status_code == 200, r.text
    r = await cliente.put(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN), json={"rol": "admin"})
    assert r.status_code == 200, r.text
    assert await _admins_activos(cliente) == 2
