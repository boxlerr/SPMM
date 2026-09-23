from pydantic import BaseModel


class CargarAusenciaDTO(BaseModel):
    """Una ausencia de un día (sin `hasta`) o de un período, las dos puntas incluidas.

    Las fechas van como texto AAAA-MM-DD y el motivo como código de la lista cerrada de
    domain/AusenciaOperario.py; los valida el servicio, para contestar en castellano y
    no con el 422 de pydantic.
    """

    desde: str
    hasta: str | None = None
    motivo: str | None = None
    observacion: str | None = None


class CorregirAusenciaDTO(BaseModel):
    """Lo que se corrige de una ausencia. Sólo cambia lo que viene: mandar
    `"motivo": null` lo saca; no mandarlo lo deja como estaba."""

    desde: str | None = None
    hasta: str | None = None
    motivo: str | None = None
    observacion: str | None = None
