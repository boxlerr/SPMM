from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)

from backend.infrastructure.db import Base

ESTADOS_RECORTE = ("disponible", "usado", "descartado")


class PiezaRecorte(Base):
    """Un tramo sobrante de un insumo (un recorte de barra, de chapa).

    El taller compra material justo, así que esto es secundario: sirve para que quien
    carga una OT vea «de esta barra hay un recorte de 2777 mm» antes de pedir otra.

    Una fila es un recorte físico (o varios IGUALES, con `cantidad`). Del viejo cada
    fila es un recorte y las repetidas son piezas distintas, por eso no se agrupan al
    importar. `texto_original` guarda lo que decía el viejo tal cual («1525x3»,
    «3440 (pintado amarillo 1212)»), porque la conversión a mm no siempre sale.

    No se borra al usarlo: pasa a 'usado' con la OT donde se usó y quién.
    `id_orden_trabajo_uso` va sin FK: el recorte ya se usó aunque la OT se borre.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "pieza_recorte"
    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_pieza_recorte_cantidad"),
        CheckConstraint("estado IN ('disponible', 'usado', 'descartado')",
                        name="ck_pieza_recorte_estado"),
        CheckConstraint("origen IN ('legacy', 'spmm')", name="ck_pieza_recorte_origen"),
        Index("ix_pieza_recorte_pieza", "id_pieza", "estado"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_pieza = Column(Integer, ForeignKey("pieza.id"), nullable=False)
    largo_mm = Column(Numeric(10, 1, asdecimal=False), nullable=True)
    ancho_mm = Column(Numeric(10, 1, asdecimal=False), nullable=True)
    cantidad = Column(Integer, nullable=False, default=1, server_default="1")
    observaciones = Column(Text, nullable=True)
    texto_original = Column(String(60), nullable=True)
    estado = Column(String(12), nullable=False, default="disponible", server_default="disponible")
    id_orden_trabajo_uso = Column(Integer, nullable=True)
    creado_en = Column(DateTime, nullable=True)
    creado_por = Column(String(120), nullable=True)
    usado_en = Column(DateTime, nullable=True)
    usado_por = Column(String(120), nullable=True)
    origen = Column(String(10), nullable=False, default="spmm", server_default="spmm")
