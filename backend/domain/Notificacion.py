"""
Modelo de dominio ORM: Notificacion
Representa una notificación del sistema SPMM usando SQLAlchemy
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from backend.infrastructure.db import Base


class Notificacion(Base):
    """Entidad Notificacion del dominio (SQLAlchemy ORM)"""
    
    __tablename__ = "notificacion"
    __table_args__ = {'schema': 'dbo'}
    
    # Campos
    id_notificacion = Column(Integer, primary_key=True, autoincrement=True, index=True)
    mensaje = Column(String(500), nullable=False)
    tipo = Column(String(50), nullable=False)  # operario_created, operario_updated, operario_deleted, etc.
    leida = Column(Boolean, nullable=False, default=False)
    motivo = Column(Text, nullable=True)  # Motivo o detalles adicionales
    fecha_creacion = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario_creador = Column(Integer, nullable=True)  # Usuario que generó la notificación (opcional)
    
    def to_dict(self) -> dict:
        """Convierte la notificación a diccionario"""
        return {
            "id_notificacion": self.id_notificacion,
            "mensaje": self.mensaje,
            "tipo": self.tipo,
            "leida": self.leida,
            "motivo": self.motivo,
            "fecha_creacion": self.fecha_creacion.isoformat() if self.fecha_creacion else None,
            "id_usuario_creador": self.id_usuario_creador,
        }

