from backend.domain.Articulo import Articulo
from backend.dto.ArticuloRequestDTO import ArticuloRequestDTO
from backend.infrastructure.ArticuloRepository import ArticuloRepository
from backend.application.validators.ArticuloValitor import articuloValidator
from fastapi.encoders import jsonable_encoder

# Excepciones, ResponseDTO y Loggers
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger

class ArticuloService:
    def __init__(self, db_session):
        self.repository = ArticuloRepository(db_session)

    async def crearArticulo(self, articulo_dto: ArticuloRequestDTO):
        try:
            logger.info("Service - Crear artículo.")

            # Validación de negocio
            errores = articuloValidator(articulo_dto)
            if errores:
                raise BusinessException("; ".join(errores))

            articulo = Articulo(
                cod_articulo=articulo_dto.cod_articulo,
                descripcion=articulo_dto.descripcion,
                abreviatura=articulo_dto.abreviatura,
            )

            articulo_guardado = await self.repository.save(articulo)

            return ResponseDTO(status=True, data=jsonable_encoder(articulo_guardado))

        except InfrastructureException:
            raise  # viene del repo
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear el artículo.") from e

    async def eliminarArticulo(self, id: int):
        logger.info(f"Service - Eliminar artículo ID: {id}")
        eliminado = await self.repository.delete(id)

        # Posibles errores:
        # - Artículo inexistente → NotFoundException
        # - Error SQL / constraint → InfrastructureException (repo)
        if not eliminado:
            raise NotFoundException(f"No se encontró el artículo con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})

    async def listarArticulos(self):
        logger.info("Service - Listar artículos.")
        articulos = await self.repository.find_all()

        # Posibles errores:
        # - Error de conexión o consulta SQL → InfrastructureException (repo)
        # - Ninguno si la lista está vacía
        return ResponseDTO(status=True, data=jsonable_encoder(articulos))
    
    async def obtenerArticuloPorId(self, id: int):
        logger.info(f"Service - Obtener artículo ID: {id}")
        articulo = await self.repository.find_by_id(id)

        # Posibles errores:
        # - Artículo no existe → NotFoundException
        # - Error SQL → InfrastructureException (repo)
        if not articulo:
            raise NotFoundException(f"No se encontró el artículo con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(articulo))

    async def modificarArticulo(self, id: int, dto: ArticuloRequestDTO):
        logger.info(f"Service - Modificar artículo ID: {id}")

        # Posibles errores:
        # - Validaciones de negocio → BusinessException
        # - Artículo inexistente → NotFoundException
        # - Error SQL → InfrastructureException (repo)

        errores = articuloValidator(dto)
        if errores:
            raise BusinessException("; ".join(errores))

        nueva_data = dto.dict(exclude_unset=True)
        actualizado = await self.repository.update(id, nueva_data)

        if not actualizado:
            raise NotFoundException(f"No se encontró el artículo con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(actualizado))

