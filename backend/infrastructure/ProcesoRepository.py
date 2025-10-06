from backend.domain.Proceso import Proceso
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class ProcesoRepository:
    def __init__(self):
        self.db = SessionLocal()

    def save(self, proceso: Proceso):
        try:
            self.db.add(proceso)
            self.db.commit()
            self.db.refresh(proceso)
            return proceso
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Proceso.") from e

    # 🔹 Nuevo: Obtener todos los procesos
    def find_all(self):
        try:
            return self.db.query(Proceso).all()
        except Exception as e:
            raise InfrastructureException("Error al listar Procesos.") from e

    # 🔹 Nuevo: Buscar un proceso por ID
    def find_by_id(self, id: int):
        try:
            return self.db.query(Proceso).filter(Proceso.id == id).first()
        except Exception as e:
            raise InfrastructureException("Error al buscar el Proceso por ID.") from e

    # 🔹 Nuevo: Actualizar un proceso existente
    def update(self, id: int, nueva_data: dict):
        try:
            proceso = self.find_by_id(id)
            if not proceso:
                return None
            for key, value in nueva_data.items():
                setattr(proceso, key, value)
            self.db.commit()
            self.db.refresh(proceso)
            return proceso
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al actualizar el Proceso.") from e

    # 🔹 Nuevo: Eliminar un proceso por ID
    def delete(self, id: int):
        try:
            proceso = self.find_by_id(id)
            if not proceso:
                return False
            self.db.delete(proceso)
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al eliminar el Proceso.") from e
