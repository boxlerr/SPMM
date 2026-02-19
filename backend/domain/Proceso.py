from sqlalchemy import Column, Integer, String, Text
from backend.infrastructure.db import Base
from sqlalchemy.orm import relationship
import typing

if typing.TYPE_CHECKING:
    from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill

class Proceso(Base):
    __tablename__ = "proceso"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nombre = Column(String(255), nullable=True)
    descripcion = Column(Text, nullable=True)

    # 🔹 Relaciones
    rangos = relationship("RangoProceso", back_populates="proceso")
    ordenes_trabajo_proceso = relationship("OrdenTrabajoProceso", back_populates="proceso")
    operarios_skill = relationship("OperarioProcesoSkill", back_populates="proceso", cascade="all, delete-orphan")
