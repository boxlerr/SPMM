"""
RF-26: bloquear el acceso tras 5 intentos fallidos seguidos de inicio de sesión.

Recorre el login como lo hace el navegador —contra la app real de FastAPI, con la
base en SQLite en memoria— porque lo que importa no es lo que devuelve un método
sino lo que queda en la base entre un intento y el siguiente: la cuenta tiene que
sobrevivir entre pedidos, el bloqueo tiene que frenar incluso a la contraseña
buena, y tiene que levantarse solo.

Lo que se decidió (y está explicado en AuthService, arriba de MAX_INTENTOS_FALLIDOS):
bloqueo TEMPORAL de 15 minutos que se levanta solo, más un «Desbloquear» del admin.
"""
import json
import re
from datetime import timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.application.AuthService import MAX_INTENTOS_FALLIDOS, MINUTOS_DE_BLOQUEO
from backend.core.security import get_password_hash
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.Usuario import Usuario
from backend.infrastructure import auditoria_movimientos as auditoria
from backend.infrastructure import migraciones
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.infrastructure.db import Base
from backend.presentation import AuthAPI
from backend.presentation.main import app

CLAVE_BUENA = "laclavedelucas"
CLAVE_ADMIN = "laclavedeljefe"
GENERICO = "Usuario o contraseña incorrectos"


async def _armar_cliente(con_auditoria: bool):
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    tablas = [Usuario.__table__] + ([AuditoriaMovimiento.__table__] if con_auditoria else [])
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tablas))

    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Como están hoy en producción: todos admin. Y SIN tocar los campos nuevos, que es
    # justamente lo que pasa con los usuarios que ya existían antes de la migración.
    async with Sesion() as s:
        s.add_all([
            Usuario(id_usuario=1, username="julian", email="julian@vaxler.com.ar",
                    password_hash=get_password_hash(CLAVE_ADMIN), nombre="Julián",
                    apellido="Boxler", rol="admin", activo=True),
            Usuario(id_usuario=2, username="lucas", email="lucas@metalurgicalongchamps.com",
                    password_hash=get_password_hash(CLAVE_BUENA), nombre="Lucas",
                    apellido="Longchamps", rol="admin", activo=True),
        ])
        await s.commit()

    async def _db():
        async with Sesion() as s:
            yield s

    app.dependency_overrides[AuthAPI.get_db] = _db
    return engine, Sesion


@pytest_asyncio.fixture
async def cliente():
    engine, Sesion = await _armar_cliente(con_auditoria=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest_asyncio.fixture
async def cliente_sin_auditoria():
    """Una base donde la tabla de auditoría no existe: escribir la fila va a fallar."""
    engine, Sesion = await _armar_cliente(con_auditoria=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


async def _login(cliente, password, username="lucas"):
    return await cliente.post("/auth/login", json={"username": username, "password": password})


async def _usuario(cliente, id_usuario=2) -> Usuario:
    async with cliente.sesiones() as s:
        return await s.get(Usuario, id_usuario)


async def _filas_de_auditoria(cliente):
    async with cliente.sesiones() as s:
        return (await s.execute(
            select(AuditoriaMovimiento).order_by(AuditoriaMovimiento.id)
        )).scalars().all()


async def _mover_el_bloqueo(cliente, hasta, id_usuario=2):
    """Simula que pasó el tiempo: corre el vencimiento en la base."""
    async with cliente.sesiones() as s:
        await s.execute(
            update(Usuario).where(Usuario.id_usuario == id_usuario).values(bloqueado_hasta=hasta)
        )
        await s.commit()


async def _token_admin(cliente):
    r = await _login(cliente, CLAVE_ADMIN, username="julian")
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


def _mensaje(r):
    return r.json()["errors"][0]["message"]


# ─────────────────────────── la regla ───────────────────────────

async def test_cuatro_errores_no_bloquean_y_el_quinto_si(cliente):
    for restantes in (4, 3, 2, 1):
        r = await _login(cliente, "malisima")
        assert r.status_code == 401, r.text
        assert r.json()["data"]["intentos_restantes"] == restantes
        assert r.json()["data"]["bloqueado"] is False
        # El mensaje se lee solo, sin que el front sepa nada de esto.
        assert _mensaje(r).startswith(GENERICO)
        assert (f"{restantes} intento" in _mensaje(r))

    u = await _usuario(cliente)
    assert u.intentos_fallidos == 4 and u.bloqueado_hasta is None

    r = await _login(cliente, "malisima")
    assert r.status_code == 423, r.text
    datos = r.json()["data"]
    assert datos["bloqueado"] is True and datos["intentos_restantes"] == 0
    assert "bloqueada hasta las" in _mensaje(r)

    u = await _usuario(cliente)
    assert u.intentos_fallidos == MAX_INTENTOS_FALLIDOS
    # 15 minutos desde ahora, en hora local y sin zona (como todas las fechas de la base),
    # redondeado para arriba al minuto: el cartel dice «hasta las 21:02» y a las 21:02
    # tiene que poder entrar.
    assert u.bloqueado_hasta.tzinfo is None
    assert u.bloqueado_hasta.second == 0 and u.bloqueado_hasta.microsecond == 0
    faltan = u.bloqueado_hasta - ahora_ar()
    assert (timedelta(minutes=MINUTOS_DE_BLOQUEO) - timedelta(seconds=5)
            < faltan <= timedelta(minutes=MINUTOS_DE_BLOQUEO + 1))
    # Y el mensaje dice la misma hora que quedó guardada.
    assert f"las {u.bloqueado_hasta:%H:%M}" in _mensaje(r)
    assert r.json()["data"]["bloqueado_hasta"] == u.bloqueado_hasta.isoformat()


async def test_bloqueado_no_entra_ni_con_la_clave_buena(cliente):
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "malisima")
    hasta = (await _usuario(cliente)).bloqueado_hasta

    r = await _login(cliente, CLAVE_BUENA)
    assert r.status_code == 423
    assert "access_token" not in (r.json()["data"] or {})
    assert "bloqueada hasta" in _mensaje(r)

    # Insistir mientras está bloqueada no suma ni estira el plazo: si lo estirara,
    # alguien apretando «Entrar» cada minuto no saldría nunca.
    await _login(cliente, "otramala")
    u = await _usuario(cliente)
    assert u.intentos_fallidos == MAX_INTENTOS_FALLIDOS
    assert u.bloqueado_hasta == hasta


async def test_pasado_el_plazo_entra_y_arranca_de_cero(cliente):
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "malisima")

    # Pasaron los 15 minutos.
    await _mover_el_bloqueo(cliente, ahora_ar() - timedelta(seconds=1))

    r = await _login(cliente, CLAVE_BUENA)
    assert r.status_code == 200, r.text
    u = await _usuario(cliente)
    assert u.intentos_fallidos == 0 and u.bloqueado_hasta is None


async def test_vencido_el_plazo_un_error_cuenta_como_el_primero(cliente):
    """5 intentos nuevos, no 1: si no, al vencer el plazo quedaría a un error de
    volver a bloquearse."""
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "malisima")
    await _mover_el_bloqueo(cliente, ahora_ar() - timedelta(seconds=1))

    r = await _login(cliente, "otramala")
    assert r.status_code == 401
    assert r.json()["data"]["intentos_restantes"] == MAX_INTENTOS_FALLIDOS - 1
    u = await _usuario(cliente)
    assert u.intentos_fallidos == 1 and u.bloqueado_hasta is None


async def test_entrar_bien_vuelve_la_cuenta_a_cero(cliente):
    """«Consecutivos»: un ingreso bueno en el medio corta la racha."""
    for _ in range(3):
        await _login(cliente, "malisima")
    assert (await _usuario(cliente)).intentos_fallidos == 3

    assert (await _login(cliente, CLAVE_BUENA)).status_code == 200
    assert (await _usuario(cliente)).intentos_fallidos == 0

    # Con la cuenta en cero, cuatro errores más todavía no bloquean.
    for _ in range(MAX_INTENTOS_FALLIDOS - 1):
        r = await _login(cliente, "malisima")
    assert r.status_code == 401
    assert r.json()["data"]["intentos_restantes"] == 1
    assert "Te queda 1 intento" in _mensaje(r)


async def test_los_errores_de_uno_no_bloquean_a_otro(cliente):
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "malisima")
    assert (await _login(cliente, CLAVE_ADMIN, username="julian")).status_code == 200
    assert (await _usuario(cliente, 1)).intentos_fallidos == 0


async def test_tambien_cuenta_si_entra_con_el_email(cliente):
    """El login acepta usuario o email; la cuenta es de la persona, no de cómo escribió."""
    await _login(cliente, "malisima", username="lucas")
    await _login(cliente, "malisima", username="lucas@metalurgicalongchamps.com")
    assert (await _usuario(cliente)).intentos_fallidos == 2


# ─────────────────────────── el admin ───────────────────────────

async def test_el_admin_lo_desbloquea_y_entra_al_toque(cliente):
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "malisima")
    token = await _token_admin(cliente)

    # La tabla de usuarios lo muestra bloqueado, con la hora.
    r = await cliente.get("/auth/usuarios", headers={"Authorization": f"Bearer {token}"})
    lucas = next(u for u in r.json()["data"] if u["username"] == "lucas")
    assert lucas["bloqueado"] is True
    assert lucas["bloqueado_hasta"] and lucas["intentos_fallidos"] == MAX_INTENTOS_FALLIDOS

    r = await cliente.post("/auth/usuarios/2/desbloquear",
                           headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["estaba_bloqueado"] is True
    assert r.json()["data"]["bloqueado"] is False

    u = await _usuario(cliente)
    assert u.intentos_fallidos == 0 and u.bloqueado_hasta is None
    assert (await _login(cliente, CLAVE_BUENA)).status_code == 200


async def test_desbloquear_a_quien_no_estaba_bloqueado_no_rompe(cliente):
    """El botón puede haber quedado viejo en una pantalla abierta hace rato."""
    await _login(cliente, "malisima")
    token = await _token_admin(cliente)
    r = await cliente.post("/auth/usuarios/2/desbloquear",
                           headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["data"]["estaba_bloqueado"] is False
    assert (await _usuario(cliente)).intentos_fallidos == 0


async def test_desbloquear_un_usuario_que_no_existe_da_404(cliente):
    token = await _token_admin(cliente)
    r = await cliente.post("/auth/usuarios/999/desbloquear",
                           headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


async def test_desbloquear_pide_ser_admin(cliente):
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "malisima")
    # Sin token.
    r = await cliente.post("/auth/usuarios/2/desbloquear")
    assert r.status_code in (401, 403)
    # Con un token que no es de admin.
    from backend.core.security import create_access_token
    token = create_access_token({"sub": "matias", "id_usuario": 3, "rol": "operario",
                                 "nombre": "Matías", "apellido": "Gómez"})
    r = await cliente.post("/auth/usuarios/2/desbloquear",
                           headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert (await _usuario(cliente)).bloqueado_hasta is not None


# ─────────────── lo que no tiene que filtrar ───────────────

async def test_un_usuario_que_no_existe_no_filtra_nada(cliente):
    """El mismo mensaje genérico de siempre, sin cuenta de intentos ni bloqueo: nada
    que diga si ese nombre existe. Y no deja rastro en la base."""
    for _ in range(MAX_INTENTOS_FALLIDOS + 2):
        r = await _login(cliente, "loquesea", username="noexiste")
        assert r.status_code == 401
        assert _mensaje(r) == GENERICO
        assert r.json()["data"] is None
        assert "intento" not in r.text and "bloque" not in r.text

    async with cliente.sesiones() as s:
        usuarios = (await s.execute(select(Usuario))).scalars().all()
    assert all((u.intentos_fallidos or 0) == 0 and u.bloqueado_hasta is None for u in usuarios)
    assert await _filas_de_auditoria(cliente) == []


async def test_un_usuario_inactivo_sigue_viendo_lo_de_siempre(cliente):
    async with cliente.sesiones() as s:
        await s.execute(update(Usuario).where(Usuario.id_usuario == 2).values(activo=False))
        await s.commit()
    for _ in range(MAX_INTENTOS_FALLIDOS + 1):
        r = await _login(cliente, "malisima")
        assert r.status_code == 401
        assert "inactivo" in _mensaje(r).lower()
    assert (await _usuario(cliente)).intentos_fallidos == 0


# ─────────────────────────── la auditoría ───────────────────────────

async def test_el_bloqueo_queda_en_la_auditoria_una_sola_vez(cliente):
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "malisima")
    # Seguir probando mientras está bloqueada no repite la fila.
    await _login(cliente, "malisima")
    await _login(cliente, CLAVE_BUENA)

    filas = await _filas_de_auditoria(cliente)
    assert len(filas) == 1
    f = filas[0]
    assert f.accion == "bloqueó"
    assert f.entidad == "usuario" and f.id_entidad == "2"
    assert "lucas" in f.descripcion and "Lucas Longchamps" in f.descripcion
    assert "5 intentos fallidos" in f.descripcion
    # No lo hizo una persona: sin autor inventado. Y no se pinta de «no se pudo».
    assert f.usuario is None and f.id_usuario is None
    assert f.estado is None
    # Ninguna contraseña en el detalle.
    assert "malisima" not in (f.detalle or "") and CLAVE_BUENA not in (f.detalle or "")
    assert json.loads(f.detalle)["intentos_fallidos"] == MAX_INTENTOS_FALLIDOS


def test_el_desbloqueo_del_admin_se_lee_como_desbloqueo():
    """Lo anota el middleware, como toda escritura. Por método sería «creó usuario #2»."""
    fila = auditoria.armar_fila(
        usuario={"nombre": "Julián", "apellido": "Boxler", "id_usuario": 1},
        metodo="POST", ruta="/auth/usuarios/2/desbloquear", estado=200, duracion_ms=5,
    )
    assert fila.descripcion == "Julián Boxler desbloqueó usuario #2"
    assert fila.accion == "desbloqueó"
    assert auditoria.se_audita("POST", "/auth/usuarios/2/desbloquear")


async def test_si_la_auditoria_falla_el_bloqueo_igual_se_aplica(cliente_sin_auditoria):
    """La fila de auditoría no puede voltear el bloqueo: sin la tabla, la escritura
    falla, se traga, y la cuenta queda bloqueada igual."""
    c = cliente_sin_auditoria
    for _ in range(MAX_INTENTOS_FALLIDOS):
        r = await _login(c, "malisima")
    assert r.status_code == 423, r.text
    assert (await _usuario(c)).bloqueado_hasta is not None
    assert (await _login(c, CLAVE_BUENA)).status_code == 423


# ─────────────── los usuarios que ya existían ───────────────

async def test_los_que_ya_existian_arrancan_desbloqueados_y_entran(cliente):
    """Los dos usuarios del andamio se crearon sin tocar los campos nuevos —como los
    de producción antes de la migración— y entran de una."""
    for id_usuario in (1, 2):
        u = await _usuario(cliente, id_usuario)
        assert u.intentos_fallidos == 0 and u.bloqueado_hasta is None
    assert (await _login(cliente, CLAVE_BUENA)).status_code == 200
    assert (await _login(cliente, CLAVE_ADMIN, username="julian")).status_code == 200


def test_la_migracion_no_deja_a_nadie_afuera():
    """Lo que corre solo al levantar en producción: columnas nuevas con DEFAULT 0 y
    NULL, y ninguna sentencia que reescriba o borre filas."""
    sentencias = dict(migraciones.MIGRACIONES)["2026-09-22_bloqueo_por_intentos_fallidos"]
    ddl = [s.lower() for s in sentencias if not s.lower().startswith("comment on")]
    sql = " ".join(ddl)
    assert "add column if not exists intentos_fallidos integer not null default 0" in sql
    assert re.search(r"add column if not exists bloqueado_hasta timestamp(?!\s+not null)", sql)
    assert not re.search(r"\b(update|delete|truncate|drop)\b", sql)
    # Sin zona: como todas las fechas de la base.
    assert "with time zone" not in sql and "timestamptz" not in sql

    archivo = (Path(__file__).resolve().parent.parent / "scripts" / "migrations"
               / "2026-09-22_bloqueo_por_intentos_fallidos.sql").read_text().lower()
    sin_comentarios = re.sub(r"--[^\n]*", " ", archivo)
    assert not re.search(r"^\s*(update|delete|truncate|drop)\b", sin_comentarios, re.M)


# ─────────────── carreras y detalles del reloj ───────────────

async def test_un_intento_que_llega_tarde_no_corre_el_plazo(cliente):
    """Dos intentos que llegan juntos con la cuenta en 4 ven 5 y 6. El 6 no puede
    mover la hora que ya se le dijo al 5 (en Postgres se probó con 7 en paralelo)."""
    from backend.infrastructure.UsuarioRepository import UsuarioRepository
    ahora = ahora_ar()
    primero = ahora + timedelta(minutes=15)
    async with cliente.sesiones() as s:
        await s.execute(update(Usuario).where(Usuario.id_usuario == 2)
                        .values(intentos_fallidos=5, bloqueado_hasta=primero))
        await s.commit()
        intentos, hasta = await UsuarioRepository(s).registrar_intento_fallido(
            2, MAX_INTENTOS_FALLIDOS, primero + timedelta(minutes=3), ahora
        )
    assert intentos == 6
    assert hasta == primero


def test_el_plazo_se_redondea_al_minuto_y_dice_el_dia_si_cruza_la_medianoche():
    from datetime import datetime
    from backend.application.AuthService import _al_minuto_siguiente, _cuando
    assert _al_minuto_siguiente(datetime(2026, 9, 22, 21, 2, 49)) == datetime(2026, 9, 22, 21, 3)
    assert _al_minuto_siguiente(datetime(2026, 9, 22, 21, 3)) == datetime(2026, 9, 22, 21, 3)
    ahora = datetime(2026, 9, 22, 23, 50)
    assert _cuando(datetime(2026, 9, 22, 23, 59), ahora) == "las 23:59"
    assert _cuando(datetime(2026, 9, 23, 0, 5), ahora) == "el 23/09 a las 00:05"
