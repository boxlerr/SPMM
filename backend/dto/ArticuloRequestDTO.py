# app/dto/orden_trabajo_dto.py
from pydantic import BaseModel

class ArticuloRequestDTO(BaseModel):
    id: int
    cod_articulo: str
    descripcion: str
    abreviatura: str
    