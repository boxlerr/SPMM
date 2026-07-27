from sqlalchemy import Column, Integer, Date, Boolean, DateTime, Unicode, UnicodeText, Uuid
from backend.infrastructure.db import Base
import datetime
import uuid

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
    # Tipos portables (SQL Server ↔ Postgres/Supabase). Antes eran NVARCHAR/UNIQUEIDENTIFIER
    # del dialecto mssql, que no existen en Postgres:
    #   Unicode/UnicodeText -> NVARCHAR/NTEXT en MSSQL, VARCHAR/TEXT en PG.
    #   Uuid(as_uuid=False) -> UNIQUEIDENTIFIER en MSSQL, uuid nativo en PG, y sigue
    #   devolviendo str (el código guarda str(uuid.uuid4()), ver PlanificacionRepository).
    nombre_proceso = Column(Unicode(255))
    rangos_permitidos = Column(UnicodeText)
    creado_en = Column(DateTime, default=datetime.datetime.utcnow)
    id_planificacion_lote = Column(Uuid(as_uuid=False), default=lambda: str(uuid.uuid4()))
    descripcion_lote = Column(Unicode(255))
    forzado_fuera_rango = Column(Boolean, default=False)
