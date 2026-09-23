"""Los pasos de OT de una persona, con lo que hace falta para medirlos (RF-06).

Sólo lecturas. Las pausas y los feriados se leen en un SAVEPOINT: si la migración de
las pausas todavía no corrió, los tiempos salen igual (sin descontar pausas, y dicho).
"""
from datetime import date, datetime

from sqlalchemy import select

from backend.commons.loggers.logger import logger
from backend.domain.Articulo import Articulo
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import PausaOrden
from backend.domain.Planificacion import Planificacion
from backend.domain.Proceso import Proceso
from backend.infrastructure.DiaBloqueadoRepository import feriados_sin_romper


class TiemposOperarioRepository:
    def __init__(self, db):
        self.db = db

    async def pasadas_elegidas(self, id_operario: int) -> list[int]:
        """Los pasos que tienen a esta persona ELEGIDA A MANO en la OT."""
        return list((await self.db.execute(
            select(OrdenTrabajoProceso.id).where(OrdenTrabajoProceso.id_operario == id_operario)
        )).scalars().all())

    async def ordenes_del_plan(self, id_operario: int) -> list[int]:
        """Las OT donde algún plan le dio un paso a esta persona."""
        return list((await self.db.execute(
            select(Planificacion.orden_id).where(Planificacion.id_operario == id_operario).distinct()
        )).scalars().all())

    async def filas_del_plan(self, ordenes_ids: list[int]) -> list[dict]:
        """Todas las filas de plan de esas OT, de TODAS las personas: hace falta ver el
        plan entero de cada paso para saber cuál es el último que lo tocó."""
        if not ordenes_ids:
            return []
        filas = (await self.db.execute(
            select(
                Planificacion.id, Planificacion.orden_id, Planificacion.proceso_id,
                Planificacion.id_orden_trabajo_proceso, Planificacion.id_operario,
                Planificacion.id_planificacion_lote, Planificacion.creado_en,
            ).where(Planificacion.orden_id.in_(list(ordenes_ids)))
        )).all()
        return [dict(f._mapping) for f in filas]

    async def pasos_de(self, ordenes_ids: list[int]) -> list[tuple[int, int, int]]:
        """(id del paso, OT, proceso) de esas OT: para ubicar las filas de plan viejas,
        que no dicen de qué paso son."""
        if not ordenes_ids:
            return []
        return [tuple(f) for f in (await self.db.execute(
            select(OrdenTrabajoProceso.id, OrdenTrabajoProceso.id_orden_trabajo,
                   OrdenTrabajoProceso.id_proceso)
            .where(OrdenTrabajoProceso.id_orden_trabajo.in_(list(ordenes_ids)))
        )).all()]

    async def pasadas_arrancadas(self, ids: list[int]) -> list[dict]:
        """Esos pasos, sólo si arrancaron, con su OT, su artículo y su proceso."""
        if not ids:
            return []
        filas = (await self.db.execute(
            select(
                OrdenTrabajoProceso.id.label("id_otp"),
                OrdenTrabajoProceso.id_orden_trabajo,
                OrdenTrabajoProceso.orden.label("paso"),
                OrdenTrabajoProceso.id_estado,
                OrdenTrabajoProceso.tiempo_proceso,
                OrdenTrabajoProceso.cant_operarios,
                OrdenTrabajoProceso.id_operario.label("id_operario_elegido"),
                OrdenTrabajoProceso.inicio_real,
                OrdenTrabajoProceso.fin_real,
                Proceso.nombre.label("proceso"),
                OrdenTrabajo.id_otvieja,
                Articulo.descripcion.label("articulo"),
            )
            .join(OrdenTrabajo, OrdenTrabajo.id == OrdenTrabajoProceso.id_orden_trabajo)
            .outerjoin(Proceso, Proceso.id == OrdenTrabajoProceso.id_proceso)
            .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
            .where(OrdenTrabajoProceso.id.in_(list(ids)))
            # El centinela del sistema viejo (1900/1950-01-01) no es un arranque.
            .where(OrdenTrabajoProceso.inicio_real.is_not(None))
            .where(OrdenTrabajoProceso.inicio_real > datetime(1950, 1, 2))
        )).all()
        return [dict(f._mapping) for f in filas]

    async def pausas_sin_romper(self, ordenes_ids: list[int]) -> list[PausaOrden] | None:
        """Las pausas (RF-03) de esas OT, abiertas y cerradas. None si no se pueden leer
        (tabla sin crear): el tiempo sale sin descontarlas y la ficha lo dice."""
        if not ordenes_ids:
            return []
        try:
            async with self.db.begin_nested():
                return list((await self.db.execute(
                    select(PausaOrden).where(PausaOrden.id_orden_trabajo.in_(list(ordenes_ids)))
                )).scalars().all())
        except Exception as e:
            logger.warning(f"Tiempos: no se pudieron leer las pausas: {e}")
            return None

    async def feriados(self) -> list[date]:
        """Los días bloqueados del calendario del taller (sólo se leen)."""
        return await feriados_sin_romper(self.db)
