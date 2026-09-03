"""
Primer ingreso: entrar con la contraseña que te pasaron y salir con una tuya.

Recorre el camino entero como lo hace el navegador —login, cambio, volver a
entrar— contra la app real de FastAPI, con la base en memoria. Lo importante no es
que el endpoint devuelva 200 sino lo de después: que el flag se apague en la base
(si no, la pantalla vuelve a aparecer para siempre) y que la contraseña nueva
sirva de verdad para entrar.

Escrito el 3/9 después de que Matías quedara encerrado en esa pantalla. La causa
fue la URL del front —eso lo cubre [test_rutas_que_llama_el_front]—, pero el flujo
de atrás nunca había tenido un test que lo recorriera de punta a punta.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.core.security import get_password_hash, verify_password
from backend.domain.Usuario import Usuario
from backend.infrastructure.db import Base
from backend.presentation import AuthAPI
from backend.presentation.main import app

PASS_INICIAL = "laquelepasaron"   # la que le pasa por chat quien lo da de alta
PASS_PROPIA = "lasuyapropia1"


@pytest_asyncio.fixture
async def cliente():
    """La app real, con la tabla usuario en SQLite en memoria."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Usuario.__table__]))

    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Alta como la hace un admin desde Usuarios: contraseña puesta por otro, y por
    # eso queda obligado a cambiarla.
    async with Sesion() as s:
        s.add(Usuario(
            username="matias",
            email="matias@metalurgicalongchamps.com",
            password_hash=get_password_hash(PASS_INICIAL),
            nombre="Matias",
            apellido="Gomez",
            rol="operario",
            activo=True,
            debe_cambiar_password=True,
        ))
        await s.commit()

    async def _db():
        async with Sesion() as s:
            yield s

    app.dependency_overrides[AuthAPI.get_db] = _db
    transporte = ASGITransport(app=app)
    async with AsyncClient(transport=transporte, base_url="http://test") as c:
        c.sesiones = Sesion  # para mirar la base desde el test
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


async def _login(cliente, password):
    return await cliente.post("/auth/login", json={"username": "matias", "password": password})


async def _usuario(cliente):
    async with cliente.sesiones() as s:
        return await s.get(Usuario, 1)


async def test_al_entrar_por_primera_vez_el_login_avisa_que_tiene_que_cambiarla(cliente):
    """El front decide mostrar la pantalla mirando este campo del login."""
    r = await _login(cliente, PASS_INICIAL)
    assert r.status_code == 200
    assert r.json()["data"]["debe_cambiar_password"] is True


async def test_cambia_la_contrasena_y_despues_entra_con_la_nueva(cliente):
    """El camino feliz completo: es lo que tenía que pasarle a Matías."""
    token = (await _login(cliente, PASS_INICIAL)).json()["data"]["access_token"]

    r = await cliente.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": PASS_INICIAL,
            "new_password": PASS_PROPIA,
            "confirm_password": PASS_PROPIA,
        },
    )
    assert r.status_code == 200, r.text

    # El flag se apaga en la BASE, no solo en el localStorage del navegador: si
    # quedara prendido, la pantalla volvería a aparecer en cada ingreso.
    u = await _usuario(cliente)
    assert u.debe_cambiar_password is False
    assert verify_password(PASS_PROPIA, u.password_hash)

    # Y ahora entra con la suya, sin que le pidan cambiar nada.
    r = await _login(cliente, PASS_PROPIA)
    assert r.status_code == 200
    assert r.json()["data"]["debe_cambiar_password"] is False

    # La que le pasaron por chat ya no sirve — que es el punto de todo esto.
    assert (await _login(cliente, PASS_INICIAL)).status_code == 401


async def test_si_se_equivoca_en_la_actual_no_cambia_nada(cliente):
    """Un error de tipeo no puede dejarlo sin la contraseña con la que sí puede entrar."""
    token = (await _login(cliente, PASS_INICIAL)).json()["data"]["access_token"]

    r = await cliente.post(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": "cualquiercosa",
            "new_password": PASS_PROPIA,
            "confirm_password": PASS_PROPIA,
        },
    )
    assert r.status_code == 400
    assert "actual" in r.json()["errors"][0]["message"].lower()

    u = await _usuario(cliente)
    assert u.debe_cambiar_password is True
    assert verify_password(PASS_INICIAL, u.password_hash)


async def test_sin_token_no_se_puede_cambiar_la_contrasena_de_nadie(cliente):
    r = await cliente.post(
        "/auth/change-password",
        json={
            "current_password": PASS_INICIAL,
            "new_password": PASS_PROPIA,
            "confirm_password": PASS_PROPIA,
        },
    )
    assert r.status_code in (401, 403)
    assert (await _usuario(cliente)).debe_cambiar_password is True


@pytest.mark.parametrize("ruta", ["/change-password", "/auth/change_password"])
async def test_las_rutas_parecidas_siguen_sin_existir(cliente, ruta):
    """
    La que llamaba el front (`/change-password`) devuelve 404 — el «Not Found» que
    vio Matías. Queda acá para que se entienda de dónde salía ese cartel.
    """
    r = await cliente.post(ruta, json={})
    assert r.status_code == 404
