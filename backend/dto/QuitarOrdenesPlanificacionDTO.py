from pydantic import BaseModel
from typing import List, Optional


class QuitarOrdenesPlanificacionDTO(BaseModel):
    """Sacar OTs de la planificación (planificadas por error / que ya no van).

    Si `id_lote` viene, se borran solo los registros de ese lote; si no,
    la OT se saca de TODAS las planificaciones donde aparezca.
    """
    orden_ids: List[int]
    id_lote: Optional[str] = None
