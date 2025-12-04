from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.infrastructure.db import Base


class Plano(Base):
    __tablename__ = "plano"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(255), nullable=False)
    descripcion = Column(String(500))
    tipo_archivo = Column(String(20))
    archivo = Column(LargeBinary, nullable=False)
    fecha_subida = Column(DateTime, default=datetime.utcnow)

    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=False)

    #relacion con ots
    orden_trabajo = relationship("OrdenTrabajo", back_populates="planos")
