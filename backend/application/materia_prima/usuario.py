"""Quién es el usuario del token, para estampar «quién» en lo que se guarda.

Es el mismo `nombre_de` que usan los consumos, las pausas y las ausencias
(IncidenciaProcesoService.nombre_de): (id_usuario, «Nombre Apellido») o (None, None) si
no hay token. Se reexporta acá para que la sección tenga un solo lugar de dónde sacarlo
y no aparezca una tercera versión (ya hay otra en AuditoriaRepository, que devuelve
sólo el nombre).

Sin usuario, nadie: nunca un autor inventado.
"""
from backend.application.IncidenciaProcesoService import nombre_de

__all__ = ["nombre_de", "nombre_solo"]


def nombre_solo(usuario: dict | None) -> str | None:
    """Sólo el nombre (para las columnas *_por, que no guardan el id)."""
    return nombre_de(usuario)[1]
