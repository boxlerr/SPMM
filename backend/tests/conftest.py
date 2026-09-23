"""
Fixtures de test. Usan SQLite en memoria (StaticPool para compartir la misma
conexión entre create_all y la sesión) para no tocar la base real SMPP.
"""
from datetime import time

import pytest
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
# Borrar una pasada de proceso limpia primero la fila del plan que la apunta, así que
# sin esta tabla ese camino ni se puede probar (y es el cambio más destructivo que
# tiene la OT).
from backend.domain.Planificacion import Planificacion
# Borrar una OT borra también sus planos, así que sin esta tabla ese camino ni se
# puede probar.
from backend.domain.Plano import Plano
# El registro de quién tocó cada paso. Se escribe sola, enganchada al ORM, así que
# cualquier test que guarde un proceso la necesita creada.
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
# El aviso de orden retrasada se guarda acá, y el detector pregunta contra esta misma
# tabla si de una OT ya avisó: sin ella no se puede probar que no duplique.
from backend.domain.Notificacion import Notificacion
# El consumo de material (RF-15) cuelga de la OT, de la pieza y —sin FK— de la línea de
# materia prima: para probar que el alta valida la línea hacen falta las tres.
from backend.domain.Pieza import Pieza
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.ConsumoMaterial import ConsumoMaterial

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
    Planificacion.__table__,
    Plano.__table__,
    AuditoriaProcesoOT.__table__,
    Notificacion.__table__,
    Pieza.__table__,
    OrdenTrabajoPieza.__table__,
    ConsumoMaterial.__table__,
]


@pytest.fixture(autouse=True)
def auditoria_no_escribe_en_produccion(monkeypatch):
    """Ningún test puede escribir una fila de auditoría en Supabase.

    El middleware de `main.py` audita TODA escritura, y para hacerlo abre su propia
    sesión con el `SessionLocal` del módulo — el de PRODUCCIÓN, que se arma al
    importar db.py. Los tests que manejan la app real (test_primer_ingreso_password,
    por ejemplo) pisan la dependencia `get_db` del endpoint, pero esa sesión aparte no
    la ve nadie: sin esto, correr los tests le mete filas a la base del cliente.

    Es el mismo agujero que ya documenta test_migraciones_al_arrancar, y acá se tapa
    de una vez para todos: se reemplaza por una sesión que se traga lo que le den. El
    test que SÍ quiera mirar lo auditado pisa `main.SessionLocal` por su cuenta, y esa
    vuelta gana porque se aplica después.
    """
    class _SesionQueNoGuarda:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): return False
        def add(self, _): pass
        async def commit(self): pass
        async def rollback(self): pass

    from backend.presentation import main
    monkeypatch.setattr(main, "SessionLocal", lambda: _SesionQueNoGuarda())


@pytest.fixture(autouse=True)
def permisos_no_leen_produccion(monkeypatch):
    """Ningún test puede leer permisos de Supabase.

    Las dependencias de permisos (core/security.py: require_admin, require_area...)
    abren su PROPIA sesión con `SESIONES_PERMISOS`, que es el `SessionLocal` de
    PRODUCCIÓN. Un test que pisa sólo el `get_db` de su router no la ve, y sin esto
    leería la base del cliente. Se reemplaza por una fábrica que no conecta a nada: la
    dependencia contesta 503 y el test que la necesite de verdad pisa
    `get_sesiones_permisos` (o `security.SESIONES_PERMISOS`) con su SQLite.
    """
    from backend.core import security

    class _SinBase:
        def __init__(self):
            raise RuntimeError(
                "Este test llegó a leer permisos sin pisar get_sesiones_permisos: "
                "la fábrica de producción está bloqueada en los tests."
            )

    monkeypatch.setattr(security, "SESIONES_PERMISOS", _SinBase)


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
