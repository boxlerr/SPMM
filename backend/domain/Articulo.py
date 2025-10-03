from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base  # Asegurate que Base es de declarative_base()

class Articulo(Base):
    __tablename__ = "articulo"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)  # ✅ Clave primaria definida
    cod_articulo = Column(String, nullable=False)
    descripcion = Column(String, nullable=False)
    abreviatura = Column(String, nullable=False)

