from sqlalchemy import Column, Integer, ForeignKey, PrimaryKeyConstraint, String, DateTime
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

    # Cantidad de operarios que el proceso requiere en simultáneo (default 1).
    # La columna ya existe en la base (cant_operarios, NOT NULL default 1).
    cant_operarios = Column(Integer, nullable=False, default=1)

    # Máquina PRESELECCIONADA para este proceso (pedido reunión Metlo 2-jul-2026).
    #   - NULL  = sin preselección: el planificador elige la máquina.
    #   - <id>  = preselección: se fuerza ese proceso a esa máquina.
    # Requiere la migración backend/scripts/migrations/2026-07-05_maquina_en_proceso.sql
    # corrida ANTES de desplegar (si la columna no existe, el ORM rompe al leer procesos).
    # El sync (sync_db.py) NO la pisa (no está en su MERGE), igual que cant_operarios.
    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id"), nullable=True)

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

