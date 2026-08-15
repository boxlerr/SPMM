from pydantic import BaseModel, Field


class RangoProcesosDTO(BaseModel):
    """Conjunto completo de procesos que habilita un rango. Reemplaza, no agrega."""

    procesos: list[int] = Field(default_factory=list)


class RangoMaquinariasDTO(BaseModel):
    """Conjunto completo de maquinarias de un rango. Reemplaza, no agrega."""

    maquinarias: list[int] = Field(default_factory=list)


class RangoIdsDTO(BaseModel):
    """Conjunto completo de rangos que habilitan una máquina o un proceso.

    Es el mismo vínculo visto desde el otro lado: se edita desde donde se descubre el
    hueco. Reemplaza, no agrega, igual que los de arriba.
    """

    rangos: list[int] = Field(default_factory=list)
