from pydantic import BaseModel, Field


class ClienteRequestDTO(BaseModel):
    nombre: str = Field(..., max_length=100)
