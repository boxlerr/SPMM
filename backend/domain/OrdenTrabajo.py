from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.infrastructure.db import Base

class OrdenTrabajo(Base):
    __tablename__ = "orden_trabajo"

    id = Column(Integer, primary_key=True, index=True)
    id_otvieja = Column(Integer)  # el número viejo, no clave
    observaciones = Column(String(255), nullable=True)
    detalle = Column(String(500), nullable=True) # 🔹 Nuevo campo detalle
    reclamo = Column(Integer, default=0) # 0 = No, 1 = Si

    id_prioridad = Column(Integer, ForeignKey("prioridad.id"), nullable=False)
    id_sector = Column(Integer, ForeignKey("sector.id"), nullable=False)
    id_articulo = Column(Integer, ForeignKey("articulo.id"), nullable=False)
    unidades = Column(Integer, nullable=True)
    cantidad_entregada = Column(Integer, nullable=True, default=0) # 🔹 Nuevo campo entrega
    
    finalizadototal = Column(Integer, nullable=True, default=0) # 0 = No, 1 = Si
    finalizadoparcial = Column(Integer, nullable=True, default=0) 

    # 🔻 Eliminado: id_maquinaria (se quitó la FK a maquinaria)

    fecha_orden = Column(DateTime, nullable=False)
    fecha_entrada = Column(DateTime, nullable=False)
    fecha_prometida = Column(DateTime, nullable=False)
    fecha_entrega = Column(DateTime, nullable=True)

    # Relaciones
    procesos = relationship("OrdenTrabajoProceso", back_populates="orden_trabajo")
    prioridad = relationship("Prioridad")
    sector = relationship("Sector")
    articulo = relationship("Articulo")
    
    id_cliente = Column(Integer, ForeignKey("cliente.id"), nullable=True)
    cliente = relationship("Cliente")
    
    #relacion con plano
    planos = relationship("Plano", back_populates="orden_trabajo")

