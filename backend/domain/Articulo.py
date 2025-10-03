from pydantic import BaseModel

class Articulo(BaseModel):
    id: int
    cod_articulo: str
    descripcion: str
    abreviatura: str
    