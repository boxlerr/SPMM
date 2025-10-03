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

    def save(self, operario: Operario):
        try:
            self.db.add(operario)
            self.db.commit()
            self.db.refresh(operario)
            return operario
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un Operario.") from e


