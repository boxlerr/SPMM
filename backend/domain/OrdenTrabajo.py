from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.infrastructure.db import Base

class OrdenTrabajo(Base):
    __tablename__ = "orden_trabajo"

    id = Column(Integer, primary_key=True, index=True)
    id_otvieja = Column(Integer)  # el número viejo, no clave
    observaciones = Column(String(255), nullable=True)

    id_prioridad = Column(Integer, ForeignKey("prioridad.id"), nullable=False)
    id_sector = Column(Integer, ForeignKey("sector.id"), nullable=False)
    id_articulo = Column(Integer, ForeignKey("articulo.id"), nullable=False)


    fecha_orden = Column(DateTime, nullable=False)
    fecha_entrada = Column(DateTime, nullable=False)
    fecha_prometida = Column(DateTime, nullable=False)
    fecha_entrega = Column(DateTime, nullable=True)

    # Relaciones
    prioridad = relationship("Prioridad", back_populates="ordenes_trabajo")
    procesos = relationship("OrdenTrabajoProceso", back_populates="orden_trabajo", lazy="joined")
    sector = relationship("Sector")
    articulo = relationship("Articulo")
