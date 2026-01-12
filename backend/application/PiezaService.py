from backend.domain.Pieza import Pieza
from backend.dto.PiezaRequestDTO import PiezaRequestDTO
from backend.infrastructure.PiezaRepository import PiezaRepository
from backend.application.validators.PiezaValidator import piezaValidator
from fastapi.encoders import jsonable_encoder

# Excepciones, ResponseDTO y Loggers
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger

class PiezaService:
    def __init__(self, db_session):
        self.repository = PiezaRepository(db_session)

    async def crearPieza(self, pieza_dto: PiezaRequestDTO):
        try:
            logger.info("Service - Crear pieza.")

            # Validación de negocio
            errores = piezaValidator(pieza_dto)
            if errores:
                raise BusinessException("; ".join(errores))

            pieza = Pieza(
                cod_pieza=pieza_dto.cod_pieza,
                descripcion=pieza_dto.descripcion,
                unitario=pieza_dto.unitario,
                unidad=pieza_dto.unidad,
                stockactual=pieza_dto.stockactual,
                observaciones=pieza_dto.observaciones,
                proveedor=pieza_dto.proveedor,
                material=pieza_dto.material,
                formato=pieza_dto.formato,
                estante=pieza_dto.estante,
                letra=pieza_dto.letra,
                nro=pieza_dto.nro
            )

            pieza_guardada = await self.repository.save(pieza)

            return ResponseDTO(status=True, data=jsonable_encoder(pieza_guardada))

        except InfrastructureException:
            raise  # viene del repo
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear la pieza.") from e

    async def eliminarPieza(self, id: int):
        logger.info(f"Service - Eliminar pieza ID: {id}")
        eliminado = await self.repository.delete(id)

        if not eliminado:
            raise NotFoundException(f"No se encontró la pieza con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})

    async def listarPiezas(self, page: int = 1, size: int = 50, search: str = ""):
        logger.info(f"Service - Listar piezas paginadas page={page} search='{search}'.")
        data, total = await self.repository.find_all(page=page, size=size, search=search)
        
        import math
        total_pages = math.ceil(total / size) if size > 0 else 0
        
        # Construct Paged Response
        paged_response = {
            "data": jsonable_encoder(data),
            "total_count": total,
            "page": page,
            "size": size,
            "total_pages": total_pages
        }
        
        # We can wrap this in ResponseDTO or return it directly. 
        # API expects ResponseDTO usually, but for tables often cleaner to have structure directly in data.
        # Current pattern: ResponseDTO(status=True, data=...)
        # So we put the paged structure INSIDE data.
        return ResponseDTO(status=True, data=paged_response)
    
    async def obtenerPiezaPorId(self, id: int):
        logger.info(f"Service - Obtener pieza ID: {id}")
        pieza = await self.repository.find_by_id(id)

        if not pieza:
            raise NotFoundException(f"No se encontró la pieza con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(pieza))

    async def modificarPieza(self, id: int, dto: PiezaRequestDTO):
        logger.info(f"Service - Modificar pieza ID: {id}")

        errores = piezaValidator(dto)
        if errores:
            raise BusinessException("; ".join(errores))

        nueva_data = dto.dict(exclude_unset=True)
        actualizado = await self.repository.update(id, nueva_data)

        if not actualizado:
            raise NotFoundException(f"No se encontró la pieza con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(actualizado))
