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

    def eliminarSector(self, id: int):
        print(f"🔄 [Service] Eliminando sector ID: {id}")  # opcional para debug

        try:
            repo = SectorRepository()
            sector = repo.find_by_id(id)
            print(f"🔍 [Service] Sector encontrado: {sector}")  # opcional

            if not sector:
                return ResponseDTO(
                    status=False,
                    data={},
                    errorDescription="No se encontró el sector con ese ID."
                )

            repo.delete(id)

            return ResponseDTO(
                status=True,
                data={"id_eliminado": id},
                errorDescription=""
            )

        except Exception as e:
            print(f"❌ [Service] Error al eliminar sector: {e}")  # opcional
            raise InfrastructureException("Error al eliminar el sector.") from e



