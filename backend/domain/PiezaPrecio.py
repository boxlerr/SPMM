from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
)

from backend.infrastructure.db import Base


class PiezaPrecio(Base):
    """El historial de precios de un insumo.

    `pieza.unitario` es el último precio y nada más: no dice de cuándo es ni de dónde
    salió. Esto guarda cada precio con su fecha y su origen:
      · 'compra'  = factura del sistema viejo (las facturas se siguen haciendo allá; el
                    sync trae el último precio de compra, paso 7b).
      · 'manual'  = cargado a mano en SPMM.
      · 'import'  = el historial del viejo (`HistorialPieza`) traído una vez.

    `pieza.unitario` + `pieza.fecha_ultimo_precio` se actualizan sólo cuando entra un
    precio con fecha igual o más nueva: cargar hoy un precio viejo que faltaba no pisa
    el vigente.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "pieza_precio"
    __table_args__ = (
        CheckConstraint("precio >= 0", name="ck_pieza_precio_precio"),
        CheckConstraint("origen IN ('compra', 'manual', 'import')", name="ck_pieza_precio_origen"),
        Index("ix_pieza_precio_pieza", "id_pieza", "fecha"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_pieza = Column(Integer, ForeignKey("pieza.id"), nullable=False)
    # Día del precio, sin hora ni zona (la factura tiene fecha, no hora).
    fecha = Column(Date, nullable=False)
    precio = Column(Numeric(18, 4, asdecimal=False), nullable=False)
    origen = Column(String(10), nullable=False)
    id_proveedor = Column(Integer, ForeignKey("proveedor.id"), nullable=True)
    usuario = Column(String(120), nullable=True)
    creado_en = Column(DateTime, nullable=True)
