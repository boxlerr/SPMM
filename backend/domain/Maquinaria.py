from sqlalchemy import Column, Integer, String
from backend.infrastructure.db import Base
from sqlalchemy.orm import relationship


class Maquinaria(Base):
    """
    Modelo SQLAlchemy para la tabla `maquinaria` (hoy en Supabase; nació en SQL Server).

    Columns:
      - id (PK, int, not null)
      - nombre (varchar(100), not null)
      - cod_maquina (nvarchar(50), null)
      - limitacion (nvarchar(255), null)
      - capacidad (nvarchar(255), null)
      - especialidad (nvarchar(255), null)
      - tipo (varchar(40), null)                         — RF-08, desde el 22/09/2026
      - estado_operativo (varchar(20), not null, 'operativa') — RF-08
      - frecuencia_mantenimiento_dias (int, null)        — RF-08

    Los tres últimos requieren
    backend/scripts/migrations/2026-09-22_maquina_tipo_estado_mantenimiento.sql (se
    aplica solo al arrancar, ver infrastructure/migraciones.py).
    """
    __tablename__ = "maquinaria"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nombre = Column(String(100), nullable=False)
    cod_maquina = Column(String(50), nullable=True)
    limitacion = Column(String(255), nullable=True)
    capacidad = Column(String(255), nullable=True)
    especialidad = Column(String(255), nullable=True)

    # Los tres datos que pide el RF-08 del SRS y que la tabla no tenía.
    #
    # Qué clase de máquina es. Lista CERRADA (MaquinariaService.TIPOS_MAQUINA) y no
    # texto libre: el texto libre se llena de variantes de la misma palabra, como ya le
    # pasó al catálogo de procesos. Los valores son las familias del planificador.
    # NULL = no se cargó; nunca se deduce del nombre (sería inventar un dato del taller).
    tipo = Column(String(40), nullable=True)
    # operativa | en_mantenimiento | fuera_de_servicio (MaquinariaService.ESTADOS_OPERATIVOS).
    # Arranca en 'operativa' porque las máquinas ya cargadas se están usando todos los
    # días: es una suposición, dicha en la migración. `server_default` además del
    # `default` para que una fila que entre por SQL crudo quede igual que en Postgres,
    # donde el DEFAULT lo pone la migración.
    # OJO: por ahora es INFORMATIVO. El planificador no lo mira, así que una máquina
    # fuera de servicio se sigue ofreciendo; sacarla del plan se decide aparte.
    estado_operativo = Column(
        String(20), nullable=False, default="operativa", server_default="operativa"
    )
    # Cada cuántos días le toca mantenimiento. NULL = no se le lleva frecuencia, que no
    # es lo mismo que 0.
    frecuencia_mantenimiento_dias = Column(Integer, nullable=True)

    rango_maquinarias = relationship(
        "RangoMaquinaria",
        back_populates="maquinaria",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # Qué procesos se hacen en esta máquina (el lado espejo de proceso.maquinarias).
    procesos = relationship(
        "ProcesoMaquinaria",
        back_populates="maquinaria",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    def __repr__(self) -> str:
        return f"<Maquinaria id={self.id} nombre={self.nombre!r}>"
      
      
  

