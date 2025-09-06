from dataclasses import dataclass
from datetime import date,datetime


@dataclass
class OrdenTrabajo:
    id: int
    numero_ot: str
    fecha_entrega: date

    def __init__(self):
        pass

    