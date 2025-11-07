from typing import List, Optional

from backend.domain.Sector import Sector
from backend.dto.SectorRequestDTO import SectorRequestDTO
from backend.infrastructure.SectorRepository import SectorRepository
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.NotFoundException import NotFoundException
from fastapi.encoders import jsonable_encoder
from backend.commons.loggers.logger import logger

class SectorService:
    def __init__(self, db_session):
        self.repository = SectorRepository(db_session)

    async def crearSector(self, sector_dto: SectorRequestDTO):
        try:
            logger.info("Service - Crear sector.")

            # Validación de negocio
            nombre = (sector_dto.nombre or "").strip()
            if not nombre:
                raise BusinessException("El nombre de Sector es obligatorio.")

            sector = Sector(nombre=nombre)
            sector_creado = await self.repository.save(sector)

            return ResponseDTO(status=True, data=jsonable_encoder(sector_creado))
        except InfrastructureException:
            raise  
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear el Sector.") from e

    async def listarSectores(self):
        logger.info("Service - Listar sectores.")
        sectores = await self.repository.find_all()
        
        if not sectores:
            logger.info("Service - No hay sectores registrados.")
        
        return ResponseDTO(status=True, data=jsonable_encoder(sectores))

    async def obtenerSectorPorId(self, id: int):
        logger.info(f"Service - Obtener sector ID: {id}")
        sector = await self.repository.find_by_id(id)

        if not sector:
            raise NotFoundException(f"No se encontró el sector con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(sector))

    async def modificarSector(self, id: int, sector_dto: SectorRequestDTO):
        logger.info(f"Service - Modificar sector ID: {id}")

        # Validación de negocio
        nombre = (sector_dto.nombre or "").strip()
        if not nombre:
            raise BusinessException("El nombre de Sector es obligatorio.")

        nueva_data = sector_dto.dict(exclude_unset=True)
        sector_actualizado = await self.repository.update(id, nueva_data)

        if not sector_actualizado:
            raise NotFoundException(f"No se encontró el sector con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(sector_actualizado))

    async def eliminarSector(self, id: int):
        logger.info(f"Service - Eliminar sector ID: {id}")
        ok = await self.repository.delete(id)

        if not ok:
            raise NotFoundException(f"No se encontró el sector con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})



