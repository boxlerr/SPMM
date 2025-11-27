from typing import Optional
from pydantic import BaseModel, Field,field_validator
from typing import Optional
from pydantic import BaseModel, Field,field_validator

class ProcesoRequestDTO(BaseModel):
    nombre: Optional[str] = Field(default=None, max_length=255)
    descripcion: Optional[str] = None


    @field_validator("nombre")
    def nombre_minimo(cls, value):
        if value and len(value) < 3:
            raise ValueError("El nombre debe tener al menos 3 caracteres")
        return value

    @field_validator("descripcion")
    def validar_descripcion(cls, value):
        if value and len(value) > 255:
            raise ValueError("La descripcion no puede exceder los 255 caracteres")
        return value
        #Adaptar funciones field validator segun nuestra logica