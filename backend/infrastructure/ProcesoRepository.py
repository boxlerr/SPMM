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
