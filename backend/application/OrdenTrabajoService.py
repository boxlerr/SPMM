from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.dto.OrdenTrabajoResponseDTO import OrdenTrabajoResponseDTO
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from pydantic import ValidationError
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
        
        # Validate and serialize using DTO to ensure structure
        valid_ordenes = []
        
        # 1. Get all Order IDs
        if ordenes:
            orden_ids = [o.id for o in ordenes]
            # 2. Fetch Planificaciones for these orders safely
            planificaciones = await self.repository.get_planificaciones_by_orden_ids(orden_ids)
            
            # 3. Build a lookup map: (orden_id, proceso_id) -> operario_nombre
            # Assuming Planificacion has orden_id, proceso_id, and relationship to operario
            # 3. Build a lookup map: (orden_id, proceso_id) -> operario_nombre
            # Result contains rows: (orden_id, proceso_id, nombre, apellido)
            plan_map = {}
            for row in planificaciones:
                try:
                    # Robust access using indices since we know the query "SELECT p.orden_id, ... " order
                    oid = row[0]
                    pid = row[1]
                    nombre = row[2]
                    apellido = row[3]
                    
                    if oid is not None and pid is not None:
                        key = (int(oid), int(pid))
                        # Format name to Title Case (e.g. "JUAN PEREZ" -> "Juan Perez")
                        nombre_fmt = nombre.title() if nombre else ""
                        apellido_fmt = apellido.title() if apellido else ""
                        plan_map[key] = f"{nombre_fmt} {apellido_fmt}".strip()
                except Exception as e:
                    # Log error but don't break the loop or crash
                    logger.warning(f"Service - Skipping malformed row: {row} - {e}")
            
            logger.info(f"Service - Mapeo de operarios construido. Total entradas: {len(plan_map)}")

            if plan_map:
                logger.info(f"Service - Ejemplo clave mapa: {list(plan_map.keys())[0]}")

            for o in ordenes:
                try:
                    # Validate basic structure
                    dto = OrdenTrabajoResponseDTO.model_validate(o)
                    
                    # 4. Inject operario_nombre into processes
                    if dto.procesos:
                        for proc in dto.procesos:
                            # proc is OrdenTrabajoProcesoDTO. It has id_proceso etc.
                            # We need to match with Planificacion. 
                            # OrdenTrabajoProcesoDTO usually has nested 'proceso' with id.
                            # Let's check structure: OrdenTrabajoProcesoDTO has 'proceso' nested object.
                            
                            pid = proc.proceso.id if proc.proceso else None
                            if pid:
                                key = (o.id, pid)
                                # Log first few attempts to verify matching logic
                                if len(valid_ordenes) == 0 and dto.procesos.index(proc) == 0:
                                     logger.info(f"Service - Buscando clave: {key} en mapa.")
                                
                                if key in plan_map:
                                    proc.operario_nombre = plan_map[key]
                                
                    valid_ordenes.append(jsonable_encoder(dto))
                except ValidationError as e:
                    logger.error(f"Service - Error validando orden ID {o.id}: {e}")
                    continue
        else:
            return ResponseDTO(status=True, data=[])
                
        return ResponseDTO(status=True, data=valid_ordenes)

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

    async def obtenerOcupacionPorSector(self):
        """
        Obtiene la ocupación (carga de trabajo) por sector
        """
        try:
            logger.info("Service - Obtener ocupación por sector.")
            ocupacion = await self.repository.get_ocupacion_por_sector()
            logger.info(f"Service - Ocupación obtenida: {len(ocupacion)} sectores")
            return ResponseDTO(status=True, data=ocupacion)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener ocupación por sector.") from e

    async def obtenerProximasEntregasTimeline(self, dias: int = 7):
        """
        Obtiene timeline de próximas entregas agrupadas por fecha
        
        Args:
            dias: Número de días hacia adelante (default: 7)
            
        Returns:
            ResponseDTO con timeline de entregas
        """
        try:
            logger.info(f"Service - Obtener timeline de próximas entregas ({dias} días).")
            timeline = await self.repository.get_proximas_entregas_timeline(dias)
            logger.info(f"Service - Timeline obtenido: {len(timeline)} días")
            return ResponseDTO(status=True, data=timeline)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener timeline de próximas entregas.") from e


    async def actualizarEstadoProceso(self, id_orden: int, id_proceso: int, id_estado: int):
        logger.info(f"Service - Actualizar estado proceso: Orden {id_orden}, Proceso {id_proceso} -> ID Estado {id_estado}")
        
        ok = await self.repository.update_proceso_status(id_orden, id_proceso, id_estado)
        
        if not ok:
            raise NotFoundException(f"No se encontró la relación Orden {id_orden} - Proceso {id_proceso}")

        # Verificar SIEMPRE si la orden está completa o no
        is_complete = await self.repository.check_all_processes_completed(id_orden)
        print(f"DEBUG: Orden {id_orden} is_complete={is_complete}")
        
        if is_complete:
            print(f"DEBUG: Marking order {id_orden} as completed")
            await self.repository.mark_as_completed(id_orden)
        else:
            # Si no está completa (porque se movió un proceso a no finalizado), marcar como incompleta
            print(f"DEBUG: Marking order {id_orden} as incomplete")
            await self.repository.mark_as_incomplete(id_orden)
            
        return ResponseDTO(status=True, data={"updated": True, "id_estado": id_estado})

    async def actualizarObservacionesProceso(self, id_orden: int, id_proceso: int, observaciones: str):
        logger.info(f"Service - Actualizar observaciones proceso: Orden {id_orden}, Proceso {id_proceso}")
        
        ok = await self.repository.update_proceso_observaciones(id_orden, id_proceso, observaciones)
        
        if not ok:
            raise NotFoundException(f"No se encontró la relación Orden {id_orden} - Proceso {id_proceso}")
            
        return ResponseDTO(status=True, data={"updated": True, "observaciones": observaciones})

    async def obtenerOrdenesNoPlanificadas(self):
        """
        Obtiene las órdenes de trabajo que no han sido planificadas
        """
        try:
            logger.info("Service - Obtener órdenes no planificadas.")
            ordenes = await self.repository.find_unplanned()
            logger.info(f"Service - Órdenes no planificadas obtenidas: {len(ordenes)}")
            return ResponseDTO(status=True, data=jsonable_encoder(ordenes))
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener órdenes no planificadas.") from e
