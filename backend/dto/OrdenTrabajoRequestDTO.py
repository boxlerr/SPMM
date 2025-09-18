# app/dto/orden_trabajo_dto.py
from pydantic import BaseModel

class OrdenTrabajoRequestDTO(BaseModel):
    id_ot: int
    descripcion: str
    id_operario: int
    id_maquinaria: int
