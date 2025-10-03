from backend.domain.Articulo import Articulo
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class ArticuloRepository:
    def __init__(self):
        self.db = SessionLocal()

    def save(self, articulo: Articulo):
        try:
            self.db.add(articulo)
            self.db.commit()
            self.db.refresh(articulo)
            return articulo
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al guardar un nuevo artículo.") from e
