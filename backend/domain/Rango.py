# backend/domain/models/Rango.py
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from backend.infrastructure.db import Base

class Rango(Base):
    __tablename__ = "rango"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(100), nullable=False)

    # 🔹 Relación inversa
    #
    # `procesos` lleva cascade porque rango_proceso es composición del rango: sin él,
    # borrar un rango con procesos asignados falla con "tried to blank-out primary key
    # column 'rango_proceso.id_rango'" —SQLAlchemy intenta anular la FK del hijo, que
    # acá es parte de la PK. Mismo criterio que rango_maquinarias, que ya lo tenía.
    #
    # `operarios_rango` NO lleva cascade a propósito: que borrar un rango le saque la
    # categoría a la gente en silencio sería peor que no poder borrarlo. El service
    # frena la primera pasada y devuelve a quiénes alcanza y qué pierden; recién
    # cuando el usuario lo confirma, el repositorio baja esas filas a mano y en la
    # misma transacción que el borrado.
    procesos = relationship(
        "RangoProceso",
        back_populates="rango",
        cascade="all, delete-orphan",
    )
    operarios_rango = relationship("OperarioRango", back_populates="rango")
    
    rango_maquinarias = relationship(
        "RangoMaquinaria",
        back_populates="rango",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
from backend.domain.RangoMaquinaria import RangoMaquinaria
