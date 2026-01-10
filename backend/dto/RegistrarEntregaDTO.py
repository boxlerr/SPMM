from pydantic import BaseModel

class RegistrarEntregaDTO(BaseModel):
    cantidad_agregar: int
