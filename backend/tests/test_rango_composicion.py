"""
Tests de la composición del rango: qué procesos y qué maquinarias habilita.

Esto es lo que hasta ahora venía fijo desde el Excel de la migración y no se podía
tocar desde la app. Es la operación de mayor alcance del módulo de recursos: cambiar
los procesos de un rango cambia qué puede hacer TODA la gente que lo tiene, no un
operario suelto.

El caso que importa de verdad está al final: sacarle un proceso al rango le quita la
elegibilidad nativa a sus operarios, pero NO pisa una habilidad manual sobre ese mismo
proceso. Las manuales existen justamente para sobrevivir a esto.
"""
import pytest
from sqlalchemy import select

from backend.application.RangoService import RangoService
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.domain.Maquinaria import Maquinaria
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
from backend.domain.RangoMaquinaria import RangoMaquinaria
from backend.domain.RangoProceso import RangoProceso
from backend.tests.conftest import seed_basico


async def _ids_procesos(session, id_rango):
    res = await session.execute(
        select(RangoProceso.id_proceso).where(RangoProceso.id_rango == id_rango)
    )
    return sorted(res.scalars().all())


async def _ids_maquinarias(session, id_rango):
    res = await session.execute(
        select(RangoMaquinaria.id_maquinaria).where(RangoMaquinaria.id_rango == id_rango)
    )
    return sorted(res.scalars().all())


# --------------------------------------------------------------------------
# Lectura
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_detalle_trae_procesos_y_alcance(session):
    # seed_basico: rango 7 cubre procesos 100 y 101, y el operario 1 lo tiene.
    await seed_basico(session)
    service = RangoService(session)

    resp = await service.obtenerDetalleRango(7)

    assert resp.data["nombre"] == "Tornero"
    assert [p["nombre"] for p in resp.data["procesos"]] == ["Roscado", "Torneado"]  # por nombre
    # El contador es lo que la UI muestra antes de dejar tocar nada.
    assert resp.data["operarios_count"] == 1


@pytest.mark.asyncio
async def test_detalle_de_rango_inexistente_es_404(session):
    await seed_basico(session)
    service = RangoService(session)

    with pytest.raises(NotFoundException):
        await service.obtenerDetalleRango(999)


# --------------------------------------------------------------------------
# Escritura: reemplaza, no agrega
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_set_procesos_reemplaza_el_conjunto(session):
    await seed_basico(session)
    service = RangoService(session)

    # El rango tenía 100 y 101; se manda solo 101 y 200.
    await service.modificarProcesosRango(7, [101, 200])

    assert await _ids_procesos(session, 7) == [101, 200]


@pytest.mark.asyncio
async def test_set_procesos_vacio_deja_el_rango_sin_nada(session):
    await seed_basico(session)
    service = RangoService(session)

    await service.modificarProcesosRango(7, [])

    assert await _ids_procesos(session, 7) == []


@pytest.mark.asyncio
async def test_set_procesos_deduplica(session):
    await seed_basico(session)
    service = RangoService(session)

    # Sin dedup esto revienta por PK compuesta duplicada.
    await service.modificarProcesosRango(7, [100, 100, 101])

    assert await _ids_procesos(session, 7) == [100, 101]


@pytest.mark.asyncio
async def test_set_procesos_con_id_inexistente_es_error_de_negocio(session):
    await seed_basico(session)
    service = RangoService(session)

    # Tiene que salir como BusinessException legible, no como violación de FK en un 500.
    with pytest.raises(BusinessException) as exc:
        await service.modificarProcesosRango(7, [100, 12345])
    assert "12345" in str(exc.value)

    # Y no debe haber tocado nada.
    assert await _ids_procesos(session, 7) == [100, 101]


@pytest.mark.asyncio
async def test_set_procesos_sobre_rango_inexistente_es_404(session):
    await seed_basico(session)
    service = RangoService(session)

    with pytest.raises(NotFoundException):
        await service.modificarProcesosRango(999, [100])


@pytest.mark.asyncio
async def test_respuesta_trae_el_detalle_recalculado(session):
    await seed_basico(session)
    service = RangoService(session)

    resp = await service.modificarProcesosRango(7, [200])

    # La UI pinta con esto sin tener que volver a pedir.
    assert [p["id"] for p in resp.data["procesos"]] == [200]
    assert resp.data["operarios_count"] == 1


# --------------------------------------------------------------------------
# Maquinarias
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_set_maquinarias_reemplaza_el_conjunto(session):
    await seed_basico(session)
    session.add_all([
        Maquinaria(id=50, nombre="Torno 1", cod_maquina="TORY-1"),
        Maquinaria(id=51, nombre="Torno 2", cod_maquina="TORY-2"),
        RangoMaquinaria(id_rango=7, id_maquinaria=50),
    ])
    await session.commit()
    service = RangoService(session)

    await service.modificarMaquinariasRango(7, [51])

    assert await _ids_maquinarias(session, 7) == [51]


@pytest.mark.asyncio
async def test_detalle_trae_la_maquinaria_con_su_codigo(session):
    await seed_basico(session)
    session.add_all([
        Maquinaria(id=50, nombre="Torno 1", cod_maquina="TORY-1"),
        RangoMaquinaria(id_rango=7, id_maquinaria=50),
    ])
    await session.commit()
    service = RangoService(session)

    resp = await service.obtenerDetalleRango(7)

    assert resp.data["maquinarias"] == [
        {"id": 50, "nombre": "Torno 1", "cod_maquina": "TORY-1"}
    ]


@pytest.mark.asyncio
async def test_set_maquinarias_con_id_inexistente_es_error_de_negocio(session):
    await seed_basico(session)
    service = RangoService(session)

    with pytest.raises(BusinessException):
        await service.modificarMaquinariasRango(7, [999])


# --------------------------------------------------------------------------
# La interacción que importa: rango vs. habilidad manual
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sacar_un_proceso_del_rango_no_borra_la_habilidad_manual(session):
    """
    El operario 1 tiene el proceso 200 como MANUAL (el rango nunca se lo dio).
    Achicar el rango no puede llevarse puesta esa habilidad: es de él, no del rango.
    """
    await seed_basico(session)
    session.add(OperarioProcesoSkill(
        id_operario=1, id_proceso=200, nivel=0, habilitado=True, manual=True
    ))
    await session.commit()
    service = RangoService(session)

    # Se le saca todo al rango.
    await service.modificarProcesosRango(7, [])

    res = await session.execute(
        select(OperarioProcesoSkill).where(
            OperarioProcesoSkill.id_operario == 1,
            OperarioProcesoSkill.id_proceso == 200,
        )
    )
    manual = res.scalar_one_or_none()
    assert manual is not None, "la manual no puede desaparecer al editar el rango"
    assert manual.manual is True
    assert manual.habilitado is True


# --------------------------------------------------------------------------
# Borrado
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_borrar_un_rango_con_procesos_se_lleva_sus_filas(session):
    """
    Sin cascade en Rango.procesos esto explota con "tried to blank-out primary key
    column 'rango_proceso.id_rango'": la FK del hijo es parte de su PK y SQLAlchemy
    intenta anularla. Se rompía en produccion con cualquier rango que tuviera procesos.
    """
    await seed_basico(session)
    # Se le saca el operario para que no corte por estar en uso.
    from backend.domain.OperarioRango import OperarioRango
    from sqlalchemy import delete as sa_delete
    await session.execute(sa_delete(OperarioRango).where(OperarioRango.id_rango == 7))
    await session.commit()

    service = RangoService(session)
    resp = await service.eliminarRango(7)

    assert resp.data == {"deleted": 7}
    assert await _ids_procesos(session, 7) == []


@pytest.mark.asyncio
async def test_borrar_un_rango_con_maquinarias_se_lleva_sus_filas(session):
    await seed_basico(session)
    from backend.domain.OperarioRango import OperarioRango
    from sqlalchemy import delete as sa_delete
    await session.execute(sa_delete(OperarioRango).where(OperarioRango.id_rango == 7))
    session.add_all([
        Maquinaria(id=50, nombre="Torno 1", cod_maquina="TORY-1"),
        RangoMaquinaria(id_rango=7, id_maquinaria=50),
    ])
    await session.commit()

    service = RangoService(session)
    await service.eliminarRango(7)

    assert await _ids_maquinarias(session, 7) == []


@pytest.mark.asyncio
async def test_no_se_puede_borrar_un_rango_que_alguien_tiene(session):
    # seed_basico deja al operario 1 con el rango 7.
    await seed_basico(session)
    service = RangoService(session)

    with pytest.raises(BusinessException) as exc:
        await service.eliminarRango(7)

    # El mensaje tiene que decir cuántos son, si no el usuario no sabe qué reasignar.
    assert "1 operario" in str(exc.value)
    # Y no puede haber borrado nada.
    assert await _ids_procesos(session, 7) == [100, 101]


@pytest.mark.asyncio
async def test_editar_el_rango_no_toca_las_filas_de_skill_nativas(session):
    """
    Las filas de nivel sobre procesos que el rango deja de dar quedan, pero son inertes:
    en este modelo `nivel` solo ordena preferencia, no habilita. Se documenta acá para
    que quede explícito que la elegibilidad la perdió por el rango, no por la fila.
    """
    await seed_basico(session)
    session.add(OperarioProcesoSkill(
        id_operario=1, id_proceso=100, nivel=1, habilitado=True, manual=False
    ))
    await session.commit()
    service = RangoService(session)

    await service.modificarProcesosRango(7, [101])

    res = await session.execute(
        select(OperarioProcesoSkill).where(
            OperarioProcesoSkill.id_operario == 1,
            OperarioProcesoSkill.id_proceso == 100,
        )
    )
    fila = res.scalar_one_or_none()
    assert fila is not None
    assert fila.manual is False  # sigue siendo nativa-con-prioridad, ahora sin rango que la sostenga
    assert await _ids_procesos(session, 7) == [101]
