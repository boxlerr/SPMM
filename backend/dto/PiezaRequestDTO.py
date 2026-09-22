from pydantic import BaseModel, Field
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


class PiezaStockMinimoDTO(BaseModel):
    """El stock mínimo de una pieza, solo (RF-14).

    DTO aparte y no un campo más de `PiezaRequestDTO` porque aquél exige código y
    descripción: para cambiar el mínimo desde la tabla habría que reenviar la pieza
    entera y, de paso, pisar con lo que tuviera la pantalla datos que son del sistema
    viejo (descripción, stock). Acá viaja sólo lo que se cambia.

    `stock_minimo` es obligatorio pero puede ser null: null QUITA el mínimo (la pieza
    deja de vigilarse). Obligatorio para que un cuerpo vacío por error no se lea como
    «quitalo».
    """
    stock_minimo: Optional[float] = Field(...)
