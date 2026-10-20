"""Los permisos de quien pide se leen UNA vez por pedido (20/10/2026).

`require_politica` llama a `resolver_permisos_actuales` directo, y las rutas que además
piden `get_permisos_actuales` (o /notificaciones, que la vuelve a llamar) leían las tablas
de permisos dos veces en el mismo pedido. Lo resuelto queda en el UsuarioActual del pedido;
el pedido siguiente trae otro y vuelve a leer: un permiso que cambia vale desde ahí.
"""
from contextlib import asynccontextmanager

from backend.core import security
from backend.core.permisos import DatosDePermisos
from backend.core.security import UsuarioActual, resolver_permisos_actuales


async def test_se_leen_una_vez_por_pedido_y_de_nuevo_en_el_siguiente(monkeypatch):
    lecturas = []

    async def datos_de_permisos(self, rol, id_usuario):
        lecturas.append((rol, id_usuario))
        return DatosDePermisos(rol=rol, rol_areas={"ordenes": "read"})

    monkeypatch.setattr(
        "backend.infrastructure.PermisosRepository.PermisosRepository.datos_de_permisos",
        datos_de_permisos)

    @asynccontextmanager
    async def sesiones():
        yield None

    pedido = UsuarioActual(id_usuario=7, username="taller", rol="operario")
    a = await resolver_permisos_actuales(pedido, sesiones)
    b = await resolver_permisos_actuales(pedido, sesiones)
    assert a is b and lecturas == [("operario", 7)]

    siguiente = UsuarioActual(id_usuario=7, username="taller", rol="operario")
    assert siguiente == pedido  # mismo usuario...
    await resolver_permisos_actuales(siguiente, sesiones)
    assert len(lecturas) == 2   # ...pero otro pedido: se vuelve a leer la base


async def test_lo_guardado_no_cambia_la_igualdad_ni_el_hash():
    @asynccontextmanager
    async def sesiones():
        yield None

    u = UsuarioActual(id_usuario=1, username="admin", rol=security.ROL_ADMIN)
    antes = hash(u)
    await resolver_permisos_actuales(u, sesiones)
    assert hash(u) == antes
    assert u == UsuarioActual(id_usuario=1, username="admin", rol=security.ROL_ADMIN)
