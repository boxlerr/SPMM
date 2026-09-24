from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)

from backend.infrastructure.db import Base

# Los tipos de movimiento, con el signo que tiene que tener cada uno. La misma lista va
# en el CHECK de la base y en application/materia_prima/reglas.py.
#   ingreso    entra material (+)
#   egreso     sale material a mano (−)
#   ajuste     corrección de inventario: la diferencia contra el saldo contado (±)
#   retiro_ot  se retiró lo reservado para una OT al marcarla disponible (−). Lo crea y
#              lo anula la línea de la OT, nunca una persona a mano.
TIPOS_MOVIMIENTO = ("ingreso", "egreso", "ajuste", "retiro_ot")


class PiezaMovimiento(Base):
    """Un movimiento de stock de un insumo (la solapa Stock del viejo).

    DESDE EL 23/09/2026 EL STOCK ES ESTO

    El stock de SPMM es la SUMA de estos movimientos (los no anulados). El
    `pieza.stockactual` del viejo no era stock físico —era una suma de compras— y no se
    usa como saldo: queda como CACHÉ de esta suma, que recalcula el servicio en cada
    movimiento (application/materia_prima/stock.py). Se importan los movimientos del
    viejo (`MOVSTOCK`, origen='legacy'), que es exactamente lo que el viejo mostraba en
    su solapa Stock.

    UNA FILA = UN MOVIMIENTO, CON SIGNO

    + entra, − sale. Nunca cero (no movería nada y confundiría el historial). El ajuste
    guarda la DIFERENCIA contra el saldo contado, no el saldo: así la suma sigue siendo
    el stock sin tener que saber cuál fue el último ajuste.

    SE ANULA, NO SE BORRA

    Un movimiento equivocado deja de sumar pero queda a la vista, con quién, cuándo y
    por qué se anuló. Mismo patrón que consumo_material.

    `id_orden_trabajo` e `id_orden_trabajo_pieza` van SIN FK a propósito: el movimiento
    es un hecho del depósito y tiene que sobrevivir a que se borre la OT o la línea
    (el material ya salió). Borrar una OT no borra sus movimientos.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "pieza_movimiento"
    __table_args__ = (
        # Un movimiento en cero no es un movimiento.
        CheckConstraint("cantidad <> 0", name="ck_pieza_movimiento_cantidad"),
        CheckConstraint(
            "tipo IN ('ingreso', 'egreso', 'ajuste', 'retiro_ot')",
            name="ck_pieza_movimiento_tipo",
        ),
        # El signo va con el tipo: un «ingreso» negativo sumaría bien y se leería mal.
        CheckConstraint(
            "(tipo = 'ingreso' AND cantidad > 0) OR (tipo IN ('egreso', 'retiro_ot') "
            "AND cantidad < 0) OR tipo = 'ajuste'",
            name="ck_pieza_movimiento_signo",
        ),
        CheckConstraint("origen IN ('legacy', 'spmm')", name="ck_pieza_movimiento_origen"),
        Index("ix_pieza_movimiento_pieza", "id_pieza", "fecha"),
    )

    # BIGSERIAL en Postgres; en SQLite (tests) INTEGER, el único que numera solo.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_pieza = Column(Integer, ForeignKey("pieza.id"), nullable=False)
    # Hora local del taller, sin zona. La pone el servidor, nunca el navegador.
    fecha = Column(DateTime, nullable=False)
    tipo = Column(String(20), nullable=False)
    # Con signo. NUMERIC(18,3) porque hay insumos por metro y por kilo; se lee como
    # float para que el JSON salga igual que las demás cantidades.
    cantidad = Column(Numeric(18, 3, asdecimal=False), nullable=False)
    comentario = Column(Text, nullable=True)
    id_orden_trabajo = Column(Integer, nullable=True)
    id_orden_trabajo_pieza = Column(Integer, nullable=True)
    # Quién, tomado del token y congelado. NULL = no se registró (un script, la
    # importación): nunca un autor inventado.
    id_usuario = Column(Integer, nullable=True)
    usuario = Column(String(120), nullable=True)
    # 'legacy' = importado de MOVSTOCK del viejo; 'spmm' = cargado acá.
    origen = Column(String(10), nullable=False, default="spmm", server_default="spmm")

    anulado = Column(SmallInteger, nullable=False, default=0, server_default="0")
    anulado_en = Column(DateTime, nullable=True)
    anulado_por = Column(String(120), nullable=True)
    motivo_anulacion = Column(Text, nullable=True)
