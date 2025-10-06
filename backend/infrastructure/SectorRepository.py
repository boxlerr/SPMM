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

    def find_by_id(self, id: int):
        try:
            return self.db.query(Sector).filter(Sector.id == id).first()
        except Exception as e:
            raise InfrastructureException("Error al buscar el Sector por ID.") from e

    def find_all(self):  
        try:
            return self.db.query(Sector).all()
        except Exception as e:
            raise InfrastructureException("Error al listar Sectores.") from e

    def save(self, sector: Sector):
        try:
            self.db.add(sector)
            self.db.commit()
            self.db.refresh(sector)
            return sector
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Sector.") from e

    def update(self, id: int, nueva_data: dict):
        try:
            sector = self.find_by_id(id)
            if not sector:
                return None
            for key, value in nueva_data.items():
                setattr(sector, key, value)
            self.db.commit()
            self.db.refresh(sector)
            return sector
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al actualizar el Sector.") from e

    def delete(self, id: int):
        try:
            sector = self.find_by_id(id)
            if not sector:
                return False
            self.db.delete(sector)
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al eliminar el Sector.") from e



