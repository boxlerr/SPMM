# backend/infrastructure/OrdenTrabajoRepository.py
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.infrastructure.db import SessionLocal

class OrdenTrabajoRepository:
    def __init__(self):
        self.db = SessionLocal()

    def save(self, orden: OrdenTrabajo):
        self.db.add(orden)
        self.db.commit()
        self.db.refresh(orden)
        return orden

