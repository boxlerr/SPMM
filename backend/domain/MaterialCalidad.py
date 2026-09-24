from sqlalchemy import Column, ForeignKey, Integer, SmallInteger, String, UniqueConstraint

from backend.infrastructure.db import Base


class MaterialCalidad(Base):
    """La calidad de un material: SAE 1045 del ACERO, DELRIN de los PLASTICOS…

    Cuelga de un material porque el combo se filtra por él: la calidad «LATON» sólo
    tiene sentido para el BRONCE. En el viejo la calidad no se guardaba en ninguna
    columna de la pieza: vivía sólo en la descripción, después del nombre del material.
    La importación la parsea de ahí.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "material_calidad"

    id = Column(Integer, primary_key=True, autoincrement=True)
    id_material = Column(Integer, ForeignKey("material.id"), nullable=False)
    nombre = Column(String(80), nullable=False)
    activo = Column(SmallInteger, nullable=False, default=1, server_default="1")

    __table_args__ = (
        UniqueConstraint("id_material", "nombre", name="uq_material_calidad"),
    )
