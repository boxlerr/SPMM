from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)
from backend.infrastructure.db import Base


class OrdenTrabajoPieza(Base):
    """Una línea de materia prima de una OT: qué insumo lleva, cuánto, y en qué está
    la compra (pedido / reservado de stock / disponible).

    Hasta el 23/09/2026 la escribía el sync con lo del sistema viejo, y el sync
    INVENTABA las marcas (pedido = cantidad > 0, disponible = 1): SPMM mostraba material
    «ok» en OT que en el viejo estaban sin pedir. Desde la reunión del 23/09 la carga
    pasa a SPMM (solapa Materias primas de la OT, pantalla Pendientes) y el sync deja de
    escribirla. Las columnas nuevas son las del viejo que faltaban (otrabajoMprimas).

    Conserva sus ids: consumo_material apunta a la línea por id. El par (OT, pieza) NO
    es único: el viejo lo repite legítimamente (el mismo insumo en dos tandas).

    `cantusada` queda sin uso: lo consumido es la suma de consumo_material no anulado
    de la línea.

    Migración: backend/scripts/migrations/2026-09-23_materia_prima.sql
    """

    __tablename__ = "orden_trabajo_pieza"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=False)
    id_pieza = Column(Integer, ForeignKey("pieza.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    unidad = Column(String, nullable=True)
    pedido = Column(Integer, nullable=True) # 1 or 0
    disponible = Column(Integer, nullable=True) # 1 or 0
    cantusada = Column(Float, nullable=True)

    # ── Materia prima en SPMM (23/09/2026) ──

    # La descripción CONGELADA al cargar (copia de pieza.descripcion). Editable sólo si
    # la pieza no es tipo 'insumo' (un consumible «a medida» se describe en la OT).
    # NULL = se muestra la de la pieza.
    descripcion = Column(String(255), nullable=True)
    # Orden de carga dentro de la OT (el viejo las muestra en el orden en que se
    # cargaron). NULL en las filas anteriores: se ordena por id.
    orden = Column(SmallInteger, nullable=True)
    # El proveedor de ESTA compra: texto (lo que dijo el viejo, o uno que no está en la
    # lista) y el de la lista cuando se eligió uno.
    proveedor = Column(String(200), nullable=True)
    id_proveedor = Column(Integer, ForeignKey("proveedor.id"), nullable=True)
    observaciones = Column(Text, nullable=True)
    # «Utilizado» del viejo. 0 = la línea no se usa (o está a confirmar): no entra en
    # Pendientes ni en el estado del material de la OT. Default 1: las líneas que ya
    # estaban cuentan, como contaban hasta hoy.
    usado = Column(SmallInteger, nullable=False, default=1, server_default="1")
    # Reservada del stock propio: `cantidad_reservada` sale del libre de la pieza hasta
    # que se marca disponible (ahí se genera el egreso `retiro_ot`).
    reserva = Column(SmallInteger, nullable=False, default=0, server_default="0")
    cantidad_reservada = Column(Numeric(18, 3, asdecimal=False), nullable=True)
    # «PRODUC» del viejo: marca MANUAL de material en fabricación o tercerizado. La API
    # además avisa si la OT ya arrancó (ot_en_curso), que se muestra aparte.
    en_produccion = Column(SmallInteger, nullable=False, default=0, server_default="0")
    # «Fecha prov.»: la que prometió el proveedor. «F. entrega»: cuándo llegó o quedó
    # disponible. Días sin hora ni zona.
    fecha_proveedor = Column(Date, nullable=True)
    fecha_entrega = Column(Date, nullable=True)
    # Quién marcó pedido / disponible y cuándo (hora local AR sin zona; nombre del
    # token, congelado). Se limpian al desmarcar.
    pedido_en = Column(DateTime, nullable=True)
    pedido_por = Column(String(120), nullable=True)
    disponible_en = Column(DateTime, nullable=True)
    disponible_por = Column(String(120), nullable=True)
    # El egreso de stock (pieza_movimiento, tipo retiro_ot) que generó marcar
    # disponible una línea reservada. Desmarcar Disponible lo anula. Sin FK: los
    # movimientos no se borran nunca, y la línea puede irse sin llevárselo.
    id_movimiento_retiro = Column(BigInteger().with_variant(Integer, "sqlite"), nullable=True)
    # 'legacy' (importada del viejo) | 'spmm' (cargada acá) | 'historial' (copiada de
    # otra OT con «Traer historial»). NULL = anterior a la importación.
    origen = Column(String(12), nullable=True)
    creado_en = Column(DateTime, nullable=True)
    creado_por = Column(String(120), nullable=True)
    modificado_en = Column(DateTime, nullable=True)
    modificado_por = Column(String(120), nullable=True)

    __table_args__ = (
        CheckConstraint("origen IN ('legacy', 'spmm', 'historial')", name="ck_otp_origen"),
        CheckConstraint("cantidad_reservada > 0", name="ck_otp_cantidad_reservada"),
        # Las líneas de UNA OT (la solapa, el estado del material, Pendientes) y las de
        # UN insumo (su reserva, «en qué OT se usó»). Ninguna existía.
        Index("ix_otp_ot", "id_orden_trabajo"),
        Index("ix_otp_pieza", "id_pieza"),
    )
