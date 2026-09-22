"""Que quede registrado TODO lo que alguien crea, edita o elimina.

Pedido de Julián (15/09): «log en auditoría de cada cosa que se haga, se agregue,
edite o elimine de TODO». Antes de esto el sistema auditaba UNA sola cosa —los
intentos de planificar— y ninguna otra pantalla. Con el taller ya cargando los datos
de verdad, «¿quién cambió esto?» no tenía respuesta.

El registro lo escribe un middleware, no los servicios. Eso trae DOS riesgos que sólo
un test agarra, y son los que este archivo persigue:

  1. **Que el middleware se coma el cuerpo del pedido.** Lee el JSON antes que el
     endpoint para poder guardarlo; si lo consume, TODOS los guardados del sistema se
     rompen a la vez. Es la clase de bug que no se ve leyendo el código.
  2. **Que una contraseña termine en el registro.** El alta de usuario manda la clave
     en el cuerpo, y el cuerpo es justo lo que esto guarda.

Y uno tercero, de diseño: que un fallo de la auditoría voltee la operación. Guardar
una OT no puede fracasar porque no se pudo escribir la fila del log.
"""
import json

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.middleware.base import BaseHTTPMiddleware

from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.infrastructure import auditoria_movimientos as auditoria
from backend.infrastructure.db import Base


# ─────────────────────────── el andamio ───────────────────────────

@pytest_asyncio.fixture
async def registro():
    """Una base con SÓLO la tabla de auditoría, y la fábrica de sesiones que usa el
    middleware. Devuelve (sessionmaker, leer()) donde leer() trae las filas."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(c, tables=[AuditoriaMovimiento.__table__])
        )
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def leer():
        from sqlalchemy import select
        async with Session() as s:
            return (await s.execute(
                select(AuditoriaMovimiento).order_by(AuditoriaMovimiento.id)
            )).scalars().all()

    yield Session, leer
    await engine.dispose()


@pytest_asyncio.fixture
async def app_de_juguete(registro, monkeypatch):
    """La app mínima con el middleware DE VERDAD —el de main.py, no una copia— y unos
    endpoints que devuelven lo que recibieron.

    Se monta aparte y no sobre la app real porque los endpoints reales necesitan la
    base entera; lo que se prueba acá es el middleware, y tiene que ser el mismo
    objeto que corre en producción o el test no prueba nada.
    """
    from backend.presentation import main

    Session, _ = registro
    monkeypatch.setattr(main, "SessionLocal", Session)

    app = FastAPI()
    app.add_middleware(BaseHTTPMiddleware, dispatch=main.auditar_movimientos)

    @app.post("/procesos")
    async def crear_proceso(datos: dict):
        return {"recibido": datos}

    @app.put("/operarios/{id}")
    async def editar_operario(id: int, datos: dict):
        return {"id": id, "recibido": datos}

    @app.delete("/maquinarias/{id}")
    async def borrar_maquina(id: int):
        return {"borrado": id}

    @app.get("/procesos")
    async def listar():
        return []

    @app.post("/auth/usuarios")
    async def crear_usuario(datos: dict):
        return {"creado": datos.get("username")}

    @app.post("/auth/login")
    async def login(datos: dict):
        return {"token": "x"}

    @app.put("/notificaciones/{id}/leida")
    async def marcar_leida(id: int):
        return {"ok": True}

    @app.post("/ordenes")
    async def crear_orden(datos: dict):
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="ya existe una OT con ese número")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


# ─────────────────── lo que nunca puede romperse ───────────────────

@pytest.mark.asyncio
async def test_el_endpoint_sigue_recibiendo_el_cuerpo_entero(app_de_juguete):
    """EL riesgo del diseño: el middleware lee el JSON antes que el endpoint.

    Si al leerlo lo consumiera, se romperían de golpe todos los guardados del sistema
    —crear una OT, editar un proceso, guardar un plan— y el síntoma sería un cuelgue,
    no un error. Por eso el endpoint devuelve lo que recibió y acá se compara entero.
    """
    enviado = {"nombre": "TORNEADO", "minutos": 45, "pasos": [{"orden": 1}, {"orden": 2}]}
    r = await app_de_juguete.post("/procesos", json=enviado)

    assert r.status_code == 200
    assert r.json()["recibido"] == enviado


@pytest.mark.asyncio
async def test_una_contrasena_nunca_llega_al_registro(app_de_juguete, registro):
    """El alta de usuario manda la clave en el cuerpo, y el cuerpo es lo que se guarda."""
    _, leer = registro
    await app_de_juguete.post("/auth/usuarios", json={
        "username": "lucas",
        "password": "elsecretodelcliente",
        "nombre": "Lucas",
        "apellido": "Gomez",
        "email": "lucas@metlo.com",
    })

    filas = await leer()
    assert len(filas) == 1
    entero = json.dumps([f.detalle for f in filas], ensure_ascii=False)
    assert "elsecretodelcliente" not in entero
    assert "***" in entero
    # Pero SÍ queda que se creó el usuario, y cuál: taparlo todo no sería auditoría.
    assert "lucas" in filas[0].descripcion.lower()


@pytest.mark.asyncio
async def test_si_falla_el_registro_la_operacion_sigue(app_de_juguete, monkeypatch, registro):
    """Guardar una OT no puede fracasar porque no se pudo escribir el log."""
    from backend.presentation import main

    class SesionRota:
        async def __aenter__(self): raise RuntimeError("base caída")
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(main, "SessionLocal", lambda: SesionRota())

    r = await app_de_juguete.post("/procesos", json={"nombre": "FRESADO"})
    assert r.status_code == 200
    assert r.json()["recibido"] == {"nombre": "FRESADO"}

    _, leer = registro
    assert await leer() == []   # no se guardó nada, y no se rompió nada


# ───────────────────── qué queda y qué no ─────────────────────

@pytest.mark.asyncio
async def test_crear_editar_y_eliminar_dejan_su_fila(app_de_juguete, registro):
    _, leer = registro
    await app_de_juguete.post("/procesos", json={"nombre": "TORNEADO"})
    await app_de_juguete.put("/operarios/7", json={"nombre": "Juan", "apellido": "Perez"})
    await app_de_juguete.delete("/maquinarias/12")

    filas = await leer()
    assert [f.accion for f in filas] == ["creó", "editó", "eliminó"]
    assert [f.entidad for f in filas] == ["proceso", "persona", "máquina"]
    assert [f.id_entidad for f in filas] == [None, "7", "12"]
    assert all(f.creado_en is not None and f.duracion_ms is not None for f in filas)


@pytest.mark.asyncio
async def test_leer_no_deja_rastro(app_de_juguete, registro):
    """Un GET no cambia nada y son casi todo el tráfico: guardarlos ahogaría el
    registro y ninguno contesta «quién tocó esto»."""
    _, leer = registro
    await app_de_juguete.get("/procesos")
    assert await leer() == []


@pytest.mark.asyncio
async def test_entrar_y_marcar_leida_no_se_registran(app_de_juguete, registro):
    """Entrar ya queda en `usuario.ultimo_login` y su cuerpo es una contraseña; marcar
    una notificación como leída es una fila por campanita que no dice nada."""
    _, leer = registro
    await app_de_juguete.post("/auth/login", json={"username": "a", "password": "b"})
    await app_de_juguete.put("/notificaciones/33/leida")
    assert await leer() == []


@pytest.mark.asyncio
async def test_lo_que_no_se_pudo_hacer_tambien_queda(app_de_juguete, registro):
    """Es la pregunta más frecuente del taller: «le di a guardar y no pasó nada»."""
    _, leer = registro
    r = await app_de_juguete.post("/ordenes", json={"id_otvieja": 15739})
    assert r.status_code == 409

    fila = (await leer())[0]
    assert fila.estado == 409
    assert "no se pudo" in fila.descripcion
    assert "15739" in fila.descripcion   # cuál era, no sólo que falló


# ──────────────── cómo se lee la frase en pantalla ────────────────

@pytest.mark.parametrize("metodo,ruta,esperado", [
    ("POST", "/ordenes", "Julián Boxler creó orden de trabajo"),
    ("PUT", "/ordenes/1081", "Julián Boxler editó orden de trabajo #1081"),
    ("DELETE", "/operarios/5", "Julián Boxler eliminó persona #5"),
    ("PUT", "/rangos/7/procesos", "Julián Boxler editó categoría › procesos #7"),
    ("POST", "/operarios/3/skills", "Julián Boxler creó persona › capacidades #3"),
    ("DELETE", "/ordenes/12/procesos/100", "Julián Boxler eliminó orden de trabajo › procesos #12"),
    ("POST", "/planificar", "Julián Boxler creó planificación"),
    ("DELETE", "/config/availability/2026-09-20",
     "Julián Boxler eliminó calendario del taller #2026-09-20"),
    ("POST", "/auth/usuarios", "Julián Boxler creó usuario"),
])
def test_la_frase_se_lee_en_castellano(metodo, ruta, esperado):
    """La pantalla muestra esta frase y nada más. Tiene que entenderse sin saber qué
    es un PUT ni qué es un endpoint — la misma regla que se aplicó a los avisos de
    pre-planificación."""
    fila = auditoria.armar_fila(
        usuario={"nombre": "Julián", "apellido": "Boxler", "id_usuario": 1},
        metodo=metodo, ruta=ruta, estado=200, duracion_ms=10,
    )
    assert fila.descripcion == esperado


def test_sin_usuario_dice_alguien_y_no_inventa_un_autor():
    fila = auditoria.armar_fila(
        usuario=None, metodo="DELETE", ruta="/procesos/9", estado=200, duracion_ms=5
    )
    assert fila.descripcion == "alguien eliminó proceso #9"
    assert fila.usuario is None and fila.id_usuario is None


# ──────────────────── el tamaño del detalle ────────────────────

def test_un_archivo_no_se_copia_al_registro():
    """Un plano llega en base64 dentro del cuerpo. Guardarlo sería duplicar el
    archivo en cada fila del log."""
    fila = auditoria.armar_fila(
        usuario=None, metodo="POST", ruta="/procesos", estado=200, duracion_ms=1,
        cuerpo={"nombre": "X", "archivo_b64": "A" * 50_000},
    )
    assert "A" * 400 not in (fila.detalle or "")
    assert "50000 caracteres" in fila.detalle


def test_el_detalle_tiene_tope():
    """Un plan confirmado manda cientos de filas; no hace falta la copia entera."""
    fila = auditoria.armar_fila(
        usuario=None, metodo="POST", ruta="/planificar", estado=200, duracion_ms=1,
        cuerpo={"ordenes": [{"id": i, "nombre": f"OT{i}"} for i in range(500)]},
    )
    assert len(fila.detalle) <= auditoria.TOPE_DETALLE


def test_del_cuerpo_de_un_plano_no_se_lee_nada():
    """No es un formulario: es el archivo. Y viene como multipart, no como JSON."""
    assert not auditoria.se_lee_el_cuerpo("/planos", "multipart/form-data; boundary=x", 900)
    assert not auditoria.se_lee_el_cuerpo("/procesos", "application/json", 10 * 1024 * 1024)
    assert auditoria.se_lee_el_cuerpo("/procesos", "application/json", 900)


def test_el_forzar_del_borrado_queda_anotado():
    """«Eliminar igual» es una decisión, no un detalle: si alguien borró a sabiendas
    de que perdía datos, el registro tiene que poder decirlo."""
    fila = auditoria.armar_fila(
        usuario={"nombre": "Lucas", "apellido": "", "id_usuario": 2},
        metodo="DELETE", ruta="/operarios/5", estado=200, duracion_ms=8,
        parametros={"forzar": "true"},
    )
    assert "forzar" in fila.detalle and "true" in fila.detalle


# ────────────────── que no se olvide ningún endpoint ──────────────────

def test_toda_ruta_de_escritura_de_la_app_queda_auditada():
    """La razón de ser del middleware: que el próximo endpoint quede cubierto solo.

    Este test recorre la tabla de rutas REAL de FastAPI y exige que cada POST/PUT/
    PATCH/DELETE o bien se audite, o bien esté en la lista de excepciones explicada
    en auditoria_movimientos.py. Una pantalla nueva sin auditoría pone esto en rojo.
    """
    from backend.presentation.main import app

    sin_auditar = []
    for ruta in app.routes:
        for metodo in getattr(ruta, "methods", None) or []:
            if metodo not in auditoria.ACCION:
                continue
            # La ruta real trae `{id}`; se reemplaza por un número para que el
            # clasificador vea lo mismo que ve en producción.
            import re
            concreta = re.sub(r"\{[^}]+\}", "1", ruta.path)
            if not auditoria.se_audita(metodo, concreta):
                sin_auditar.append(f"{metodo} {ruta.path}")

    esperadas = {
        "POST /auth/login", "POST /auth/logout", "POST /auth/refresh",
        "PUT /notificaciones/leer-todas", "PUT /notificaciones/{id}/leida",
        # El cron del sync: no lo llama una persona y son 48 por día.
        "POST /internal/sync",
        # El cron del aviso de órdenes retrasadas: mismo motivo, tampoco lo llama nadie.
        "POST /internal/alertas-retraso",
        # El cron de todos los avisos juntos (retraso + stock bajo, RF-14): ídem.
        "POST /internal/alertas",
    }
    assert set(sin_auditar) <= esperadas, (
        f"estas escrituras quedaron fuera del registro sin motivo: "
        f"{sorted(set(sin_auditar) - esperadas)}"
    )


def test_toda_entidad_del_diccionario_se_lee_como_la_nombra_el_taller():
    """Si mañana alguien agrega una entrada con el nombre técnico, esto lo frena."""
    tecnicos = {"ordenes", "operarios", "maquinarias", "rangos", "otp", "ot"}
    for camino, nombre in auditoria.ENTIDAD.items():
        assert nombre not in tecnicos, f"«{camino}» se muestra como «{nombre}»"
        # Arranca en minúscula porque se lee en el medio de una frase («Lucas
        # editó ...»). Adentro puede haber una sigla, que es como se dice acá.
        assert nombre[0] == nombre[0].lower(), (
            f"«{nombre}» va en minúscula: se lee en el medio de una frase")


def test_el_cron_del_sync_no_ensucia_el_registro():
    """48 renglones por día de «alguien creó internal › sync» taparían lo que se busca.

    Cloud Scheduler le pega a `POST /internal/sync` cada 30 minutos. No lo llama una
    persona, así que el renglón sale sin nombre y no contesta «quién tocó esto»; y el
    sync ya se loguea solo en Cloud Run con sus propios números. A las tres horas de
    estar en producción, 7 de las 9 filas del registro eran el cron.
    """
    assert not auditoria.se_audita("POST", "/internal/sync")
    # Pero una escritura de verdad sigue entrando.
    assert auditoria.se_audita("POST", "/ordenes")
