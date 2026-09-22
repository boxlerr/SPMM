from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
)

from backend.infrastructure.db import Base


class ConsumoMaterial(Base):
    """Una carga de consumo de material contra una orden de trabajo (RF-15).

    El SRS pide «asociar consumo de materiales a cada orden de producción». Lo que la OT
    PIDE ya estaba en `orden_trabajo_pieza`; lo que se CONSUMIÓ de verdad, quién lo
    cargó y cuándo, no estaba en ningún lado. Esto es eso.

    POR QUÉ UNA TABLA PROPIA

    `orden_trabajo_pieza` es del sistema viejo (decisión del 11/09): la escribe el sync
    y la reescribe cada media hora. Su `cantusada`, que parece el lugar natural, el sync
    la llena con `mp.cantstk` —la misma columna del viejo que alimenta el stock—, así
    que un consumo guardado ahí duraría hasta la próxima pasada. Esta tabla la escribe
    SPMM y el sync no la mira.

    UNA FILA = UNA CARGA, NO UN TOTAL

    El taller consume en tandas y a veces se equivoca. Con un solo número no se puede
    ver quién cargó qué, ni deshacer una carga sin tocar las otras. El total de una línea
    es la suma de sus filas no anuladas.

    NO MUEVE EL STOCK

    `pieza.stockactual` lo reescribe el sync con el del viejo, así que descontarlo acá
    sería un número que vuelve solo a los minutos. Pasar el stock a SPMM es decisión del
    cliente. Hasta entonces, esto registra; no descuenta.

    Migración: backend/scripts/migrations/2026-09-22_consumo_material.sql
    """

    __tablename__ = "consumo_material"
    # La base ya no deja entrar un consumo en cero o negativo aunque llegue por otro
    # camino que no sea el servicio (un script, una corrección a mano). Una carga
    # equivocada se anula; no se compensa con un negativo, que sumaría bien y se leería
    # mal («-3 chapas» no es algo que haya pasado en el taller).
    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_consumo_material_cantidad_positiva"),
    )

    # BIGSERIAL en Postgres; en SQLite (tests) INTEGER, el único que numera solo.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)

    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=False)
    # Siempre lleno, aunque haya línea: si la línea desaparece, el consumo tiene que
    # seguir diciendo de qué material era.
    id_pieza = Column(Integer, ForeignKey("pieza.id"), nullable=False)
    # La línea de material de la OT que se consumió. Por PK y NO por el par (OT, pieza):
    # ese par no es único (el sync deduplica en Python porque el viejo lo repite). Sin
    # FK a propósito: la línea es del viejo, y si alguien la borra, lo consumido no se
    # puede ir con ella. NULL = material que no estaba en la lista de la OT.
    id_orden_trabajo_pieza = Column(Integer, nullable=True)

    # NUMERIC(18,3) en la base porque hay materiales por metro y por kilo, y un float
    # sumando 0,1 + 0,2 muestra 0,30000000000000004. Se lee como float (asdecimal=False)
    # para que el JSON salga igual que el `cantidad` de orden_trabajo_pieza.
    cantidad = Column(Numeric(18, 3, asdecimal=False), nullable=False)
    # Copiada de la línea (o de la pieza) al cargar: si mañana el sync le cambia la
    # unidad a la línea, este renglón tiene que seguir diciendo en qué se cargó.
    unidad = Column(String(40), nullable=True)

    # Hora local del taller, sin zona, como TODAS las fechas de esta base. La estampa el
    # servicio: nunca el navegador (el reloj del teléfono no es el del taller).
    fecha = Column(DateTime, nullable=False)
    # Quién, tomado del token. NULL = no se registró (un script); nunca un autor
    # inventado. El nombre queda congelado: si mañana se renombra el usuario, el
    # renglón sigue diciendo quién lo cargó.
    id_usuario = Column(Integer, nullable=True)
    usuario = Column(String(120), nullable=True)
    observaciones = Column(Text, nullable=True)

    # Se anula, no se borra: el renglón equivocado deja de sumar pero sigue a la vista.
    # SMALLINT 0/1 como el resto de las marcas de esta base (no_lleva_materia_prima…).
    anulado = Column(SmallInteger, nullable=False, default=0, server_default="0")
    anulado_en = Column(DateTime, nullable=True)
    anulado_por = Column(String(120), nullable=True)
    motivo_anulacion = Column(Text, nullable=True)
