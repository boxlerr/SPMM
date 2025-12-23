# Importaciones de módulos
from backend.domain.Maquinaria import Maquinaria
from backend.dto.MaquinariaRequestDTO import MaquinariaRequestDTO
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger


class MaquinariaService:
    """
    Capa de aplicación de Maquinaria (versión asincrónica).
    Maneja validaciones, conversión a DTO y llamadas al repositorio asincrónico.
    """

    def __init__(self, db_session):
        self.repository = MaquinariaRepository(db_session)

    # Crear Maquinaria
    async def crearMaquinaria(self, maquinaria_dto: MaquinariaRequestDTO):
        try:
            if not maquinaria_dto.nombre:
                raise BusinessException("El nombre de la maquinaria es obligatorio.")

            maquinaria = Maquinaria(
                nombre=maquinaria_dto.nombre,
                cod_maquina=maquinaria_dto.cod_maquina,
                limitacion=maquinaria_dto.limitacion,
                capacidad=maquinaria_dto.capacidad,
                especialidad=maquinaria_dto.especialidad,
            )

            maquinaria_creada = await self.repository.save(maquinaria)

            return ResponseDTO(
                status=True,
                data=jsonable_encoder(maquinaria_creada),
                errorDescription=""
            )

        except BusinessException as e:
            raise e
        except Exception as e:
            logger.error(f"Service - Error al crear Maquinaria: {e}")
            raise InfrastructureException("Error al guardar la Maquinaria.") from e

    # Eliminar Maquinaria
    async def eliminarMaquinaria(self, id: int):
        try:
            logger.info(f"Service - Eliminando Maquinaria id={id}")
            ok = await self.repository.delete(id)

            if not ok:
                return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

            return ResponseDTO(status=True, data={"deleted": id}, errorDescription="")
        except Exception as e:
            logger.error(f"Service - Error al eliminar Maquinaria: {e}")
            raise InfrastructureException("Error al eliminar la Maquinaria.") from e

    # Listar Maquinarias
    async def listarMaquinarias(self):
        try:
            logger.info("Service - Listar Maquinarias.")
            maquinarias = await self.repository.find_all()

            data = [
                {
                    "id": m.id,
                    "nombre": m.nombre,
                    "cod_maquina": m.cod_maquina,
                    "limitacion": m.limitacion,
                    "capacidad": m.capacidad,
                    "especialidad": m.especialidad,
                }
                for m in maquinarias
            ]

            return ResponseDTO(status=True, data=data, errorDescription="")
        except Exception as e:
            logger.error(f"Service - Error al listar Maquinarias: {e}")
            raise InfrastructureException("Error al listar Maquinarias.") from e

    # Obtener Maquinaria por ID
    async def obtenerMaquinariaPorId(self, id: int):
        try:
            logger.info(f"Service - Obtener Maquinaria id={id}")
            m = await self.repository.find_by_id(id)

            if not m:
                return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

            return ResponseDTO(
                status=True,
                data={
                    "id": m.id,
                    "nombre": m.nombre,
                    "cod_maquina": m.cod_maquina,
                    "limitacion": m.limitacion,
                    "capacidad": m.capacidad,
                    "especialidad": m.especialidad,
                },
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al obtener Maquinaria: {e}")
            raise InfrastructureException("Error al obtener la Maquinaria.") from e

    # Modificar Maquinaria
    async def modificarMaquinaria(self, id: int, maquinaria_dto: MaquinariaRequestDTO):
        try:
            nueva_data = maquinaria_dto.dict(exclude_unset=True)
            actualizado = await self.repository.update(id, nueva_data)

            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

            return ResponseDTO(
                status=True,
                data={"id": actualizado.id},
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al actualizar Maquinaria: {e}")
            raise InfrastructureException("Error al actualizar la Maquinaria.") from e
