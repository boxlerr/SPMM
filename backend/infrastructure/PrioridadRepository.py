from backend.domain.Prioridad import Prioridad
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class PrioridadRepository:
    def __init__(self):
        self.db = SessionLocal()

    def save(self, prioridad: Prioridad):
        """
        Crea una nueva prioridad (INSERT). 
        Si querés UPDATE más adelante, armamos un método update/find_by_id.
        """
        try:
            self.db.add(prioridad)
            self.db.commit()
            self.db.refresh(prioridad)
            return prioridad
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al cargar una nueva Prioridad.") from e
