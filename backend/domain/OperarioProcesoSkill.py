from sqlalchemy import Column, Integer, ForeignKey, SmallInteger, Boolean, CheckConstraint
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class OperarioProcesoSkill(Base):
    """
    Modelo ORM para la tabla `operario_proceso_skill`.
    Define los niveles de habilidad de los operarios para diferentes procesos.
    """
    __tablename__ = "operario_proceso_skill"

    id_operario = Column(
        Integer, 
        ForeignKey("operario.id", ondelete="CASCADE"), 
        primary_key=True
    )
    id_proceso = Column(
        Integer, 
        ForeignKey("proceso.id", ondelete="CASCADE"), 
        primary_key=True
    )
    nivel = Column(SmallInteger, nullable=False, default=0)
    habilitado = Column(Boolean, nullable=False, default=True)

    # Relationships
    operario = relationship("Operario", back_populates="procesos_skill")
    proceso = relationship("Proceso", back_populates="operarios_skill")

    # Constraint to validate nivel in (0, 1, 2)
    __table_args__ = (
        CheckConstraint('nivel IN (0, 1, 2)', name='check_nivel_valido'),
    )
