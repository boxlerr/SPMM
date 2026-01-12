from sqlalchemy import Column, Integer, String, Float, ForeignKey
from backend.infrastructure.db import Base

class OrdenTrabajoPieza(Base):
    __tablename__ = "orden_trabajo_pieza"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=False)
    id_pieza = Column(Integer, ForeignKey("pieza.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    unidad = Column(String, nullable=True)
    pedido = Column(Integer, nullable=True) # 1 or 0
    disponible = Column(Integer, nullable=True) # 1 or 0
    cantusada = Column(Float, nullable=True)
