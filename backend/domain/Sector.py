from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base


class Sector(Base):
    """
    Entidad de dominio y modelo SQLAlchemy que mapea la tabla `sector`.

    Campos:
    - id: clave primaria autoincremental.
    - nombre: nombre del sector (obligatorio, hasta 100 caracteres).
    """

    __tablename__ = "sector"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)


