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
    # Posición dentro de la lista de su nivel: 0 = primero = más preferido.
    # NULL = sin posición, se trata como el final. El planificador la usa como
    # desempate fino DENTRO del nivel (el nivel sigue mandando).
    orden = Column(SmallInteger, nullable=True)
    # De dónde sale la habilidad. False = override sobre una NATIVA (la da el rango);
    # True = la cargó alguien a mano y habilita el proceso para ESTE operario aunque
    # su rango no lo incluya. Es el único eje que agrega elegibilidad: `nivel` solo
    # ordena preferencia y `habilitado` solo saca.
    manual = Column(Boolean, nullable=False, default=False, server_default="false")

    # Relationships
    operario = relationship("Operario", back_populates="procesos_skill")
    proceso = relationship("Proceso", back_populates="operarios_skill")

    # Constraint to validate nivel in (0, 1, 2)
    __table_args__ = (
        CheckConstraint('nivel IN (0, 1, 2)', name='check_nivel_valido'),
    )
