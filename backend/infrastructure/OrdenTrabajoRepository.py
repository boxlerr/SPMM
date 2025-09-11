# backend/infrastructure/OrdenTrabajoRepository.py
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions import InfrastructureException
class OrdenTrabajoRepository:
    def __init__(self):
        self.db = SessionLocal()

    def save(self, orden: OrdenTrabajo):
        
        try:       
            self.db.add(orden)
            self.db.commit()
            self.db.refresh(orden)
            return orden
        except Exception as e:
            self.db.rollback() 
        raise InfrastructureException("Error al cargar una nueva OT.") from e


