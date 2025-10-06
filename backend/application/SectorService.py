from typing import List, Optional

from backend.domain.Sector import Sector
from backend.dto.SectorRequestDTO import SectorRequestDTO
from backend.infrastructure.SectorRepository import SectorRepository
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException


class SectorService:
    """
    validación mínima y delega en repositorio `save`.
    """

    def __init__(self):
        self.repo = SectorRepository()

    def crearSector(self, payload: SectorRequestDTO):
        try:
            nombre = (payload.nombre or "").strip()
            if not nombre:
                raise BusinessException("El nombre de Sector es obligatorio.")

            sector = Sector(nombre=nombre)
            creado = self.repo.save(sector)

            response = ResponseDTO()
            response.status = True
            response.data = {"id": creado.id, "nombre": creado.nombre}
            response.errorDescription = ""
            return response
        except Exception as e:
            raise InfrastructureException("Error al guardar el Sector.") from e

    def listarSectores(self):
        try:
            data = [{"id": s.id, "nombre": s.nombre} for s in self.repo.find_all()]
            return ResponseDTO(status=True, data=data, errorDescription="")
        except Exception as e:
            raise InfrastructureException("Error al listar Sectores.") from e

    def obtenerSectorPorId(self, id: int):
        try:
            sector = self.repo.find_by_id(id)
            if not sector:
                return ResponseDTO(status=False, data={}, errorDescription="Sector no encontrado")
            return ResponseDTO(status=True, data={"id": sector.id, "nombre": sector.nombre}, errorDescription="")
        except Exception as e:
            raise InfrastructureException("Error al obtener Sector.") from e

    def modificarSector(self, id: int, sector_dto: SectorRequestDTO):
        try:
            nueva_data = sector_dto.dict(exclude_unset=True)
            actualizado = self.repo.update(id, nueva_data)
            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Sector no encontrado")
            return ResponseDTO(status=True, data={"id": actualizado.id}, errorDescription="")
        except Exception as e:
            raise InfrastructureException("Error al actualizar Sector.") from e

    def eliminarSector(self, id: int):
        try:
            sector = self.repo.find_by_id(id)
            if not sector:
                return ResponseDTO(status=False, data={}, errorDescription="No se encontró el sector con ese ID.")
            self.repo.delete(id)
            return ResponseDTO(status=True, data={"id_eliminado": id}, errorDescription="")
        except Exception as e:
            raise InfrastructureException("Error al eliminar el sector.") from e



