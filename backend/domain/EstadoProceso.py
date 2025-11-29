from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base
from sqlalchemy.orm import relationship

class EstadoProceso(Base):
    __tablename__ = "estado_proceso"

    id = Column(Integer, primary_key=True, index=True)
    descripcion = Column(String(50), nullable=False)

    # Relación inversa (opcional, pero útil)
    ordenes_trabajo_proceso = relationship("OrdenTrabajoProceso", back_populates="estado_proceso")
