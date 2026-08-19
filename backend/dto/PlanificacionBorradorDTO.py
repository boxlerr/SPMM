from typing import Any, Optional

from pydantic import BaseModel


class GuardarBorradorDTO(BaseModel):
    """Lo que manda el autosave de la vista previa.

    `contenido` es opaco: el backend lo guarda y lo devuelve tal cual. Es el estado
    completo de la pantalla —plan, excedentes, diagnósticos y los retoques hechos a
    mano—, y el que decide qué hay adentro es el frontend, que es quien lo dibuja.
    Tiparlo acá sería tener que tocar el backend cada vez que la vista previa
    muestra una columna nueva.
    """

    # Si viene, se pisa ese borrador. Si no, se crea uno.
    id: Optional[int] = None
    contenido: dict[str, Any]
    ordenes_ids: list[int] = []
    cantidad_procesos: int = 0
    fecha_desde: Optional[str] = None
    fecha_hasta: Optional[str] = None
    # False cuando lo pidió el usuario con un botón; True cuando fue el autosave.
    automatico: bool = True
