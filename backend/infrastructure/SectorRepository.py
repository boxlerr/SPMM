from backend.domain.Sector import Sector
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException


class SectorRepository:
    """
    Repositorio de `Sector`, alineado con el estilo de OrdenTrabajo/Proceso/Prioridad.
    Solo expone `save` para insertar registros.
    """

    def __init__(self):
        self.db = SessionLocal()

    def save(self, sector: Sector):
        try:
            self.db.add(sector)
            self.db.commit()
            self.db.refresh(sector)
            return sector
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Sector.") from e

    def delete(self, sector_id: int) -> bool:
        try:
            sector = self.db.get(Sector, sector_id)
            if not sector:
                return False
            self.db.delete(sector)
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al eliminar un Sector.") from e


