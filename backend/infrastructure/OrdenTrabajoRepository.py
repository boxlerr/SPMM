# backend/infrastructure/OrdenTrabajoRepository.py
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException
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
    
    
    def find_by_id(self, id: int):
        return self.db.query(OrdenTrabajo).filter(OrdenTrabajo.id == id).first()

    def delete(self, id: int):
        try:
            orden = self.find_by_id(id)
            if orden:
                self.db.delete(orden)
                self.db.commit()
                return True
            return False
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al eliminar la OT.") from e


