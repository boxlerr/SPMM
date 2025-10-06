from backend.domain.Articulo import Articulo
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class ArticuloRepository:
    def __init__(self):
        self.db = SessionLocal()


    def find_by_id(self, id: int):
        return self.db.query(Articulo).filter(Articulo.id == id).first()

    def save(self, articulo: Articulo):
        try:
            self.db.add(articulo)
            self.db.commit()
            self.db.refresh(articulo)
            return articulo
        except Exception as e:
            self.db.rollback()
            print("❌ Error en INSERT:", repr(e))  # 👈 Mostramos el error original
            raise InfrastructureException("Error al guardar un nuevo artículo.") from e


    def delete(self, id: int):
        try:
            articulo = self.find_by_id(id)
            if articulo:
                self.db.delete(articulo)
                self.db.commit()
                return True
            return False
        except Exception as e:
            self.db.rollback()
            print(f"❌ [Repo] Error en delete: {e}")
            raise InfrastructureException("Error al eliminar el artículo.") from e

    def find_all(self):
        try:
            return self.db.query(Articulo).all()
        except Exception as e:
            raise InfrastructureException("Error al listar Artículos.") from e

    def find_by_id(self, id: int):
        try:
            return self.db.query(Articulo).filter(Articulo.id == id).first()
        except Exception as e:
            raise InfrastructureException("Error al buscar el Artículo por ID.") from e

    def update(self, id: int, nueva_data: dict):
        try:
            articulo = self.find_by_id(id)
            if not articulo:
                return None
            for key, value in nueva_data.items():
                setattr(articulo, key, value)
            self.db.commit()
            self.db.refresh(articulo)
            return articulo
        except Exception as e:
            self.db.rollback()
            raise InfrastructureException("Error al actualizar el Artículo.") from e