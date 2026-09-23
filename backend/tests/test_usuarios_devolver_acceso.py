"""
Devolverle el acceso a alguien (RF-24, la pantalla «Usuarios y permisos»).

Revisión del 23/09. «Eliminar» desactiva (soft delete: activo = false) y la persona
salía de la lista, que traía sólo a los activos. La pantalla nueva había perdido además
el Activo/Inactivo del formulario viejo: quien se eliminaba por error quedaba afuera
para siempre salvo tocando la base, y su usuario seguía tomado (no se lo podía volver a
dar de alta). En Don Joaquín es setUsuarioEstadoAction.

Ahora la lista trae también a los que no tienen acceso si se le pide
(?incluir_inactivos=true, lo que pide la pantalla nueva; sin el parámetro, como
siempre) y PUT /auth/usuarios/{id} {"activo": true} se lo devuelve.
"""
from backend.tests.test_permisos_admin_api import cliente  # noqa: F401  (fixture)
from backend.tests.test_permisos_api import ANA, CLAVE, JULIAN, MATIAS, SOFIA, _token

ADMIN = _token(JULIAN)


async def _lista(c, **params):
    r = await c.get("/auth/usuarios", headers=ADMIN, params=params)
    assert r.status_code == 200, r.text
    return {u["username"]: u for u in r.json()["data"]}


async def _entra(c, username) -> int:
    r = await c.post("/auth/login", json={"username": username, "password": CLAVE})
    return r.status_code


async def test_la_lista_trae_a_los_que_no_tienen_acceso_solo_si_se_piden(cliente):
    assert "ana" not in await _lista(cliente)  # lo de siempre (el front de antes)
    todos = await _lista(cliente, incluir_inactivos="true")
    assert todos["ana"]["activo"] is False
    assert todos["matias"]["activo"] is True


async def test_eliminar_por_error_y_devolverle_el_acceso(cliente):
    r = await cliente.delete(f"/auth/usuarios/{MATIAS}", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert await _entra(cliente, "matias") == 401
    assert (await _lista(cliente, incluir_inactivos="true"))["matias"]["activo"] is False

    r = await cliente.put(f"/auth/usuarios/{MATIAS}", headers=ADMIN, json={"activo": True})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["activo"] is True
    assert await _entra(cliente, "matias") == 200
    # Vuelve con su rol de antes.
    assert (await _lista(cliente))["matias"]["rol"] == "operario"


async def test_una_cuenta_que_estaba_inactiva_vuelve_a_entrar(cliente):
    assert await _entra(cliente, "ana") == 401
    r = await cliente.put(f"/auth/usuarios/{ANA}", headers=ADMIN, json={"activo": True})
    assert r.status_code == 200, r.text
    assert await _entra(cliente, "ana") == 200


async def test_devolver_el_acceso_es_del_admin(cliente):
    r = await cliente.put(f"/auth/usuarios/{ANA}", headers=_token(SOFIA, "supervisor"),
                          json={"activo": True})
    assert r.status_code == 403
    assert await _entra(cliente, "ana") == 401


async def test_si_el_aviso_no_se_puede_guardar_el_cambio_contesta_bien(cliente, monkeypatch):
    """El alta y la edición dejan un aviso en la campanita. Si guardarlo falla, su
    rollback expiraba el usuario recién guardado y la respuesta reventaba (500, con el
    cambio ya hecho): se vio al devolver el acceso con dos pedidos a la vez."""
    from backend.application.NotificacionService import NotificacionService

    async def falla(self, dto):
        await self.repository.db.rollback()
        raise RuntimeError("la campanita no anda")

    monkeypatch.setattr(NotificacionService, "crearNotificacion", falla)
    r = await cliente.put(f"/auth/usuarios/{ANA}", headers=ADMIN, json={"activo": True})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["activo"] is True
    r = await cliente.post("/auth/usuarios", headers=ADMIN, json={
        "username": "pedro", "email": "pedro@metlo.com.ar", "password": "123456",
        "nombre": "Pedro", "apellido": "Prueba", "rol": "operario"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["username"] == "pedro"
