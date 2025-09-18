from dataclasses import dataclass
from datetime import datetime

""" 
@dataclass
class OrdenTrabajo:
    def __init__(self, id_ot: int, descripcion: str, fecha: datetime, id_operario: int, id_maquinaria: int):
        self.id_ot = id_ot
        self.descripcion = descripcion
        self.fecha = fecha
        self.id_operario = id_operario
        self.id_maquinaria = id_maquinaria """

from sqlalchemy import Column, Integer, String, DateTime
from backend.infrastructure.db import Base
from datetime import datetime

class OrdenTrabajo(Base):
    __tablename__ = "ordenes_trabajo"

    id_ot = Column(Integer, primary_key=True, index=True)
    descripcion = Column(String(255), nullable=False)
    fecha = Column(DateTime, default=datetime.now)
    id_operario = Column(Integer, nullable=False)
    id_maquinaria = Column(Integer, nullable=False)
    
    ##no iria una func??
