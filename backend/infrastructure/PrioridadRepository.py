from backend.domain.Prioridad import Prioridad
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class PrioridadRepository:
    def __init__(self):
        self.db = SessionLocal()

    def save(self, prioridad: Prioridad):
        try:
            self.db.add(prioridad)
            self.db.commit()
            self.db.refresh(prioridad)
            return prioridad
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al cargar una nueva Prioridad.") from e

    # 🔹 Nuevo: Obtener todas las prioridades
    def find_all(self):
        try:
            return self.db.query(Prioridad).all()
        except Exception as e:
            raise InfrastructureException("Error al listar Prioridades.") from e

    # 🔹 Nuevo: Buscar una prioridad por ID
    def find_by_id(self, id: int):
        try:
            return self.db.query(Prioridad).filter(Prioridad.id == id).first()
        except Exception as e:
            raise InfrastructureException("Error al buscar la Prioridad por ID.") from e

    # 🔹 Nuevo: Actualizar una prioridad existente
    def update(self, id: int, nueva_data: dict):
        try:
            prioridad = self.find_by_id(id)
            if not prioridad:
                return None
            for key, value in nueva_data.items():
                setattr(prioridad, key, value)
            self.db.commit()
            self.db.refresh(prioridad)
            return prioridad
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al actualizar la Prioridad.") from e

    # 🔹 Nuevo: Eliminar una prioridad por ID
    def delete(self, id: int):
        try:
            prioridad = self.find_by_id(id)
            if not prioridad:
                return False
            self.db.delete(prioridad)
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al eliminar la Prioridad.") from e
