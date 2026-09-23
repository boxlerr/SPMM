from pydantic import BaseModel


class PausarDTO(BaseModel):
    """Pausar la OT entera (sin `id_otp`) o un paso suelto (con `id_otp`, la pasada de
    orden_trabajo_proceso). El motivo es de la lista cerrada de domain/PausaOrden.py; lo
    valida el servicio para contestar en castellano y no con el 422 de pydantic."""

    motivo: str
    observacion: str | None = None
    id_otp: int | None = None


class ReanudarDTO(BaseModel):
    """Qué se reanuda: la OT entera (sin `id_otp`) o ese paso."""

    id_otp: int | None = None
