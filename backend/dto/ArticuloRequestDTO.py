# app/dto/orden_trabajo_dto.py
from pydantic import BaseModel

class ArticuloRequestDTO(BaseModel):
    cod_articulo: str
    descripcion: str
    abreviatura: str