from sqlalchemy import Column, Integer, ForeignKey, PrimaryKeyConstraint
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class OrdenTrabajoProceso(Base):
    __tablename__ = "orden_trabajo_proceso"

    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=False)
    id_proceso = Column(Integer, ForeignKey("proceso.id"), nullable=False)
    orden = Column(Integer, nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint('id_orden_trabajo', 'id_proceso'),
    )

    # Relaciones
    orden_trabajo = relationship("OrdenTrabajo", back_populates="procesos")
    proceso = relationship("Proceso")

