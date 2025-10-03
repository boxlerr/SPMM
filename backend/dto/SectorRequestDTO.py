from pydantic import BaseModel, Field


class SectorRequestDTO(BaseModel):
    nombre: str = Field(..., max_length=100)


