from sqlalchemy import Column, Integer, ForeignKey, PrimaryKeyConstraint
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class OrdenTrabajoProceso(Base):
    __tablename__ = "orden_trabajo_proceso"

    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"))
    id_proceso = Column(Integer, ForeignKey("proceso.id"))
    orden = Column(Integer, nullable=False)
    tiempo_proceso = Column(Integer, nullable=True)



    __table_args__ = (
        PrimaryKeyConstraint('id_orden_trabajo', 'id_proceso'),
    )

    # 🔹 Relaciones
    orden_trabajo = relationship("OrdenTrabajo", back_populates="procesos")
    proceso = relationship("Proceso", back_populates="ordenes_trabajo_proceso")

