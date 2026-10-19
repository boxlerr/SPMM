"""
Los proveedores del paso tercerizado se escriben, se editan y se eliminan desde la lista
(19/10/2026, Julián: «el proveedor, que se pueda escribir, editar y eliminar en la lista al
elegirlo»). Son los de materias primas, que trae el espejo del Integral; Julián eligió que
SPMM mande en los que se tocan desde esa lista: el espejo no los vuelve a pisar.
"""
from datetime import datetime
from types import SimpleNamespace

import pytest

import backend.scripts.importar_materia_prima_legacy as I
from backend.application.MateriaPrimaCatalogoService import MateriaPrimaCatalogoService
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.domain.Proveedor import Proveedor
from backend.dto.MateriaPrimaCatalogoDTO import ProveedorCambiosIn


async def _proveedores(session):
    session.add_all([
        Proveedor(id=1, id_legacy=None, razon_social="VULCANIZADORA DE PRUEBA SRL", inactivo=0),
        Proveedor(id=2, id_legacy=55, razon_social="GOMA", cuit="- -", inactivo=0),
        Proveedor(id=3, id_legacy=56, razon_social="RAS ARTICULOS DE GOMA SRL", inactivo=0),
    ])
    await session.commit()


@pytest.mark.asyncio
async def test_editar_un_proveedor_del_integral_lo_deja_de_pisar_el_espejo(session):
    await _proveedores(session)
    r = await MateriaPrimaCatalogoService(session).editar_proveedor(
        2, ProveedorCambiosIn(razon_social="GOMERIA DEL SUR SRL", cuit=""))
    assert r.data["razon_social"] == "GOMERIA DEL SUR SRL"
    p = await session.get(Proveedor, 2)
    await session.refresh(p)
    assert p.cuit is None
    assert p.editado_en_spmm is not None, "vino del Integral: desde ahora manda SPMM"


@pytest.mark.asyncio
async def test_cambiar_solo_los_dias_no_lo_saca_del_espejo(session):
    """Los días no los trae el espejo: cambiarlos no hace falta que lo marque."""
    await _proveedores(session)
    await MateriaPrimaCatalogoService(session).editar_proveedor(3, ProveedorCambiosIn(demora_dias=10))
    p = await session.get(Proveedor, 3)
    await session.refresh(p)
    assert p.demora_dias == 10 and p.editado_en_spmm is None


@pytest.mark.asyncio
async def test_un_nombre_que_ya_es_de_otro_pide_confirmar(session):
    await _proveedores(session)
    servicio = MateriaPrimaCatalogoService(session)
    with pytest.raises(ConfirmacionRequeridaException):
        await servicio.editar_proveedor(2, ProveedorCambiosIn(razon_social="Ras artículos de goma S.R.L."))
    r = await servicio.editar_proveedor(
        2, ProveedorCambiosIn(razon_social="Ras artículos de goma S.R.L."), forzar=True)
    assert r.status is True
    # Guardarse con el mismo nombre que ya tiene no es un duplicado de sí mismo.
    r = await servicio.editar_proveedor(3, ProveedorCambiosIn(razon_social="RAS ARTICULOS DE GOMA SRL"))
    assert r.status is True


@pytest.mark.asyncio
async def test_eliminar_uno_de_spmm_que_nunca_se_uso_lo_borra(session):
    await _proveedores(session)
    r = await MateriaPrimaCatalogoService(session).eliminar_proveedor(1)
    assert r.data["borrado"] == "del_todo"
    session.expunge_all()
    assert await session.get(Proveedor, 1) is None


@pytest.mark.asyncio
async def test_eliminar_uno_del_integral_lo_saca_de_las_listas(session):
    """Borrarlo no sirve: el espejo lo volvería a traer. Queda inactivo y marcado."""
    await _proveedores(session)
    r = await MateriaPrimaCatalogoService(session).eliminar_proveedor(2)
    assert r.data["borrado"] == "de_las_listas"
    p = await session.get(Proveedor, 2)
    await session.refresh(p)
    assert p.inactivo == 1 and p.editado_en_spmm is not None
    lista = await MateriaPrimaCatalogoService(session).listar_proveedores("goma")
    assert [x["id"] for x in lista.data] == [3]


@pytest.mark.asyncio
async def test_eliminar_uno_que_ya_hace_un_paso_no_lo_borra(session):
    from backend.domain.EstadoProceso import EstadoProceso
    from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
    await _proveedores(session)
    session.add(EstadoProceso(id=1, descripcion="Pendiente"))
    session.add(OrdenTrabajoProceso(id=500, id_orden_trabajo=None, id_proceso=None, orden=1,
                                    tiempo_proceso=1, id_proveedor=1))
    await session.commit()
    r = await MateriaPrimaCatalogoService(session).eliminar_proveedor(1)
    assert r.data["borrado"] == "de_las_listas"
    assert r.data["usos"] == {"pasos tercerizados": 1}
    p = await session.get(Proveedor, 1)
    await session.refresh(p)
    assert p.inactivo == 1


def _del_viejo(id_proveedor, nombre):
    return {"idProveedor": id_proveedor, "Descripcion": nombre, "fantasia": None, "cuit": None,
            "telefono": None, "celular": None, "mail": None, "direccion": None, "localidad": None,
            "obs": None, "inactivo": 0}


@pytest.mark.asyncio
async def test_el_espejo_no_pisa_lo_editado_en_spmm():
    """En seco: el espejo actualiza el que no se tocó y deja como está el editado en SPMM."""
    ctx = I.Contexto(None, {"proveedor": [_del_viejo(10, "VIEJA SA NUEVA"),
                                          _del_viejo(11, "NOMBRE DEL INTEGRAL")]},
                     aplicar=False, ejemplos=5, respaldar=False)
    base = {c: None for c in I.COLS_PROVEEDOR} | {"inactivo": 0}
    ctx.estado = SimpleNamespace(proveedores=[
        base | {"id": 1, "id_legacy": 10, "editado_en_spmm": None, "razon_social": "VIEJA SA"},
        base | {"id": 2, "id_legacy": 11, "editado_en_spmm": datetime(2026, 10, 19, 15),
                "razon_social": "NOMBRE QUE PUSO SPMM"},
    ])
    await I.paso_proveedores(ctx)
    por_id = {p["id"]: p for p in ctx.estado.proveedores}
    assert por_id[1]["razon_social"] == "VIEJA SA NUEVA"
    assert por_id[2]["razon_social"] == "NOMBRE QUE PUSO SPMM"
    assert ctx.pasos[-1].conteos["editados o dados de baja en SPMM (no se pisan)"] == 1
