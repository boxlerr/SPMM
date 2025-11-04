from sqlalchemy import select
from sqlalchemy.orm import joinedload
from sqlalchemy import func, case
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from datetime import datetime, date

from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Proceso import Proceso

class OrdenTrabajoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, orden: OrdenTrabajo):
        try:
            logger.info("Repository - Crear Orden de Trabajo.")
            self.db.add(orden)
            await self.db.commit()
            await self.db.refresh(orden)
            logger.info("Repository - Crear Orden de Trabajo OK.")
            return orden
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar la Orden de Trabajo.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todas las órdenes de trabajo.")
            result = await self.db.execute(select(OrdenTrabajo))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar las Órdenes de Trabajo.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar orden de trabajo por ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar la Orden de Trabajo por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()
            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(orden, key, value)

            await self.db.commit()
            await self.db.refresh(orden)
            logger.info(f"Repository - Orden de trabajo {id} actualizada correctamente.")
            return orden
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar la Orden de Trabajo.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()

            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para eliminar.")
                return False

            await self.db.delete(orden)
            await self.db.commit()
            logger.info(f"Repository - Orden de trabajo {id} eliminada correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar la Orden de Trabajo.") from e
            
    async def find_by_fecha_orden_entre(self, desde: datetime, hasta: datetime):
        try:
            logger.info(f"Repository - Buscar órdenes entre {desde} y {hasta}.")
            result = await self.db.execute(select(OrdenTrabajo).where(
                OrdenTrabajo.fecha_orden >= desde,
                OrdenTrabajo.fecha_orden <= hasta
            ))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_fecha_orden_entre: {e}")
            raise InfrastructureException("Error al filtrar por fechas.") from e

    async def find_by_prioridad(self, id_prioridad: int):
        try:
            logger.info(f"Repository - Buscar órdenes por prioridad {id_prioridad}.")
            result = await self.db.execute(select(OrdenTrabajo).where(
                OrdenTrabajo.id_prioridad == id_prioridad
            ))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_prioridad: {e}")
            raise InfrastructureException("Error al filtrar por prioridad.") from e

    async def find_with_procesos(self):
        try:
            logger.info("Repository - Obtener órdenes con sus procesos.")
    
            result = await self.db.execute(
                select(OrdenTrabajo)
                .options(
                    joinedload(OrdenTrabajo.procesos)
                    .joinedload(OrdenTrabajoProceso.proceso),
                    joinedload(OrdenTrabajo.prioridad)   # 👈 agregalo
                )
            )
            logger.info(f"Repository - Resultado OK órdenes encontradas).")
            return result.scalars().unique().all()
        
        except Exception as e:
            logger.error(f"Repository - Error en find_with_procesos: {e}")
            raise InfrastructureException("Error al obtener órdenes con procesos asociados.") from e

    async def get_estadisticas_estados(self):
        """
        Obtiene el conteo de órdenes por estado:
        - completadas: fecha_entrega <= HOY
        - en_proceso: fecha_entrada <= HOY y fecha_entrega IS NULL
        - pendientes: fecha_entrada > HOY y fecha_entrega IS NULL
        - retrasadas: fecha_prometida < HOY y fecha_entrega IS NULL
        """
        try:
            logger.info("Repository - Obtener estadísticas de estados de órdenes.")
            
            hoy = date.today()
            
            # Query para contar estados
            query = select(
                func.count(case(
                    (OrdenTrabajo.fecha_entrega != None, 1)
                )).label('completadas'),
                func.count(case(
                    ((OrdenTrabajo.fecha_entrada <= hoy) & 
                     (OrdenTrabajo.fecha_entrega == None), 1)
                )).label('en_proceso'),
                func.count(case(
                    ((OrdenTrabajo.fecha_entrada > hoy) & 
                     (OrdenTrabajo.fecha_entrega == None), 1)
                )).label('pendientes'),
                func.count(case(
                    ((OrdenTrabajo.fecha_prometida < hoy) & 
                     (OrdenTrabajo.fecha_entrega == None), 1)
                )).label('retrasadas')
            )
            
            result = await self.db.execute(query)
            row = result.fetchone()
            
            estadisticas = {
                'completadas': row.completadas or 0,
                'en_proceso': row.en_proceso or 0,
                'pendientes': row.pendientes or 0,
                'retrasadas': row.retrasadas or 0,
                'total': (row.completadas or 0) + (row.en_proceso or 0) + 
                        (row.pendientes or 0) + (row.retrasadas or 0)
            }
            
            logger.info(f"Repository - Estadísticas OK: {estadisticas}")
            return estadisticas
            
        except Exception as e:
            logger.error(f"Repository - Error en get_estadisticas_estados: {e}")
            raise InfrastructureException("Error al obtener estadísticas de estados.") from e

