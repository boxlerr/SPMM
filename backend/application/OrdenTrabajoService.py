from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from datetime import datetime

class OrdenTrabajoService:
    def __init__(self, db_session):
        self.repository = OrdenTrabajoRepository(db_session)

    async def crearOrdenTrabajo(self, dto: OrdenTrabajoRequestDTO):
        try:
            logger.info("Service - Crear orden de trabajo.")

            orden = OrdenTrabajo(
                id_otvieja=dto.id_otvieja,
                observaciones=dto.observaciones,
                id_prioridad=dto.id_prioridad,
                id_sector=dto.id_sector,
                id_articulo=dto.id_articulo,
                # 🔻 Eliminado: id_maquinaria
                fecha_orden=dto.fecha_orden,
                fecha_entrada=dto.fecha_entrada,
                fecha_prometida=dto.fecha_prometida,
                fecha_entrega=dto.fecha_entrega
            )

            orden_creada = await self.repository.save(orden)
            return ResponseDTO(status=True, data=jsonable_encoder(orden_creada))

        except InfrastructureException:
            raise  
        except Exception as e:
            raise ApplicationException("Error inesperado al crear la Orden de Trabajo.") from e

    async def listarOrdenes(self):
        logger.info("Service - Listar órdenes de trabajo.")
        ordenes = await self.repository.find_all()
        
        if not ordenes:
            logger.info("Service - No hay órdenes de trabajo registradas.")
        
        return ResponseDTO(status=True, data=jsonable_encoder(ordenes))

    async def obtenerOrdenPorId(self, id: int):
        logger.info(f"Service - Obtener orden de trabajo ID: {id}")
        orden = await self.repository.find_by_id(id)

        if not orden:
            raise NotFoundException(f"No se encontró la orden de trabajo con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(orden))

    async def modificarOrden(self, id: int, dto: OrdenTrabajoRequestDTO):
        logger.info(f"Service - Modificar orden de trabajo ID: {id}")
        
        nueva_data = dto.model_dump(exclude_unset=True)
        orden_actualizada = await self.repository.update(id, nueva_data)

        if not orden_actualizada:
            raise NotFoundException(f"No se encontró la orden de trabajo con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(orden_actualizada))

    async def eliminarOrden(self, id: int):
        logger.info(f"Service - Eliminar orden de trabajo ID: {id}")
        ok = await self.repository.delete(id)

        if not ok:
            raise NotFoundException(f"No se encontró la orden de trabajo con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})
        
    async def listarPorFechas(self, desde: datetime, hasta: datetime):
        logger.info(f"Service - Listar órdenes por fechas: {desde} a {hasta}")
        ordenes = await self.repository.find_by_fecha_orden_entre(desde, hasta)
        
        if not ordenes:
            logger.info("Service - No hay órdenes en el rango de fechas especificado.")
        
        return ResponseDTO(status=True, data=jsonable_encoder(ordenes))

    async def listarPorPrioridad(self, id_prioridad: int):
        logger.info(f"Service - Listar órdenes por prioridad: {id_prioridad}")
        ordenes = await self.repository.find_by_prioridad(id_prioridad)
        
        if not ordenes:
            logger.info(f"Service - No hay órdenes con prioridad {id_prioridad}.")
        
        return ResponseDTO(status=True, data=jsonable_encoder(ordenes))

    async def obtenerEstadisticasEstados(self):
        """
        Obtiene estadísticas de órdenes agrupadas por estado
        """
        try:
            logger.info("Service - Obtener estadísticas de estados.")
            estadisticas = await self.repository.get_estadisticas_estados()
            logger.info(f"Service - Estadísticas obtenidas: {estadisticas}")
            return ResponseDTO(status=True, data=estadisticas)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener estadísticas de estados.") from e

    async def obtenerOrdenesCriticas(self, dias: int = 7):
        """
        Obtiene las órdenes críticas próximas a vencer
        """
        try:
            logger.info(f"Service - Obtener órdenes críticas (próximas {dias} días).")
            ordenes = await self.repository.get_ordenes_criticas(dias)
            
            # Formatear la respuesta con información relevante
            ordenes_formateadas = []
            for orden in ordenes:
                from datetime import date
                hoy = date.today()
                dias_restantes = (orden.fecha_prometida - hoy).days
                
                orden_data = {
                    "id": orden.id,
                    "articulo": orden.articulo.descripcion if orden.articulo else "Sin artículo",
                    "sector": orden.sector.nombre if orden.sector else "Sin sector",
                    "fecha_prometida": orden.fecha_prometida.isoformat(),
                    "dias_restantes": dias_restantes
                }
                ordenes_formateadas.append(orden_data)
            
            logger.info(f"Service - Órdenes críticas obtenidas: {len(ordenes_formateadas)}")
            return ResponseDTO(status=True, data=ordenes_formateadas)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener órdenes críticas.") from e

