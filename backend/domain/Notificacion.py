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
    # Sin schema explícito (ver Usuario): 'dbo' es el default en SQL Server y no
    # existe en Postgres/Supabase.

    # Campos
    id_notificacion = Column(Integer, primary_key=True, autoincrement=True, index=True)
    mensaje = Column(String(500), nullable=False)
    tipo = Column(String(50), nullable=False)  # operario_created, operario_updated, operario_deleted, etc.
    leida = Column(Boolean, nullable=False, default=False)
    motivo = Column(Text, nullable=True)  # Motivo o detalles adicionales
    fecha_creacion = Column(DateTime, nullable=False, default=datetime.utcnow)
    id_usuario_creador = Column(Integer, nullable=True)  # Usuario que generó la notificación (opcional)

    # De qué orden de trabajo habla este aviso. NULL = no habla de ninguna (el alta de
    # una persona, un cambio de usuario).
    #
    # No está para adornar: es lo que hace que el detector de órdenes retrasadas pueda
    # preguntar «¿de esta OT ya avisé?». Sin eso cada corrida escribiría otra copia del
    # mismo aviso y a los diez días la campanita tendría diez renglones por orden.
    # Es además lo que permite que tocar el aviso lleve a la orden y no a la lista.
    #
    # Sin FK a propósito (mismo criterio que auditoria_movimiento): borrar una OT no
    # puede fallar por un aviso viejo que la nombra.
    # Ver migrations/2026-09-22_alerta_retraso_ot.sql.
    id_orden_trabajo = Column(Integer, nullable=True)
    
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
            "id_orden_trabajo": self.id_orden_trabajo,
        }

