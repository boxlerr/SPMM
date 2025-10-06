from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base

class Maquinaria(Base):
    __tablename__ = "maquinaria"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(100), nullable=False)
    tipo = Column(String(100), nullable=False)
