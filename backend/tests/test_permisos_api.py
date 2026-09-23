"""
RF-24: los permisos por rol, área y sección, contra la app real de FastAPI.

Lo primero es lo que no se puede romper con el deploy: HOY TODOS LOS USUARIOS SON
ADMIN, y tienen que seguir entrando y viendo todo — con la migración aplicada y
también si la migración todavía no corrió (backend nuevo, base vieja).

Después, las dependencias (core/security.py) sobre una app de juguete: que el nivel
salga del rol, de las secciones y de lo que se le dio a la persona; que se resuelva
contra la base EN CADA PEDIDO (no se le cree al token); y que ante la duda cierren.

Y al final las reglas duras del ABM de usuarios: el rol tiene que existir, nadie se
cambia el rol a sí mismo, un administrador permanente no se baja, y el sistema no se
queda nunca sin un admin.

Base: SQLite en memoria. Nada de esto toca Supabase: el conftest bloquea la fábrica de
sesiones de producción y acá se pisa con la de cada test.
"""
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import APIRouter, Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import MetaData, Table, select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.permisos import AREAS, MATRIZ_ROL_AREA, SECCIONES
from backend.core.security import (
    create_access_token,
    get_current_user,
    get_password_hash,
    get_sesiones_permisos,
    require_admin,
    require_area,
    require_area_segun_metodo,
    require_seccion,
)
from backend.domain.Notificacion import Notificacion
from backend.domain.Permisos import TABLAS_DE_PERMISOS, UsuarioArea, UsuarioSeccion
from backend.domain.Usuario import Usuario
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.infrastructure.db import Base
from backend.presentation import AuthAPI
from backend.presentation.main import app
from backend.tests.test_permisos_migracion import sembrar_permisos

CLAVE = "unaclavecualquiera"

JULIAN, LUCAS, SOFIA, MATIAS, ANA = 1, 2, 3, 4, 5
PERSONAS = [
    # id, username, rol, activo
    (JULIAN, "julian", "admin", True),
    (LUCAS, "lucas", "admin", True),
    (SOFIA, "sofia", "supervisor", True),
    (MATIAS, "matias", "operario", True),
    (ANA, "ana", "operario", False),
]


# ─────────────────────────── armado ───────────────────────────


async def _base(con_permisos: bool = True, con_admin_permanente: bool = True,
                con_pantalla_inicio: bool | None = None):
    """Una base en memoria. `con_permisos=False` y `con_admin_permanente=False` es la
    base de producción ANTES de la migración: sin tablas de permisos y sin la columna.

    `con_pantalla_inicio=False` es la base sin la migración de la pantalla de inicio
    (RF-28): usuario y rol sin `pantalla_inicio`. Por defecto sigue a
    `con_admin_permanente`: la base de antes de las migraciones no tiene ninguna de las
    dos columnas."""
    if con_pantalla_inicio is None:
        con_pantalla_inicio = con_admin_permanente
    sin = set()
    if not con_admin_permanente:
        sin.add("admin_permanente")
    if not con_pantalla_inicio:
        sin.add("pantalla_inicio")

    def _sin_columnas(tabla):
        md = MetaData()
        Table(tabla.name, md, *[col._copy() for col in tabla.columns if col.name not in sin])
        return md

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        # El ABM de usuarios deja una notificación; sin la tabla, su rollback expira el
        # usuario recién guardado y el endpoint revienta por otra cosa.
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Notificacion.__table__]))
        if not sin:
            await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Usuario.__table__]))
        else:
            await conn.run_sync(_sin_columnas(Usuario.__table__).create_all)
        if con_permisos:
            if con_pantalla_inicio:
                await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLAS_DE_PERMISOS))
            else:
                from backend.domain.Permisos import Rol
                await conn.run_sync(_sin_columnas(Rol.__table__).create_all)
                await conn.run_sync(lambda c: Base.metadata.create_all(
                    c, tables=[t for t in TABLAS_DE_PERMISOS if t.name != "rol"]))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        for id_, username, rol, activo in PERSONAS:
            s.add(Usuario(id_usuario=id_, username=username, email=f"{username}@metlo.com.ar",
                          password_hash=get_password_hash(CLAVE), nombre=username.title(),
                          apellido="Prueba", rol=rol, activo=activo))
        await s.commit()
        if con_permisos:
            await sembrar_permisos(s)
    return engine, Sesion


def _enchufar(aplicacion, Sesion):
    async def _db():
        async with Sesion() as s:
            yield s
    aplicacion.dependency_overrides[AuthAPI.get_db] = _db
    aplicacion.dependency_overrides[get_sesiones_permisos] = lambda: Sesion


@pytest_asyncio.fixture
async def cliente():
    engine, Sesion = await _base()
    _enchufar(app, Sesion)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest_asyncio.fixture
async def cliente_sin_migracion():
    """Backend nuevo contra la base de hoy: la migración de permisos no corrió."""
    engine, Sesion = await _base(con_permisos=False, con_admin_permanente=False)
    _enchufar(app, Sesion)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


def _juguete() -> FastAPI:
    """Una app con cada tipo de dependencia colgada, como las va a colgar main.py."""
    j = FastAPI()
    registrar_exception_handlers(j)

    @j.get("/op", dependencies=[Depends(require_area("operaciones"))])
    async def ver_op():
        return {"ok": True}

    @j.post("/op", dependencies=[Depends(require_area("operaciones", "write"))])
    async def tocar_op():
        return {"ok": True}

    @j.get("/rendimiento", dependencies=[Depends(require_seccion("dashboard_rendimiento"))])
    async def rendimiento():
        return {"ok": True}

    @j.get("/planificador", dependencies=[Depends(require_seccion("operaciones_planificador"))])
    async def planificador():
        return {"ok": True}

    @j.get("/solo-admin")
    async def solo_admin(u: dict = Depends(require_admin)):
        return {"rol": u["rol"]}

    clientes = APIRouter()

    @clientes.get("/clientes")
    async def listar():
        return {"ok": True}

    @clientes.post("/clientes")
    async def crear():
        return {"ok": True}

    catalogo = APIRouter()

    @catalogo.get("/maquinas")
    async def maquinas():
        return {"ok": True}

    @catalogo.delete("/maquinas/1")
    async def borrar_maquina():
        return {"ok": True}

    j.include_router(clientes, dependencies=[
        Depends(get_current_user), Depends(require_area_segun_metodo("clientes"))])
    j.include_router(catalogo, dependencies=[
        Depends(get_current_user),
        Depends(require_area_segun_metodo("recursos", lectura_libre=True))])
    return j


@pytest_asyncio.fixture
async def juguete():
    engine, Sesion = await _base()
    j = _juguete()
    j.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    async with AsyncClient(transport=ASGITransport(app=j), base_url="http://test") as c:
        c.sesiones = Sesion
        c.app = j
        yield c
    await engine.dispose()


def _token(id_usuario: int, rol: str = "admin") -> dict:
    username = next(u for i, u, _, _ in PERSONAS if i == id_usuario) if id_usuario <= 5 else "x"
    tok = create_access_token({"sub": username, "id_usuario": id_usuario, "rol": rol,
                               "nombre": username.title(), "apellido": "Prueba"})
    return {"Authorization": f"Bearer {tok}"}


def _msg(r) -> str:
    return r.json()["errors"][0]["message"]


async def _login(c, username):
    return await c.post("/auth/login", json={"username": username, "password": CLAVE})


async def _ejecutar(c, sentencia):
    async with c.sesiones() as s:
        await s.execute(sentencia)
        await s.commit()


# ─────────────────────── el deploy: los admins de hoy siguen viendo todo ───────────────────────

TODO_ADMIN_AREAS = {a.codigo: "admin" for a in AREAS}
TODO_ADMIN_SECCIONES = {s.codigo: "admin" for s in SECCIONES}

# Lo que el front de hoy lee de la respuesta del login. No puede faltar nada.
CLAVES_DEL_LOGIN = {
    "id_usuario", "username", "email", "nombre", "apellido", "rol", "activo",
    "debe_cambiar_password", "access_token", "token_type", "expires_in",
}


async def test_el_login_de_un_admin_trae_todo_y_lo_de_siempre(cliente):
    r = await _login(cliente, "julian")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert CLAVES_DEL_LOGIN <= set(data)
    assert data["rol"] == "admin"
    p = data["permisos"]
    assert p["es_admin"] is True and p["rol"] == "admin"
    assert p["areas"] == TODO_ADMIN_AREAS
    assert p["secciones"] == TODO_ADMIN_SECCIONES
    assert p["admin_permanente"] is False  # la migración no prende a nadie


async def test_auth_me_de_un_admin_trae_todo(cliente):
    r = await cliente.get("/auth/me", headers=_token(JULIAN))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["username"] == "julian" and data["apellido"] == "Prueba"
    assert data["permisos"]["areas"] == TODO_ADMIN_AREAS
    assert data["permisos"]["secciones"] == TODO_ADMIN_SECCIONES


async def test_sin_la_migracion_los_admins_entran_y_ven_todo(cliente_sin_migracion):
    """Backend nuevo, base vieja: ni tablas de permisos ni la columna admin_permanente."""
    c = cliente_sin_migracion
    r = await _login(c, "julian")
    assert r.status_code == 200, r.text
    p = r.json()["data"]["permisos"]
    assert p["areas"] == TODO_ADMIN_AREAS and p["secciones"] == TODO_ADMIN_SECCIONES
    assert p["admin_permanente"] is None  # «no se sabe», sin romper nada

    r = await c.get("/auth/me", headers=_token(JULIAN))
    assert r.status_code == 200, r.text
    assert r.json()["data"]["permisos"]["areas"] == TODO_ADMIN_AREAS

    # La gestión de usuarios sigue andando, incluida el alta (el INSERT no puede nombrar
    # la columna que falta).
    r = await c.get("/auth/usuarios", headers=_token(JULIAN))
    assert r.status_code == 200, r.text
    # El candado de la pantalla: «no se sabe» (None) para todos, sin romper la lista.
    assert {u["admin_permanente"] for u in r.json()["data"]} == {None}
    r = await c.post("/auth/usuarios", headers=_token(JULIAN), json={
        "username": "nuevo", "email": "nuevo@metlo.com.ar", "password": "123456",
        "nombre": "Nuevo", "apellido": "Prueba", "rol": "admin"})
    assert r.status_code == 200, r.text
    r = await c.put(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN),
                    json={"nombre": "Lucas", "rol": "admin", "activo": True})
    assert r.status_code == 200, r.text


async def test_sin_la_migracion_no_se_puede_asignar_otro_rol(cliente_sin_migracion):
    r = await cliente_sin_migracion.post("/auth/usuarios", headers=_token(JULIAN), json={
        "username": "nuevo", "email": "nuevo@metlo.com.ar", "password": "123456",
        "nombre": "Nuevo", "apellido": "Prueba", "rol": "operario"})
    assert r.status_code == 400
    assert "falta que se actualice la base" in _msg(r)


async def test_sin_la_migracion_un_no_admin_entra_igual_y_sin_permisos_en_la_respuesta(
    cliente_sin_migracion,
):
    """Si los permisos no se pueden leer, el login no se cae: la clave no viene y el
    front hace lo de siempre, mientras la API cuida cada pedido."""
    r = await _login(cliente_sin_migracion, "matias")
    assert r.status_code == 200, r.text
    assert "permisos" not in r.json()["data"]
    assert CLAVES_DEL_LOGIN <= set(r.json()["data"])
    # Y la API no abre nada que no pueda verificar.
    r = await cliente_sin_migracion.get("/auth/me", headers=_token(MATIAS, "operario"))
    assert r.status_code == 503
    assert "No se pudieron verificar tus permisos" in _msg(r)


# ─────────────────────────── /auth/me de alguien que no es admin ───────────────────────────


async def test_auth_me_de_un_operario_es_la_matriz(cliente):
    r = await cliente.get("/auth/me", headers=_token(MATIAS, "operario"))
    assert r.status_code == 200, r.text
    p = r.json()["data"]["permisos"]
    assert p["es_admin"] is False and p["rol"] == "operario"
    assert p["areas"] == MATRIZ_ROL_AREA["operario"]
    assert p["secciones"]["operaciones_ordenes"] == "read"
    assert p["secciones"]["operaciones_planificador"] == "none"  # el override de rol
    assert p["secciones"]["configuracion_usuarios"] == "none"  # confidencial
    assert p["secciones"]["dashboard_rendimiento"] == "none"  # confidencial
    assert p["secciones"]["recursos_humano"] == "none"  # hereda recursos: none


async def test_auth_me_dice_el_rol_de_la_base_no_el_del_token(cliente):
    r = await cliente.get("/auth/me", headers=_token(MATIAS, "admin"))
    assert r.status_code == 200
    assert r.json()["data"]["rol"] == "operario"
    assert r.json()["data"]["permisos"]["es_admin"] is False


async def test_el_login_de_un_supervisor_trae_su_matriz(cliente):
    r = await _login(cliente, "sofia")
    assert r.status_code == 200, r.text
    p = r.json()["data"]["permisos"]
    assert p["areas"] == MATRIZ_ROL_AREA["supervisor"]
    assert p["secciones"]["operaciones_planificador"] == "write"


async def test_una_cuenta_desactivada_pierde_el_acceso_aunque_tenga_token(cliente):
    r = await cliente.get("/auth/me", headers=_token(ANA, "operario"))
    assert r.status_code == 401


# ─────────────────────────── las dependencias ───────────────────────────


async def test_require_area_por_nivel(juguete):
    assert (await juguete.get("/op", headers=_token(MATIAS, "operario"))).status_code == 200
    r = await juguete.post("/op", headers=_token(MATIAS, "operario"))
    assert r.status_code == 403
    assert _msg(r) == "No tenés permiso para modificar «Operaciones»."
    assert (await juguete.post("/op", headers=_token(SOFIA, "supervisor"))).status_code == 200
    assert (await juguete.post("/op", headers=_token(JULIAN))).status_code == 200


async def test_require_seccion_confidencial_cerrada_salvo_otorgamiento(juguete):
    for quien, rol in ((MATIAS, "operario"), (SOFIA, "supervisor")):
        r = await juguete.get("/rendimiento", headers=_token(quien, rol))
        assert r.status_code == 403
        assert "Rendimiento por persona" in _msg(r)
    assert (await juguete.get("/rendimiento", headers=_token(JULIAN))).status_code == 200

    # Se le otorga a Sofía, a ella sola: vale desde el pedido siguiente, con el mismo token.
    async with juguete.sesiones() as s:
        s.add(UsuarioSeccion(id_usuario=SOFIA, seccion_codigo="dashboard_rendimiento",
                             nivel="read", otorgado_por=JULIAN, motivo="lo pidió Lucas"))
        await s.commit()
    assert (await juguete.get("/rendimiento", headers=_token(SOFIA, "supervisor"))).status_code == 200
    assert (await juguete.get("/rendimiento", headers=_token(MATIAS, "operario"))).status_code == 403


async def test_un_permiso_vencido_no_cuenta_y_uno_vigente_si(juguete):
    async with juguete.sesiones() as s:
        s.add(UsuarioSeccion(id_usuario=SOFIA, seccion_codigo="dashboard_rendimiento",
                             nivel="read", vence_en=ahora_ar() - timedelta(minutes=1)))
        await s.commit()
    assert (await juguete.get("/rendimiento", headers=_token(SOFIA, "supervisor"))).status_code == 403
    await _ejecutar(juguete, update(UsuarioSeccion).values(vence_en=ahora_ar() + timedelta(days=1)))
    assert (await juguete.get("/rendimiento", headers=_token(SOFIA, "supervisor"))).status_code == 200


async def test_el_override_de_rol_restringe_una_seccion(juguete):
    """El operario ve Operaciones pero no el planificador (rol_seccion)."""
    assert (await juguete.get("/op", headers=_token(MATIAS, "operario"))).status_code == 200
    assert (await juguete.get("/planificador", headers=_token(MATIAS, "operario"))).status_code == 403
    assert (await juguete.get("/planificador", headers=_token(SOFIA, "supervisor"))).status_code == 200


async def test_segun_metodo_lee_con_read_y_escribe_con_write(juguete):
    # clientes: supervisor read, operario none.
    assert (await juguete.get("/clientes", headers=_token(SOFIA, "supervisor"))).status_code == 200
    r = await juguete.post("/clientes", headers=_token(SOFIA, "supervisor"))
    assert r.status_code == 403 and _msg(r) == "No tenés permiso para modificar «Clientes»."
    r = await juguete.get("/clientes", headers=_token(MATIAS, "operario"))
    assert r.status_code == 403 and _msg(r) == "No tenés permiso para ver «Clientes»."
    assert (await juguete.post("/clientes", headers=_token(JULIAN))).status_code == 200


async def test_un_permiso_de_persona_en_el_area_suma(juguete):
    async with juguete.sesiones() as s:
        s.add(UsuarioArea(id_usuario=MATIAS, area_codigo="clientes", nivel="write",
                          otorgado_por=JULIAN, motivo="atiende a los clientes esta semana",
                          vence_en=ahora_ar() + timedelta(days=7)))
        await s.commit()
    assert (await juguete.get("/clientes", headers=_token(MATIAS, "operario"))).status_code == 200
    assert (await juguete.post("/clientes", headers=_token(MATIAS, "operario"))).status_code == 200


async def test_lectura_libre_para_los_catalogos(juguete):
    """Recursos: el operario no tiene el área, pero la lista de máquinas la necesita
    Operaciones. Leer puede cualquiera con cuenta activa; escribir pide el área."""
    assert (await juguete.get("/maquinas", headers=_token(MATIAS, "operario"))).status_code == 200
    r = await juguete.delete("/maquinas/1", headers=_token(MATIAS, "operario"))
    assert r.status_code == 403 and "«Recursos»" in _msg(r)
    assert (await juguete.delete("/maquinas/1", headers=_token(SOFIA, "supervisor"))).status_code == 403
    assert (await juguete.delete("/maquinas/1", headers=_token(JULIAN))).status_code == 200
    # Una cuenta desactivada no lee ni lo libre.
    assert (await juguete.get("/maquinas", headers=_token(ANA, "operario"))).status_code == 401


async def test_sin_token_no_pasa_nada(juguete):
    for metodo, ruta in (("get", "/op"), ("get", "/maquinas"), ("get", "/solo-admin")):
        r = await getattr(juguete, metodo)(ruta)
        assert r.status_code in (401, 403)


async def test_no_se_le_cree_al_token(juguete):
    """Un token que dice admin, de alguien que en la base es operario."""
    falso = _token(MATIAS, "admin")
    assert (await juguete.get("/solo-admin", headers=falso)).status_code == 403
    assert (await juguete.post("/op", headers=falso)).status_code == 403
    assert (await juguete.get("/rendimiento", headers=falso)).status_code == 403


async def test_un_cambio_de_rol_vale_desde_el_pedido_siguiente(juguete):
    token = _token(MATIAS, "operario")
    assert (await juguete.post("/op", headers=token)).status_code == 403
    await _ejecutar(juguete, update(Usuario).where(Usuario.id_usuario == MATIAS).values(rol="supervisor"))
    assert (await juguete.post("/op", headers=token)).status_code == 200
    # Y al revés: un admin al que se le saca el rol pierde todo con el token viejo.
    token_lucas = _token(LUCAS)
    assert (await juguete.get("/solo-admin", headers=token_lucas)).status_code == 200
    await _ejecutar(juguete, update(Usuario).where(Usuario.id_usuario == LUCAS).values(rol="operario"))
    assert (await juguete.get("/solo-admin", headers=token_lucas)).status_code == 403
    assert (await juguete.post("/op", headers=token_lucas)).status_code == 403


async def test_desactivar_corta_el_acceso_con_el_token_vivo(juguete):
    token = _token(SOFIA, "supervisor")
    assert (await juguete.get("/op", headers=token)).status_code == 200
    await _ejecutar(juguete, update(Usuario).where(Usuario.id_usuario == SOFIA).values(activo=False))
    r = await juguete.get("/op", headers=token)
    assert r.status_code == 401
    assert "inactivo" in _msg(r)


async def test_un_rol_que_no_esta_en_la_tabla_no_abre_nada(juguete):
    await _ejecutar(juguete, update(Usuario).where(Usuario.id_usuario == MATIAS).values(rol="jefe"))
    assert (await juguete.get("/op", headers=_token(MATIAS, "jefe"))).status_code == 403
    assert (await juguete.get("/maquinas", headers=_token(MATIAS, "jefe"))).status_code == 200


async def test_si_la_base_no_contesta_no_se_abre_nada(juguete):
    class _Caida:
        def __init__(self):
            raise ConnectionError("la base no contesta")

    juguete.app.dependency_overrides[get_sesiones_permisos] = lambda: _Caida
    for ruta in ("/op", "/solo-admin", "/maquinas"):
        r = await juguete.get(ruta, headers=_token(JULIAN))
        assert r.status_code == 503, ruta
        assert "No se pudieron verificar tus permisos" in _msg(r)


async def test_sin_tablas_de_permisos_el_admin_pasa_y_el_resto_no():
    """Si la migración no corrió: el admin no necesita las tablas; al resto no se le
    abre nada que no se pueda verificar (503, no 200)."""
    engine, Sesion = await _base(con_permisos=False, con_admin_permanente=False)
    j = _juguete()
    j.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    try:
        async with AsyncClient(transport=ASGITransport(app=j), base_url="http://test") as c:
            assert (await c.post("/op", headers=_token(JULIAN))).status_code == 200
            assert (await c.get("/solo-admin", headers=_token(JULIAN))).status_code == 200
            assert (await c.get("/op", headers=_token(MATIAS, "operario"))).status_code == 503
            assert (await c.get("/solo-admin", headers=_token(MATIAS, "operario"))).status_code == 403
            # La lectura libre sólo necesita la fila del usuario.
            assert (await c.get("/maquinas", headers=_token(MATIAS, "operario"))).status_code == 200
    finally:
        await engine.dispose()


def test_un_codigo_con_typo_revienta_al_armar_la_dependencia():
    with pytest.raises(ValueError):
        require_area("operacion")
    with pytest.raises(ValueError):
        require_area("operaciones", "lectura")
    with pytest.raises(ValueError):
        require_seccion("usuarios")
    with pytest.raises(ValueError):
        require_area_segun_metodo("recurso")


# ─────────────────────────── ABM de usuarios: roles y admins ───────────────────────────


def _alta(rol):
    return {"username": "pedro", "email": "pedro@metlo.com.ar", "password": "123456",
            "nombre": "Pedro", "apellido": "Prueba", "rol": rol}


async def _rol_de(c, id_usuario):
    async with c.sesiones() as s:
        return (await s.execute(select(Usuario.rol).where(Usuario.id_usuario == id_usuario))).scalar()


async def test_el_alta_acepta_los_roles_de_la_tabla(cliente):
    r = await cliente.post("/auth/usuarios", headers=_token(JULIAN), json=_alta("Supervisor"))
    assert r.status_code == 200, r.text
    assert r.json()["data"]["rol"] == "supervisor"


async def test_el_alta_rechaza_un_rol_que_no_existe(cliente):
    r = await cliente.post("/auth/usuarios", headers=_token(JULIAN), json=_alta("jefe"))
    assert r.status_code == 400
    assert "El rol 'jefe' no existe" in _msg(r) and "supervisor" in _msg(r)
    r = await cliente.post("/auth/usuarios", headers=_token(JULIAN), json=_alta("con espacios"))
    assert r.status_code == 400


async def test_el_alta_de_siempre_con_admin_sigue_andando(cliente):
    """El front de hoy da de alta con rol 'admin' (su valor por defecto). Vale aunque
    alguien haya borrado la fila del rol admin: es admin por regla, no por su fila."""
    from backend.domain.Permisos import Rol
    from sqlalchemy import delete
    await _ejecutar(cliente, delete(Rol).where(Rol.codigo == "admin"))
    r = await cliente.post("/auth/usuarios", headers=_token(JULIAN), json=_alta("admin"))
    assert r.status_code == 200, r.text


async def test_cambiar_el_rol_de_otro(cliente):
    r = await cliente.put(f"/auth/usuarios/{MATIAS}", headers=_token(JULIAN), json={"rol": "supervisor"})
    assert r.status_code == 200, r.text
    assert await _rol_de(cliente, MATIAS) == "supervisor"
    r = await cliente.put(f"/auth/usuarios/{MATIAS}", headers=_token(JULIAN), json={"rol": "jefe"})
    assert r.status_code == 400


async def test_nadie_se_cambia_el_rol_ni_se_desactiva_a_si_mismo(cliente):
    r = await cliente.put(f"/auth/usuarios/{JULIAN}", headers=_token(JULIAN), json={"rol": "operario"})
    assert r.status_code == 409
    assert "tu propio rol" in _msg(r)
    r = await cliente.put(f"/auth/usuarios/{JULIAN}", headers=_token(JULIAN), json={"activo": False})
    assert r.status_code == 409
    assert await _rol_de(cliente, JULIAN) == "admin"
    # Editar lo suyo con el mismo rol (que es lo que manda el front de hoy) sí.
    r = await cliente.put(f"/auth/usuarios/{JULIAN}", headers=_token(JULIAN),
                          json={"nombre": "Julián", "rol": "admin", "activo": True})
    assert r.status_code == 200, r.text


async def test_al_admin_que_se_baja_no_le_alcanza_el_token_viejo(cliente):
    token_lucas = _token(LUCAS)
    assert (await cliente.get("/auth/usuarios", headers=token_lucas)).status_code == 200
    r = await cliente.put(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN), json={"rol": "supervisor"})
    assert r.status_code == 200, r.text
    assert (await cliente.get("/auth/usuarios", headers=token_lucas)).status_code == 403
    r = await cliente.get("/auth/me", headers=token_lucas)
    assert r.json()["data"]["permisos"]["areas"] == MATRIZ_ROL_AREA["supervisor"]


async def test_un_admin_permanente_no_se_baja_ni_se_desactiva_ni_se_elimina(cliente):
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == LUCAS)
                    .values(admin_permanente=True))
    for cuerpo in ({"rol": "supervisor"}, {"activo": False}):
        r = await cliente.put(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN), json=cuerpo)
        assert r.status_code == 409, cuerpo
        assert "administrador permanente" in _msg(r)
    r = await cliente.delete(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN))
    assert r.status_code == 409
    assert "administrador permanente" in _msg(r)
    assert await _rol_de(cliente, LUCAS) == "admin"
    # Lo demás se le puede editar.
    r = await cliente.put(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN),
                          json={"nombre": "Lucas", "rol": "admin"})
    assert r.status_code == 200, r.text
    # Y /auth/me lo dice.
    r = await cliente.get("/auth/me", headers=_token(LUCAS))
    assert r.json()["data"]["permisos"]["admin_permanente"] is True


async def test_eliminar_a_otro_admin_cuando_quedan_otros(cliente):
    r = await cliente.delete(f"/auth/usuarios/{LUCAS}", headers=_token(JULIAN))
    assert r.status_code == 200, r.text


async def test_nunca_queda_el_sistema_sin_admin():
    """Por la API no se llega (quien actúa ya es un admin activo que no se puede bajar a
    sí mismo), así que la regla se prueba sola: es la red por si mañana hay otro camino."""
    engine, Sesion = await _base()
    try:
        await _ejecutar_en(Sesion, update(Usuario).where(Usuario.id_usuario == LUCAS)
                           .values(rol="supervisor"))
        for rol_nuevo, activo_nuevo in (("operario", True), ("admin", False)):
            with pytest.raises(Exception) as e:
                await AuthAPI._cuidar_administradores(
                    Sesion, id_objetivo=JULIAN, id_actor=99, rol_actual="admin",
                    activo_actual=True, rol_nuevo=rol_nuevo, activo_nuevo=activo_nuevo)
            assert getattr(e.value, "status_code", None) == 409
            assert "único administrador activo" in e.value.detail["message"]
        # Con otro admin activo, sí.
        await _ejecutar_en(Sesion, update(Usuario).where(Usuario.id_usuario == LUCAS)
                           .values(rol="admin"))
        await AuthAPI._cuidar_administradores(
            Sesion, id_objetivo=JULIAN, id_actor=99, rol_actual="admin",
            activo_actual=True, rol_nuevo="operario", activo_nuevo=True)
    finally:
        await engine.dispose()


async def _ejecutar_en(Sesion, sentencia):
    async with Sesion() as s:
        await s.execute(sentencia)
        await s.commit()
