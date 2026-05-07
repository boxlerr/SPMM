from sqlalchemy import Column, Integer, String, Date, Boolean, Time
from backend.infrastructure.db import Base
from sqlalchemy.orm import relationship
import typing

if typing.TYPE_CHECKING:
    from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill


class Operario(Base):
    """
    Modelo SQLAlchemy para la tabla `operario`.

    Nota: `sector` se modela como texto por ahora (simple). Más adelante
    puede pasar a ser una FK a `sector.id` sin cambiar el flujo general.
    """

    __tablename__ = "operario"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False)
    fecha_nacimiento = Column(Date, nullable=True)
    fecha_ingreso = Column(Date, nullable=True)
    sector = Column(String(100), nullable=True)  # texto simple por ahora
    categoria = Column(String(100), nullable=False)
    disponible = Column(Boolean, nullable=False, default=True)
    telefono = Column(String(50), nullable=True)
    celular = Column(String(50), nullable=True)
    dni = Column(String(20), nullable=True)
    email = Column(String(100), nullable=True)
    hora_inicio = Column(Time, nullable=False, default="07:00:00")
    hora_fin = Column(Time, nullable=False, default="16:00:00")
    # Días laborables del operario. Formato CSV con códigos en inglés:
    # MON,TUE,WED,THU,FRI,SAT,SUN. Default L-V.
    dias_trabajo = Column(String(50), nullable=False, default="MON,TUE,WED,THU,FRI")
    min_desayuno = Column(Integer, nullable=False, default=15)
    min_almuerzo = Column(Integer, nullable=False, default=30)

    rangos = relationship("OperarioRango", back_populates="operario")
    procesos_skill = relationship("OperarioProcesoSkill", back_populates="operario", cascade="all, delete-orphan")
