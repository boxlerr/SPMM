from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base


class Cliente(Base):
    """
    Entidad de dominio y modelo SQLAlchemy que mapea la tabla `cliente`.

    Campos:
    - id: clave primaria autoincremental.
    - nombre: nombre del cliente (obligatorio, hasta 100 caracteres).
    """

    __tablename__ = "cliente"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
