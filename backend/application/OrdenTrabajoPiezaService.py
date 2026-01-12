from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.dto.OrdenTrabajoPiezaRequestDTO import OrdenTrabajoPiezaRequestDTO
from backend.infrastructure.OrdenTrabajoPiezaRepository import OrdenTrabajoPiezaRepository
from backend.application.validators.OrdenTrabajoPiezaValidator import ordenTrabajoPiezaValidator
from fastapi.encoders import jsonable_encoder

# Excepciones, ResponseDTO y Loggers
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger

class OrdenTrabajoPiezaService:
    def __init__(self, db_session):
        self.repository = OrdenTrabajoPiezaRepository(db_session)

    async def crearOrdenTrabajoPieza(self, dto: OrdenTrabajoPiezaRequestDTO):
        try:
            logger.info("Service - Crear OrdenTrabajoPieza.")

            # Validación de negocio
            errores = ordenTrabajoPiezaValidator(dto)
            if errores:
                raise BusinessException("; ".join(errores))

            # TODO: Validar existencia de OrdenTrabajo y Pieza si es necesario

            entity = OrdenTrabajoPieza(
                id_orden_trabajo=dto.id_orden_trabajo,
                id_pieza=dto.id_pieza,
                cantidad=dto.cantidad,
                unidad=dto.unidad,
                pedido=dto.pedido,
                disponible=dto.disponible,
                cantusada=dto.cantusada
            )

            guardado = await self.repository.save(entity)

            return ResponseDTO(status=True, data=jsonable_encoder(guardado))

        except InfrastructureException:
            raise
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear OrdenTrabajoPieza.") from e

    async def eliminarOrdenTrabajoPieza(self, id: int):
        logger.info(f"Service - Eliminar OrdenTrabajoPieza ID: {id}")
        eliminado = await self.repository.delete(id)

        if not eliminado:
            raise NotFoundException(f"No se encontró la OrdenTrabajoPieza con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})

    async def listarOrdenTrabajoPiezas(self):
        logger.info("Service - Listar OrdenTrabajoPiezas.")
        data = await self.repository.find_all()
        return ResponseDTO(status=True, data=jsonable_encoder(data))
    
    async def obtenerOrdenTrabajoPiezaPorId(self, id: int):
        logger.info(f"Service - Obtener OrdenTrabajoPieza ID: {id}")
        data = await self.repository.find_by_id(id)

        if not data:
            raise NotFoundException(f"No se encontró la OrdenTrabajoPieza con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(data))

    async def modificarOrdenTrabajoPieza(self, id: int, dto: OrdenTrabajoPiezaRequestDTO):
        logger.info(f"Service - Modificar OrdenTrabajoPieza ID: {id}")

        errores = ordenTrabajoPiezaValidator(dto)
        if errores:
            raise BusinessException("; ".join(errores))

        nueva_data = dto.dict(exclude_unset=True)
        actualizado = await self.repository.update(id, nueva_data)

        if not actualizado:
            raise NotFoundException(f"No se encontró la OrdenTrabajoPieza con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(actualizado))
