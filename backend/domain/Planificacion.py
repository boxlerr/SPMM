from sqlalchemy import Column, Integer, String, Date, Boolean, DateTime, UniqueIdentifier, NVARCHAR
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.ext.declarative import declarative_base
import datetime
import uuid

Base = declarative_base()

class Planificacion(Base):
    __tablename__ = "planificacion"

    id = Column(Integer, primary_key=True, autoincrement=True)
    orden_id = Column(Integer, nullable=False)
    proceso_id = Column(Integer, nullable=False)
    id_operario = Column(Integer)
    id_rango_operario = Column(Integer)
    id_maquinaria = Column(Integer)
    sin_maquinaria = Column(Boolean, default=False)
    inicio_min = Column(Integer, nullable=False)
    fin_min = Column(Integer, nullable=False)
    duracion_min = Column(Integer, nullable=False)
    prioridad_peso = Column(Integer, nullable=False)
    fecha_prometida = Column(Date)
    sin_asignar = Column(Boolean, default=False)
    nombre_proceso = Column(NVARCHAR(255))
    rangos_permitidos = Column(NVARCHAR(None))
    creado_en = Column(DateTime, default=datetime.datetime.utcnow)
    id_planificacion_lote = Column(UNIQUEIDENTIFIER, default=uuid.uuid4)
    descripcion_lote = Column(NVARCHAR(255))
