from sqlalchemy import BigInteger, Column, DateTime, Integer, Unicode, UnicodeText

from backend.infrastructure.db import Base


class AuditoriaProcesoOT(Base):
    """Una fila por cada paso que alguien agregó, cambió o sacó de una OT.

    POR QUÉ NO ALCANZABA CON `auditoria_movimiento`

    Aquella tabla guarda el PEDIDO: el método, la dirección y el cuerpo que mandó el
    navegador. Para «¿quién borró la persona?» alcanza, porque el pedido ES el cambio.
    Para los procesos de una OT no: el guardado manda la lista entera, así que un
    cuerpo con 12 pasos no dice cuál se agregó ni cuál se fue — hay que compararlo con
    lo que había, que no está en ningún lado. Y encima ese cuerpo se recorta a los 20
    primeros ítems y a 4000 caracteres, así que en una OT larga directamente no está
    completo. Lo que se guarda acá es el CAMBIO, fila por fila y campo por campo, ya
    comparado contra lo que había.

    Las dos conviven y contestan cosas distintas: allá «qué se intentó» (incluido lo
    que falló), acá «qué quedó». Por eso esta tabla se escribe DENTRO de la misma
    transacción que el cambio: si el guardado se va al rollback, el registro se va con
    él. Un renglón que dice que alguien agregó un paso que no existe sería peor que no
    tener el renglón.

    UNA FILA ACÁ = UNA PASADA TOCADA, NO UN GUARDADO

    Guardar una OT donde se cambiaron tres pasos deja tres filas, no una. Es la única
    forma de poder contestar la pregunta que motivó todo esto: «este proceso está dos
    veces, ¿lo puso alguien o vino así?». `id_otp` es la pasada (la fila de
    orden_trabajo_proceso): si la misma OT tiene TORNO CNC trece veces, cada una tiene
    su propio id y su propia historia.

    Migración: backend/scripts/migrations/2026-09-17_auditoria_proceso_ot.sql
    """

    __tablename__ = "auditoria_proceso_ot"

    # BIGSERIAL en Postgres; en SQLite (tests) INTEGER, el único que numera solo.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)

    # Hora local del taller, sin zona, como TODAS las fechas de esta base. Con
    # segundos: dos pasadas del mismo proceso agregadas en el mismo guardado caen en
    # el mismo minuto, y el orden entre ellas es justamente lo que se viene a mirar.
    creado_en = Column(DateTime, nullable=False, index=True)

    # Quién. NULL = no se registró (un script, una corrida a mano contra la base).
    # Vacío nunca es un autor inventado: la pantalla lo muestra como «el sistema».
    id_usuario = Column(Integer)
    usuario = Column(Unicode(120))

    # Desde dónde se hizo: «Planificador», «Ficha de la orden», «Catálogo de
    # procesos»… Es la diferencia entre un paso que alguien sacó a propósito y uno que
    # se fue de arrastre al borrar un proceso del catálogo.
    origen = Column(Unicode(60))

    id_orden_trabajo = Column(Integer, nullable=False, index=True)

    # La pasada tocada. Queda huérfano a propósito cuando la fila se borra: es el
    # número con el que se sigue el rastro de esa pasada hacia atrás.
    id_otp = Column(BigInteger().with_variant(Integer, "sqlite"))

    id_proceso = Column(Integer)
    # Copia del nombre al momento del cambio. No es redundante: el catálogo se puede
    # borrar (DELETE /procesos/{id}?forzar=true saca el proceso de todas las OT), y
    # justo ese es el caso donde más se necesita saber qué era.
    nombre_proceso = Column(Unicode(200))

    # alta | baja | edicion
    accion = Column(Unicode(10), nullable=False)

    # En qué paso estaba al momento del cambio. Sirve para ubicarlo al leer; no
    # identifica nada (el paso no es único dentro de la OT y se renumera solo).
    paso = Column(Integer)

    # Sólo en las ediciones: [{"campo","antes","despues"}] en JSON, ya con los valores
    # en castellano ("Pendiente", "TORNO T1") y no con ids sueltos.
    cambios = Column(UnicodeText)

    # La frase armada, que es lo único que se lee en la pantalla.
    descripcion = Column(UnicodeText, nullable=False)

    # El rastro técnico, para cuando la frase no alcanza.
    metodo = Column(Unicode(10))
    ruta = Column(Unicode(300))
