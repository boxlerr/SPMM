from datetime import datetime
from backend.domain.OrdenTrabajo import OrdenTrabajo

class CrearOrdenTrabajoService:
    def __init__(self, repository):
        self.repository = repository

    def ejecutar(self, orden: OrdenTrabajo):
        # Asignamos la fecha antes de guardar
        orden.fecha = datetime.now()
        return self.repository.save(orden)

