from sqlalchemy import Column, Integer, String, Date, Boolean
from backend.infrastructure.db import Base


class Operario(Base):
    """
    Modelo SQLAlchemy para la tabla `operario`.

    Nota: `sector` se modela como texto por ahora (simple). Más adelante
    puede pasar a ser una FK a `sector.id` sin cambiar el flujo general.
    """

    __tablename__ = "operario"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    fecha_nacimiento = Column(Date, nullable=False)
    fecha_ingreso = Column(Date, nullable=False)
    sector = Column(String(100), nullable=False)  # texto simple por ahora
    categoria = Column(String(100), nullable=False)
    disponible = Column(Boolean, nullable=False, default=True)
    cant_hs_trabajadas = Column(Integer, nullable=False, default=0)
    dias_trabajo = Column(String(50), nullable=True)  # ej.: "Lun-Vie"

from dataclasses import dataclass

@dataclass
class Operario:
    id:int
    nombre: str
    apellido : str

    def __init__(self):
        pass
    
    def pruebaPC():
        pass
    