"""Lo que entra por la API de la cañera (spec §2.3). Los filtros de Pendientes van por
query string y los declara el endpoint.

El número de OT llega como número o como texto: es el que ve la gente (id_otvieja), y la
cañera del viejo tiene números que no son OT de SPMM («158010», una OT que no existe
acá). El servicio decide: si es una OT de SPMM la ata por id; si no, avisa (409) y con
`forzar` lo anota tal cual en `ot_texto`.
"""
from typing import Union

from pydantic import BaseModel


class AsignarCeldaIn(BaseModel):
    """`POST /materia-prima/canera`: ubicar una OT en un casillero («E4»)."""
    celda: str
    numero_ot: Union[int, str]


class MoverCeldaIn(BaseModel):
    """`PUT /materia-prima/canera/{id}/mover`: el casillero nuevo."""
    celda: str
