"""
Fixtures de test. Usan SQLite en memoria (StaticPool para compartir la misma
conexión entre create_all y la sesión) para no tocar la base real SMPP.
"""
from datetime import time

import pytest_asyncio
from sqlalchemy import event
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
from backend.domain.Maquinaria import Maquinaria
from backend.domain.RangoMaquinaria import RangoMaquinaria
from backend.domain.ProcesoMaquinaria import ProcesoMaquinaria
# Las OT y sus procesos: borrar un proceso del catálogo tiene que poder decir en qué
# órdenes está, y eso se consulta contra estas dos tablas.
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
# Las que cuelgan de esas dos por FK. Con `PRAGMA foreign_keys=ON` el harness las exige
# al insertar, aunque el test no las use.
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Prioridad import Prioridad
from backend.domain.Sector import Sector
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente

# Solo las tablas que tocan las skills nativas y la composición del rango
# (evita tipos MSSQL de otros modelos).
TEST_TABLES = [
    Proceso.__table__,
    Rango.__table__,
    Operario.__table__,
    RangoProceso.__table__,
    OperarioRango.__table__,
    OperarioProcesoSkill.__table__,
    Maquinaria.__table__,
    RangoMaquinaria.__table__,
    ProcesoMaquinaria.__table__,
    # Borrar un proceso del catálogo tiene que poder decir en qué órdenes está.
    OrdenTrabajo.__table__,
    OrdenTrabajoProceso.__table__,
    EstadoProceso.__table__,
    IncidenciaProceso.__table__,
    Prioridad.__table__,
    Sector.__table__,
    Articulo.__table__,
    Cliente.__table__,
]


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    # SQLite ignora las FK (y sus ON DELETE CASCADE) salvo que se pidan explícitamente.
    # Sin esto el harness es más permisivo que Postgres y deja pasar borrados que en
    # producción dejan filas huérfanas —o al revés, esconde que el cascade funciona.
    @event.listens_for(engine.sync_engine, "connect")
    def _activar_fks(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
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
