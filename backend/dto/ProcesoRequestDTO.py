from typing import Optional
from pydantic import BaseModel, Field,field_validator

class ProcesoRequestDTO(BaseModel):
    nombre: Optional[str] = Field(default=None, max_length=255)
    descripcion: Optional[str] = None


    @field_validator("nombre")
    def nombre_minimo(cls, value):
        if len(value) > 10:
            raise ValueError("El nombre debe tener menos de 10 caracteres")
        return value

    @field_validator("descripcion")
    def validar_descripcion(cls, value):
        if len(value) > 10:
            raise ValueError("La descripcion debe tener menos de 10 caracteres")
        return value
        #Adaptar funciones field validator segun nuestra logica
        