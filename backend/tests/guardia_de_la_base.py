"""La guardia: ningún test llega a una base (ni a ningún servidor) que no sea local.

POR QUÉ

El `.env` de la raíz apunta a Supabase de PRODUCCIÓN, y `backend/infrastructure/db.py`
arma su engine con eso apenas se lo importa. Cada agujero se venía tapando de a uno con
un fixture (la auditoría del middleware, los permisos, las copias de seguridad), y el
23/09 un revisor igual hizo UNA lectura a producción desde un test: un router abría su
propia sesión y nadie la había pisado. Tapar de a uno no alcanza; esto la hace
imposible para todos, también para el router que se escriba mañana.

QUÉ HACE (conftest.py la instala ANTES de importar nada de la app)

 1. La URL de la base. SUPABASE_DB_URL y DATABASE_URL se fuerzan a un Postgres en
    127.0.0.1:9, donde no escucha nadie, antes de que db.py lea el `.env` (python-dotenv
    no pisa una variable que ya está). Así el `SessionLocal` de la app, si un test llega
    a usarlo, choca contra una conexión rechazada en la propia máquina. Si alguien ya
    puso una URL LOCAL (un Postgres descartable suyo) se respeta. También se vacían las
    claves de Supabase Storage y de Resend: sin ellas no hay a dónde subir ni mandar.
 2. La conexión, en tres capas, cada una por si las otras fallan:
      · SQLAlchemy: todo engine (sync o async, lo arme quien lo arme) pasa por
        `do_connect`; si no es SQLite y el host no es local, salta.
      · asyncpg.connect / create_pool y psycopg2.connect, por si alguien conecta sin
        SQLAlchemy (los scripts lo hacen).
      · El socket: resolver un nombre o abrir una conexión TCP a algo que no sea la
        propia máquina salta. Esto cubre también Supabase Storage, Resend o cualquier
        otra cosa de afuera.
    Todas levantan AccesoRemotoBloqueado, con un mensaje que dice qué se intentó.

Lo local sigue andando: SQLite, 127.0.0.1, ::1, localhost y los sockets de Unix.
tests/test_guardia_de_la_base.py prueba que cada capa salta.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import parse_qs, urlsplit

# Un Postgres local donde no escucha nadie (el 9 es el puerto «discard»): la app se arma
# igual (el engine es perezoso) y, si algo llega a conectar, lo rechaza la propia máquina.
URL_DE_LOS_TESTS = "postgresql://tests:tests@127.0.0.1:9/spmm_tests_sin_base"

VARIABLES_DE_LA_BASE = ("SUPABASE_DB_URL", "DATABASE_URL")
# Sin esto, storage_planos y el mail tendrían con qué salir a Supabase y a Resend.
VARIABLES_QUE_SE_VACIAN = (
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
)


class AccesoRemotoBloqueado(RuntimeError):
    """Un test intentó llegar a una base o a un servidor que no es la propia máquina."""


def es_local(host) -> bool:
    """True si `host` es esta máquina: vacío (socket de Unix por defecto), una ruta de
    socket de Unix, localhost o una IP de loopback."""
    if host is None:
        return True
    if isinstance(host, (bytes, bytearray)):
        host = host.decode("utf-8", "replace")
    h = str(host).strip().strip("[]").lower()
    if h == "" or h.startswith("/"):
        return True
    if h == "localhost" or h.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(h.split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def _bloquear(que: str, host) -> None:
    raise AccesoRemotoBloqueado(
        f"GUARDIA DE LOS TESTS: {que} a «{host}», que no es esta máquina. Los tests sólo "
        "pueden usar SQLite o un Postgres en 127.0.0.1/localhost (el .env apunta a "
        "PRODUCCIÓN). Pisá la sesión o el cliente que abre esa conexión."
    )


def _hosts_de_url(url) -> list:
    """Los hosts de una URL de Postgres (`postgresql://u:p@host:5432/db?host=...`)."""
    if not url:
        return []
    partes = urlsplit(str(url))
    hosts = []
    # netloc puede traer varios hosts separados por coma (multi-host de libpq/asyncpg).
    netloc = partes.netloc.rsplit("@", 1)[-1]
    for trozo in netloc.split(","):
        trozo = trozo.strip()
        if trozo.startswith("["):
            hosts.append(trozo[1:trozo.find("]")])
        elif trozo:
            hosts.append(trozo.split(":", 1)[0])
    hosts.extend(parse_qs(partes.query).get("host", []))
    return hosts


def url_es_local(url: str) -> bool:
    if str(url).startswith("sqlite"):
        return True
    return all(es_local(h) for h in _hosts_de_url(url))


# ─────────────────────────── 1. la URL ───────────────────────────

def forzar_entorno() -> None:
    for var in VARIABLES_DE_LA_BASE:
        actual = os.environ.get(var)
        if not actual or not url_es_local(actual):
            os.environ[var] = URL_DE_LOS_TESTS
    for var in VARIABLES_QUE_SE_VACIAN:
        os.environ[var] = ""
    # El loop del sync sólo arranca con el lifespan, pero por las dudas.
    os.environ["SYNC_LOOP_ENABLED"] = "false"


# ─────────────────────────── 2. las conexiones ───────────────────────────

def _revisar_sqlalchemy(dialect, conn_rec, cargs, cparams):
    if dialect.name == "sqlite":
        return None
    hosts = []
    if "host" in cparams:
        h = cparams["host"]
        hosts.extend(h if isinstance(h, (list, tuple)) else [h])
    if "dsn" in cparams:
        hosts.extend(_hosts_de_url(cparams["dsn"]))
    # SQL Server por ODBC: el host viaja adentro de la cadena («SERVER=...;»).
    for arg in cargs:
        if isinstance(arg, str) and "SERVER=" in arg.upper():
            for parte in arg.split(";"):
                clave, _, valor = parte.partition("=")
                if clave.strip().upper() == "SERVER":
                    hosts.append(valor.split(",")[0].split("\\")[0])
    if dialect.name != "postgresql" and not hosts:
        _bloquear(f"una conexión {dialect.name} sin host a la vista", "?")
    for h in hosts:
        if not es_local(h):
            _bloquear(f"una conexión {dialect.name} de SQLAlchemy", h)
    return None


def _envolver_asyncpg():
    try:
        import asyncpg
    except ImportError:  # pragma: no cover
        return

    def _revisar(args, kwargs):
        dsn = kwargs.get("dsn") or (args[0] if args else None)
        hosts = _hosts_de_url(dsn)
        h = kwargs.get("host")
        if h is not None:
            hosts.extend(h if isinstance(h, (list, tuple)) else [h])
        for host in hosts:
            if not es_local(host):
                _bloquear("asyncpg", host)

    for nombre in ("connect", "create_pool"):
        original = getattr(asyncpg, nombre)
        if getattr(original, "_guardia", False):
            continue

        def envuelta(*args, __original=original, __nombre=nombre, **kwargs):
            _revisar(args, kwargs)
            return __original(*args, **kwargs)

        envuelta._guardia = True
        setattr(asyncpg, nombre, envuelta)


def _envolver_psycopg2():
    try:
        import psycopg2
    except ImportError:  # pragma: no cover
        return
    original = psycopg2.connect
    if getattr(original, "_guardia", False):
        return

    def envuelta(dsn=None, *args, **kwargs):
        hosts = []
        if dsn and "://" in str(dsn):
            hosts.extend(_hosts_de_url(dsn))
        elif dsn:
            for parte in str(dsn).split():
                clave, _, valor = parte.partition("=")
                if clave == "host":
                    hosts.append(valor)
        if kwargs.get("host") is not None:
            hosts.append(kwargs["host"])
        for host in hosts:
            if not es_local(host):
                _bloquear("psycopg2", host)
        return original(dsn, *args, **kwargs)

    envuelta._guardia = True
    psycopg2.connect = envuelta


def _envolver_sockets():
    if getattr(socket.getaddrinfo, "_guardia", False):
        return
    getaddrinfo_original = socket.getaddrinfo
    connect_original = socket.socket.connect
    connect_ex_original = socket.socket.connect_ex

    def getaddrinfo(host, *args, **kwargs):
        if not es_local(host):
            _bloquear("resolver el nombre", host)
        return getaddrinfo_original(host, *args, **kwargs)

    def _revisar_direccion(sock, direccion):
        # Sockets de Unix: la dirección es una ruta. Esos son siempre locales.
        if sock.family in (socket.AF_INET, socket.AF_INET6) and isinstance(direccion, tuple):
            if not es_local(direccion[0]):
                _bloquear("abrir una conexión", f"{direccion[0]}:{direccion[1]}")

    def connect(self, direccion):
        _revisar_direccion(self, direccion)
        return connect_original(self, direccion)

    def connect_ex(self, direccion):
        _revisar_direccion(self, direccion)
        return connect_ex_original(self, direccion)

    getaddrinfo._guardia = True
    socket.getaddrinfo = getaddrinfo
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex


def instalar() -> None:
    """Lo llama conftest.py antes de importar la app. Se puede llamar más de una vez."""
    forzar_entorno()

    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    if not event.contains(Engine, "do_connect", _revisar_sqlalchemy):
        event.listen(Engine, "do_connect", _revisar_sqlalchemy)
    _envolver_asyncpg()
    _envolver_psycopg2()
    _envolver_sockets()


def verificar_la_app() -> None:
    """Después de importar db.py: que la URL con la que se armó el engine sea local.

    Si no, los tests no arrancan (mejor eso que una lectura a producción)."""
    from backend.infrastructure import db

    if not url_es_local(db.DATABASE_URL) or db.engine.dialect.name not in ("postgresql", "sqlite"):
        raise AccesoRemotoBloqueado(
            "GUARDIA DE LOS TESTS: db.py se armó contra una base que no es local; los "
            "tests no arrancan. ¿Se importó la app antes que conftest.py?"
        )
