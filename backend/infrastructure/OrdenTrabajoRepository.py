from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException

from backend.domain.Sector import Sector
from backend.domain.Prioridad import Prioridad
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Articulo import Articulo
from datetime import datetime



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
            raise InfrastructureException("Error al guardar la Orden de Trabajo.") from e

    def find_all(self):
        try:
            return self.db.query(OrdenTrabajo).all()
        except Exception as e:
            raise InfrastructureException("Error al listar Órdenes de Trabajo.") from e

    def find_by_id(self, id: int):
        try:
            return self.db.query(OrdenTrabajo).filter(OrdenTrabajo.id == id).first()
        except Exception as e:
            raise InfrastructureException("Error al buscar la Orden de Trabajo por ID.") from e

    def update(self, id: int, nueva_data: dict):
        try:
            orden = self.find_by_id(id)
            if not orden:
                return None
            for key, value in nueva_data.items():
                setattr(orden, key, value)

            print("Objeto antes de commit:", orden.__dict__)
            self.db.commit()

            return orden
        except Exception as e:
            self.db.rollback()
            print("❌ Error real en UPDATE:", repr(e))  # 👈 Agregado
            raise InfrastructureException("Error al actualizar la Orden de Trabajo.") from e


    def delete(self, id: int):
        try:
            orden = self.find_by_id(id)
            if not orden:
                return False
            self.db.delete(orden)
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al eliminar la Orden de Trabajo.") from e
            
    def find_by_fecha_orden_entre(self, desde: datetime, hasta: datetime):
        try:
            return self.db.query(OrdenTrabajo).filter(
                OrdenTrabajo.fecha_orden >= desde,
                OrdenTrabajo.fecha_orden <= hasta
            ).all()
        except Exception as e:
            raise InfrastructureException("Error al filtrar por fechas.") from e

    def find_by_prioridad(self, id_prioridad: int):
        try:
            return self.db.query(OrdenTrabajo).filter(
                OrdenTrabajo.id_prioridad == id_prioridad
            ).all()
        except Exception as e:
            raise InfrastructureException("Error al filtrar por prioridad.") from e





