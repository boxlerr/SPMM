from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UnicodeText
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.infrastructure.db import Base

class OrdenTrabajo(Base):
    __tablename__ = "orden_trabajo"

    id = Column(Integer, primary_key=True, index=True)
    id_otvieja = Column(Integer, index=True)  # el número viejo, no clave
    observaciones = Column(UnicodeText, nullable=True)
    detalle = Column(Text, nullable=True) # 🔹 Nuevo campo detalle
    reclamo = Column(Integer, default=0) # 0 = No, 1 = Si

    id_prioridad = Column(Integer, ForeignKey("prioridad.id"), nullable=False)
    id_sector = Column(Integer, ForeignKey("sector.id"), nullable=False)
    id_articulo = Column(Integer, ForeignKey("articulo.id"), nullable=False)
    unidades = Column(Integer, nullable=True)
    cantidad_entregada = Column(Integer, nullable=True, default=0) # 🔹 Nuevo campo entrega
    
    finalizadototal = Column(Integer, nullable=True, default=0) # 0 = No, 1 = Si
    finalizadoparcial = Column(Integer, nullable=True, default=0) 

    # 🔹 Nuevos campos "Pronto"
    n_ped_l = Column(String(100), nullable=True)
    n_pedido = Column(String(100), nullable=True)
    subsector = Column(String(100), nullable=True)
    requerido_por = Column(String(100), nullable=True)
    aprobado_por = Column(String(100), nullable=True)
    remitos_salida = Column(String(200), nullable=True)
    f_disp_material = Column(DateTime, nullable=True)
    
    fabricacion = Column(Integer, nullable=True, default=0)
    reparacion = Column(Integer, nullable=True, default=0)
    sin_cargo = Column(Integer, nullable=True, default=0)
    stock = Column(Integer, nullable=True, default=0)
    interno = Column(Integer, nullable=True, default=0)
    revisada = Column(Integer, nullable=True, default=0)
    tercerizado_total = Column(Integer, nullable=True, default=0)
    tercerizado_parcial = Column(Integer, nullable=True, default=0)
    suspendida = Column(Integer, nullable=True, default=0)
    email = Column(Integer, nullable=True, default=0)
    tiene_plano = Column(Integer, nullable=True, default=0)
    programada = Column(Integer, nullable=True, default=0)
    en_proceso = Column(Integer, nullable=True, default=0)

    # Columnas que existían en la base pero faltaban en el modelo (por eso no se
    # migraban). `ttt1` y `fc` las escribe el sync y son parte de la regla de
    # "OT pendiente" del sistema legacy; `obspaniol` son las observaciones de pañol.
    requerido = Column(String(50), nullable=True)
    aprobado = Column(String(50), nullable=True)
    obspaniol = Column(String(500), nullable=True)
    ttt1 = Column(Integer, nullable=False, default=0)
    fc = Column(Integer, nullable=False, default=0)

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

