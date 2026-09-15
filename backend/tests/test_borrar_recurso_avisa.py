"""Borrar una máquina o una persona tiene que decir QUÉ se lleva puesto.

ESTO ESTABA ROTO, y de la peor forma posible en el caso de las personas:
`operario_rango` es NO ACTION y TODA persona tiene al menos una categoría, así que el
borrado reventaba SIEMPRE con un error de constraint. En pantalla eso se leía «puede
que la base de datos se haya desconectado; esperá unos segundos e intentá de nuevo»:
la función nunca funcionó y encima el mensaje mandaba a esperar a que se arreglara
algo que no estaba roto.

El trato correcto ya existía para los procesos y los rangos (avisar, no bloquear): la
primera pasada contesta 409 con el motivo y la segunda, con `forzar`, ejecuta. Acá se
extiende a los otros dos recursos.
"""
import pytest

from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException


def test_los_endpoints_aceptan_forzar():
    """Sin el parámetro no hay segunda pasada posible: el cartel diría «Eliminar igual»
    y el pedido volvería a dar 409 para siempre."""
    import inspect
    from backend.presentation.MaquinariaAPI import eliminar_maquinaria
    from backend.presentation.OperarioAPI import eliminar_operario

    for fn in (eliminar_maquinaria, eliminar_operario):
        p = inspect.signature(fn).parameters
        assert "forzar" in p, f"{fn.__name__} no acepta forzar"
        assert p["forzar"].default is False, f"{fn.__name__}: forzar tiene que venir apagado"


@pytest.mark.asyncio
async def test_borrar_persona_con_categoria_avisa_en_vez_de_reventar(session):
    from datetime import time
    from backend.application.OperarioService import OperarioService
    from backend.domain.Operario import Operario
    from backend.domain.OperarioRango import OperarioRango
    from backend.domain.Rango import Rango

    session.add_all([
        Rango(id=6, nombre="OFICIAL"),
        Operario(id=1, nombre="Gustavo", apellido="Romero", categoria="OFICIAL",
                 hora_inicio=time(7, 0), hora_fin=time(16, 0)),
        OperarioRango(id_operario=1, id_rango=6),
    ])
    await session.commit()

    svc = OperarioService(session)

    # Primera pasada: NO borra y explica. Antes acá reventaba la FK.
    with pytest.raises(ConfirmacionRequeridaException) as e:
        await svc.eliminarOperario(1)
    motivo = str(e.value)
    assert "Gustavo Romero" in motivo
    assert "categoría" in motivo
    # Y propone lo que casi siempre corresponde en vez de borrar.
    assert "NO disponible" in motivo

    # Sigue estando: preguntar no borra.
    assert await session.get(Operario, 1) is not None

    # Segunda pasada: ahora sí.
    r = await svc.eliminarOperario(1, forzar=True)
    assert r.status is True
    session.expire_all()
    assert await session.get(Operario, 1) is None


@pytest.mark.asyncio
async def test_borrar_maquina_en_uso_avisa_y_despues_borra(session):
    from backend.application.MaquinariaService import MaquinariaService
    from backend.domain.Maquinaria import Maquinaria
    from backend.domain.Rango import Rango
    from backend.domain.RangoMaquinaria import RangoMaquinaria

    session.add_all([
        Maquinaria(id=18, nombre="TORNO 5"),
        Rango(id=4, nombre="MEDIO OFICIAL"),
        RangoMaquinaria(id_maquinaria=18, id_rango=4),
    ])
    await session.commit()

    svc = MaquinariaService(session)
    with pytest.raises(ConfirmacionRequeridaException) as e:
        await svc.eliminarMaquinaria(18)
    assert "TORNO 5" in str(e.value) and "categoría" in str(e.value)

    assert await session.get(Maquinaria, 18) is not None
    r = await svc.eliminarMaquinaria(18, forzar=True)
    assert r.status is True
    session.expire_all()
    assert await session.get(Maquinaria, 18) is None


@pytest.mark.asyncio
async def test_borrar_algo_que_nadie_usa_no_pregunta(session):
    """El aviso es para cuando hay algo que perder. Si no hay nada, preguntar de gusto
    es una pantalla más entre la persona y lo que quiere hacer."""
    from backend.application.MaquinariaService import MaquinariaService
    from backend.domain.Maquinaria import Maquinaria

    session.add(Maquinaria(id=99, nombre="MAQUINA SUELTA"))
    await session.commit()

    r = await MaquinariaService(session).eliminarMaquinaria(99)
    assert r.status is True
    session.expire_all()
    assert await session.get(Maquinaria, 99) is None
