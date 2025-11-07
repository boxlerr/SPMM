# backend/domain/models/Rango.py
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class Rango(Base):
    __tablename__ = "rango"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(100), nullable=False)

    # 🔹 Relación inversa
    procesos = relationship("RangoProceso", back_populates="rango")
    operarios_rango = relationship("OperarioRango", back_populates="rango")

