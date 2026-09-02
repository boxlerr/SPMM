"""
Borrar un proceso del catálogo desde el desplegable de la OT.

Julián, 2/9: «hay cosas mal escritas o chanchuyos». El catálogo se llenó de variantes
de tipeo que el sync del sistema viejo daba de alta como procesos nuevos
(«AGUJEREADo y ROSCADO», «PLEGADORA0», «TORNO T1 trBAJO 3 dias 24h»).

Lo que importa acá: borrar uno que está EN USO no puede ser un click silencioso. Dos
de las FK que apuntan a `proceso` son NO ACTION, así que sin esto el borrado revienta
con un error de constraint que en pantalla se lee como «error de conexión» y no dice
nada de lo que se está por perder.
"""
from datetime import datetime

import pytest

from backend.application.ProcesoService import ProcesoService
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.domain.Proceso import Proceso
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Prioridad import Prioridad
from backend.domain.Sector import Sector
from backend.domain.Articulo import Articulo
from backend.domain.EstadoProceso import EstadoProceso


async def _ot(db, numero_visible: int):
    """Una OT mínima. Prioridad y sector son obligatorios en el modelo."""
    # El estado 1 (Pendiente) es el default de la fila de proceso: sin él, la FK corta.
    if not await db.get(EstadoProceso, 1):
        db.add(EstadoProceso(id=1, descripcion="Pendiente"))
    p = Prioridad(descripcion="NORMAL")
    sec = Sector(nombre="SIN SECTOR")
    art = Articulo(cod_articulo="NO-DEF", descripcion="Sin definir", abreviatura="ND")
    db.add_all([p, sec, art])
    await db.commit()
    for x in (p, sec, art):
        await db.refresh(x)
    hoy = datetime(2026, 9, 2)
    ot = OrdenTrabajo(id_otvieja=numero_visible, id_prioridad=p.id,
                      id_sector=sec.id, id_articulo=art.id,
                      ttt1=0, fc=0, fecha_orden=hoy, fecha_entrada=hoy, fecha_prometida=hoy)
    db.add(ot)
    await db.commit()
    await db.refresh(ot)
    return ot


async def _proceso(db, nombre="PLEGADORA0"):
    p = Proceso(nombre=nombre, descripcion="")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@pytest.mark.asyncio
async def test_un_proceso_que_no_usa_nadie_se_borra_derecho(session):
    p = await _proceso(session)
    res = await ProcesoService(session).eliminarProceso(p.id)
    assert res.status is True
    assert res.data["ordenes_afectadas"] == 0
    assert await ProcesoService(session).repository.find_by_id(p.id) is None


@pytest.mark.asyncio
async def test_un_proceso_en_uso_pregunta_antes_y_dice_en_cuales(session):
    p = await _proceso(session, "AGUJEREADo y ROSCADO")
    ot = await _ot(session, 15670)
    session.add(OrdenTrabajoProceso(id_orden_trabajo=ot.id, id_proceso=p.id, orden=1, cant_operarios=1))
    await session.commit()

    with pytest.raises(ConfirmacionRequeridaException) as e:
        await ProcesoService(session).eliminarProceso(p.id)
    motivo = str(e.value)
    assert "AGUJEREADo y ROSCADO" in motivo
    assert "#15670" in motivo, "la OT se nombra por su número visible, no por el id interno"
    assert "se pierde" in motivo

    # Y sigue estando: preguntar no borra.
    assert await ProcesoService(session).repository.find_by_id(p.id) is not None


@pytest.mark.asyncio
async def test_con_forzar_se_borra_y_se_lleva_las_filas_de_las_ot(session):
    p = await _proceso(session, "TORNO T1 trBAJO 3 dias 24h")
    ot = await _ot(session, 15729)
    session.add(OrdenTrabajoProceso(id_orden_trabajo=ot.id, id_proceso=p.id, orden=1, cant_operarios=1))
    await session.commit()

    res = await ProcesoService(session).eliminarProceso(p.id, forzar=True)
    assert res.data["ordenes_afectadas"] == 1
    assert await ProcesoService(session).repository.find_by_id(p.id) is None


@pytest.mark.asyncio
async def test_borrar_uno_que_no_existe_no_inventa_nada(session):
    with pytest.raises(NotFoundException):
        await ProcesoService(session).eliminarProceso(999999)
