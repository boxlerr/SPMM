"""
Lo que entra por la administración de permisos (RF-24, PermisosAPI).

Los códigos (rol, área, sección) viajan en la dirección y se validan en el endpoint
contra el catálogo y la base; acá sólo va el cuerpo.
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, BaseModel, Field, field_validator

from backend.core.permisos import LARGO_PANTALLA_DE_INICIO, validar_pantalla_de_inicio
from backend.dto.UsuarioRequestDTO import _normalizar_rol

# Hora del taller. Las fechas de la base son hora local sin zona (ver fechas.py).
_AR = timezone(timedelta(hours=-3))


def _vencimiento_local(v):
    """Un vencimiento con zona (la Z de toISOString) -> el mismo instante en hora del
    taller, sin zona, que es como se compara (ahora_ar) y como se guarda.

    No es fechas.sin_zona a propósito: esa pasa a UTC porque sus fechas son DÍAS (un
    <input type="date"> llega como medianoche UTC y así no se corre el día). Un
    vencimiento es un INSTANTE que se compara contra la hora del taller: pasado a UTC
    vencería tres horas antes de lo que se eligió."""
    if isinstance(v, datetime) and v.tzinfo is not None:
        return v.astimezone(_AR).replace(tzinfo=None)
    return v


Vencimiento = Annotated[datetime, AfterValidator(_vencimiento_local)]


class NivelDeRolEnAreaDTO(BaseModel):
    """PUT /permisos/roles/{rol}/areas/{area}"""
    nivel: Literal["none", "read", "write", "admin"]


class NivelDeRolEnSeccionDTO(BaseModel):
    """PUT /permisos/roles/{rol}/secciones/{seccion}

    «hereda» saca el override: la sección vuelve a seguir el nivel del área (o, si es
    confidencial, vuelve a quedar cerrada para ese rol)."""
    nivel: Literal["hereda", "none", "read", "write", "admin"]


class ConfidencialDTO(BaseModel):
    """PUT /permisos/secciones/{seccion}/confidencial"""
    confidencial: bool


class PermisoDePersonaDTO(BaseModel):
    """PUT /permisos/usuarios/{id}/areas/{area} y .../secciones/{seccion}

    Un permiso de más para UNA persona: sólo suma sobre lo que le da su rol. Sin
    `vence_en` es permanente; con él, deja de contar solo cuando llega esa hora."""
    nivel: str
    vence_en: Optional[Vencimiento] = None
    motivo: Optional[str] = Field(None, max_length=500)

    @field_validator("nivel")
    @classmethod
    def _nivel(cls, v):
        v = (v or "").strip().lower()
        if v == "none":
            raise ValueError(
                "Un permiso de más tiene que dar algo: para sacarlo, usá «quitar»."
            )
        if v not in ("read", "write", "admin"):
            raise ValueError("Nivel inválido: tiene que ser read, write o admin.")
        return v

    @field_validator("motivo")
    @classmethod
    def _motivo(cls, v):
        v = (v or "").strip()
        return v or None


class CambiarRolDTO(BaseModel):
    """PUT /permisos/usuarios/{id}/rol"""
    rol: str

    @field_validator("rol")
    @classmethod
    def _rol(cls, v):
        return _normalizar_rol(v)


class PantallaInicioDTO(BaseModel):
    """PUT /permisos/usuarios/{id}/pantalla-inicio y /permisos/roles/{rol}/pantalla-inicio

    RF-28. La pantalla a la que entra después del login: una del menú ('/operaciones'), o
    null —para una persona, «como su rol»; para un rol, «la de siempre»—. Va obligatoria
    (aunque sea null): un cuerpo vacío no puede borrar nada por descuido."""
    pantalla_inicio: Optional[str] = Field(..., max_length=LARGO_PANTALLA_DE_INICIO)

    @field_validator("pantalla_inicio")
    @classmethod
    def _pantalla(cls, v):
        return validar_pantalla_de_inicio(v)
