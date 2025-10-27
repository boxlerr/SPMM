from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base


class Maquinaria(Base):
    """
    Modelo SQLAlchemy para la tabla `maquinaria` en SQL Server.

    Columns:
      - id (PK, int, not null)
      - nombre (varchar(100), not null)
      - cod_maquina (nvarchar(50), null)
      - limitacion (nvarchar(255), null)
      - capacidad (nvarchar(255), null)
      - especialidad (nvarchar(255), null)
    """
    __tablename__ = "maquinaria"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nombre = Column(String(100), nullable=False)
    cod_maquina = Column(String(50), nullable=True)
    limitacion = Column(String(255), nullable=True)
    capacidad = Column(String(255), nullable=True)
    especialidad = Column(String(255), nullable=True)

    def __repr__(self) -> str:
        return f"<Maquinaria id={self.id} nombre={self.nombre!r}>"

