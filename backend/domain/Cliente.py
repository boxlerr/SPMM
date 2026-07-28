from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base


class Cliente(Base):
    """
    Entidad de dominio y modelo SQLAlchemy que mapea la tabla `cliente`.

    Campos:
    - id: clave primaria autoincremental.
    - nombre: nombre del cliente (obligatorio, hasta 150 caracteres).
    """

    __tablename__ = "cliente"

    id = Column(Integer, primary_key=True, index=True)
    # id del cliente en el sistema legacy (metalurgica_db). Es la clave con la que
    # el sync machea; existía en la base pero faltaba en el modelo.
    id_viejo = Column(Integer, nullable=True, index=True)
    nombre = Column(String(150), nullable=False)
    direccion = Column(String(255), nullable=True)
    cuit = Column(String(20), nullable=True)
    telefono = Column(String(50), nullable=True)
    celular = Column(String(50), nullable=True)
    localidad = Column(String(100), nullable=True)
    mail = Column(String(150), nullable=True)
    web = Column(String(150), nullable=True)
    obs = Column(String(500), nullable=True)
    fantasia = Column(String(150), nullable=True)
    abreviatura = Column(String(50), nullable=True)
