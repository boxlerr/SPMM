from pydantic import BaseModel, Field


class RangoRequestDTO(BaseModel):
    nombre: str = Field(..., max_length=100)
