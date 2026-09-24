from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
)

from backend.infrastructure.db import Base


class OrdenTrabajoPiezaCorte(Base):
    """Los cortes de una línea de materia prima de la OT (el botón «Cortes» del viejo).

    «3 × 1093 mm» de una barra: cuántos tramos y de qué largo (y ancho, en chapa). Con
    eso la pantalla sugiere cuántos metros pedir (reglas.sugerido_m, sumando el espesor
    de la sierra en cada corte). La sugerencia NO cambia la cantidad de la línea sola.

    Cuelga de la línea con ON DELETE CASCADE: un corte sin su línea no significa nada,
    y borrar la línea no tiene por qué preguntar por sus cortes.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "orden_trabajo_pieza_corte"
    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_otp_corte_cantidad"),
        Index("ix_otp_corte_linea", "id_orden_trabajo_pieza"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_orden_trabajo_pieza = Column(
        Integer, ForeignKey("orden_trabajo_pieza.id", ondelete="CASCADE"), nullable=False,
    )
    cantidad = Column(Integer, nullable=False)
    largo_mm = Column(Numeric(10, 1, asdecimal=False), nullable=True)
    ancho_mm = Column(Numeric(10, 1, asdecimal=False), nullable=True)
    # Lo que decía el viejo cuando no se pudo leer como medida («80x200x20mm»).
    texto_original = Column(String(60), nullable=True)
    orden = Column(SmallInteger, nullable=True)
