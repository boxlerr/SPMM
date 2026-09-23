"""Los pasos de OT de una persona, con lo que hace falta para medirlos (RF-06).

Sólo lecturas. Las pausas, las ausencias, el historial de los pasos y los feriados se
leen en un SAVEPOINT: si la migración de alguna de esas tablas todavía no corrió, los
tiempos salen igual (sin descontar eso, y dicho).
"""
from datetime import date, datetime

from sqlalchemy import select

from backend.commons.loggers.logger import logger
from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.domain.AusenciaOperario import AusenciaOperario
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

    async def ausencias_sin_romper(self, id_operario: int, desde: date | None = None,
                                   hasta: date | None = None) -> list[tuple[date, date | None]] | None:
        """(desde, vuelve) de las ausencias de la persona que tocan el período (RF-06).
        None si no se pueden leer (tabla sin crear): las horas salen sin descontarlas y
        la respuesta lo dice."""
        try:
            async with self.db.begin_nested():
                q = select(AusenciaOperario.desde, AusenciaOperario.vuelve).where(
                    AusenciaOperario.id_operario == id_operario)
                if hasta is not None:
                    q = q.where(AusenciaOperario.desde <= hasta)
                if desde is not None:
                    q = q.where((AusenciaOperario.vuelve.is_(None)) | (AusenciaOperario.vuelve > desde))
                return [tuple(f) for f in (await self.db.execute(q)).all()]
        except Exception as e:
            logger.warning(f"Tiempos: no se pudieron leer las ausencias de {id_operario}: {e}")
            return None

    async def cambios_de_fin_sin_romper(self, ids_otp: list[int]) -> list[tuple] | None:
        """(paso, cuándo, cambios en JSON) de las ediciones del historial de pasos que
        tocaron el fin real: de ahí sale cuándo estuvo terminado un paso que después se
        reabrió (ver TiemposOperarioService.cerrados_del_historial). None si la tabla de
        auditoría no se puede leer."""
        if not ids_otp:
            return []
        try:
            async with self.db.begin_nested():
                return [tuple(f) for f in (await self.db.execute(
                    select(AuditoriaProcesoOT.id_otp, AuditoriaProcesoOT.creado_en,
                           AuditoriaProcesoOT.cambios)
                    .where(AuditoriaProcesoOT.id_otp.in_(list(ids_otp)))
                    .where(AuditoriaProcesoOT.accion == "edicion")
                    .where(AuditoriaProcesoOT.cambios.like("%fin real%"))
                    .order_by(AuditoriaProcesoOT.creado_en, AuditoriaProcesoOT.id)
                )).all()]
        except Exception as e:
            logger.warning(f"Tiempos: no se pudo leer el historial de los pasos: {e}")
            return None
