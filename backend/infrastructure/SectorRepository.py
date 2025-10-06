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
        return self.db.query(Sector).filter(Sector.id == id).first()

    def save(self, sector: Sector):
        try:
            self.db.add(sector)
            self.db.commit()
            self.db.refresh(sector)
            return sector
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Sector.") from e

    def delete(self, id: int):
        print(f"🛠️ [Repo] Ejecutando delete para Sector ID: {id}")
        try:
            sector = self.find_by_id(id)
            print(f"📦 [Repo] Sector a eliminar: {sector}")

            if sector:
                self.db.delete(sector)
                self.db.commit()
                print("✅ [Repo] Sector eliminado")
                return True

            print("⚠️ [Repo] Sector no encontrado para eliminar")
            return False

        except Exception as e:
            self.db.rollback()
            print(f"❌ [Repo] Error en delete: {e}")
            raise InfrastructureException("Error al eliminar el sector.") from e



