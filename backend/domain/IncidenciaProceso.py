from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from datetime import datetime
from backend.infrastructure.db import Base


class IncidenciaProceso(Base):
    """
    Registro de una incidencia que generó pérdida de tiempo o necesidad de más
    gente en un proceso de una orden. Caso principal: alguien no interpretó un
    plano (tipo = 'INTERPRETACION_PLANOS'), pero el `tipo` queda abierto para
    otros motivos a futuro.

    Alimenta la métrica del dashboard (cuántas veces pasó, cuánto tiempo se perdió).
    """

    __tablename__ = "incidencia_proceso"

    id = Column(Integer, primary_key=True, autoincrement=True)
    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=False)
    id_proceso = Column(Integer, ForeignKey("proceso.id"), nullable=True)
    id_operario = Column(Integer, ForeignKey("operario.id"), nullable=True)
    tipo = Column(String(50), nullable=False, default="INTERPRETACION_PLANOS")
    minutos_perdidos = Column(Integer, nullable=False, default=0)
    operarios_extra = Column(Integer, nullable=False, default=0)
    descripcion = Column(String(500), nullable=True)
    fecha_registro = Column(DateTime, nullable=False, default=datetime.utcnow)
