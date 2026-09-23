"""La guardia de conftest.py salta de verdad (ver tests/guardia_de_la_base.py).

Ninguno de estos tests sale de la máquina: cada intento a un host de afuera se corta
ANTES de resolver el nombre o de abrir el socket, y ése es justamente el punto. Los
nombres son los de la forma de Supabase para que se lea qué se está cuidando; si la
guardia no estuviera, el test fallaría por la red y no por la guardia (nunca pasaría).
"""
import socket

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from backend.tests.guardia_de_la_base import AccesoRemotoBloqueado, es_local, url_es_local

HOST_REMOTO = "db.proyecto-de-mentira.supabase.co"
POOLER_REMOTO = "aws-0-sa-east-1.pooler.supabase.com"


def _salto_la_guardia(excinfo) -> bool:
    """La guardia salta adentro del connect; según la capa puede llegar envuelta."""
    e = excinfo.value
    while e is not None:
        if isinstance(e, AccesoRemotoBloqueado):
            return True
        e = e.__cause__ or e.__context__
    return False


def test_la_app_se_armo_contra_una_base_local():
    from backend.infrastructure import db

    url = make_url(db.DATABASE_URL)
    assert url.host in ("127.0.0.1", "localhost", "::1") or url.drivername.startswith("sqlite")
    assert "supabase" not in str(db.DATABASE_URL)
    assert "pooler" not in str(db.DATABASE_URL)


def test_quien_decide_que_es_local():
    for local in (None, "", "localhost", "127.0.0.1", "127.0.0.2", "::1", "[::1]",
                  "/tmp/.s.PGSQL.5432", "app.localhost"):
        assert es_local(local), local
    for remoto in (HOST_REMOTO, POOLER_REMOTO, "10.0.0.5", "8.8.8.8", "2001:db8::1",
                   "localhost.evil.com"):
        assert not es_local(remoto), remoto
    assert url_es_local("sqlite+aiosqlite:///:memory:")
    assert url_es_local("postgresql://u:p@127.0.0.1:5432/x")
    assert not url_es_local(f"postgresql://u:p@{POOLER_REMOTO}:6543/postgres")
    # multi-host: con uno de afuera alcanza para que no sea local
    assert not url_es_local(f"postgresql://u:p@127.0.0.1:5432,{HOST_REMOTO}:5432/x")


async def test_un_engine_async_a_supabase_salta_al_conectar():
    engine = create_async_engine(f"postgresql+asyncpg://u:p@{POOLER_REMOTO}:6543/postgres")
    try:
        with pytest.raises(Exception) as excinfo:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        assert _salto_la_guardia(excinfo)
    finally:
        await engine.dispose()


def test_un_engine_sync_a_supabase_salta_al_conectar():
    engine = create_engine(f"postgresql+psycopg2://u:p@{HOST_REMOTO}:5432/postgres")
    with pytest.raises(Exception) as excinfo:
        with engine.connect():
            pass
    assert _salto_la_guardia(excinfo)


async def test_asyncpg_sin_sqlalchemy_salta():
    import asyncpg

    with pytest.raises(AccesoRemotoBloqueado):
        await asyncpg.connect(f"postgresql://u:p@{HOST_REMOTO}:5432/postgres")
    with pytest.raises(AccesoRemotoBloqueado):
        await asyncpg.connect(host=POOLER_REMOTO, user="u", password="p")
    with pytest.raises(AccesoRemotoBloqueado):
        await asyncpg.create_pool(f"postgresql://u:p@{POOLER_REMOTO}:6543/postgres")


def test_psycopg2_sin_sqlalchemy_salta():
    import psycopg2

    with pytest.raises(AccesoRemotoBloqueado):
        psycopg2.connect(f"postgresql://u:p@{HOST_REMOTO}:5432/postgres")
    with pytest.raises(AccesoRemotoBloqueado):
        psycopg2.connect(f"host={POOLER_REMOTO} dbname=postgres user=u")
    with pytest.raises(AccesoRemotoBloqueado):
        psycopg2.connect(host=HOST_REMOTO, dbname="postgres")


def test_un_socket_pelado_hacia_afuera_salta():
    with pytest.raises(AccesoRemotoBloqueado):
        socket.getaddrinfo(HOST_REMOTO, 5432)
    with pytest.raises(AccesoRemotoBloqueado):
        socket.create_connection((POOLER_REMOTO, 6543), timeout=1)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(AccesoRemotoBloqueado):
            s.connect(("8.8.8.8", 53))
        with pytest.raises(AccesoRemotoBloqueado):
            s.connect_ex(("8.8.8.8", 53))
    finally:
        s.close()


async def test_la_sesion_de_produccion_de_la_app_no_llega_a_ningun_lado():
    """El caso del 23/09: un router que abre su propia sesión con el SessionLocal de
    db.py. Con la guardia apunta a 127.0.0.1:9, donde no hay nadie: rechazo local."""
    from backend.infrastructure.db import SessionLocal

    with pytest.raises(OSError):
        async with SessionLocal() as s:
            await s.execute(text("SELECT 1"))


def test_lo_local_sigue_andando():
    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT 1")).scalar() == 1
    assert socket.getaddrinfo("127.0.0.1", 80)
    assert socket.getaddrinfo("localhost", 80)
