from pydantic import BaseModel
from typing import Optional

class PiezaRequestDTO(BaseModel):
    cod_pieza: str
    descripcion: str
    unitario: Optional[float] = None
    unidad: Optional[str] = None
    stockactual: Optional[float] = None
    observaciones: Optional[str] = None
    proveedor: Optional[str] = None
    material: Optional[str] = None
    formato: Optional[str] = None
    estante: Optional[str] = None
    letra: Optional[str] = None
    nro: Optional[str] = None
    id_otvieja: Optional[int] = None
