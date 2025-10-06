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
        try:
            return self.db.query(Operario).filter(Operario.id == id).first()
        except Exception as e:
            raise InfrastructureException("Error al buscar el Operario por ID.") from e

    def find_all(self):
        try:
            return self.db.query(Operario).all()
        except Exception as e:
            raise InfrastructureException("Error al listar Operarios.") from e

    def save(self, operario: Operario):
        try:
            self.db.add(operario)
            self.db.commit()
            self.db.refresh(operario)
            return operario
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Operario.") from e

    def update(self, id: int, nueva_data: dict):
        try:
            operario = self.find_by_id(id)
            if not operario:
                return None
            for key, value in nueva_data.items():
                setattr(operario, key, value)
            self.db.commit()
            self.db.refresh(operario)
            return operario
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al actualizar el Operario.") from e

    def delete(self, id: int):
        try:
            operario = self.find_by_id(id)
            if not operario:
                return False
            self.db.delete(operario)
            self.db.commit()
            return True
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al eliminar el Operario.") from e



