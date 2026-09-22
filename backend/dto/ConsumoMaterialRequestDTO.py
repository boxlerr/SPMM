from typing import Optional

from pydantic import BaseModel


class ConsumoMaterialRequestDTO(BaseModel):
    """Registrar una carga de consumo de material contra una OT (RF-15).

    Lo normal es mandar la LÍNEA (`id_orden_trabajo_pieza`): de ahí salen la pieza y la
    unidad, y no hay forma de cargar el consumo en una unidad distinta de la pedida.
    `id_pieza` suelto queda para un material que no estaba en la lista de la OT.

    No hay campo de fecha ni de usuario a propósito: los pone el servidor (hora del
    taller y usuario del token). Si los mandara el navegador, el registro diría lo que
    el navegador quisiera.
    """
    id_orden_trabajo: int
    id_orden_trabajo_pieza: Optional[int] = None
    id_pieza: Optional[int] = None
    cantidad: float
    # Si viene, tiene que coincidir con la de la línea. Sumar kilos con unidades en el
    # mismo total no dice nada.
    unidad: Optional[str] = None
    observaciones: Optional[str] = None


class AnularConsumoDTO(BaseModel):
    """Anular una carga: deja de sumar, pero el renglón queda a la vista."""
    motivo: Optional[str] = None
