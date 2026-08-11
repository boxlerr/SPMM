from pydantic import BaseModel, Field


class RangoProcesosDTO(BaseModel):
    """Conjunto completo de procesos que habilita un rango. Reemplaza, no agrega."""

    procesos: list[int] = Field(default_factory=list)


class RangoMaquinariasDTO(BaseModel):
    """Conjunto completo de maquinarias de un rango. Reemplaza, no agrega."""

    maquinarias: list[int] = Field(default_factory=list)
