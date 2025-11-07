# backend/domain/models/RangoProceso.py
from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class RangoProceso(Base):
    __tablename__ = "rango_proceso"

    id_rango = Column(Integer, ForeignKey("rango.id"), primary_key=True)
    id_proceso = Column(Integer, ForeignKey("proceso.id"), primary_key=True)

    # 🔹 Relaciones
    rango = relationship("Rango", back_populates="procesos")
    proceso = relationship("Proceso", back_populates="rangos")
