from sqlalchemy import BigInteger, Column, Integer, ForeignKey, Index, String, DateTime
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class OrdenTrabajoProceso(Base):
    """
    Una PASADA de un proceso dentro de una OT.

    Ojo: una fila NO es "el proceso X de la OT Y", es "esta pasada del proceso X en la
    OT Y". El mismo proceso puede ir varias veces en la misma orden — el legacy carga
    una fila por pasada y así se trabaja en el taller (la OT 7497 tiene TORNO CNC 13
    veces, intercalado con los demás). Hasta el 28/08/2026 la PK era
    (id_orden_trabajo, id_proceso), o sea que la segunda pasada no entraba: se perdía
    al migrar o se sumaba dentro de la primera.

    Requiere la migración backend/scripts/migrations/2026-08-28_proceso_repetido_en_ot.sql
    corrida ANTES de desplegar (si la columna `id` no existe, el ORM rompe al leer).
    """

    __tablename__ = "orden_trabajo_proceso"

    # Identidad propia de la pasada. Es la que hay que usar para direccionar una línea
    # (endpoints, planificación); (id_orden_trabajo, id_proceso) ya NO alcanza.
    # El variant a Integer es para SQLite (los tests): sólo autoincrementa un
    # INTEGER PRIMARY KEY, un BIGINT le queda NOT NULL sin valor. En Postgres sigue
    # siendo bigint, como lo crea la migración.
    id = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )

    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"))
    id_proceso = Column(Integer, ForeignKey("proceso.id"))

    # Paso dentro de la OT. NO es único: hoy hay 531 filas que comparten paso con otra
    # de la misma OT (dato del cliente, no se renumera). Sirve para ordenar, no para
    # identificar.
    orden = Column(Integer, nullable=False)
    tiempo_proceso = Column(Integer, nullable=True)
    id_estado = Column(Integer, ForeignKey("estado_proceso.id"), default=1)
    observaciones = Column(String, nullable=True)

    # Cantidad de operarios que el proceso requiere en simultáneo (default 1).
    # La columna ya existe en la base (cant_operarios, NOT NULL default 1).
    cant_operarios = Column(Integer, nullable=False, default=1)

    # Máquina PRESELECCIONADA para este proceso (pedido reunión Metlo 2-jul-2026).
    #   - NULL  = sin preselección: el planificador elige la máquina.
    #   - <id>  = preselección: se fuerza ese proceso a esa máquina.
    # Requiere la migración backend/scripts/migrations/2026-07-05_maquina_en_proceso.sql
    # corrida ANTES de desplegar (si la columna no existe, el ORM rompe al leer procesos).
    # El sync (sync_db.py) NO la pisa (no está en su MERGE), igual que cant_operarios.
    id_maquinaria = Column(Integer, ForeignKey("maquinaria.id"), nullable=True)

    # Persona PRESELECCIONADA para este proceso (pedido de Lucas, 26-ago-2026: "en
    # orden, al crear trabajo, falta persona en proceso"). Mismo contrato que la
    # máquina de arriba:
    #   - NULL  = sin preselección: el planificador elige la persona.
    #   - <id>  = preselección: se fuerza ese proceso a esa persona.
    # Requiere la migración backend/scripts/migrations/2026-08-26_operario_en_proceso.sql
    # corrida ANTES de desplegar. El sync (sync_db.py) no la pisa.
    id_operario = Column(Integer, ForeignKey("operario.id"), nullable=True)

    # New fields for real time tracking
    inicio_real = Column(DateTime, nullable=True)
    fin_real = Column(DateTime, nullable=True)

    __table_args__ = (
        # La PK vieja también hacía de índice para "los procesos de esta OT". Al pasar
        # la PK a `id` hay que reponerlo a mano.
        Index("ix_otp_orden_trabajo", "id_orden_trabajo"),
        Index("ix_otp_orden_proceso", "id_orden_trabajo", "id_proceso"),
    )

    # 🔹 Relaciones
    orden_trabajo = relationship("OrdenTrabajo", back_populates="procesos")
    proceso = relationship("Proceso", back_populates="ordenes_trabajo_proceso")
    estado_proceso = relationship("EstadoProceso", back_populates="ordenes_trabajo_proceso")

