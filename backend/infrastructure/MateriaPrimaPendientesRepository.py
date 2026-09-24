"""Lectura de Pendientes (la pantalla de compras por semana) y escritura de la cañera.

Por el ORM y con la sesión recibida, como el resto de la sección. La única excepción es
la lectura del plan, que va por una tabla liviana (`table()` de SQLAlchemy Core, igual de
portable): el modelo Planificacion no declara `inicio_base`, la columna que la migración
2026-09-11 agregó y que el repositorio del planificador escribe a mano. Ver `plan_de_ots`.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, MetaData, Table, func, select

from backend.application.materia_prima.stock import en_tandas
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from backend.domain.Articulo import Articulo
from backend.domain.CaneraOcupacion import CaneraOcupacion
from backend.domain.Cliente import Cliente
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.Prioridad import Prioridad

# La tabla del plan, sólo con lo que hace falta para saber CUÁNDO arranca cada proceso.
# Con metadata propia: declararla en la de la app (Base.metadata) le crearía a los tests
# una segunda definición de `planificacion`.
_meta_plan = MetaData()
_PLAN = Table(
    "planificacion", _meta_plan,
    Column("orden_id", Integer),
    Column("inicio_min", Integer),
    Column("creado_en", DateTime),
    Column("inicio_base", DateTime),
)


def abierta():
    """Una OT abierta: ni finalizada ni suspendida.

    «No finalizada» es el mismo corte que usan el tablero (estado_ordenes: completadas =
    finalizadototal 1), las órdenes críticas y la cañera (finalizada = finalizadototal 1).
    La suspendida (la tilde del sistema viejo) tampoco compra material: está frenada.
    """
    return (
        (func.coalesce(OrdenTrabajo.finalizadototal, 0) != 1)
        & (func.coalesce(OrdenTrabajo.suspendida, 0) != 1)
    )


class MateriaPrimaPendientesRepository:
    def __init__(self, db):
        self.db = db

    # ─────────────────────────── transacción ───────────────────────────

    async def confirmar(self) -> None:
        try:
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error al guardar la cañera: {e}")
            raise InfrastructureException("Error al guardar la cañera.") from e

    async def deshacer(self) -> None:
        try:
            await self.db.rollback()
        except Exception as e:  # un rollback que falla no puede tapar el error original
            logger.warning(f"Repository - No se pudo deshacer: {e}")

    # ─────────────────────────── OT ───────────────────────────

    def _cabecera(self):
        """Lo que se muestra de cada OT en Pendientes: la OT, su cliente, artículo y
        prioridad (LEFT JOIN: una OT no puede desaparecer de la lista porque le falte un
        dato de catálogo)."""
        return (
            select(OrdenTrabajo, Cliente.nombre, Articulo.descripcion, Prioridad.descripcion)
            .outerjoin(Cliente, Cliente.id == OrdenTrabajo.id_cliente)
            .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
            .outerjoin(Prioridad, Prioridad.id == OrdenTrabajo.id_prioridad)
        )

    async def ots_abiertas(self):
        """[(OT, cliente, artículo, prioridad)] de todas las OT abiertas que llevan
        materia prima (las marcadas «No lleva materias primas» no tienen nada que comprar)."""
        consulta = self._cabecera().where(
            abierta(),
            func.coalesce(OrdenTrabajo.no_lleva_materia_prima, 0) != 1,
        )
        return (await self.db.execute(consulta)).all()

    async def ots_por_numero(self, numero: int):
        """La OT con ese número visible (id_otvieja), esté como esté: pedirla por número es
        querer verla aunque ya esté terminada. Sin las «No lleva»."""
        consulta = self._cabecera().where(
            OrdenTrabajo.id_otvieja == numero,
            func.coalesce(OrdenTrabajo.no_lleva_materia_prima, 0) != 1,
        )
        return (await self.db.execute(consulta)).all()

    async def ot_por_numero(self, numero: int) -> OrdenTrabajo | None:
        return (await self.db.execute(
            select(OrdenTrabajo).where(OrdenTrabajo.id_otvieja == numero).order_by(OrdenTrabajo.id)
        )).scalars().first()

    # ─────────────────────────── el plan ───────────────────────────

    async def plan_de_ots(self, ids_ot) -> list[tuple[int, int, datetime | None, datetime | None]]:
        """[(orden_id, inicio_min, inicio_base, creado_en)] de las filas del plan de esas OT.

        `inicio_base` (el T=0 guardado del plan) existe en la base desde la migración del
        11/09 pero no en el modelo, así que va por la tabla liviana de arriba. Si la base
        no la tiene (los tests en SQLite, que arman las tablas del modelo), se lee sin
        ella y cada plan se ubica por su `creado_en`: exactamente lo que hace GET
        /planificacion con los planes viejos (`base_del_plan`). La primera lectura va en un
        savepoint para que, si falla, la transacción siga viva (Postgres la aborta).
        """
        filas: list = []
        tandas = list(en_tandas(ids_ot))
        if not tandas:
            return filas
        con_base = True
        try:
            async with self.db.begin_nested():
                for tanda in tandas:
                    filas.extend((await self.db.execute(
                        select(_PLAN.c.orden_id, _PLAN.c.inicio_min, _PLAN.c.inicio_base,
                               _PLAN.c.creado_en)
                        .where(_PLAN.c.orden_id.in_(tanda), _PLAN.c.inicio_min.isnot(None))
                    )).all())
        except Exception as e:
            logger.info(f"Repository - planificacion sin inicio_base ({type(e).__name__}): "
                        f"se ubica cada plan por su creado_en.")
            con_base = False
        if con_base:
            return [tuple(f) for f in filas]
        filas = []
        for tanda in tandas:
            filas.extend((await self.db.execute(
                select(_PLAN.c.orden_id, _PLAN.c.inicio_min, _PLAN.c.creado_en)
                .where(_PLAN.c.orden_id.in_(tanda), _PLAN.c.inicio_min.isnot(None))
            )).all())
        return [(orden_id, inicio_min, None, creado_en) for orden_id, inicio_min, creado_en in filas]

    # ─────────────────────────── cañera ───────────────────────────

    async def ocupacion(self, id_ocupacion: int) -> CaneraOcupacion | None:
        return await self.db.get(CaneraOcupacion, id_ocupacion)

    async def vigente_en(self, columna: str, fila: int) -> CaneraOcupacion | None:
        """La ocupación vigente de un casillero (a lo sumo una)."""
        return (await self.db.execute(
            select(CaneraOcupacion)
            .where(CaneraOcupacion.columna == columna, CaneraOcupacion.fila == fila,
                   CaneraOcupacion.hasta.is_(None))
            .order_by(CaneraOcupacion.id)
        )).scalars().first()

    async def vigentes_de_terminadas(self) -> list[CaneraOcupacion]:
        """Las ocupaciones vigentes de OT ya finalizadas: lo que se puede liberar."""
        terminadas = select(OrdenTrabajo.id).where(OrdenTrabajo.finalizadototal == 1)
        return list((await self.db.execute(
            select(CaneraOcupacion)
            .where(CaneraOcupacion.hasta.is_(None),
                   CaneraOcupacion.id_orden_trabajo.in_(terminadas))
            .order_by(CaneraOcupacion.columna, CaneraOcupacion.fila)
        )).scalars().all())

    async def numero_de_ot(self, id_orden_trabajo: int | None):
        if id_orden_trabajo is None:
            return None
        return (await self.db.execute(
            select(OrdenTrabajo.id_otvieja).where(OrdenTrabajo.id == id_orden_trabajo)
        )).scalar()

    async def agregar(self, objeto) -> None:
        self.db.add(objeto)
        await self.db.flush()
