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
    direccion = Column(String(255), nullable=True)
    cuit = Column(String(20), nullable=True)
    telefono = Column(String(50), nullable=True)
    celular = Column(String(50), nullable=True)
    localidad = Column(String(100), nullable=True)
    mail = Column(String(100), nullable=True)
    web = Column(String(100), nullable=True)
    obs = Column(String(500), nullable=True)
    fantasia = Column(String(100), nullable=True)
    abreviatura = Column(String(20), nullable=True)
