from sqlalchemy import Column, Integer, ForeignKey, PrimaryKeyConstraint
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base


class ProcesoMaquinaria(Base):
    """En qué máquinas se puede hacer un proceso.

    Espejo de RangoMaquinaria, pero colgando del proceso y no del rango. Es la lista
    que el planificador venía DEDUCIENDO del nombre del proceso: ahora se puede cargar.
    Sin filas, se sigue deduciendo — ver la migración 2026-09-02.
    """
    __tablename__ = "proceso_maquinaria"

    id_proceso = Column(Integer, ForeignKey("proceso.id", ondelete="CASCADE"), nullable=False)
    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("id_proceso", "id_maquinaria"),
    )

    proceso = relationship("Proceso", back_populates="maquinarias", passive_deletes=True)
    maquinaria = relationship("Maquinaria", back_populates="procesos", passive_deletes=True)
