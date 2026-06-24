"""
Fixtures de test. Usan SQLite en memoria (StaticPool para compartir la misma
conexión entre create_all y la sesión) para no tocar la base real SMPP.
"""
from datetime import time

import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.infrastructure.db import Base

# Importar los modelos involucrados para registrarlos en Base.metadata y
# configurar los mappers (relaciones por string).
from backend.domain.Operario import Operario
from backend.domain.OperarioRango import OperarioRango
from backend.domain.Rango import Rango
from backend.domain.RangoProceso import RangoProceso
from backend.domain.Proceso import Proceso
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill

# Solo las tablas que tocan las skills nativas (evita tipos MSSQL de otros modelos).
TEST_TABLES = [
    Proceso.__table__,
    Rango.__table__,
    Operario.__table__,
    RangoProceso.__table__,
    OperarioRango.__table__,
    OperarioProcesoSkill.__table__,
]


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TEST_TABLES))

    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        yield s

    await engine.dispose()


async def seed_basico(session):
    """
    Crea un operario (id=1) con rango (id=7) que cubre los procesos 100 y 101,
    y un proceso 200 fuera del rango. Devuelve nada; los ids son fijos.
    """
    session.add_all([
        Proceso(id=100, nombre="Torneado"),
        Proceso(id=101, nombre="Roscado"),
        Proceso(id=200, nombre="Fresado"),
        Rango(id=7, nombre="Tornero"),
        Operario(id=1, nombre="Juan", apellido="Perez", categoria="OFICIAL",
                 hora_inicio=time(7, 0), hora_fin=time(16, 0)),
        RangoProceso(id_rango=7, id_proceso=100),
        RangoProceso(id_rango=7, id_proceso=101),
        OperarioRango(id_operario=1, id_rango=7),
    ])
    await session.commit()
