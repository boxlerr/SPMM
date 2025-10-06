from backend.domain.Operario import Operario
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException


class OperarioRepository:
    """
    Repositorio de `Operario` con el método `save` para insertar registros.
    Maneja la transacción y traduce errores a `InfrastructureException`.
    """

    def __init__(self):
        self.db = SessionLocal()

    def find_by_id(self, id: int):
        return self.db.query(Operario).filter(Operario.id == id).first()

    def save(self, operario: Operario):
        try:
            self.db.add(operario)
            self.db.commit()
            self.db.refresh(operario)
            return operario
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Operario.") from e

    def delete(self, id: int):
        print(f"🛠️ [Repo] Ejecutando delete para ID: {id}")

        try:
            operario = self.find_by_id(id)
            print(f"📦 [Repo] Operario a eliminar: {operario}")

            if operario:
                self.db.delete(operario)
                self.db.commit()
                print("✅ [Repo] Operario eliminado")
                return True

            print("⚠️ [Repo] Operario no encontrado para eliminar")
            return False

        except Exception as e:
            self.db.rollback()
            print(f"❌ [Repo] Error en delete: {e}")
            raise InfrastructureException("Error al eliminar el operario.") from e



