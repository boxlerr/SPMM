"""
RF-28: la pantalla de inicio por persona y por rol (la `pantalla_inicio` de Don Joaquín,
más una por rol, que es el «tipo de usuario» del SRS).

Lo que se prueba:

1. La regla (core/permisos.py): la de la persona pisa la del rol; una que ya no es del
   menú no cuenta; sólo se puede fijar una pantalla del menú; «¿la puede abrir?» es la
   misma pregunta que el menú.
2. La migración: dos columnas NULL, después de la de permisos, sin tocar filas.
3. La API: el login y /auth/me dicen a qué pantalla entra cada uno; el admin la fija
   por persona y por rol (y nadie más); la matriz y la lista de usuarios la muestran; y
   queda en la auditoría.
4. El deploy: con la migración sin correr todos entran como hoy, el alta de usuarios
   anda (el INSERT no nombra la columna) y fijarla contesta 503, no un 500.

Base: SQLite en memoria (test_permisos_api._base). Nada toca Supabase.
"""
import re
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from backend.core.permisos import (
    AREA_POR_CODIGO,
    AREAS,
    MATRIZ_ROL_AREA,
    MATRIZ_ROL_SECCION,
    PANTALLAS_DE_INICIO,
    SECCION_POR_CODIGO,
    DatosDePermisos,
    pantalla_de_inicio,
    permisos_de,
    puede_abrir_pantalla,
    validar_pantalla_de_inicio,
)
from backend.core.security import get_sesiones_permisos
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.Permisos import Rol
from backend.domain.Usuario import Usuario
from backend.infrastructure import migraciones
from backend.infrastructure.db import Base
from backend.presentation import AuthAPI, PermisosAPI, main
from backend.presentation.main import app
from backend.tests.test_permisos_api import (
    CLAVE,
    JULIAN,
    LUCAS,
    MATIAS,
    SOFIA,
    _base,
    _token,
)

RAIZ = Path(__file__).resolve().parents[2]
NOMBRE = "2026-09-22_pantalla_de_inicio"
SQL = (RAIZ / "backend" / "scripts" / "migrations" / f"{NOMBRE}.sql").read_text()
ADMIN = _token(JULIAN)
SUPERVISOR = _token(SOFIA, "supervisor")
OPERARIO = _token(MATIAS, "operario")


# ═════════════════════ 1. la regla ═════════════════════


def test_la_de_la_persona_pisa_la_del_rol():
    assert pantalla_de_inicio("/planos", "/operaciones") == "/planos"
    assert pantalla_de_inicio(None, "/operaciones") == "/operaciones"
    assert pantalla_de_inicio("", "/operaciones") == "/operaciones"
    assert pantalla_de_inicio("/planos", None) == "/planos"
    assert pantalla_de_inicio(None, None) is None


def test_una_que_ya_no_es_del_menu_no_cuenta():
    """Quedó vieja en la base (se sacó un ítem del menú): mejor la del rol que ninguna, y
    ninguna antes que mandar a alguien a un 404."""
    assert pantalla_de_inicio("/ya-no-existe", "/operaciones") == "/operaciones"
    assert pantalla_de_inicio("/ya-no-existe", "/tampoco") is None


def test_solo_se_fija_una_pantalla_del_menu():
    assert validar_pantalla_de_inicio(" /planos ") == "/planos"
    assert validar_pantalla_de_inicio("") is None
    assert validar_pantalla_de_inicio(None) is None
    for mala in ("/planos/3", "planos", "/ordenes", "https://otro.sitio", "/Planos"):
        with pytest.raises(ValueError, match="no es una pantalla del menú"):
            validar_pantalla_de_inicio(mala)


def test_el_catalogo_es_el_menu():
    """Las pantallas que se pueden elegir son las del menú (Sidebar.tsx), en su orden."""
    sidebar = (RAIZ / "frontend" / "src" / "components" / "Sidebar.tsx").read_text()
    lista = sidebar.split("const sidebarItems", 1)[1].split("];", 1)[0]
    assert [p.ruta for p in PANTALLAS_DE_INICIO] == re.findall(r'href:\s*"([^"]+)"', lista)


def test_lo_que_pide_cada_pantalla_existe_y_es_de_su_area():
    for p in PANTALLAS_DE_INICIO:
        assert p.ruta.startswith("/") and len(p.ruta) <= 80
        if p.area:
            assert p.area in AREA_POR_CODIGO, p
        for s in p.solapas:
            assert SECCION_POR_CODIGO[s].area == p.area, (p.ruta, s)
    # Toda área tiene su pantalla (un área sin pantalla no se podría elegir como inicio).
    # Configuración es la excepción: su pantalla es de todos («Mi cuenta» está adentro).
    assert {a.codigo for a in AREAS} - {"configuracion"} <= {p.area for p in PANTALLAS_DE_INICIO}
    assert {p.ruta for p in PANTALLAS_DE_INICIO if not p.area} == {"/configuracion", "/novedades"}


def _de(rol, **extra):
    return permisos_de(DatosDePermisos(
        rol=rol, rol_areas=MATRIZ_ROL_AREA.get(rol, {}),
        rol_secciones=MATRIZ_ROL_SECCION.get(rol, {}), **extra))


def test_puede_abrirla_es_lo_mismo_que_el_menu():
    todas = {p.ruta for p in PANTALLAS_DE_INICIO}
    abre = lambda permisos: {r for r in todas if puede_abrir_pantalla(permisos, r)}  # noqa: E731
    assert abre(_de("admin")) == todas
    assert abre(_de("operario")) == {
        "/dashboard", "/operaciones", "/planos", "/configuracion", "/no-conformidades", "/novedades"}
    assert abre(_de("supervisor")) == todas - {"/auditoria"}
    # Un permiso de más abre lo suyo; una solapa sola alcanza para la pantalla.
    assert puede_abrir_pantalla(_de("operario", usuario_areas={"clientes": "read"}), "/clientes")
    assert puede_abrir_pantalla(
        _de("operario", usuario_secciones={"auditoria_procesos": "read"}), "/auditoria")
    # Lo que no es del menú, o sin permisos, no.
    assert not puede_abrir_pantalla(_de("admin"), "/ordenes")
    assert not puede_abrir_pantalla(None, "/novedades")


# ═════════════════════ 2. la migración ═════════════════════


def _codigo(texto: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"(?m)--[^\n]*", " ", texto)).lower()


@pytest.mark.parametrize("fuente", ["sql", "modulo"])
def test_la_migracion_no_toca_ninguna_fila(fuente):
    """Dos columnas NULL: nadie cambia de pantalla por el deploy. Nada de UPDATE (una
    siembra por rol volvería a poner, en cada arranque, la pantalla que alguien sacó)."""
    sentencias = dict(migraciones.MIGRACIONES)[NOMBRE]
    codigo = _codigo(SQL if fuente == "sql" else " ; ".join(sentencias))
    for prohibido in ("update ", "delete ", "insert ", "drop ", "truncate", "not null",
                      "default", "create type", "alter column"):
        assert prohibido not in codigo, f"{fuente}: {prohibido!r}"
    assert "alter table usuario add column if not exists pantalla_inicio varchar(80)" in codigo
    assert "alter table rol add column if not exists pantalla_inicio varchar(80)" in codigo


def test_va_despues_de_la_que_crea_la_tabla_rol():
    nombres = [n for n, _ in migraciones.MIGRACIONES]
    assert nombres.index(NOMBRE) > nombres.index("2026-09-22_permisos_por_rol_y_area")


def test_el_orm_tiene_las_columnas_y_el_insert_no_las_nombra():
    """Anulable y SIN default de Python pero con default de la base: si no, SQLAlchemy la
    manda en el INSERT con un NULL explícito y el alta revienta contra una base sin la
    columna (ver domain/Usuario.py)."""
    for modelo in (Usuario, Rol):
        col = modelo.__table__.c.pantalla_inicio
        assert col.nullable and col.type.length == 80
        assert col.default is None and col.server_default is not None
        assert "pantalla_inicio" not in modelo.__mapper__._insert_cols_as_none[modelo.__table__]
        assert modelo.__mapper__.eager_defaults is False


# ═════════════════════ 3. la API ═════════════════════


async def _cliente(**base):
    engine, Sesion = await _base(**base)
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=[AuditoriaMovimiento.__table__]))

    async def _db():
        async with Sesion() as s:
            yield s

    app.dependency_overrides[AuthAPI.get_db] = _db
    app.dependency_overrides[PermisosAPI.get_db] = _db
    app.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    c.sesiones = Sesion
    c.engine = engine
    return c


@pytest_asyncio.fixture
async def cliente():
    c = await _cliente()
    yield c
    await c.aclose()
    app.dependency_overrides.clear()
    await c.engine.dispose()


@pytest_asyncio.fixture
async def cliente_sin_la_columna():
    """La de permisos ya corrió; la de la pantalla de inicio, todavía no."""
    c = await _cliente(con_pantalla_inicio=False)
    yield c
    await c.aclose()
    app.dependency_overrides.clear()
    await c.engine.dispose()


def _msg(r) -> str:
    return r.json()["errors"][0]["message"]


async def _login(c, username):
    r = await c.post("/auth/login", json={"username": username, "password": CLAVE})
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _me(c, headers):
    r = await c.get("/auth/me", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _en_la_base(c):
    async with c.sesiones() as s:
        personas = dict((await s.execute(select(Usuario.id_usuario, Usuario.pantalla_inicio))).all())
        roles = dict((await s.execute(select(Rol.codigo, Rol.pantalla_inicio))).all())
    return personas, roles


async def test_sin_nada_fijado_todos_entran_como_hoy(cliente):
    """El deploy no cambia a nadie de pantalla: la columna arranca vacía."""
    for username in ("julian", "sofia", "matias"):
        assert (await _login(cliente, username))["pantalla_inicio"] is None
    assert (await _me(cliente, OPERARIO))["pantalla_inicio"] is None


async def test_la_del_rol_vale_para_todos_los_del_rol_y_la_de_la_persona_la_pisa(cliente):
    r = await cliente.put("/permisos/roles/operario/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/operaciones"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["puede_abrirla"] is True
    assert (await _login(cliente, "matias"))["pantalla_inicio"] == "/operaciones"
    assert (await _me(cliente, OPERARIO))["pantalla_inicio"] == "/operaciones"
    # A los de otro rol no les cambia nada.
    assert (await _login(cliente, "sofia"))["pantalla_inicio"] is None

    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/planos"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert (data["pantalla_inicio"], data["pantalla_del_rol"], data["efectiva"]) == \
        ("/planos", "/operaciones", "/planos")
    assert (await _login(cliente, "matias"))["pantalla_inicio"] == "/planos"
    assert (await _me(cliente, OPERARIO))["pantalla_inicio"] == "/planos"

    # null = «como su rol».
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": None})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["efectiva"] == "/operaciones"
    assert (await _me(cliente, OPERARIO))["pantalla_inicio"] == "/operaciones"
    # Y null en el rol = la de siempre.
    r = await cliente.put("/permisos/roles/operario/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": None})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, OPERARIO))["pantalla_inicio"] is None
    personas, roles = await _en_la_base(cliente)
    assert personas[MATIAS] is None and roles["operario"] is None


async def test_fijarla_no_da_permiso_para_verla_y_se_avisa(cliente):
    """Al Operario sin Clientes se le puede fijar Clientes (no se pierde nada), pero la
    respuesta dice que no la puede abrir: va a entrar al Dashboard. No es un 409."""
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/clientes"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["puede_abrirla"] is False
    # Sigue sin poder: fijarla no le dio nada.
    assert (await _me(cliente, OPERARIO))["permisos"]["areas"]["clientes"] == "none"
    r = await cliente.put("/permisos/roles/operario/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/auditoria"})
    assert r.json()["data"]["puede_abrirla"] is False
    r = await cliente.put("/permisos/roles/supervisor/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/recursos"})
    assert r.json()["data"]["puede_abrirla"] is True


async def test_al_admin_y_a_uno_mismo_tambien_se_les_fija(cliente):
    """No es un permiso: es por dónde entra. Se le puede fijar al rol Administrador, a otro
    admin y a uno mismo."""
    r = await cliente.put("/permisos/roles/admin/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/operaciones"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["puede_abrirla"] is True
    assert (await _login(cliente, "lucas"))["pantalla_inicio"] == "/operaciones"
    r = await cliente.put(f"/permisos/usuarios/{JULIAN}/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/auditoria"})
    assert r.status_code == 200, r.text
    assert (await _me(cliente, ADMIN))["pantalla_inicio"] == "/auditoria"


async def test_solo_el_admin_la_fija(cliente):
    """Fijarla es administrar usuarios: sólo el rol Administrador, mirado en la base. Ni
    siquiera la propia, si no es admin."""
    await cliente.put(f"/permisos/usuarios/{SOFIA}/pantalla-inicio", headers=ADMIN,
                      json={"pantalla_inicio": "/planos"})
    for headers, quien in ((SUPERVISOR, SOFIA), (OPERARIO, MATIAS), (_token(SOFIA, "admin"), SOFIA)):
        r = await cliente.put(f"/permisos/usuarios/{quien}/pantalla-inicio", headers=headers,
                              json={"pantalla_inicio": "/clientes"})
        assert r.status_code == 403, r.text
        r = await cliente.put("/permisos/roles/supervisor/pantalla-inicio", headers=headers,
                              json={"pantalla_inicio": "/clientes"})
        assert r.status_code == 403, r.text
    personas, roles = await _en_la_base(cliente)
    assert personas[SOFIA] == "/planos" and roles["supervisor"] is None


async def test_lo_que_no_se_puede_fijar(cliente):
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/ordenes"})
    assert r.status_code == 400
    assert "no es una pantalla del menú" in _msg(r)
    r = await cliente.put("/permisos/roles/operario/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "https://otro.sitio"})
    assert r.status_code == 400
    # Un cuerpo vacío no borra nada por descuido: el campo va siempre (aunque sea null).
    r = await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=ADMIN, json={})
    assert r.status_code == 400
    assert "obligatorio" in _msg(r)
    r = await cliente.put("/permisos/usuarios/999/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/planos"})
    assert r.status_code == 404
    r = await cliente.put("/permisos/roles/jefe/pantalla-inicio", headers=ADMIN,
                          json={"pantalla_inicio": "/planos"})
    assert r.status_code == 404
    personas, roles = await _en_la_base(cliente)
    assert set(personas.values()) == {None} and set(roles.values()) == {None}


async def test_la_matriz_y_la_lista_la_muestran(cliente):
    await cliente.put("/permisos/roles/operario/pantalla-inicio", headers=ADMIN,
                      json={"pantalla_inicio": "/operaciones"})
    await cliente.put(f"/permisos/usuarios/{SOFIA}/pantalla-inicio", headers=ADMIN,
                      json={"pantalla_inicio": "/planos"})
    r = await cliente.get("/permisos/matriz", headers=ADMIN)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["pantalla_inicio_disponible"] is True
    assert {x["codigo"]: x["pantalla_inicio"] for x in data["roles"]} == {
        "admin": None, "supervisor": None, "operario": "/operaciones"}
    r = await cliente.get("/auth/usuarios", headers=ADMIN)
    assert r.status_code == 200, r.text
    # La de cada persona, sin mezclar la del rol: «como su rol» es None.
    assert {u["id_usuario"]: u["pantalla_inicio"] for u in r.json()["data"]} == {
        JULIAN: None, LUCAS: None, SOFIA: "/planos", MATIAS: None}


async def test_una_vieja_en_la_base_sale_como_ninguna(cliente):
    """Si un ítem se saca del menú y quedó fijado, no se manda a nadie a un 404: se lee
    como si no hubiera nada (y la del rol, si hay, vale)."""
    async with cliente.sesiones() as s:
        await s.execute(update(Rol).where(Rol.codigo == "operario").values(pantalla_inicio="/planos"))
        await s.execute(update(Usuario).where(Usuario.id_usuario == MATIAS)
                        .values(pantalla_inicio="/ya-no-existe"))
        await s.commit()
    assert (await _me(cliente, OPERARIO))["pantalla_inicio"] == "/planos"
    r = await cliente.get("/auth/usuarios", headers=ADMIN)
    assert {u["id_usuario"]: u["pantalla_inicio"] for u in r.json()["data"]}[MATIAS] is None


async def test_queda_en_la_auditoria(cliente, monkeypatch):
    monkeypatch.setattr(main, "SessionLocal", cliente.sesiones)
    await cliente.put("/permisos/roles/operario/pantalla-inicio", headers=ADMIN,
                      json={"pantalla_inicio": "/operaciones"})
    await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=ADMIN,
                      json={"pantalla_inicio": "/planos"})
    await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=ADMIN,
                      json={"pantalla_inicio": None})
    await cliente.put(f"/permisos/usuarios/{MATIAS}/pantalla-inicio", headers=SUPERVISOR,
                      json={"pantalla_inicio": "/clientes"})
    async with cliente.sesiones() as s:
        filas = (await s.execute(select(AuditoriaMovimiento).order_by(AuditoriaMovimiento.id))).scalars().all()
    assert [f.descripcion for f in filas] == [
        "Julian Prueba le fijó al rol «Operario» la pantalla de inicio «Operaciones»",
        "Julian Prueba le fijó a Matias Prueba la pantalla de inicio «Planos»",
        "Julian Prueba hizo que Matias Prueba entre por la pantalla de inicio de su rol («Operaciones»)",
        f"Sofia Prueba editó permisos › de una persona #{MATIAS} (no se pudo: error 403)",
    ]
    assert all(f.id_usuario == JULIAN for f in filas[:3])


# ═════════════════════ 4. el deploy: la migración sin correr ═════════════════════


async def test_sin_la_columna_todos_entran_como_hoy(cliente_sin_la_columna):
    c = cliente_sin_la_columna
    for username in ("julian", "matias"):
        data = await _login(c, username)
        assert data["pantalla_inicio"] is None
        assert "permisos" in data  # lo de RF-24 sigue viniendo
    assert (await _me(c, ADMIN))["pantalla_inicio"] is None
    assert (await _me(c, OPERARIO))["permisos"]["rol"] == "operario"


async def test_sin_la_columna_la_gestion_de_usuarios_anda(cliente_sin_la_columna):
    """La lista sale sin la clave (la pantalla no ofrece fijarla), la matriz dice que no
    está disponible, y el alta y la edición andan: el INSERT no nombra la columna."""
    c = cliente_sin_la_columna
    r = await c.get("/auth/usuarios", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert all("pantalla_inicio" not in u for u in r.json()["data"])
    r = await c.get("/permisos/matriz", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["pantalla_inicio_disponible"] is False
    assert all("pantalla_inicio" not in x for x in r.json()["data"]["roles"])
    r = await c.post("/auth/usuarios", headers=ADMIN, json={
        "username": "nuevo", "email": "nuevo@metlo.com.ar", "password": "123456",
        "nombre": "Nuevo", "apellido": "Prueba", "rol": "operario"})
    assert r.status_code == 200, r.text
    r = await c.put(f"/auth/usuarios/{MATIAS}", headers=ADMIN, json={"nombre": "Matías"})
    assert r.status_code == 200, r.text
    r = await c.put(f"/permisos/usuarios/{MATIAS}/rol", headers=ADMIN, json={"rol": "supervisor"})
    assert r.status_code == 200, r.text


async def test_sin_la_columna_fijarla_dice_que_falta_la_migracion(cliente_sin_la_columna):
    c = cliente_sin_la_columna
    for ruta in (f"/permisos/usuarios/{MATIAS}/pantalla-inicio", "/permisos/roles/operario/pantalla-inicio"):
        r = await c.put(ruta, headers=ADMIN, json={"pantalla_inicio": "/planos"})
        assert r.status_code == 503, r.text
        assert "falta que corra la migración de la pantalla de inicio" in _msg(r)
    # Y la API sigue andando después (el rollback no dejó nada colgado).
    assert (await c.get("/permisos/matriz", headers=ADMIN)).status_code == 200


async def test_antes_de_todas_las_migraciones_tambien():
    """La base de hoy en producción: ni permisos ni pantalla de inicio."""
    c = await _cliente(con_permisos=False, con_admin_permanente=False)
    try:
        data = await _login(c, "julian")
        assert data["pantalla_inicio"] is None
        assert (await _me(c, ADMIN))["pantalla_inicio"] is None
        r = await c.get("/auth/usuarios", headers=ADMIN)
        assert r.status_code == 200 and all("pantalla_inicio" not in u for u in r.json()["data"])
    finally:
        await c.aclose()
        app.dependency_overrides.clear()
        await c.engine.dispose()
