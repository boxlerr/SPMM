from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    text,
)

from backend.infrastructure.db import Base

# La grilla fija de la cañera: columnas A..O × filas 1..9. La pantalla muestra A..L por
# defecto y deja ver M..O (así es el mueble del taller).
COLUMNAS_CANERA = "ABCDEFGHIJKLMNO"
FILAS_CANERA = tuple(range(1, 10))


class CaneraOcupacion(Base):
    """Qué OT ocupa cada casillero de la cañera (el mueble donde se deja el material
    cortado de cada orden), y desde cuándo.

    Una fila = una ocupación: casillero + OT + desde/hasta. Liberar un casillero es
    ponerle `hasta`; NO se borra, así queda el historial de dónde estuvo cada cosa. Una
    OT puede ocupar varios casilleros; un casillero, una sola OT vigente a la vez (índice
    único parcial sobre (columna, fila) con hasta NULL: en SQLite la misma regla la
    declara el índice de abajo, y el servicio la cuida igual para dar un 409 claro).

    `ot_texto` es el número tal cual cuando no es una OT de SPMM (la cañera del viejo
    tiene números que no existen acá, y borrar una OT deja su número escrito acá). Una
    fila siempre dice de qué OT es: por id o por texto.

    `id_orden_trabajo` lleva FK sin CASCADE a propósito: borrar la OT no puede llevarse
    el historial de la cañera. OrdenTrabajoRepository.delete libera sus casilleros,
    copia el número a `ot_texto` y suelta la FK, en la misma transacción.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "canera_ocupacion"
    __table_args__ = (
        CheckConstraint("columna BETWEEN 'A' AND 'O'", name="ck_canera_columna"),
        CheckConstraint("fila BETWEEN 1 AND 9", name="ck_canera_fila"),
        CheckConstraint("hasta IS NULL OR hasta >= desde", name="ck_canera_hasta_despues"),
        CheckConstraint("id_orden_trabajo IS NOT NULL OR ot_texto IS NOT NULL",
                        name="ck_canera_con_ot"),
        CheckConstraint("origen IN ('legacy', 'spmm')", name="ck_canera_origen"),
        Index("ux_canera_celda_vigente", "columna", "fila", unique=True,
              postgresql_where=text("hasta IS NULL"), sqlite_where=text("hasta IS NULL")),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    columna = Column(String(1), nullable=False)
    fila = Column(SmallInteger, nullable=False)
    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=True)
    ot_texto = Column(String(20), nullable=True)
    # Hora local AR sin zona. `hasta` NULL = ocupado ahora.
    desde = Column(DateTime, nullable=False)
    hasta = Column(DateTime, nullable=True)
    asignado_por = Column(String(120), nullable=True)
    liberado_por = Column(String(120), nullable=True)
    origen = Column(String(10), nullable=False, default="spmm", server_default="spmm")

    @property
    def celda(self) -> str:
        """«E4»: la columna y la fila, como se nombra el casillero en el taller."""
        return f"{self.columna}{self.fila}"
