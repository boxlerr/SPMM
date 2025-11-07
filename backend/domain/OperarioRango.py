from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base
from backend.domain.Rango import Rango


class OperarioRango(Base):
    __tablename__ = "operario_rango"

    id_operario = Column(Integer, ForeignKey("operario.id"), primary_key=True)
    id_rango = Column(Integer, ForeignKey("rango.id"), primary_key=True)

    # Relaciones
    operario = relationship("Operario", back_populates="rangos")
    rango = relationship("Rango", back_populates="operarios_rango")
