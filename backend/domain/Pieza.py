from sqlalchemy import Column, Integer, String, Float
from backend.infrastructure.db import Base

class Pieza(Base):
    __tablename__ = "pieza"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    cod_pieza = Column(String, nullable=False)
    descripcion = Column(String, nullable=False)
    unitario = Column(Float, nullable=True)
    unidad = Column(String, nullable=True)
    stockactual = Column(Float, nullable=True)
    observaciones = Column(String, nullable=True)
    proveedor = Column(String, nullable=True)
    material = Column(String, nullable=True)
    formato = Column(String, nullable=True)
    estante = Column(String, nullable=True)
    letra = Column(String, nullable=True)
    nro = Column(String, nullable=True)
