"""
RF-19: bajar una copia completa y restaurarla desde la app (CopiaSeguridadAPI), contra
la app real de FastAPI.

Lo que se prueba:

- La ida y vuelta: copia -> se cambian datos -> se restaura -> todo igual que antes.
- Que un archivo adulterado (hash que no coincide), dañado, de otra versión, de otro
  tamaño o una bomba de zip se rechace SIN tocar nada. Y que uno adulterado con los
  hashes rehechos (sin la firma del servidor) nunca traiga los usuarios, y los datos
  sólo si se confirma aparte.
- Que una tabla o columna desconocida (aun con un nombre armado para inyectar SQL) se
  informe y se ignore.
- Que sea sólo del admin (403 para el resto).
- Que si la restauración falla a la mitad, la base quede como estaba.
- Que la copia del estado actual se arme ANTES de tocar datos, y que sin ella no se
  restaure.
- Que los usuarios no se toquen salvo que se pida, y que ni así el admin que restaura
  quede afuera; que nadie vuelva a una contraseña vieja, que no se reactive a nadie y
  que los administradores permanentes queden como están.
- Que la copia no lleve contraseñas ni tokens de recuperación.
- Que una fila de `plano` no pueda apuntar a la carpeta de las copias automáticas.
- Que la salida «ya bajé la copia» no pierda lo que se guardó después de bajarla.
- Que las secuencias queden bien: después de restaurar se crea una fila nueva sin
  chocar ids.
- La auditoría: quién bajó (anotado antes del primer byte, también si se corta), quién
  intentó bajar sin permiso, quién restauró qué y cuántas filas.

CONTRA QUÉ BASE

SQLite en memoria siempre. Y, si está la variable SPMM_PG_PRUEBAS con la URL de un
Postgres DESCARTABLE en localhost (lo que usa producción: TRUNCATE, LOCK, secuencias,
JSONB, una clave foránea que el modelo no declara), las mismas pruebas otra vez ahí:

    SPMM_PG_PRUEBAS=postgresql+asyncpg://yo@localhost:55439/spmm_pruebas pytest ...

Esa base se BORRA ENTERA en cada prueba (DROP SCHEMA public CASCADE): por eso sólo se
acepta localhost. Nunca Supabase.
"""
import asyncio
import hashlib
import io
import json
import os
import uuid
import zipfile
from datetime import date, datetime, time
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.core.security import get_password_hash, get_sesiones_permisos, verify_password
from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.Cliente import Cliente
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Notificacion import Notificacion
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Pieza import Pieza
from backend.domain.Planificacion import Planificacion
from backend.domain.Plano import Plano
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Sector import Sector
from backend.domain.Usuario import Usuario
from backend.infrastructure import copias_de_seguridad as copias
from backend.infrastructure import deposito_copias
from backend.infrastructure import storage_planos
from backend.infrastructure.db import Base
from backend.presentation import CopiaSeguridadAPI, PermisosAPI, main
from backend.presentation.main import app
from backend.tests.test_permisos_api import JULIAN, LUCAS, MATIAS, PERSONAS, SOFIA, _token
from backend.tests.test_permisos_migracion import sembrar_permisos

ADMIN = _token(JULIAN)
# Un solo bcrypt para todos: cada uno cuesta un cuarto de segundo.
HASH_VIEJO = get_password_hash("la-de-antes")
HASH_NUEVO = "$2b$12$otrohashquenoesdeverdadperosirveparacompararxxxxxxxxxx"

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url: str) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


MOTORES = ["sqlite"] + (["postgres"] if PG_URL and _pg_seguro(PG_URL) else [])


# ─────────────────────────── la base de prueba ───────────────────────────


def _ddl_extras(motor: str) -> list[str]:
    """Tablas del sistema que ningún modelo declara (se crean con SQL, como en
    producción). La copia las tiene que llevar igual."""
    serial = "SERIAL PRIMARY KEY" if motor == "postgres" else "INTEGER PRIMARY KEY AUTOINCREMENT"
    jsonb = "JSONB" if motor == "postgres" else "JSON"
    sentencias = [
        "CREATE TABLE dia_bloqueado (fecha DATE PRIMARY KEY, "
        "creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        f"CREATE TABLE planificacion_borrador (id {serial}, nombre_usuario VARCHAR(120), "
        f"cantidad_ots INTEGER NOT NULL DEFAULT 0, datos {jsonb})",
        f"CREATE TABLE orden_trabajo_proceso_version (id {serial}, "
        "id_orden_trabajo INTEGER NOT NULL REFERENCES orden_trabajo(id) ON DELETE CASCADE, "
        f"creado_en TIMESTAMP NOT NULL, procesos {jsonb} NOT NULL)",
    ]
    if motor == "postgres":
        # La que la base tiene y el modelo no dice (2026-08-28_proceso_repetido_en_ot.sql):
        # con el orden de los modelos, el plan se cargaría antes que los pasos.
        sentencias.append(
            "ALTER TABLE planificacion ADD CONSTRAINT fk_planificacion_otp "
            "FOREIGN KEY (id_orden_trabajo_proceso) REFERENCES orden_trabajo_proceso(id) "
            "ON DELETE CASCADE"
        )
        # Las de los planos, como en producción (2026-09-06_planos_por_articulo.sql y
        # 2026-09-09_planos_en_storage.sql): un plano tiene el archivo en algún lado.
        sentencias += [
            "ALTER TABLE plano ADD CONSTRAINT ck_plano_destino "
            "CHECK (id_articulo IS NOT NULL OR id_orden_trabajo IS NOT NULL)",
            "ALTER TABLE plano ADD CONSTRAINT ck_plano_tiene_archivo "
            "CHECK (archivo IS NOT NULL OR storage_path IS NOT NULL)",
        ]
    else:
        # SQLite no agrega un CHECK a una tabla que ya existe: un trigger hace lo mismo.
        sentencias.append(
            "CREATE TRIGGER ck_plano_tiene_archivo BEFORE INSERT ON plano "
            "WHEN NEW.archivo IS NULL AND NEW.storage_path IS NULL "
            "BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: ck_plano_tiene_archivo'); END"
        )
    return sentencias


async def _armar_base(motor: str, archivo_sqlite: str | None = None):
    """`archivo_sqlite`: una SQLite en un archivo, con una conexión por sesión (como
    Postgres). La de memoria comparte UNA conexión entre todas las sesiones, y cortar una
    consulta a la mitad (una descarga que se corta) se la lleva puesta con la base."""
    if motor == "postgres":
        engine = create_async_engine(PG_URL, poolclass=NullPool)
    else:
        if archivo_sqlite:
            engine = create_async_engine(f"sqlite+aiosqlite:///{archivo_sqlite}", poolclass=NullPool)
        else:
            engine = create_async_engine(
                "sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                connect_args={"check_same_thread": False},
            )

        @event.listens_for(engine.sync_engine, "connect")
        def _fks(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    async with engine.begin() as conn:
        if motor == "postgres":
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)
        for sentencia in _ddl_extras(motor):
            await conn.execute(text(sentencia))

    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        for id_, username, rol, activo in PERSONAS:
            s.add(Usuario(id_usuario=id_, username=username, email=f"{username}@metlo.com.ar",
                          password_hash=HASH_VIEJO, nombre=username.title(), apellido="Prueba",
                          rol=rol, activo=activo))
        await s.commit()
        await sembrar_permisos(s)
        await _sembrar_datos(s, motor)
        if motor == "postgres":
            # Los datos se sembraron con ids a mano: las secuencias quedan como en
            # producción (al máximo) para que un alta sin id no choque desde el vamos.
            columnas = (await s.execute(text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND column_default LIKE 'nextval%'"
            ))).all()
            for tabla, columna in columnas:
                await s.execute(text(
                    f'SELECT setval(pg_get_serial_sequence(\'"{tabla}"\', \'{columna}\'), '
                    f'COALESCE((SELECT max("{columna}") FROM "{tabla}"), 0) + 1, false)'
                ))
            await s.commit()
    return engine, Sesion


async def _sembrar_datos(s, motor: str):
    s.add_all([
        Prioridad(id=1, descripcion="Normal"),
        Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A1", descripcion="Eje", abreviatura="EJE"),
        Cliente(id=1, nombre="Acme"),
        Cliente(id=2, nombre="Metlo SA", obs="cliente de siempre"),
        EstadoProceso(id=1, descripcion="Pendiente"),
        EstadoProceso(id=2, descripcion="Terminado"),
        Proceso(id=100, nombre="Torneado"),
        Proceso(id=101, nombre="Fresado"),
        Operario(id=1, nombre="Juan", apellido="Pérez", categoria="OFICIAL",
                 hora_inicio=time(7, 0), hora_fin=time(16, 0)),
        Maquinaria(id=1, nombre="Torno 1"),
        Pieza(id=1, cod_pieza="P1", descripcion="Barra 1\"", stock_minimo=5),
    ])
    await s.flush()
    s.add_all([
        OrdenTrabajo(id=10, id_otvieja=5001, id_prioridad=1, id_sector=1, id_articulo=1,
                     id_cliente=1, observaciones="urgente — ñandú", unidades=4,
                     fecha_orden=datetime(2026, 9, 1, 8, 30), fecha_entrada=datetime(2026, 9, 1, 9),
                     fecha_prometida=datetime(2026, 9, 30, 16)),
        OrdenTrabajo(id=11, id_otvieja=5002, id_prioridad=1, id_sector=1, id_articulo=1,
                     id_cliente=2, fecha_orden=datetime(2026, 9, 2), fecha_entrada=datetime(2026, 9, 2),
                     fecha_prometida=datetime(2026, 10, 15)),
    ])
    await s.flush()
    s.add_all([
        OrdenTrabajoProceso(id=1000, id_orden_trabajo=10, id_proceso=100, orden=1, id_estado=1,
                            id_operario=1, id_maquinaria=1, tiempo_proceso=90),
        OrdenTrabajoProceso(id=1001, id_orden_trabajo=10, id_proceso=101, orden=2, id_estado=1),
        OrdenTrabajoProceso(id=1002, id_orden_trabajo=11, id_proceso=100, orden=1, id_estado=2,
                            inicio_real=datetime(2026, 9, 3, 7, 15, 30)),
    ])
    await s.flush()
    s.add_all([
        Planificacion(id=1, orden_id=10, proceso_id=100, id_orden_trabajo_proceso=1000,
                      id_operario=1, inicio_min=0, fin_min=90, duracion_min=90, prioridad_peso=1,
                      fecha_prometida=date(2026, 9, 30), id_planificacion_lote=str(uuid.uuid4()),
                      creado_en=datetime(2026, 9, 5, 10)),
        Plano(id=1, nombre="eje.pdf", tipo_archivo="pdf", storage_path="articulo/1/abc-eje.pdf",
              id_articulo=1, tamano=1234, fecha_subida=datetime(2026, 9, 6)),
        # Uno del camino viejo: el archivo adentro de la base. La copia no lo lleva y al
        # restaurar se conserva.
        Plano(id=2, nombre="croquis.png", tipo_archivo="png", archivo=b"\x89PNG-del-camino-viejo",
              id_orden_trabajo=10, fecha_subida=datetime(2026, 9, 7)),
        Notificacion(id_notificacion=1, mensaje="OT 5001 retrasada", tipo="OT_RETRASADA",
                     leida=False, fecha_creacion=datetime(2026, 9, 8, 12)),
        AuditoriaMovimiento(creado_en=datetime(2026, 9, 8, 12), usuario="Julian", accion="creó",
                            entidad="cliente", descripcion="Julian creó cliente", metodo="POST",
                            ruta="/clientes", estado=200),
    ])
    await s.commit()

    json_ = "CAST(:d AS JSONB)" if motor == "postgres" else ":d"
    await s.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES (:f)"), {"f": date(2026, 12, 25)})
    await s.execute(text("INSERT INTO dia_bloqueado (fecha) VALUES (:f)"), {"f": date(2026, 12, 31)})
    await s.execute(
        text(f"INSERT INTO planificacion_borrador (nombre_usuario, cantidad_ots, datos) VALUES (:n, :c, {json_})"),
        {"n": "Julian", "c": 2, "d": json.dumps({"ordenes": [10, 11], "nota": "borrador — ñ"})},
    )
    await s.execute(
        text("INSERT INTO orden_trabajo_proceso_version (id_orden_trabajo, creado_en, procesos) "
             f"VALUES (:o, :c, {json_})"),
        {"o": 10, "c": datetime(2026, 9, 9, 11), "d": json.dumps([{"id": 1000, "orden": 1}])},
    )
    await s.commit()


class DepositoDePrueba:
    """Storage de mentira: guarda en memoria y deja ver en qué momento se guardó."""

    donde = "la memoria de la prueba"

    def __init__(self, anda: bool = True, hay: bool = True):
        self.anda = anda
        self.hay = hay
        self.guardadas: dict[str, bytes] = {}

    def disponible(self) -> bool:
        return self.hay

    async def guardar(self, nombre, archivo):
        if not self.anda:
            raise RuntimeError("Storage HTTP 400: mime type application/zip is not supported")
        archivo.seek(0)
        self.guardadas[nombre] = archivo.read()
        return "copias-de-seguridad/" + nombre

    async def listar(self):
        return [{"nombre": n, "tamano": len(b)} for n, b in sorted(self.guardadas.items(), reverse=True)]

    async def bajar(self, nombre):
        return self.guardadas[nombre]

    async def borrar(self, nombre):
        if not self.anda:
            raise RuntimeError("Storage HTTP 500")
        del self.guardadas[nombre]


@pytest_asyncio.fixture(params=MOTORES)
async def cliente(request, monkeypatch):
    async for c in _cliente(request.param, monkeypatch):
        yield c


@pytest_asyncio.fixture(params=MOTORES)
async def cliente_cortable(request, monkeypatch, tmp_path):
    """Para cortar una descarga a la mitad: cada sesión con su conexión."""
    archivo = str(tmp_path / "copias.db") if request.param == "sqlite" else None
    async for c in _cliente(request.param, monkeypatch, archivo):
        yield c


async def _cliente(motor, monkeypatch, archivo_sqlite=None):
    engine, Sesion = await _armar_base(motor, archivo_sqlite)
    deposito = DepositoDePrueba()
    app.dependency_overrides[get_sesiones_permisos] = lambda: Sesion
    app.dependency_overrides[CopiaSeguridadAPI.get_sesiones_backup] = lambda: Sesion
    app.dependency_overrides[CopiaSeguridadAPI.get_deposito] = lambda: deposito
    # La auditoría del middleware (revisar y restaurar son POST), a esta misma base.
    monkeypatch.setattr(main, "SessionLocal", Sesion)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.sesiones = Sesion
        c.deposito = deposito
        c.motor = motor
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


# ─────────────────────────── ayudas ───────────────────────────


async def _foto(c, *, con_auditoria: bool = False) -> dict:
    """Todas las tablas, fila por fila, en orden. La auditoría se deja afuera: la
    restauración misma escribe en ella."""
    async with c.sesiones() as s:
        conn = await s.connection()
        esquema = await copias.leer_esquema(conn)
        foto = {}
        for t in copias.tablas_en_orden(esquema):
            if not con_auditoria and t.name in copias.TABLAS_DE_AUDITORIA:
                continue
            orden = list(t.primary_key.columns) or list(t.columns)
            foto[t.name] = [tuple(f) for f in (await conn.execute(select(t).order_by(*orden))).all()]
        return foto


async def _ejecutar(c, *sentencias):
    async with c.sesiones() as s:
        for sentencia in sentencias:
            if isinstance(sentencia, tuple):
                await s.execute(*sentencia)
            else:
                await s.execute(sentencia)
        await s.commit()


async def _leer(c, consulta):
    async with c.sesiones() as s:
        return (await s.execute(consulta)).all()


async def _bajar(c, headers=ADMIN) -> bytes:
    r = await c.get("/backups/descargar", headers=headers)
    assert r.status_code == 200, r.text
    return r.content


async def _revisar(c, datos: bytes, *, incluir_usuarios=False, headers=ADMIN, nombre="copia.zip"):
    return await c.post(
        "/backups/revisar", headers=headers,
        files={"archivo": (nombre, datos, "application/zip")},
        data={"incluir_usuarios": "true" if incluir_usuarios else "false"},
    )


async def _restaurar(c, datos: bytes, *, huella=None, confirmacion="RESTAURAR", incluir_usuarios=False,
                     ya_descargue=False, la_de_hoy: bytes | None = None, sin_firma=False,
                     headers=ADMIN, nombre="copia.zip"):
    """`la_de_hoy`: la copia que el admin acaba de bajar (el navegador manda su sha256).
    `sin_firma`: confirma aparte una copia que no tiene la firma de este servidor."""
    data = {
        "huella": huella or hashlib.sha256(datos).hexdigest(),
        "confirmacion": confirmacion,
        "incluir_usuarios": "true" if incluir_usuarios else "false",
        "ya_descargue_la_copia_actual": "true" if ya_descargue else "false",
        "aceptar_copia_sin_firma": "true" if sin_firma else "false",
    }
    if la_de_hoy is not None:
        data["huella_copia_actual"] = hashlib.sha256(la_de_hoy).hexdigest()
    return await c.post(
        "/backups/restauracion", headers=headers,
        files={"archivo": (nombre, datos, "application/zip")},
        data=data,
    )


def _msg(r) -> str:
    return r.json()["errors"][0]["message"]


def _manifiesto(datos: bytes) -> dict:
    return json.loads(zipfile.ZipFile(io.BytesIO(datos)).read("manifiesto.json"))


def _filas(datos: bytes, tabla: str) -> tuple[list, list]:
    zf = zipfile.ZipFile(io.BytesIO(datos))
    m = json.loads(zf.read("manifiesto.json"))
    crudo = zf.read(f"tablas/{tabla}.jsonl").decode("utf-8")
    return m["tablas"][tabla]["columnas"], [json.loads(l) for l in crudo.splitlines() if l]


def _jsonl(filas: list) -> bytes:
    return b"".join(json.dumps(f, ensure_ascii=False).encode("utf-8") + b"\n" for f in filas)


def _reempaquetar(datos: bytes, *, tablas: dict | None = None, cambiar_manifiesto=None,
                  recalcular: bool = True, extra: dict | None = None, al_final=None,
                  firmar: bool | None = None) -> bytes:
    """Arma otra copia a partir de `datos`: reemplaza el contenido de algunas tablas y
    (si `recalcular`) vuelve a calcular hashes y cantidades. Con `recalcular=False`, es
    una copia adulterada a mano. `al_final` toca el manifiesto después de recalcular.

    `firmar` (por defecto, lo mismo que `recalcular`) la vuelve a firmar con la clave del
    servidor: es la copia que ESTE servidor habría hecho con ese contenido (una copia de
    antes de una migración, por ejemplo). Con `firmar=False` y los hashes rehechos es lo
    que haría alguien que edita la copia sin tener la clave: la firma no coincide."""
    if firmar is None:
        firmar = recalcular
    tablas = tablas or {}
    zin = zipfile.ZipFile(io.BytesIO(datos))
    m = json.loads(zin.read("manifiesto.json"))
    if cambiar_manifiesto:
        cambiar_manifiesto(m)
    salida = io.BytesIO()
    with zipfile.ZipFile(salida, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if info.filename == "manifiesto.json":
                continue
            contenido = zin.read(info.filename)
            tabla = (info.filename[len("tablas/"):-len(".jsonl")]
                     if info.filename.startswith("tablas/") else None)
            if tabla in tablas:
                contenido = tablas[tabla]
            if recalcular and tabla in m["tablas"]:
                m["tablas"][tabla]["sha256"] = hashlib.sha256(contenido).hexdigest()
                m["tablas"][tabla]["filas"] = len([l for l in contenido.split(b"\n") if l])
            zout.writestr(info.filename, contenido)
        for nombre, contenido in (extra or {}).items():
            zout.writestr(nombre, contenido)
        if al_final:
            al_final(m)
        if firmar:
            m["firma"] = copias.firmar_manifiesto(m)
        zout.writestr("manifiesto.json", json.dumps(m, ensure_ascii=False))
    return salida.getvalue()


# ─────────────────────────── bajar ───────────────────────────


async def test_la_copia_trae_todas_las_tablas_y_no_los_archivos(cliente):
    r = await cliente.get("/backups/descargar", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    disposicion = r.headers["content-disposition"]
    assert disposicion.startswith('attachment; filename="spmm_backup_') and disposicion.endswith('.zip"')
    m = _manifiesto(r.content)
    assert m["formato"] == "spmm-copia-de-seguridad" and m["version"] == 1
    assert m["generado_por"]["id_usuario"] == JULIAN
    assert datetime.fromisoformat(m["generado_en"]).tzinfo is None  # hora local, sin zona

    # Los modelos son el piso: todas sus tablas están. Y también las que ningún modelo
    # declara (el calendario, los borradores, el historial para deshacer).
    assert set(Base.metadata.tables) <= set(m["tablas"])
    for sin_modelo in ("dia_bloqueado", "planificacion_borrador", "orden_trabajo_proceso_version"):
        assert sin_modelo in m["tablas"], sin_modelo

    assert m["tablas"]["cliente"]["filas"] == 2
    assert m["tablas"]["orden_trabajo_proceso"]["filas"] == 3
    assert m["total_filas"] == sum(t["filas"] for t in m["tablas"].values())
    # El archivo de los planos no viaja; la fila (con la ruta en Storage) sí.
    assert m["tablas"]["plano"]["columnas_omitidas"] == ["archivo"]
    assert "archivo" not in m["tablas"]["plano"]["columnas"]
    columnas, filas = _filas(r.content, "plano")
    assert filas[0][columnas.index("storage_path")] == "articulo/1/abc-eje.pdf"
    # Cada tabla, con el hash de su archivo.
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    for nombre, t in m["tablas"].items():
        assert hashlib.sha256(zf.read(t["archivo"])).hexdigest() == t["sha256"], nombre
    assert "LEEME.txt" in zf.namelist()


async def test_bajar_queda_en_la_auditoria(cliente):
    datos = await _bajar(cliente)
    filas = await _leer(cliente, select(AuditoriaMovimiento).where(
        AuditoriaMovimiento.ruta == "/backups/descargar"))
    assert len(filas) == 1  # una sola fila: la de «empezó», completada al terminar
    fila = filas[0][0]
    assert fila.id_usuario == JULIAN and fila.accion == "descargó" and fila.estado == 200
    assert "descargó una copia de seguridad completa" in fila.descripcion
    assert _manifiesto(datos)["generado_en"][:10] in fila.descripcion.replace("_", "-")
    detalle = json.loads(fila.detalle)["despues"]
    # Lo que después reconoce ESTE archivo (la salida «ya la bajé» de restaurar).
    assert detalle["completa"] is True
    assert detalle["sha256"] == hashlib.sha256(datos).hexdigest()
    assert set(detalle["contenido"]) == {"datos", "acceso"}


# ─────────────────────────── ida y vuelta ───────────────────────────


async def test_ida_y_vuelta_deja_todo_como_estaba(cliente):
    antes = await _foto(cliente)
    copia = await _bajar(cliente)

    # Se trabaja un rato después de la copia.
    await _ejecutar(
        cliente,
        update(Cliente).where(Cliente.id == 1).values(nombre="Acme (cambiado)"),
        update(OrdenTrabajo).where(OrdenTrabajo.id == 10).values(observaciones="otra cosa"),
        OrdenTrabajoProceso.__table__.delete().where(OrdenTrabajoProceso.id == 1002),
        insert(Cliente).values(nombre="Cliente nuevo"),
        (text("INSERT INTO dia_bloqueado (fecha) VALUES (:f)"), {"f": date(2027, 1, 1)}),
        (text("DELETE FROM planificacion_borrador"),),
    )
    assert await _foto(cliente) != antes

    r = await _revisar(cliente, copia)
    assert r.status_code == 200, r.text
    vista = r.json()["data"]
    por_tabla = {t["tabla"]: t for t in vista["tablas"]}
    assert (por_tabla["cliente"]["filas_actuales"], por_tabla["cliente"]["filas_copia"]) == (3, 2)
    assert por_tabla["cliente"]["accion"] == "reemplaza"
    assert por_tabla["usuario"]["accion"] == "conserva"
    assert por_tabla["auditoria_movimiento"]["accion"] == "conserva"
    assert vista["copia"]["generada_en"] == _manifiesto(copia)["generado_en"]
    assert vista["archivo"]["huella"] == hashlib.sha256(copia).hexdigest()

    r = await _restaurar(cliente, copia, huella=vista["archivo"]["huella"])
    assert r.status_code == 200, r.text
    resultado = r.json()["data"]
    assert resultado["total_filas"] > 0
    assert {t["tabla"]: t["filas"] for t in resultado["tablas"]}["cliente"] == 2
    assert await _foto(cliente) == antes


async def test_ida_y_vuelta_de_a_pocas_filas(cliente, monkeypatch):
    """Con páginas de 2 filas: la copia se lee por la clave (simple y compuesta, como
    rol_area) y se carga de a lotes, y sale igual."""
    monkeypatch.setattr(copias, "LOTE", 2)
    antes = await _foto(cliente)
    copia = await _bajar(cliente)
    assert _manifiesto(copia)["tablas"]["rol_area"]["filas"] > 2
    await _ejecutar(
        cliente,
        update(Cliente).where(Cliente.id == 2).values(nombre="otro"),
        (text("DELETE FROM rol_area WHERE rol_codigo = 'operario'"),),
    )
    r = await _restaurar(cliente, copia, incluir_usuarios=True)
    assert r.status_code == 200, r.text
    assert await _foto(cliente) == antes


async def test_la_copia_previa_se_arma_antes_de_tocar_datos(cliente):
    copia = await _bajar(cliente)
    await _ejecutar(cliente, insert(Cliente).values(id=50, nombre="Cargado después de la copia"))
    despues_de_trabajar = await _foto(cliente)

    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    previa = r.json()["data"]["copia_previa"]
    assert previa["nombre"].endswith("_antes-de-restaurar.zip")
    guardada = cliente.deposito.guardadas[previa["nombre"]]
    # Lo que se guardó es el estado de ANTES de restaurar: tiene el cliente 50.
    columnas, filas = _filas(guardada, "cliente")
    assert 50 in [f[columnas.index("id")] for f in filas]
    assert _manifiesto(guardada)["motivo"].startswith("automática, antes de restaurar")

    # Y sirve para deshacer: restaurarla devuelve lo que había.
    r = await _restaurar(cliente, guardada, nombre=previa["nombre"])
    assert r.status_code == 200, r.text
    assert await _foto(cliente) == despues_de_trabajar


async def test_las_secuencias_quedan_bien(cliente):
    copia = await _bajar(cliente)
    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    # Filas nuevas sin id, en una tabla de modelo y en una sin modelo: no chocan.
    await _ejecutar(
        cliente,
        insert(Cliente).values(nombre="Después de restaurar"),
        (text("INSERT INTO planificacion_borrador (nombre_usuario) VALUES ('x')"),),
        insert(OrdenTrabajoProceso).values(id_orden_trabajo=11, id_proceso=101, orden=2, id_estado=1),
    )
    ids = [i for (i,) in await _leer(cliente, select(Cliente.id).order_by(Cliente.id))]
    assert ids[:2] == [1, 2] and ids[2] > 2
    borradores = [i for (i,) in await _leer(cliente, text("SELECT id FROM planificacion_borrador ORDER BY id"))]
    assert len(borradores) == 2 and borradores[1] > borradores[0]


async def test_una_secuencia_no_vuelve_para_atras(cliente):
    """Después de restaurar una copia vieja, un id que ya se dio no se vuelve a dar: la
    auditoría (que no se toca) habla de él."""
    if cliente.motor != "postgres":
        pytest.skip("las secuencias son de Postgres; SQLite da max(id)+1")
    copia = await _bajar(cliente)
    await _ejecutar(cliente, insert(Cliente).values(nombre="efímero"))
    (efimero,) = [i for (i,) in await _leer(cliente, select(Cliente.id).where(Cliente.nombre == "efímero"))]
    assert (await _restaurar(cliente, copia)).status_code == 200
    await _ejecutar(cliente, insert(Cliente).values(nombre="otro"))
    (nuevo,) = [i for (i,) in await _leer(cliente, select(Cliente.id).where(Cliente.nombre == "otro"))]
    assert nuevo > efimero


async def test_un_json_vacio_vuelve_vacio_y_no_como_null(cliente):
    """Una columna JSON sin nada (SQL NULL) tiene que volver sin nada. El tipo JSON de
    SQLAlchemy guarda un None como el JSON «null» si no se le dice otra cosa, y ahí un
    `WHERE datos IS NULL` deja de encontrar la fila aunque en pantalla se vea igual."""
    await _ejecutar(cliente, (text("INSERT INTO planificacion_borrador (nombre_usuario) VALUES ('sin datos')"),))
    consulta = text("SELECT count(*) FROM planificacion_borrador WHERE datos IS NULL")
    assert await _leer(cliente, consulta) == [(1,)]
    copia = await _bajar(cliente)
    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    assert await _leer(cliente, consulta) == [(1,)]
    # Y el que tenía algo, lo sigue teniendo.
    assert await _leer(cliente, text("SELECT count(*) FROM planificacion_borrador WHERE datos IS NOT NULL")) == [(1,)]


async def test_el_archivo_de_un_plano_viejo_se_conserva(cliente):
    copia = await _bajar(cliente)
    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["archivos_conservados"] == 1
    ((archivo,),) = await _leer(cliente, select(Plano.archivo).where(Plano.id == 2))
    assert archivo == b"\x89PNG-del-camino-viejo"


# ─────────────────────────── lo que se rechaza sin tocar nada ───────────────────────────


async def test_un_archivo_adulterado_se_rechaza_sin_tocar_nada(cliente):
    copia = await _bajar(cliente)
    columnas, filas = _filas(copia, "cliente")
    filas[0][columnas.index("nombre")] = "Nombre cambiado a mano"
    adulterada = _reempaquetar(copia, tablas={"cliente": _jsonl(filas)}, recalcular=False)
    antes = await _foto(cliente)

    r = await _revisar(cliente, adulterada)
    assert r.status_code == 422, r.text
    assert "no coincide con su huella" in _msg(r) and "Clientes" in _msg(r)

    r = await _restaurar(cliente, adulterada)
    assert r.status_code == 422, r.text
    assert await _foto(cliente) == antes
    assert cliente.deposito.guardadas == {}  # ni siquiera se llegó a la copia previa


async def test_filas_de_mas_o_de_menos_se_rechazan(cliente):
    """Alguien sacó una fila y rehízo el hash, pero no la cantidad."""
    copia = await _bajar(cliente)
    _, filas = _filas(copia, "cliente")

    def _mentir(m):
        m["tablas"]["cliente"]["filas"] = 2

    sin_una = _reempaquetar(copia, tablas={"cliente": _jsonl(filas[:1])}, al_final=_mentir)
    antes = await _foto(cliente)
    r = await _revisar(cliente, sin_una)
    assert r.status_code == 422
    assert "no tiene las filas que dice el manifiesto" in _msg(r)
    assert (await _restaurar(cliente, sin_una)).status_code == 422
    assert await _foto(cliente) == antes


async def test_lo_que_no_es_una_copia_se_rechaza(cliente):
    antes = await _foto(cliente)
    r = await _revisar(cliente, b"esto no es un zip")
    assert r.status_code == 422 and "no es un .zip válido" in _msg(r)

    zip_cualquiera = io.BytesIO()
    with zipfile.ZipFile(zip_cualquiera, "w") as z:
        z.writestr("fotos/vacaciones.jpg", b"...")
    r = await _revisar(cliente, zip_cualquiera.getvalue())
    assert r.status_code == 422 and "manifiesto" in _msg(r)

    copia = await _bajar(cliente)
    def _otro_formato(m):
        m["formato"] = "otra-cosa"
    r = await _revisar(cliente, _reempaquetar(copia, cambiar_manifiesto=_otro_formato))
    assert r.status_code == 422 and "no es una copia de seguridad de SPMM" in _msg(r)

    def _version_nueva(m):
        m["version"] = 2
    r = await _revisar(cliente, _reempaquetar(copia, cambiar_manifiesto=_version_nueva))
    assert r.status_code == 422 and "versión 2" in _msg(r) and "actualizá el servidor" in _msg(r)

    columnas, filas = _filas(copia, "cliente")
    filas[0][columnas.index("id")] = "no es un número"
    r = await _revisar(cliente, _reempaquetar(copia, tablas={"cliente": _jsonl(filas)}))
    assert r.status_code == 422 and "hoy no entra" in _msg(r)

    r = await _revisar(cliente, _reempaquetar(copia, tablas={"cliente": b"{roto\n"}))
    assert r.status_code == 422 and "no es un JSON válido" in _msg(r)
    assert await _foto(cliente) == antes


async def test_una_bomba_de_zip_no_se_abre(cliente):
    copia = await _bajar(cliente)
    # 64 MB de ceros comprimen a ~60 KB: más de mil veces.
    bomba = _reempaquetar(copia, tablas={"cliente": b"0" * (64 * 1024 * 1024)}, recalcular=False)
    r = await _revisar(cliente, bomba)
    assert r.status_code == 422 and "desproporcionado" in _msg(r)


async def test_un_archivo_demasiado_grande_se_rechaza(cliente, monkeypatch):
    copia = await _bajar(cliente)
    monkeypatch.setattr(CopiaSeguridadAPI, "LIMITE_SUBIDA", 1024)
    r = await _revisar(cliente, copia)
    assert r.status_code == 413 and "el máximo para restaurar desde la app" in _msg(r)


async def test_hay_que_escribir_restaurar_y_restaurar_lo_mismo_que_se_reviso(cliente):
    copia = await _bajar(cliente)
    antes = await _foto(cliente)
    r = await _restaurar(cliente, copia, confirmacion="restaurar")
    assert r.status_code == 422 and "RESTAURAR" in _msg(r)
    r = await _restaurar(cliente, copia, huella="0" * 64)
    assert r.status_code == 409 and "no es el mismo que se revisó" in _msg(r)
    assert await _foto(cliente) == antes


async def test_tablas_y_columnas_desconocidas_se_informan_y_se_ignoran(cliente):
    copia = await _bajar(cliente)
    antes = await _foto(cliente)
    malicioso = 'x"; DROP TABLE orden_trabajo; --'

    columnas, filas = _filas(copia, "cliente")
    columnas_nuevas = columnas + ["columna_que_ya_no_existe", malicioso]
    filas_nuevas = [f + ["algo", "DROP TABLE cliente"] for f in filas]

    def _agregar(m):
        m["tablas"]["cliente"]["columnas"] = columnas_nuevas
        m["tablas"]["tabla_que_ya_no_existe"] = {
            "archivo": "tablas/tabla_que_ya_no_existe.jsonl", "filas": 1,
            "sha256": hashlib.sha256(b'[1]\n').hexdigest(), "columnas": ["id"]}
        m["tablas"][malicioso] = {
            "archivo": f"tablas/{malicioso}.jsonl", "filas": 1,
            "sha256": hashlib.sha256(b'[1]\n').hexdigest(), "columnas": [malicioso]}

    rara = _reempaquetar(
        copia, tablas={"cliente": _jsonl(filas_nuevas)}, cambiar_manifiesto=_agregar,
        extra={"tablas/tabla_que_ya_no_existe.jsonl": b"[1]\n", f"tablas/{malicioso}.jsonl": b"[1]\n"},
    )
    r = await _revisar(cliente, rara)
    assert r.status_code == 200, r.text
    vista = r.json()["data"]
    avisos = " ".join(vista["avisos"])
    assert "«tabla_que_ya_no_existe», que hoy ya no existe: se ignora" in avisos
    assert "«columna_que_ya_no_existe» de «Clientes» ya no existe: se ignora" in avisos
    assert malicioso[:60] in avisos
    assert set(vista["ignoradas"]) == {"tabla_que_ya_no_existe", malicioso}

    r = await _restaurar(cliente, rara)
    assert r.status_code == 200, r.text
    # No se ejecutó nada raro: están todas las tablas y los datos son los de la copia.
    assert await _foto(cliente) == antes


async def test_una_columna_nueva_queda_en_su_valor_por_defecto(cliente):
    copia = await _bajar(cliente)
    columnas, filas = _filas(copia, "cliente")
    i = columnas.index("obs")
    sin_obs = [f[:i] + f[i + 1:] for f in filas]

    def _sacar(m):
        m["tablas"]["cliente"]["columnas"] = columnas[:i] + columnas[i + 1:]
        m["tablas"]["cliente"]["tipos"] = m["tablas"]["cliente"]["tipos"][:i] + m["tablas"]["cliente"]["tipos"][i + 1:]

    vieja = _reempaquetar(copia, tablas={"cliente": _jsonl(sin_obs)}, cambiar_manifiesto=_sacar)
    r = await _revisar(cliente, vieja)
    assert r.status_code == 200, r.text
    assert any("columna nueva, «obs»" in a for a in r.json()["data"]["avisos"])
    r = await _restaurar(cliente, vieja)
    assert r.status_code == 200, r.text
    assert [o for (o,) in await _leer(cliente, select(Cliente.obs).order_by(Cliente.id))] == [None, None]


async def test_una_tabla_nueva_que_la_copia_no_trae(cliente):
    """Una copia de antes de que existiera una tabla: si cuelga de lo que se reemplaza,
    queda vacía (en esa fecha no tenía nada); si no, se deja como está."""
    copia = await _bajar(cliente)

    def _sin(m):
        del m["tablas"]["orden_trabajo_proceso_version"]
        del m["tablas"]["dia_bloqueado"]

    vieja = _reempaquetar(copia, cambiar_manifiesto=_sin)
    r = await _revisar(cliente, vieja)
    assert r.status_code == 200, r.text
    por_tabla = {t["tabla"]: t["accion"] for t in r.json()["data"]["tablas"]}
    assert por_tabla["orden_trabajo_proceso_version"] == "vacia"
    assert por_tabla["dia_bloqueado"] == "sin_copia"
    r = await _restaurar(cliente, vieja)
    assert r.status_code == 200, r.text
    assert await _leer(cliente, text("SELECT count(*) FROM orden_trabajo_proceso_version")) == [(0,)]
    assert await _leer(cliente, text("SELECT count(*) FROM dia_bloqueado")) == [(2,)]


# ─────────────────────────── falla a la mitad ───────────────────────────


async def test_si_falla_a_la_mitad_la_base_queda_como_estaba(cliente, monkeypatch):
    copia = await _bajar(cliente)
    await _ejecutar(cliente, insert(Cliente).values(id=77, nombre="Cargado después"))
    antes = await _foto(cliente)

    # Con todas las tablas ya vaciadas y recargadas, algo revienta antes del commit.
    async def _revienta(*_):
        raise RuntimeError("se cortó la luz")
    monkeypatch.setattr(copias, "_ajustar_secuencias", _revienta)
    r = await _restaurar(cliente, copia)
    assert r.status_code == 500, r.text
    assert "se cortó la luz" in _msg(r) and "quedó como estaba" in _msg(r)
    assert await _foto(cliente) == antes


async def test_una_copia_inconsistente_no_deja_nada_a_medias(cliente):
    """Pasa la revisión (hashes y tipos bien) pero la base la frena al cargar: un paso
    que apunta a un proceso que no está."""
    copia = await _bajar(cliente)
    columnas, filas = _filas(copia, "orden_trabajo_proceso")
    filas[-1][columnas.index("id_proceso")] = 999
    rota = _reempaquetar(copia, tablas={"orden_trabajo_proceso": _jsonl(filas)})
    await _ejecutar(cliente, update(Cliente).where(Cliente.id == 1).values(nombre="cambiado"))
    antes = await _foto(cliente)

    assert (await _revisar(cliente, rota)).status_code == 200
    r = await _restaurar(cliente, rota)
    assert r.status_code == 500, r.text
    assert "quedó como estaba" in _msg(r)
    assert await _foto(cliente) == antes


# ─────────────────────────── la copia previa ───────────────────────────


async def test_sin_copia_previa_no_se_restaura(cliente):
    copia = await _bajar(cliente)
    await _ejecutar(cliente, update(Cliente).where(Cliente.id == 1).values(nombre="cambiado"))
    antes = await _foto(cliente)

    cliente.deposito.anda = False
    r = await _restaurar(cliente, copia)
    assert r.status_code == 409, r.text
    assert r.json()["errors"][0]["campo"] == "copia_previa"
    assert "No se restauró nada" in _msg(r)
    assert await _foto(cliente) == antes

    # Decir «ya la descargué» sin haberla bajado no alcanza.
    await _ejecutar(cliente, AuditoriaMovimiento.__table__.delete().where(
        AuditoriaMovimiento.ruta == "/backups/descargar"))
    r = await _restaurar(cliente, copia, ya_descargue=True, la_de_hoy=copia)
    assert r.status_code == 409, r.text
    assert await _foto(cliente) == antes

    # Bajada recién (queda en la auditoría, con su huella) y confirmada: ahora sí.
    hoy = await _bajar(cliente)
    r = await _restaurar(cliente, copia, ya_descargue=True, la_de_hoy=hoy)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["copia_previa"]["donde"] == "la copia que descargaste recién"


async def test_sin_storage_configurado_pide_la_descarga(cliente):
    cliente.deposito.hay = False
    r = await cliente.get("/backups/estado", headers=ADMIN)
    assert r.json()["data"]["copia_automatica"]["disponible"] is False
    copia = await _bajar(cliente)
    await _ejecutar(cliente, AuditoriaMovimiento.__table__.delete())
    r = await _restaurar(cliente, copia)
    assert r.status_code == 409 and "no hay dónde guardar" in _msg(r)
    hoy = await _bajar(cliente)
    assert (await _restaurar(cliente, copia, ya_descargue=True, la_de_hoy=hoy)).status_code == 200


# ─────────────────────────── usuarios ───────────────────────────


async def test_los_usuarios_no_se_tocan_salvo_que_se_pida(cliente):
    copia = await _bajar(cliente)
    await _ejecutar(
        cliente,
        update(Usuario).where(Usuario.id_usuario == SOFIA).values(password_hash=HASH_NUEVO, nombre="Sofía"),
        insert(Usuario).values(id_usuario=6, username="nuevo", email="nuevo@metlo.com.ar",
                               password_hash=HASH_NUEVO, nombre="Nuevo", apellido="Prueba", rol="operario"),
    )
    usuarios_de_ahora = await _leer(cliente, select(Usuario.__table__).order_by(Usuario.id_usuario))

    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    assert await _leer(cliente, select(Usuario.__table__).order_by(Usuario.id_usuario)) == usuarios_de_ahora
    assert "Usuarios" in r.json()["data"]["conservadas"]


async def test_incluir_usuarios_devuelve_los_de_la_copia_menos_el_admin_que_restaura(cliente):
    copia = await _bajar(cliente)
    await _ejecutar(
        cliente,
        update(Usuario).where(Usuario.id_usuario == SOFIA).values(password_hash=HASH_NUEVO, nombre="Sofía"),
        update(Usuario).where(Usuario.id_usuario == JULIAN).values(password_hash=HASH_NUEVO,
                                                                    nombre="Julián", creado_por=2),
        insert(Usuario).values(id_usuario=6, username="nuevo", email="nuevo@metlo.com.ar",
                               password_hash=HASH_NUEVO, nombre="Nuevo", apellido="Prueba", rol="operario"),
    )
    ((julian_ahora,),) = [(tuple(f),) for f in await _leer(
        cliente, select(Usuario.__table__).where(Usuario.id_usuario == JULIAN))]

    r = await _revisar(cliente, copia, incluir_usuarios=True)
    assert r.status_code == 200, r.text
    por_tabla = {t["tabla"]: t["accion"] for t in r.json()["data"]["tablas"]}
    assert por_tabla["usuario"] == "reemplaza" and por_tabla["rol_area"] == "reemplaza"
    assert por_tabla["auditoria_movimiento"] == "conserva"
    assert any("Tu cuenta queda como está ahora" in a for a in r.json()["data"]["avisos"])

    r = await _restaurar(cliente, copia, incluir_usuarios=True)
    assert r.status_code == 200, r.text
    usuarios = {f.id_usuario: f for f in await _leer(cliente, select(Usuario.__table__))}
    assert set(usuarios) == {1, 2, 3, 4, 5}  # el nuevo no estaba en la copia
    # Los datos vuelven a los de la copia; la contraseña, NO: queda la de hoy.
    assert usuarios[SOFIA].nombre == "Sofia" and usuarios[SOFIA].password_hash == HASH_NUEVO
    # Julián restauró: su cuenta queda como estaba recién (su clave de hoy, admin, activa).
    assert tuple(usuarios[JULIAN]) == julian_ahora
    assert usuarios[JULIAN].rol == "admin" and usuarios[JULIAN].activo
    # Sigue pudiendo entrar a la pantalla.
    assert (await cliente.get("/backups/estado", headers=ADMIN)).status_code == 200


async def test_incluir_usuarios_no_deja_afuera_al_admin(cliente):
    copia = await _bajar(cliente)
    columnas, filas = _filas(copia, "usuario")
    i_id = columnas.index("id_usuario")
    # En la copia, «julian» es la cuenta 99: si se cargara, la cuenta 1 (la de quien
    # restaura) chocaría con su propio usuario o quedaría afuera.
    for f in filas:
        if f[i_id] == JULIAN:
            f[i_id] = 99
    otra = _reempaquetar(copia, tablas={"usuario": _jsonl(filas)})
    antes = await _foto(cliente)
    r = await _revisar(cliente, otra, incluir_usuarios=True)
    assert r.status_code == 422 and "quedarías afuera" in _msg(r)
    r = await _restaurar(cliente, otra, incluir_usuarios=True)
    assert r.status_code == 422
    assert await _foto(cliente) == antes
    # Sin incluir usuarios, la misma copia se restaura sin problema.
    assert (await _restaurar(cliente, otra)).status_code == 200


# ─────────────────────────── permisos y auditoría ───────────────────────────


async def test_solo_el_admin(cliente):
    copia = await _bajar(cliente)
    antes = await _foto(cliente)
    for quien, rol in ((SOFIA, "supervisor"), (MATIAS, "operario")):
        h = _token(quien, rol)
        assert (await cliente.get("/backups/estado", headers=h)).status_code == 403
        r = await cliente.get("/backups/descargar", headers=h)
        assert r.status_code == 403
        assert "«Configuración»" in _msg(r)
        assert (await _revisar(cliente, copia, headers=h)).status_code == 403
        assert (await _restaurar(cliente, copia, headers=h)).status_code == 403
        assert (await cliente.get("/backups/automaticas", headers=h)).status_code == 403
    assert (await cliente.get("/backups/descargar")).status_code in (401, 403)
    assert await _foto(cliente) == antes


async def test_restaurar_queda_en_la_auditoria(cliente):
    copia = await _bajar(cliente)
    r = await _restaurar(cliente, copia, nombre="spmm_backup_2026-09-22_1530.zip")
    assert r.status_code == 200, r.text
    filas = await _leer(cliente, select(AuditoriaMovimiento).where(
        AuditoriaMovimiento.ruta == "/backups/restauracion"))
    assert len(filas) == 1
    fila = filas[0][0]
    assert fila.id_usuario == JULIAN and fila.accion == "restauró" and fila.estado == 200
    assert "restauró la copia de seguridad del" in fila.descripcion
    assert "spmm_backup_2026-09-22_1530.zip" in fila.descripcion
    detalle = json.loads(fila.detalle)["despues"]
    assert detalle["filas"]["cliente"] == 2
    assert detalle["copia_previa"].endswith("_antes-de-restaurar.zip")
    # La auditoría de antes sigue ahí: no se restaura.
    assert await _leer(cliente, select(AuditoriaMovimiento.ruta).where(
        AuditoriaMovimiento.ruta == "/clientes")) == [("/clientes",)]


async def test_las_copias_automaticas_se_listan_y_se_bajan(cliente):
    copia = await _bajar(cliente)
    assert (await _restaurar(cliente, copia)).status_code == 200
    r = await cliente.get("/backups/automaticas", headers=ADMIN)
    assert r.status_code == 200, r.text
    (automatica,) = r.json()["data"]["copias"]
    assert automatica["fecha"] and automatica["nombre"].endswith("_antes-de-restaurar.zip")
    r = await cliente.get(f"/backups/automaticas/{automatica['nombre']}/descargar", headers=ADMIN)
    assert r.status_code == 200 and r.content == cliente.deposito.guardadas[automatica["nombre"]]
    r = await cliente.get("/backups/automaticas/..%2F..%2Fplanos%2Fx/descargar", headers=ADMIN)
    assert r.status_code == 404


# ─────────────────────────── cuántas automáticas quedan ───────────────────────────


def _automatica(mes: int, dia: int) -> str:
    return copias.nombre_de_copia(datetime(2026, mes, dia, 9, 30, 15), antes_de_restaurar=True)


def test_quedan_las_diez_automaticas_mas_nuevas():
    viejas = [_automatica(1, d) for d in range(1, 13)]  # 12, del 1 al 12 de enero
    recien = _automatica(9, 22)
    ajena = "spmm_backup_2026-01-01_0900.zip"  # la forma de una bajada a mano
    sobran = deposito_copias.automaticas_de_sobra(viejas + [recien, ajena, "otra-cosa.zip"], recien)
    # 13 automáticas: quedan la recién y las 9 más nuevas; se van las 3 del 1 al 3.
    assert sorted(sobran) == [_automatica(1, 1), _automatica(1, 2), _automatica(1, 3)]
    assert recien not in sobran and ajena not in sobran


def test_sin_la_recien_en_la_lista_no_se_borra_nada():
    viejas = [_automatica(1, d) for d in range(1, 20)]
    assert deposito_copias.automaticas_de_sobra(viejas, _automatica(9, 22)) == []
    # Con el reloj corrido, la recién puede no ser la más nueva: igual no se borra.
    recien = _automatica(1, 1)
    assert recien not in deposito_copias.automaticas_de_sobra(viejas, recien)


async def test_el_deposito_de_verdad_solo_borra_automaticas(monkeypatch):
    borradas = []

    async def borrar(ruta):
        borradas.append(ruta)

    monkeypatch.setattr(storage_planos, "borrar", borrar)
    deposito = deposito_copias.DepositoEnStorage()
    for nombre in ("spmm_backup_2026-01-01_0900.zip", "../planos/x.pdf", "articulo/1/a.pdf"):
        with pytest.raises(ValueError):
            await deposito.borrar(nombre)
    await deposito.borrar(_automatica(1, 1))
    assert borradas == ["copias-de-seguridad/" + _automatica(1, 1)]


async def test_al_restaurar_se_borran_las_automaticas_que_sobran(cliente):
    viejas = {_automatica(1, d): b"vieja" for d in range(1, 13)}
    ajena = "spmm_backup_2026-01-01_0900.zip"
    cliente.deposito.guardadas.update(viejas)
    cliente.deposito.guardadas[ajena] = b"a mano"
    copia = await _bajar(cliente)

    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    recien = r.json()["data"]["copia_previa"]["nombre"]
    automaticas = [n for n in cliente.deposito.guardadas if n.endswith("_antes-de-restaurar.zip")]
    assert len(automaticas) == 10 and recien in automaticas
    assert ajena in cliente.deposito.guardadas
    borradas = sorted(set(viejas) - set(automaticas))
    assert borradas == [_automatica(1, d) for d in (1, 2, 3)]
    # Y queda anotado cuáles se borraron.
    (fila,) = [f for (f,) in await _leer(cliente, select(AuditoriaMovimiento).where(
        AuditoriaMovimiento.ruta == "/backups/restauracion"))]
    assert sorted(json.loads(fila.detalle)["despues"]["automaticas_borradas"]) == borradas


async def test_si_borrar_falla_la_restauracion_queda_igual(cliente, monkeypatch):
    cliente.deposito.guardadas.update({_automatica(1, d): b"vieja" for d in range(1, 13)})
    copia = await _bajar(cliente)

    async def no_anda(_nombre):
        raise RuntimeError("Storage HTTP 500")

    monkeypatch.setattr(cliente.deposito, "borrar", no_anda)
    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    assert len(cliente.deposito.guardadas) == 13  # las 12 de antes y la nueva


async def test_si_la_restauracion_falla_no_se_borra_ninguna(cliente, monkeypatch):
    viejas = {_automatica(1, d): b"vieja" for d in range(1, 13)}
    cliente.deposito.guardadas.update(viejas)
    copia = await _bajar(cliente)

    async def falla_despues_de_la_copia(conn, esquema, archivo, revision, **kw):
        await kw["antes_de_borrar"]()  # la automática se guarda...
        raise RuntimeError("se cortó la conexión")  # ...y la restauración no termina

    monkeypatch.setattr(CopiaSeguridadAPI, "restaurar_copia", falla_despues_de_la_copia)
    r = await _restaurar(cliente, copia)
    assert r.status_code == 500, r.text
    assert set(viejas) <= set(cliente.deposito.guardadas)
    assert len(cliente.deposito.guardadas) == 13


async def test_el_estado_dice_cuantas_automaticas_quedan(cliente):
    r = await cliente.get("/backups/estado", headers=ADMIN)
    assert r.json()["data"]["copia_automatica"]["quedan"] == 10


# ─────────────────────────── piezas sueltas ───────────────────────────


def test_los_grupos_se_nombran_por_el_modelo():
    assert {"usuario", "rol", "area", "seccion", "rol_area", "rol_seccion",
            "usuario_area", "usuario_seccion"} == copias.TABLAS_DE_ACCESO
    assert {"auditoria_movimiento", "auditoria_proceso_ot"} <= copias.TABLAS_DE_AUDITORIA
    for tabla in copias.TABLAS_DE_ACCESO:
        assert tabla in Base.metadata.tables


def test_el_nombre_del_archivo():
    cuando = datetime(2026, 9, 22, 15, 30, 12)
    assert copias.nombre_de_copia(cuando) == "spmm_backup_2026-09-22_1530.zip"
    assert copias.nombre_de_copia(cuando, antes_de_restaurar=True) == \
        "spmm_backup_2026-09-22_153012_antes-de-restaurar.zip"
    assert copias.NOMBRE_DE_ARCHIVO.match(copias.nombre_de_copia(cuando))
    assert not copias.NOMBRE_DE_ARCHIVO.match("../planos/x.zip")


# ═══════════════════════ segunda vuelta: lo que encontró la verificación ═══════════════════════


async def _descargas(c) -> list:
    return [f for (f,) in await _leer(c, select(AuditoriaMovimiento).where(
        AuditoriaMovimiento.ruta == "/backups/descargar").order_by(AuditoriaMovimiento.id))]


def _sin_columna(datos: bytes, tabla: str, columna: str) -> bytes:
    """La misma copia como la habría hecho este servidor antes de que existiera
    `columna` (firmada)."""
    columnas, filas = _filas(datos, tabla)
    i = columnas.index(columna)

    def _sacar(m):
        t = m["tablas"][tabla]
        t["columnas"] = t["columnas"][:i] + t["columnas"][i + 1:]
        t["tipos"] = t["tipos"][:i] + t["tipos"][i + 1:]
        t["columnas_vaciadas"] = [c for c in t.get("columnas_vaciadas", []) if c != columna]

    return _reempaquetar(datos, tablas={tabla: _jsonl([f[:i] + f[i + 1:] for f in filas])},
                         cambiar_manifiesto=_sacar)


# ── «ya descargué la copia de hoy» no puede perder lo que se guardó después ──


async def test_ya_la_descargue_no_alcanza_si_despues_se_guardo_algo(cliente):
    cliente.deposito.anda = False
    vieja = await _bajar(cliente)
    hoy = await _bajar(cliente)
    # Alguien guarda algo DESPUÉS de que el admin bajó la copia de hoy.
    await _ejecutar(cliente, update(Cliente).where(Cliente.id == 1).values(nombre="Acme (después)"))
    antes = await _foto(cliente)

    r = await _restaurar(cliente, vieja, ya_descargue=True, la_de_hoy=hoy)
    assert r.status_code == 409, r.text
    assert r.json()["errors"][0]["campo"] == "copia_previa"
    assert "guardó cambios" in _msg(r) and "No se restauró nada" in _msg(r)
    assert await _foto(cliente) == antes

    # Bajada otra vez (ya con el cambio adentro): ahora sí, y lo nuevo está en esa copia.
    otra = await _bajar(cliente)
    columnas, filas = _filas(otra, "cliente")
    assert "Acme (después)" in [f[columnas.index("nombre")] for f in filas]
    r = await _restaurar(cliente, vieja, ya_descargue=True, la_de_hoy=otra)
    assert r.status_code == 200, r.text


async def test_ya_la_descargue_pide_ese_archivo_entero_y_de_quien_restaura(cliente):
    cliente.deposito.anda = False
    vieja = await _bajar(cliente)
    antes = await _foto(cliente)
    # Sin decir qué archivo tiene, o con uno que no se bajó de acá: no.
    assert (await _restaurar(cliente, vieja, ya_descargue=True)).status_code == 409
    assert (await _restaurar(cliente, vieja, ya_descargue=True, la_de_hoy=b"otro")).status_code == 409
    # La bajó OTRO admin: tampoco (tiene que tenerla quien restaura).
    de_lucas = await _bajar(cliente, headers=_token(LUCAS))
    assert (await _restaurar(cliente, vieja, ya_descargue=True, la_de_hoy=de_lucas)).status_code == 409
    # Una descarga que se cortó no cuenta.
    hoy = await _bajar(cliente)
    await _ejecutar(cliente, update(AuditoriaMovimiento).where(
        AuditoriaMovimiento.id == (await _descargas(cliente))[-1].id).values(estado=499))
    assert (await _restaurar(cliente, vieja, ya_descargue=True, la_de_hoy=hoy)).status_code == 409
    assert await _foto(cliente) == antes


async def test_ya_la_descargue_con_los_usuarios_mira_tambien_las_cuentas(cliente):
    cliente.deposito.anda = False
    vieja = await _bajar(cliente)
    hoy = await _bajar(cliente)
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == MATIAS).values(rol="supervisor"))
    # Con los usuarios, el cambio de rol de después de bajarla se perdería: no.
    r = await _restaurar(cliente, vieja, ya_descargue=True, la_de_hoy=hoy, incluir_usuarios=True)
    assert r.status_code == 409 and "guardó cambios" in _msg(r)
    # Sin los usuarios, las cuentas no se tocan: los datos siguen siendo los de la copia de hoy.
    r = await _restaurar(cliente, vieja, ya_descargue=True, la_de_hoy=hoy)
    assert r.status_code == 200, r.text


# ── la firma ──


async def test_la_copia_va_firmada_y_una_editada_se_nota(cliente):
    copia = await _bajar(cliente)
    assert _manifiesto(copia)["firma"]["algoritmo"] == "hmac-sha256"
    r = await _revisar(cliente, copia)
    assert r.json()["data"]["firma"] == {"valida": True, "motivo": None}

    # Alguien cambia un dato y rehace hashes y cantidades, pero no tiene la clave.
    columnas, filas = _filas(copia, "cliente")
    filas[0][columnas.index("nombre")] = "Cambiado a mano"
    editada = _reempaquetar(copia, tablas={"cliente": _jsonl(filas)}, firmar=False)
    await _ejecutar(cliente, update(Cliente).where(Cliente.id == 2).values(nombre="hoy"))
    antes = await _foto(cliente)

    r = await _revisar(cliente, editada)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["firma"] == {"valida": False, "motivo": copias.SIN_FIRMA}
    # Con los usuarios, nunca: ni revisarla ni restaurarla, aunque se confirme.
    r = await _revisar(cliente, editada, incluir_usuarios=True)
    assert r.status_code == 422 and "no se pueden incluir los usuarios" in _msg(r)
    r = await _restaurar(cliente, editada, incluir_usuarios=True, sin_firma=True)
    assert r.status_code == 422
    # Los datos, sólo confirmándolo aparte.
    r = await _restaurar(cliente, editada)
    assert r.status_code == 409 and r.json()["errors"][0]["campo"] == "firma"
    assert await _foto(cliente) == antes
    assert cliente.deposito.guardadas == {}
    r = await _restaurar(cliente, editada, sin_firma=True)
    assert r.status_code == 200, r.text
    assert [n for (n,) in await _leer(cliente, select(Cliente.nombre).order_by(Cliente.id))] == \
        ["Cambiado a mano", "Metlo SA"]
    (fila,) = [f for (f,) in await _leer(cliente, select(AuditoriaMovimiento).where(
        AuditoriaMovimiento.ruta == "/backups/restauracion", AuditoriaMovimiento.estado == 200))]
    assert "sin la firma de este servidor" in fila.descripcion


async def test_una_copia_de_otro_servidor_no_esta_firmada(cliente, monkeypatch):
    copia = await _bajar(cliente)
    # Otra instalación (u otra SECRET_KEY): otra clave de firma.
    monkeypatch.setattr(copias, "_clave_de_firma", lambda: b"la-clave-de-otra-instalacion")
    r = await _revisar(cliente, copia)
    assert r.status_code == 200 and r.json()["data"]["firma"]["valida"] is False


async def test_una_cuenta_de_admin_inventada_no_entra(cliente):
    """El ataque de la verificación: agregar a la copia un admin permanente con una clave
    conocida y rehacer los hashes. No entra, y su token no abre nada."""
    copia = await _bajar(cliente)
    columnas, filas = _filas(copia, "usuario")
    intruso = list(filas[0])
    for campo, valor in (("id_usuario", 77), ("username", "intruso"), ("email", "intruso@x.com"),
                         ("rol", "admin"), ("activo", True), ("admin_permanente", True),
                         ("password_hash", HASH_VIEJO)):
        intruso[columnas.index(campo)] = valor
    columnas_ua, _ = _filas(copia, "usuario_area")
    de_mas = {"id": 1, "id_usuario": SOFIA, "area_codigo": "configuracion", "nivel": "admin",
              "creado_en": "2026-09-01T00:00:00"}
    editada = _reempaquetar(copia, firmar=False, tablas={
        "usuario": _jsonl(filas + [intruso]),
        "usuario_area": _jsonl([[de_mas.get(c) for c in columnas_ua]]),
    })
    antes = await _foto(cliente)
    assert (await _revisar(cliente, editada, incluir_usuarios=True)).status_code == 422
    for sin_firma in (False, True):
        r = await _restaurar(cliente, editada, incluir_usuarios=True, sin_firma=sin_firma)
        assert r.status_code == 422, r.text
    assert await _foto(cliente) == antes
    assert (await cliente.get("/backups/estado", headers=_token(77))).status_code == 401
    assert (await cliente.get("/backups/descargar", headers=_token(SOFIA, "supervisor"))).status_code == 403


async def test_la_copia_no_puede_dar_lo_que_la_pantalla_de_permisos_no_deja(cliente):
    """Aunque la copia esté firmada (defensa en profundidad): «administrar» en
    Configuración es sólo del rol admin."""
    copia = await _bajar(cliente)
    columnas_ua, _ = _filas(copia, "usuario_area")
    de_mas = {"id": 1, "id_usuario": SOFIA, "area_codigo": "configuracion", "nivel": "admin",
              "creado_en": "2026-09-01T00:00:00"}
    mala = _reempaquetar(copia, tablas={"usuario_area": _jsonl([[de_mas.get(c) for c in columnas_ua]])})
    r = await _revisar(cliente, mala, incluir_usuarios=True)
    assert r.status_code == 422 and "sólo del rol Administrador" in _msg(r)
    # Sin los usuarios, esa tabla no se toca: la copia se puede restaurar.
    assert (await _revisar(cliente, mala)).status_code == 200

    columnas_ra, filas_ra = _filas(copia, "rol_area")
    i_rol, i_area, i_nivel = (columnas_ra.index(c) for c in ("rol_codigo", "area_codigo", "nivel"))
    for f in filas_ra:
        if f[i_rol] == "supervisor" and f[i_area] == "configuracion":
            f[i_nivel] = "admin"
    mala = _reempaquetar(copia, tablas={"rol_area": _jsonl(filas_ra)})
    r = await _revisar(cliente, mala, incluir_usuarios=True)
    assert r.status_code == 422 and "al rol «supervisor»" in _msg(r)


def test_los_topes_son_los_de_la_pantalla_de_permisos():
    assert copias.TOPE_AREA_NO_ADMIN == PermisosAPI._TOPE_AREA
    assert copias.TOPE_SECCION_NO_ADMIN == PermisosAPI._TOPE_SECCION


# ── las copias automáticas no se pueden bajar como si fueran un plano ──


async def test_un_plano_no_puede_apuntar_fuera_de_los_planos(cliente):
    copia = await _bajar(cliente)
    antes = await _foto(cliente)
    columnas, filas = _filas(copia, "plano")
    i = columnas.index("storage_path")
    for ruta in ("copias-de-seguridad/spmm_backup_2026-09-22_153012_antes-de-restaurar.zip",
                 "articulo/1/../../copias-de-seguridad/x.zip", "/articulo/1/x.pdf", "otra/1/x.pdf"):
        filas[0][i] = ruta
        for firmar in (False, True):
            mala = _reempaquetar(copia, tablas={"plano": _jsonl(filas)}, firmar=firmar)
            r = await _revisar(cliente, mala)
            assert r.status_code == 422, (ruta, r.text)
            assert "no es el archivo de un plano" in _msg(r)
            assert (await _restaurar(cliente, mala, sin_firma=True)).status_code == 422
    assert await _foto(cliente) == antes


async def test_plano_service_no_sirve_ni_borra_nada_fuera_de_los_planos(monkeypatch):
    from backend.application.PlanoService import PlanoService

    pedidos = []

    async def _bajar_objeto(ruta):
        pedidos.append(("bajar", ruta))
        return b"lo que haya"

    async def _borrar_objeto(ruta):
        pedidos.append(("borrar", ruta))

    monkeypatch.setattr(storage_planos, "bajar", _bajar_objeto)
    monkeypatch.setattr(storage_planos, "borrar", _borrar_objeto)

    def _servicio(ruta, archivo=None):
        class _Repo:
            async def find_by_id(self, _id):
                return SimpleNamespace(archivo=archivo, storage_path=ruta, tipo_archivo="pdf", nombre="x")

            async def find_storage_path(self, _id):
                return ruta

            async def delete(self, _id):
                return True

        servicio = PlanoService(None)
        servicio.repository = _Repo()
        return servicio

    copia = "copias-de-seguridad/spmm_backup_2026-09-22_153012_antes-de-restaurar.zip"
    for ruta in (copia, "articulo/1/../../" + copia, "articulo/1/%2e%2e/x"):
        with pytest.raises(InfrastructureException):
            await _servicio(ruta).obtenerContenidoPlano(1)
        # Con el blob del camino viejo, se sirve el blob (nunca el objeto).
        assert (await _servicio(ruta, b"blob").obtenerContenidoPlano(1))[0] == b"blob"
        await _servicio(ruta).eliminarPlano(1)
    assert pedidos == []

    # Y un plano de verdad, como siempre.
    ruta = storage_planos.ruta_para("Plano (1).pdf", id_articulo=7)
    assert (await _servicio(ruta).obtenerContenidoPlano(1))[0] == b"lo que haya"
    await _servicio(ruta).eliminarPlano(1)
    assert pedidos == [("bajar", ruta), ("borrar", ruta)]


def test_las_rutas_de_plano():
    for ruta in (storage_planos.ruta_para("Plano (1).pdf", id_articulo=7),
                 storage_planos.ruta_para("croquis Ø.png", id_orden=10),
                 storage_planos.ruta_para("..")):
        assert storage_planos.es_ruta_de_plano(ruta), ruta
        assert storage_planos.ruta_permitida_para_planos(ruta), ruta
    for ruta in ("copias-de-seguridad/x.zip", "articulo/1/../x", "articulo/1/..", "/articulo/1/x",
                 "articulo//x", "articulo/1/x?y", "articulo/1/%2e%2e", "", None, 5):
        assert not storage_planos.es_ruta_de_plano(ruta), ruta
        assert not storage_planos.ruta_permitida_para_planos(ruta), ruta
    # Una ruta vieja con otra forma se sigue abriendo; restaurarla, no.
    assert storage_planos.ruta_permitida_para_planos("planos/viejo.pdf")
    assert not storage_planos.es_ruta_de_plano("planos/viejo.pdf")


# ── la copia no lleva contraseñas ni tokens de recuperación ──


async def test_la_copia_no_lleva_contrasenas_ni_tokens(cliente):
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == SOFIA).values(
        reset_token="TOKEN-VIVO-DE-RESETEO", reset_token_expiry=datetime(2026, 9, 23, 12)))
    datos = await _bajar(cliente)
    columnas, filas = _filas(datos, "usuario")
    for columna in ("password_hash", "reset_token", "reset_token_expiry"):
        assert all(f[columnas.index(columna)] is None for f in filas), columna
    assert _manifiesto(datos)["tablas"]["usuario"]["columnas_vaciadas"] == \
        ["password_hash", "reset_token", "reset_token_expiry"]
    zf = zipfile.ZipFile(io.BytesIO(datos))
    todo = b"".join(zf.read(n) for n in zf.namelist())
    assert b"TOKEN-VIVO-DE-RESETEO" not in todo and b"$2b$" not in todo

    # Y restaurarla, aun con los usuarios, no le cambia la contraseña a nadie.
    r = await _restaurar(cliente, datos, incluir_usuarios=True)
    assert r.status_code == 200, r.text
    claves = {i: h for (i, h) in await _leer(cliente, select(Usuario.id_usuario, Usuario.password_hash))}
    assert set(claves.values()) == {HASH_VIEJO}


def test_lo_que_no_viaja_son_columnas_del_modelo():
    for tabla, columnas in copias.COLUMNAS_QUE_NO_VIAJAN.items():
        assert set(columnas) <= set(Base.metadata.tables[tabla].c.keys())
    assert set(copias.CAMPOS_DE_HOY) <= set(Usuario.__table__.c.keys())
    assert not verify_password("", copias.CLAVE_INUSABLE)
    assert not verify_password(copias.CLAVE_INUSABLE, copias.CLAVE_INUSABLE)


# ── incluir usuarios con las reglas de RF-24 y RF-26 ──


async def test_incluir_usuarios_no_reactiva_ni_toca_a_los_permanentes(cliente):
    # Cuando se hizo la copia: Lucas era supervisor, Sofía estaba activa y existía Pepe.
    await _ejecutar(
        cliente,
        update(Usuario).where(Usuario.id_usuario == LUCAS).values(rol="supervisor"),
        insert(Usuario).values(id_usuario=6, username="pepe", email="pepe@metlo.com.ar",
                               password_hash=HASH_VIEJO, nombre="Pepe", apellido="Prueba",
                               rol="operario"),
    )
    copia = await _bajar(cliente)
    # Después: Lucas volvió a admin y es permanente (con otra clave), Sofía se fue (se
    # desactivó), Pepe se borró y Matías pasó a supervisor.
    await _ejecutar(
        cliente,
        update(Usuario).where(Usuario.id_usuario == LUCAS).values(
            rol="admin", admin_permanente=True, password_hash=HASH_NUEVO),
        update(Usuario).where(Usuario.id_usuario == SOFIA).values(activo=False, password_hash=HASH_NUEVO),
        Usuario.__table__.delete().where(Usuario.id_usuario == 6),
        update(Usuario).where(Usuario.id_usuario == MATIAS).values(rol="supervisor"),
    )
    (lucas_hoy,) = [tuple(f) for f in await _leer(
        cliente, select(Usuario.__table__).where(Usuario.id_usuario == LUCAS))]

    r = await _revisar(cliente, copia, incluir_usuarios=True)
    assert r.status_code == 200, r.text
    cambios = " ".join(r.json()["data"]["cambios_de_usuarios"])
    assert "administradores permanentes (Lucas Prueba (lucas))" in cambios
    assert "Vuelven desactivadas y sin contraseña" in cambios and "Pepe Prueba (pepe)" in cambios
    assert "Matias Prueba (matias) (supervisor → operario)" in cambios
    assert "Siguen desactivadas" in cambios and "Sofia Prueba (sofia)" in cambios

    r = await _restaurar(cliente, copia, incluir_usuarios=True)
    assert r.status_code == 200, r.text
    usuarios = {f.id_usuario: f for f in await _leer(cliente, select(Usuario.__table__))}
    # El permanente, tal cual está hoy: admin, permanente y su clave de hoy.
    assert tuple(usuarios[LUCAS]) == lucas_hoy
    # Nadie se reactiva, y cada uno conserva su clave de hoy.
    assert usuarios[SOFIA].activo is False and usuarios[SOFIA].password_hash == HASH_NUEVO
    assert usuarios[MATIAS].rol == "operario"
    # Pepe vuelve, pero desactivado y sin clave que sirva.
    assert usuarios[6].activo is False and usuarios[6].admin_permanente is False
    assert usuarios[6].password_hash == copias.CLAVE_INUSABLE
    assert usuarios[6].reset_token is None and usuarios[6].debe_cambiar_password is True
    assert not verify_password("la-de-antes", usuarios[6].password_hash)


async def test_una_copia_vieja_no_le_saca_la_marca_de_permanente_a_nadie(cliente):
    """Una copia de antes de que existiera admin_permanente: la columna queda como hoy."""
    vieja = _sin_columna(await _bajar(cliente), "usuario", "admin_permanente")
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == LUCAS).values(admin_permanente=True))
    r = await _restaurar(cliente, vieja, incluir_usuarios=True)
    assert r.status_code == 200, r.text
    ((permanente,),) = await _leer(cliente, select(Usuario.admin_permanente).where(Usuario.id_usuario == LUCAS))
    assert permanente is True


async def test_un_permanente_no_puede_chocar_con_otra_cuenta_de_la_copia(cliente):
    copia = await _bajar(cliente)
    columnas, filas = _filas(copia, "usuario")
    for f in filas:
        if f[columnas.index("id_usuario")] == LUCAS:
            f[columnas.index("id_usuario")] = 98
    otra = _reempaquetar(copia, tablas={"usuario": _jsonl(filas)})
    await _ejecutar(cliente, update(Usuario).where(Usuario.id_usuario == LUCAS).values(admin_permanente=True))
    antes = await _foto(cliente)
    r = await _revisar(cliente, otra, incluir_usuarios=True)
    assert r.status_code == 422 and "administrador permanente" in _msg(r)
    assert (await _restaurar(cliente, otra, incluir_usuarios=True)).status_code == 422
    assert await _foto(cliente) == antes


# ── la auditoría de las descargas ──


async def _descargar_y_cortar(headers: dict, cortar_despues: int) -> int:
    """Pide la copia directo a la app ASGI y corta la conexión cuando llegaron
    `cortar_despues` bytes, como un navegador que se cierra a la mitad."""
    recibido = bytearray()
    cortar = asyncio.Event()
    pedido = {"enviado": False}
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
        "scheme": "http", "path": "/backups/descargar", "raw_path": b"/backups/descargar",
        "query_string": b"", "root_path": "", "client": ("127.0.0.1", 1), "server": ("test", 80),
        "headers": [(b"host", b"test"), (b"authorization", headers["Authorization"].encode())],
    }

    async def receive():
        if not pedido["enviado"]:
            pedido["enviado"] = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await cortar.wait()
        return {"type": "http.disconnect"}

    async def send(mensaje):
        if mensaje["type"] == "http.response.body":
            recibido.extend(mensaje.get("body", b""))
            if len(recibido) >= cortar_despues:
                cortar.set()

    try:
        await app(scope, receive, send)
    except Exception:
        pass  # según la versión, cortar puede terminar en una excepción: da igual
    return len(recibido)


async def test_una_descarga_cortada_queda_anotada(cliente_cortable, monkeypatch):
    cliente = cliente_cortable
    monkeypatch.setattr(copias, "LOTE", 1)  # muchos pedazos, para cortar a la mitad
    entera = len(await _bajar(cliente))
    await _ejecutar(cliente, AuditoriaMovimiento.__table__.delete())
    llegaron = await _descargar_y_cortar(ADMIN, cortar_despues=2000)
    assert 0 < llegaron < entera
    (fila,) = await _descargas(cliente)
    assert fila.id_usuario == JULIAN and fila.estado == 499
    assert "se cortó" in fila.descripcion
    assert json.loads(fila.detalle)["despues"]["completa"] is False


async def test_la_descarga_se_anota_antes_del_primer_byte(cliente_cortable, monkeypatch):
    cliente = cliente_cortable
    monkeypatch.setattr(copias, "LOTE", 1)

    async def _nunca_termina_de_anotar(*_, **__):
        return None
    monkeypatch.setattr(CopiaSeguridadAPI, "_anotar_fin", _nunca_termina_de_anotar)
    assert await _descargar_y_cortar(ADMIN, cortar_despues=2000) > 0
    # Aunque no se haya podido completar, la fila de «empezó» está.
    (fila,) = await _descargas(cliente)
    assert fila.id_usuario == JULIAN and fila.estado is None
    assert "empezó a descargar una copia de seguridad completa" in fila.descripcion


async def test_sin_poder_anotarla_no_hay_copia(cliente, monkeypatch):
    async def _falla(*_, **__):
        raise RuntimeError("la base de la auditoría no contesta")
    monkeypatch.setattr(CopiaSeguridadAPI, "_anotar_inicio", _falla)
    r = await cliente.get("/backups/descargar", headers=ADMIN)
    assert r.status_code == 503 and "sin dejar rastro" in _msg(r)
    assert not r.content.startswith(b"PK")


async def test_un_intento_sin_permiso_de_bajar_queda_anotado(cliente):
    for ruta in ("/backups/descargar", "/backups/automaticas"):
        r = await cliente.get(ruta, headers=_token(SOFIA, "supervisor"))
        assert r.status_code == 403
    filas = [f for (f,) in await _leer(cliente, select(AuditoriaMovimiento).where(
        AuditoriaMovimiento.ruta.like("/backups/%")).order_by(AuditoriaMovimiento.id))]
    assert [(f.id_usuario, f.ruta, f.estado) for f in filas] == [
        (SOFIA, "/backups/descargar", 403), (SOFIA, "/backups/automaticas", 403)]
    assert filas[0].descripcion == "Sofia Prueba descargó copia de seguridad (no se pudo: error 403)"
    # Las lecturas de siempre siguen sin anotarse.
    assert (await cliente.get("/backups/estado", headers=ADMIN)).status_code == 200
    assert len(await _leer(cliente, select(AuditoriaMovimiento.id).where(
        AuditoriaMovimiento.ruta == "/backups/estado"))) == 0


# ── los planos del camino viejo ──


async def test_un_plano_viejo_que_despues_se_paso_a_storage_conserva_su_ruta(cliente):
    copia = await _bajar(cliente)  # el plano 2 está adentro de la base, sin ruta
    ruta = "orden/10/0123456789abcdef0123456789abcdef-croquis.png"
    await _ejecutar(cliente, update(Plano).where(Plano.id == 2).values(archivo=None, storage_path=ruta))
    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    assert await _leer(cliente, select(Plano.storage_path, Plano.archivo).where(Plano.id == 2)) == [(ruta, None)]


async def test_un_plano_sin_archivo_en_ningun_lado_no_vuelve_y_se_avisa(cliente):
    copia = await _bajar(cliente)
    await _ejecutar(cliente, Plano.__table__.delete().where(Plano.id == 2))
    r = await _revisar(cliente, copia)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["planos_sin_archivo"] == 1
    assert any("Un plano de la copia no tiene el archivo en ningún lado" in a for a in r.json()["data"]["avisos"])
    r = await _restaurar(cliente, copia)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["planos_sin_archivo"] == 1
    assert [i for (i,) in await _leer(cliente, select(Plano.id))] == [1]
