from sqlalchemy import Column, Integer, String, Text
from backend.infrastructure.db import Base

class Proceso(Base):
    __tablename__ = "proceso"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nombre = Column(String(255), nullable=True)
    descripcion = Column(Text, nullable=True)
