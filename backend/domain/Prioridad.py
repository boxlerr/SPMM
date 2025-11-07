from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base
from sqlalchemy.orm import relationship

class Prioridad(Base):
    __tablename__ = "prioridad"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    descripcion = Column(String(100), nullable=False)
    detalle = Column(String(255), nullable=True)

    # 🔹 Relación inversa
    ordenes_trabajo = relationship("OrdenTrabajo", back_populates="prioridad")