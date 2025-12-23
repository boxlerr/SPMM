from sqlalchemy import Column, Integer, ForeignKey, PrimaryKeyConstraint, String, DateTime, DateTime
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class OrdenTrabajoProceso(Base):
    __tablename__ = "orden_trabajo_proceso"

    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"))
    id_proceso = Column(Integer, ForeignKey("proceso.id"))
    orden = Column(Integer, nullable=False)
    tiempo_proceso = Column(Integer, nullable=True)
    id_estado = Column(Integer, ForeignKey("estado_proceso.id"), default=1)
    observaciones = Column(String, nullable=True)

    # New fields for real time tracking
    inicio_real = Column(DateTime, nullable=True)
    fin_real = Column(DateTime, nullable=True)
    
    # New fields for real time tracking
    inicio_real = Column(DateTime, nullable=True)
    fin_real = Column(DateTime, nullable=True)

    __table_args__ = (
        PrimaryKeyConstraint('id_orden_trabajo', 'id_proceso'),
    )

    # 🔹 Relaciones
    orden_trabajo = relationship("OrdenTrabajo", back_populates="procesos")
    proceso = relationship("Proceso", back_populates="ordenes_trabajo_proceso")
    estado_proceso = relationship("EstadoProceso", back_populates="ordenes_trabajo_proceso")

