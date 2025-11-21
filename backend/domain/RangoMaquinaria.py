from sqlalchemy import Column, Integer, ForeignKey, PrimaryKeyConstraint
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class RangoMaquinaria(Base):
    __tablename__ = "rango_maquinaria"

    id_rango = Column(Integer, ForeignKey("rango.id", ondelete="CASCADE"), nullable=False)
    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("id_rango", "id_maquinaria"),
    )

    # Relaciones
    rango = relationship("Rango", back_populates="rango_maquinarias", passive_deletes=True)
    maquinaria = relationship("Maquinaria", back_populates="rango_maquinarias", passive_deletes=True)
