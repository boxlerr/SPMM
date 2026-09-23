"""RF-25: que entrar, salir y equivocarse la contraseña queden en Auditoría.

El SRS pide «registrar un log de todas las acciones realizadas por cada usuario». Hasta
el 23/09 el login estaba excluido a propósito (su cuerpo es una contraseña) y la única
huella era `usuario.ultimo_login`. Ahora queda, y este archivo persigue lo único que
esta parte no puede hacer mal:

  1. Que una contraseña, un token o un hash terminen en el registro. Se busca cada
     valor en TODAS las columnas de TODAS las filas, después de un recorrido completo.
  2. Que un usuario que no existe revele algo: ni en la respuesta (tiene que ser la de
     siempre) ni en el registro, donde lo tipeado va recortado — es lo que la gente
     escribe cuando pone la contraseña en la casilla del usuario.
  3. Que un intento fallido tenga autor. No sabemos quién tipeó: la cuenta que se
     intentó usar va en `id_entidad`, como el bloqueo de RF-26.

Contra la app REAL (con su middleware) y SQLite en memoria; la misma prueba corrió
contra un Postgres descartable antes del commit (ver el mensaje).
"""
import json

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.application.AuthService import MAX_INTENTOS_FALLIDOS
from backend.core.security import get_password_hash, get_sesiones_permisos
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.Usuario import Usuario
from backend.infrastructure import auditoria_movimientos as auditoria
from backend.infrastructure.db import Base
from backend.presentation import AuditoriaAPI, AuthAPI
from backend.presentation import main as main_mod
from backend.presentation.main import app

CLAVE_LUCAS = "laclavedelucas"
CLAVE_JULIAN = "laclavedeljefe"
CHROME_WINDOWS = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
DESDE_EL_TALLER = {"User-Agent": CHROME_WINDOWS, "X-Forwarded-For": "10.0.0.9, 181.45.67.89"}


@pytest_asyncio.fixture
async def cliente(monkeypatch):
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=[Usuario.__table__, AuditoriaMovimiento.__table__]))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        s.add_all([
            Usuario(id_usuario=1, username="julian", email="julian@vaxler.com.ar",
                    password_hash=get_password_hash(CLAVE_JULIAN), nombre="Julián",
                    apellido="Boxler", rol="admin", activo=True),
            Usuario(id_usuario=2, username="lucas", email="lucas@metalurgicalongchamps.com",
                    password_hash=get_password_hash(CLAVE_LUCAS), nombre="Lucas",
                    apellido="Longchamps", rol="admin", activo=True),
            Usuario(id_usuario=3, username="ana", email="ana@metalurgicalongchamps.com",
                    password_hash=get_password_hash(CLAVE_LUCAS), nombre="Ana",
                    apellido="Pérez", rol="operario", activo=False),
        ])
        await s.commit()

    async def _db():
        async with Sesion() as s:
            yield s

    app.dependency_overrides[AuthAPI.get_db] = _db
    app.dependency_overrides[AuditoriaAPI.get_db] = _db
    app.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    # La fila la escribe el middleware con una sesión PROPIA: que sea esta base.
    monkeypatch.setattr(main_mod, "SessionLocal", Sesion)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


async def _filas(cliente) -> list[AuditoriaMovimiento]:
    async with cliente.sesiones() as s:
        return (await s.execute(
            select(AuditoriaMovimiento).order_by(AuditoriaMovimiento.id)
        )).scalars().all()


def _todo_el_texto(filas) -> str:
    """Cada columna de cada fila, junta: donde un secreto no puede aparecer."""
    return json.dumps(
        [[str(getattr(f, c.name)) for c in AuditoriaMovimiento.__table__.columns] for f in filas],
        ensure_ascii=False,
    )


async def _login(cliente, username, password, **kw):
    return await cliente.post("/auth/login", json={"username": username, "password": password}, **kw)


# ─────────────────────────── entrar ───────────────────────────

async def test_entrar_bien_queda_con_quien_desde_donde_y_con_que(cliente):
    r = await _login(cliente, "lucas", CLAVE_LUCAS, headers=DESDE_EL_TALLER)
    assert r.status_code == 200

    [fila] = await _filas(cliente)
    assert fila.accion == "ingresó"
    assert fila.entidad == "sesión"
    assert (fila.id_usuario, fila.usuario, fila.id_entidad) == (2, "Lucas Longchamps", "2")
    assert fila.descripcion == "Lucas Longchamps entró al sistema"
    assert fila.estado == 200
    detalle = json.loads(fila.detalle)
    assert detalle["resultado"] == "bien"
    assert detalle["cuenta"] == "lucas"
    # La ÚLTIMA de X-Forwarded-For (la pone el frente de Google, no el navegador).
    assert detalle["ip"] == "181.45.67.89"
    assert detalle["navegador"] == "Chrome en Windows"


async def test_clave_mala_queda_sin_autor_y_con_la_cuenta(cliente):
    """No sabemos quién tipeó: la cuenta va en id_entidad y en la frase, no como autor."""
    r = await _login(cliente, "lucas", "noesesta1")
    assert r.status_code == 401

    [fila] = await _filas(cliente)
    assert fila.accion == "intento fallido"
    assert fila.id_usuario is None and fila.usuario is None
    assert fila.id_entidad == "2"
    assert fila.estado == 401
    assert "«lucas» (Lucas Longchamps)" in fila.descripcion
    assert "contraseña incorrecta" in fila.descripcion
    assert f"Le quedan {MAX_INTENTOS_FALLIDOS - 1} intentos" in fila.descripcion
    assert "noesesta1" not in _todo_el_texto([fila])


async def test_un_usuario_que_no_existe_no_filtra_nada(cliente):
    """La respuesta es la de siempre (no dice que el usuario no existe) y el registro
    guarda lo tipeado recortado: acá lo tipeado ES una contraseña, en la casilla
    equivocada."""
    r = await _login(cliente, "MiClaveSecreta77", "otracosa9")
    assert r.status_code == 401
    cuerpo = r.json()
    assert cuerpo["errors"][0]["message"] == "Usuario o contraseña incorrectos"
    assert "intentos_restantes" not in json.dumps(cuerpo)

    [fila] = await _filas(cliente)
    assert fila.accion == "intento fallido"
    assert fila.id_usuario is None and fila.usuario is None and fila.id_entidad is None
    assert "no existe" in fila.descripcion
    assert "«MiC…»" in fila.descripcion
    todo = _todo_el_texto([fila])
    assert "MiClaveSecreta77" not in todo and "Secreta" not in todo
    assert "otracosa9" not in todo
    assert "cuenta" not in json.loads(fila.detalle)


async def test_una_cuenta_desactivada_dice_por_que_no_entro(cliente):
    r = await _login(cliente, "ana", CLAVE_LUCAS)
    assert r.status_code == 401
    [fila] = await _filas(cliente)
    assert fila.accion == "intento fallido" and fila.id_entidad == "3"
    assert "desactivada" in fila.descripcion


async def test_cinco_errores_dejan_cinco_intentos_y_el_bloqueo(cliente):
    """Y con la cuenta bloqueada, ni la contraseña buena entra: también queda, y dice
    que la clave no se miró."""
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "lucas", "malamala1")
    r = await _login(cliente, "lucas", CLAVE_LUCAS)
    assert r.status_code == 423

    filas = await _filas(cliente)
    acciones = [f.accion for f in filas]
    assert acciones.count("intento fallido") == MAX_INTENTOS_FALLIDOS + 1
    assert acciones.count("bloqueó") == 1
    quinto = [f for f in filas if f.accion == "intento fallido"][MAX_INTENTOS_FALLIDOS - 1]
    assert quinto.estado == 423 and "quedó bloqueada" in quinto.descripcion
    ultimo = filas[-1]
    assert ultimo.accion == "intento fallido" and "no se miró la contraseña" in ultimo.descripcion
    assert CLAVE_LUCAS not in _todo_el_texto(filas)


# ─────────────────────────── salir ───────────────────────────

async def test_salir_queda_y_sin_sesion_no(cliente):
    r = await _login(cliente, "lucas", CLAVE_LUCAS)
    tok = r.json()["data"]["access_token"]

    assert (await cliente.post("/auth/logout", headers={"Authorization": f"Bearer {tok}"})).status_code == 200
    # Sin sesión no hay a quién atribuirla ni nada que cerrar: no deja fila.
    assert (await cliente.post("/auth/logout")).status_code in (401, 403)
    assert (await cliente.post("/auth/logout", headers={"Authorization": "Bearer basura"})).status_code == 401

    filas = await _filas(cliente)
    assert [f.accion for f in filas] == ["ingresó", "salió"]
    salio = filas[-1]
    assert (salio.id_usuario, salio.usuario, salio.id_entidad) == (2, "Lucas Longchamps", "2")
    assert salio.descripcion == "Lucas Longchamps salió del sistema"


# ─────────────────────────── las claves ───────────────────────────

async def test_cambiar_restablecer_y_recuperar_quedan_sin_ninguna_clave(cliente):
    """El recorrido entero, y después se busca cada secreto en todo el registro."""
    r = await _login(cliente, "lucas", CLAVE_LUCAS)
    tok = r.json()["data"]["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    r = await cliente.post("/auth/change-password", headers=h, json={
        "current_password": "noesmiclave1", "new_password": "clavenueva22",
        "confirm_password": "clavenueva22"})
    assert r.status_code == 400
    r = await cliente.post("/auth/change-password", headers=h, json={
        "current_password": CLAVE_LUCAS, "new_password": "clavenueva22",
        "confirm_password": "clavenueva22"})
    assert r.status_code == 200
    # Las dos nuevas no coinciden: lo frena la validación, antes del endpoint (y en esta
    # app la validación contesta 400, no 422: exception_handlers).
    r = await cliente.post("/auth/change-password", headers=h, json={
        "current_password": "clavenueva22", "new_password": "otra333333",
        "confirm_password": "distinta4444"})
    assert r.status_code == 400
    r = await cliente.post("/auth/reset-password", json={
        "token": "EnlaceFalsoQueNoExiste", "new_password": "reseteada55",
        "confirm_password": "reseteada55"})
    assert r.status_code == 400
    r = await cliente.post("/auth/forgot-password", json={"email": "lucas@metalurgicalongchamps.com"})
    assert r.status_code == 200
    r = await cliente.post("/auth/forgot-password", json={"email": "nadie@ningunlado.com"})
    assert r.status_code == 200

    filas = await _filas(cliente)
    por_accion = {}
    for f in filas:
        por_accion.setdefault(f.accion, []).append(f)

    mal, bien, incompleto = por_accion["cambió su clave"]
    assert mal.estado == 400 and "la contraseña actual no es correcta" in mal.descripcion
    assert bien.estado == 200 and bien.descripcion == "Lucas Longchamps cambió su contraseña"
    assert incompleto.estado == 400 and "no pudo cambiar su contraseña" in incompleto.descripcion
    assert "no coinciden" in incompleto.descripcion and "error del sistema" not in incompleto.descripcion
    assert all(f.id_usuario == 2 and f.entidad == "contraseña" for f in (mal, bien, incompleto))

    [reset] = por_accion["restableció clave"]
    assert reset.id_usuario is None and "el enlace no es válido" in reset.descripcion

    de_lucas, de_nadie = por_accion["pidió recuperar"]
    assert de_lucas.id_entidad == "2" and "«lucas»" in de_lucas.descripcion
    assert de_nadie.id_entidad is None and "«nad…»" in de_nadie.descripcion

    todo = _todo_el_texto(filas)
    for secreto in (CLAVE_LUCAS, "noesmiclave1", "clavenueva22", "otra333333", "distinta4444",
                    "EnlaceFalsoQueNoExiste", "reseteada55", tok, "nadie@ningunlado.com", "$2b$"):
        assert secreto not in todo, f"«{secreto[:12]}…» quedó en el registro"


async def test_desbloquear_dice_de_quien_era_la_cuenta(cliente):
    for _ in range(MAX_INTENTOS_FALLIDOS):
        await _login(cliente, "lucas", "malamala1")
    tok = (await _login(cliente, "julian", CLAVE_JULIAN)).json()["data"]["access_token"]
    r = await cliente.post("/auth/usuarios/2/desbloquear", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text

    fila = (await _filas(cliente))[-1]
    assert fila.accion == "desbloqueó"
    assert (fila.id_usuario, fila.entidad, fila.id_entidad) == (1, "usuario", "2")
    assert fila.descripcion == "Julián Boxler desbloqueó la cuenta de «lucas»"


# ─────────────────────────── la vista Ingresos ───────────────────────────

async def test_la_vista_ingresos_y_el_filtro_por_persona_traen_lo_de_su_cuenta(cliente):
    """Filtrar por Lucas trae lo que él hizo Y los intentos fallidos contra su cuenta
    (que no tienen autor): es lo que se busca cuando dice «no puedo entrar»."""
    await _login(cliente, "lucas", "malamala1")
    await _login(cliente, "lucas", CLAVE_LUCAS)
    tok = (await _login(cliente, "julian", CLAVE_JULIAN)).json()["data"]["access_token"]
    h = {"Authorization": f"Bearer {tok}"}

    r = await cliente.get("/auditoria/movimientos", headers=h,
                          params={"tipo": "ingresos", "id_usuario": 2, "opciones": "false"})
    assert r.status_code == 200, r.text
    assert [m["accion"] for m in r.json()["movimientos"]] == ["ingresó", "intento fallido"]

    r = await cliente.get("/auditoria/movimientos", headers=h,
                          params={"tipo": "ingresos", "solo_fallidos": "true", "opciones": "false"})
    assert [m["id_entidad"] for m in r.json()["movimientos"]] == ["2"]


# ─────────────────────────── las piezas, sin base ───────────────────────────

@pytest.mark.parametrize("tipeado,esperado", [
    ("juancito", "jua…"),
    ("juan", "ju…"),
    ("ana", "a…"),
    ("ab", "a…"),
    ("x", "…"),
    ("   ", "(vacío)"),
    (None, "(vacío)"),
])
def test_lo_tipeado_se_recorta_a_lo_sumo_a_tres_letras_y_nunca_a_mas_de_la_mitad(tipeado, esperado):
    assert auditoria.recortar_tipeado(tipeado) == esperado


def test_el_resumen_no_deja_pasar_lo_tipeado_entero():
    r = auditoria.resumen_de_intento({"tipeado": "MiClaveSecreta77", "motivo": "usuario_inexistente"})
    assert r == {"motivo": "usuario_inexistente", "tipeado": "MiC…"}
    # De una cuenta que existe, lo tipeado ni siquiera viaja: alcanza con la cuenta.
    r = auditoria.resumen_de_intento({"tipeado": "lucas@x.com", "id_usuario": 2, "cuenta": "lucas",
                                      "motivo": "clave_incorrecta"})
    assert "tipeado" not in r and r["cuenta"] == "lucas"


@pytest.mark.parametrize("agente,esperado", [
    (CHROME_WINDOWS, "Chrome en Windows"),
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
     "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Safari en iPhone"),
    ("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
     "Chrome/128.0.0.0 Mobile Safari/537.36", "Chrome en Android"),
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
     "Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0", "Edge en Windows"),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0",
     "Firefox en Mac"),
    ("curl/8.4.0", "programa (curl)"),
    ("", None),
])
def test_el_navegador_se_lee_de_un_vistazo(agente, esperado):
    assert auditoria.describir_navegador(agente) == esperado


def test_la_ip_es_la_ultima_de_x_forwarded_for_y_si_no_la_del_socket():
    assert auditoria.origen_del_pedido({"x-forwarded-for": "6.6.6.6, 181.1.2.3"})["ip"] == "181.1.2.3"
    assert auditoria.origen_del_pedido({}, "127.0.0.1") == {"ip": "127.0.0.1"}
    assert auditoria.origen_del_pedido({}, None) == {}


def test_un_login_que_ni_llego_al_endpoint_queda_igual():
    """Un 422 (faltó un campo) no pasa por el endpoint: la fila sale sin cuenta."""
    fila = auditoria.armar_fila(usuario=None, metodo="POST", ruta="/auth/login", estado=422,
                                duracion_ms=3, cuerpo={"password": "x"})
    assert fila.accion == "intento fallido" and fila.id_usuario is None
    assert "incompleto" in fila.descripcion
    assert "password" not in (fila.detalle or "")


def test_el_login_y_las_claves_no_se_leen_del_cuerpo():
    for ruta in ("/auth/login", "/auth/change-password", "/auth/reset-password",
                 "/auth/forgot-password"):
        assert not auditoria.se_lee_el_cuerpo(ruta, "application/json", 50)
        assert auditoria.se_audita("POST", ruta)
    assert auditoria.se_audita("POST", "/auth/logout")


# ─────────────────────────── el tope de lo que se escribe sin identificarse ───────────────────────────
#
# Revisión del 23/09: cualquiera, sin sesión, escribía una fila por cada login o pedido de
# recuperación. Un script en bucle llenaba la tabla (y la vista Ingresos) y usaba una
# conexión del pooler por fila. Ahora hay un tope por IP (auditoria_movimientos,
# «EL TOPE DE LOS PEDIDOS SIN IDENTIFICARSE»).

DESDE_AFUERA = {"User-Agent": "python-requests/2.31", "X-Forwarded-For": "203.0.113.50"}


async def test_un_bucle_desde_una_ip_no_llena_el_registro(cliente, monkeypatch):
    """Con el tope en 5 (en producción es 30): 12 logins con usuarios inventados, uno con
    el cuerpo roto y un pedido de recuperación desde la MISMA IP dejan 5 filas, y la
    quinta avisa. Desde otra IP, el intento sigue quedando; y entrar bien, también."""
    monkeypatch.setattr(auditoria.TOPE_ANONIMOS, "tope", 5)
    for i in range(12):
        r = await _login(cliente, f"bot{i:03d}x", "loquesea", headers=DESDE_AFUERA)
        assert r.status_code == 401  # la respuesta es la de siempre: el tope no la cambia
    r = await cliente.post("/auth/login", json={"nada": 1}, headers=DESDE_AFUERA)
    assert r.status_code in (400, 422)
    r = await cliente.post("/auth/forgot-password", json={"email": "x@inventado.com"},
                           headers=DESDE_AFUERA)
    assert r.status_code == 200

    filas = await _filas(cliente)
    assert len(filas) == 5
    assert all(f.accion == "intento fallido" and f.id_usuario is None for f in filas)
    ultima = filas[-1]
    assert "Desde esta IP ya van 5 pedidos sin identificarse en la última hora" in ultima.descripcion
    assert json.loads(ultima.detalle)["tope"]["cuantos"] == 5
    assert "ya van" not in filas[-2].descripcion

    # Otra IP no paga lo de la primera.
    r = await _login(cliente, "lucas", "noesesta1", headers=DESDE_EL_TALLER)
    assert r.status_code == 401
    # Y quien entra bien tiene autor: no cuenta para el tope aunque venga de esa IP.
    r = await _login(cliente, "lucas", CLAVE_LUCAS, headers=DESDE_AFUERA)
    assert r.status_code == 200
    filas = await _filas(cliente)
    assert len(filas) == 7
    assert filas[-2].id_entidad == "2" and filas[-2].accion == "intento fallido"
    assert filas[-1].accion == "ingresó"


def _fila_anonima(cuando, **kw):
    fila = auditoria.armar_fila(usuario=None, metodo="POST", ruta="/auth/login", estado=401,
                                duracion_ms=3, resumen={"acceso": {"motivo": "usuario_inexistente",
                                                                   "tipeado": "adm…"}},
                                origen={"ip": "203.0.113.50"}, **kw)
    fila.creado_en = cuando
    return fila


def test_pasada_la_hora_vuelve_a_registrar_y_dice_cuantos_se_omitieron():
    from datetime import datetime, timedelta

    tope = auditoria.TopeSinIdentificarse(tope=3, ventana=timedelta(hours=1))
    t0 = datetime(2026, 9, 23, 14, 40)
    origen = {"ip": "203.0.113.50"}
    guardadas = [auditoria.aplicar_tope(_fila_anonima(t0 + timedelta(minutes=i)), origen, tope)
                 for i in range(10)]
    assert [f is not None for f in guardadas] == [True] * 3 + [False] * 7
    assert "hasta las 15:40 no se registran uno por uno" in guardadas[2].descripcion

    # 14:40 + 1 h: vuelve a registrar, y la primera cuenta los 7 que no quedaron.
    otra = auditoria.aplicar_tope(_fila_anonima(t0 + timedelta(hours=1)), origen, tope)
    assert otra is not None
    assert "se dejaron de registrar 7 pedidos más sin identificarse" in otra.descripcion
    assert json.loads(otra.detalle)["omitidos_antes"] == 7


def test_lo_que_tiene_autor_o_no_es_de_acceso_no_cuenta_para_el_tope():
    from datetime import datetime, timedelta

    tope = auditoria.TopeSinIdentificarse(tope=1, ventana=timedelta(hours=1))
    ahora = datetime(2026, 9, 23, 10, 0)
    origen = {"ip": "203.0.113.50"}
    assert auditoria.aplicar_tope(_fila_anonima(ahora), origen, tope) is not None
    assert auditoria.aplicar_tope(_fila_anonima(ahora), origen, tope) is None
    # Entrar bien, salir, cambiar la clave: tienen autor.
    entro = auditoria.armar_fila(usuario=None, metodo="POST", ruta="/auth/login", estado=200,
                                 duracion_ms=3, resumen={"acceso": {"id_usuario": 2, "cuenta": "lucas",
                                                                    "nombre": "Lucas"}},
                                 origen=origen)
    assert auditoria.aplicar_tope(entro, origen, tope) is entro
    # Restablecer con un enlace válido no se repite en bucle: no cuenta.
    restablecio = auditoria.armar_fila(usuario=None, metodo="POST", ruta="/auth/reset-password",
                                       estado=200, duracion_ms=3,
                                       resumen={"acceso": {"id_usuario": 2, "cuenta": "lucas"}},
                                       origen=origen)
    assert auditoria.aplicar_tope(restablecio, origen, tope) is restablecio
    # Lo que no es de acceso (editar una OT sin sesión: la rechaza la política) tampoco.
    ot = auditoria.armar_fila(usuario=None, metodo="PUT", ruta="/ordenes/5", estado=401,
                              duracion_ms=3)
    assert auditoria.aplicar_tope(ot, None, tope) is ot


def test_la_memoria_del_tope_no_crece_sin_fin(monkeypatch):
    from datetime import datetime, timedelta

    monkeypatch.setattr(auditoria, "_MAX_IPS_EN_MEMORIA", 50)
    tope = auditoria.TopeSinIdentificarse(tope=3, ventana=timedelta(hours=1))
    t0 = datetime(2026, 9, 23, 8, 0)
    for i in range(200):
        tope.decidir(f"10.0.{i // 250}.{i % 250}", t0)
    # Dos horas después, una IP nueva barre las vencidas.
    tope.decidir("198.51.100.1", t0 + timedelta(hours=2))
    assert len(tope._por_ip) == 1
