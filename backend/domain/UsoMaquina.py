"""Cada vez que una máquina se usó en un paso de una OT (RF-10). Ver
application/UsoMaquinaService.py (las cuentas) e infrastructure/UsoMaquinaRepository.py
(quién escribe las filas).

UNA FILA = UN TRAMO DE USO

Se abre cuando un paso pasa a «En proceso» y se cierra cuando pasa a «Terminado». Un paso
que se termina, se reabre y se vuelve a terminar deja DOS filas: el tiempo en que estuvo
terminado no es uso de la máquina.

LO QUE SE CONGELA

La máquina, la persona, el número de OT y el nombre del proceso se copian al abrir la
fila y no se tocan más: si después se replanifica, se le cambia la máquina al paso o se
renombra el proceso, el registro sigue diciendo lo que pasó. Es un registro, no una
vista del plan.

SIN FK AL PASO NI A LA OT, A PROPÓSITO

El guardado completo de una OT borra y recrea pasos, y borrar una OT no puede fallar por
un registro de uso viejo (mismo criterio que las pausas de RF-03). La única FK es a la
máquina, con ON DELETE CASCADE: borrar la máquina se lleva su historial de uso, y el
borrado lo avisa antes (MaquinariaService.eliminarMaquinaria).

Migración: backend/scripts/migrations/2026-09-23_uso_y_mantenimiento_de_maquinas.sql
"""
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)

from backend.infrastructure.db import Base

# De dónde salió la máquina del paso.
ORIGEN_OT = "OT"      # la eligió alguien a mano en la OT (orden_trabajo_proceso.id_maquinaria)
ORIGEN_PLAN = "PLAN"  # la del último plan que incluyó ese paso (planificacion.id_maquinaria)
ORIGENES = (ORIGEN_OT, ORIGEN_PLAN)

# Por qué una fila NO suma horas (NULL = suma).
NO_SUMA_FUERA_DE_SERVICIO = "FUERA_DE_SERVICIO"  # se arrancó con la máquina fuera de servicio
NO_SUMA_VUELTA_A_PENDIENTE = "VUELTA_A_PENDIENTE"  # el paso volvió a Pendiente: no se hizo
MOTIVOS_NO_SUMA = (NO_SUMA_FUERA_DE_SERVICIO, NO_SUMA_VUELTA_A_PENDIENTE)


class UsoMaquina(Base):
    __tablename__ = "uso_maquina"

    # Integer en SQLite (los tests): sólo autoincrementa un INTEGER PRIMARY KEY.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id", ondelete="CASCADE"), nullable=False)
    origen_maquina = Column(String(10), nullable=False)

    id_orden_trabajo = Column(Integer, nullable=False)
    # El número con el que el taller conoce la OT (id_otvieja), o el interno si no tiene.
    numero_ot = Column(Integer, nullable=True)
    id_otp = Column(BigInteger, nullable=False)
    paso = Column(Integer, nullable=True)
    id_proceso = Column(Integer, nullable=True)
    nombre_proceso = Column(String(200), nullable=True)

    # Quién la usó: la persona elegida a mano en el paso o, si no hay, la del último plan
    # (la misma atribución que los tiempos de RF-06: el sistema no registra quién lo hizo
    # de verdad). `operario` es el nombre congelado; si el plan puso a varias, van todas.
    id_operario = Column(Integer, nullable=True)
    operario = Column(String(200), nullable=True)

    # Hora local del taller, sin zona, como todas las fechas de esta base.
    inicio = Column(DateTime, nullable=False)
    fin = Column(DateTime, nullable=True)
    # Se escriben al cerrar la fila: el reloj (corrido) y lo que cae adentro de la
    # jornada menos las pausas (efectivo). Ver application/TiempoEfectivo.py.
    corrido_min = Column(Integer, nullable=True)
    efectivo_min = Column(Integer, nullable=True)

    no_suma = Column(String(30), nullable=True)

    # Quién apretó «En proceso» y «Terminado» (del token), congelado. NULL = no se
    # registró; nunca un autor inventado.
    id_usuario_inicio = Column(Integer, nullable=True)
    usuario_inicio = Column(String(120), nullable=True)
    id_usuario_fin = Column(Integer, nullable=True)
    usuario_fin = Column(String(120), nullable=True)

    __table_args__ = (
        CheckConstraint("origen_maquina IN ('OT', 'PLAN')", name="ck_uso_origen"),
        CheckConstraint(
            "no_suma IS NULL OR no_suma IN ('FUERA_DE_SERVICIO', 'VUELTA_A_PENDIENTE')",
            name="ck_uso_no_suma",
        ),
        CheckConstraint("fin IS NULL OR fin >= inicio", name="ck_uso_fin_despues"),
        # Lo que pide la pantalla: el uso de UNA máquina en un período.
        Index("ix_uso_maquina_inicio", "id_maquinaria", "inicio"),
        # Un solo tramo abierto por paso: un doble clic en «En proceso» no abre dos.
        Index(
            "ux_uso_maquina_abierto",
            "id_otp",
            unique=True,
            postgresql_where=text("fin IS NULL"),
            sqlite_where=text("fin IS NULL"),
        ),
    )

    def __repr__(self) -> str:
        return f"<UsoMaquina id={self.id} maquina={self.id_maquinaria} otp={self.id_otp}>"
