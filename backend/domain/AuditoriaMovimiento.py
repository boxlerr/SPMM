from sqlalchemy import BigInteger, Column, DateTime, Integer, SmallInteger, Unicode, UnicodeText

from backend.infrastructure.db import Base


class AuditoriaMovimiento(Base):
    """Una fila por cada vez que alguien crea, edita o elimina algo.

    No la escribe ningún servicio: la escribe el middleware de
    `backend/presentation/main.py`, que ve pasar TODAS las llamadas que modifican
    datos. Ahí está el porqué completo; acá va sólo la forma de la fila.

    Migración: backend/scripts/migrations/2026-09-15_auditoria_movimiento.sql
    """

    __tablename__ = "auditoria_movimiento"

    # BIGSERIAL en Postgres; en SQLite (tests) un INTEGER, que es el único tipo que
    # esa base numera sola.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)

    # Hora local del taller, sin zona, como TODAS las fechas de esta base.
    creado_en = Column(DateTime, nullable=False, index=True)

    # Quién. Los dos pueden ser NULL: hay endpoints sin token (el /planificar viejo) y
    # un token sin nombre. Vacío es "no se registró", nunca un autor inventado.
    id_usuario = Column(Integer)
    usuario = Column(Unicode(120))

    # Qué pasó, en castellano: creó / editó / eliminó.
    accion = Column(Unicode(20), nullable=False)
    # Sobre qué: "orden de trabajo", "recurso humano", "proceso"…
    entidad = Column(Unicode(80), nullable=False)
    # Cuál, cuando el número está en la dirección. En un alta todavía no existe.
    id_entidad = Column(Unicode(40))
    # La frase armada, que es lo único que se lee en la pantalla.
    descripcion = Column(UnicodeText, nullable=False)

    # El rastro técnico, para cuando la frase no alcanza.
    metodo = Column(Unicode(10), nullable=False)
    ruta = Column(Unicode(300), nullable=False)
    # El código HTTP: 200 salió bien, 4xx/5xx no se pudo. Los intentos fallidos se
    # guardan igual — son los que más se preguntan.
    estado = Column(SmallInteger)
    duracion_ms = Column(Integer)
    # Los datos que se mandaron, en JSON, sin contraseñas y sin archivos.
    detalle = Column(UnicodeText)
