"""
Tests de las habilidades MANUALES: las que se cargan a mano porque el rango no las
contempla.

Modelo: el universo de lo que un operario sabe hacer son sus NATIVAS (rango × procesos
del rango) MÁS las manuales. La fila de una manual no es un override sobre algo
derivado —es la habilidad misma—, y de ahí salen las tres diferencias que se prueban
acá:

  - se persiste aunque esté sin priorizar y encendida (si no, desaparece),
  - se le puede dar prioridad SKILL 1/2 sin que el rango la dé,
  - no se borra sola al reactivarla ni al quitarle la prioridad.

Y la resolución: si el rango pasa a dar ese proceso, la manual se degrada a nativa.
"""
import pytest
from sqlalchemy import select

from backend.application.OperarioService import (
    OperarioService,
    _build_skills_payload,
    _normalizar_skills,
)
from backend.commons.exceptions.BusinessException import BusinessException
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
from backend.domain.OperarioRango import OperarioRango
from backend.domain.Rango import Rango
from backend.domain.RangoProceso import RangoProceso
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
from backend.dto.ProcesoSkillDTO import ProcesoSkillDTO
from backend.infrastructure.OperarioProcesoSkillRepository import OperarioProcesoSkillRepository
from backend.tests.conftest import seed_basico


async def _get_skill(session, id_operario, id_proceso):
    res = await session.execute(
        select(OperarioProcesoSkill).where(
            OperarioProcesoSkill.id_operario == id_operario,
            OperarioProcesoSkill.id_proceso == id_proceso,
        )
    )
    return res.scalar_one_or_none()


# --------------------------------------------------------------------------
# Normalización (pura)
# --------------------------------------------------------------------------

def test_manual_sin_prioridad_se_persiste():
    # Una nativa sin marcar y encendida no genera fila (se deriva del rango). Una
    # manual sí: la fila es lo único que sostiene la habilidad.
    filas = _normalizar_skills([
        {"id_proceso": 200, "nivel": 0, "habilitado": True, "manual": True},
        {"id_proceso": 100, "nivel": 0, "habilitado": True, "manual": False},
    ])
    assert [f["id_proceso"] for f in filas] == [200]
    assert filas[0]["manual"] is True


def test_duplicado_conserva_el_flag_manual():
    # Gana la prioridad más alta, pero `manual` es del proceso: no se puede perder
    # porque la entrada ganadora no lo traía.
    filas = _normalizar_skills([
        {"id_proceso": 200, "nivel": 2, "habilitado": True, "manual": True},
        {"id_proceso": 200, "nivel": 1, "habilitado": True, "manual": False},
    ])
    assert len(filas) == 1
    assert filas[0]["nivel"] == 1 and filas[0]["manual"] is True


# --------------------------------------------------------------------------
# Payload que ve la UI
# --------------------------------------------------------------------------

def test_payload_marca_la_manual():
    from backend.tests.test_build_skills_payload import make_op, by_proceso

    op = make_op(skills=[], rangos_procs=[[100]])
    op.procesos_skill = [
        type("S", (), {"id_proceso": 200, "nivel": 0, "habilitado": True, "orden": None, "manual": True})()
    ]
    m = by_proceso(_build_skills_payload(op))
    assert m[200]["manual"] is True and m[200]["nativa"] is False
    assert m[100]["manual"] is False and m[100]["nativa"] is True


def test_payload_degrada_manual_que_paso_a_ser_nativa():
    # El rango terminó dando el proceso: se ve como nativa y sin la marca manual.
    from backend.tests.test_build_skills_payload import make_op, by_proceso

    op = make_op(skills=[], rangos_procs=[[100]])
    op.procesos_skill = [
        type("S", (), {"id_proceso": 100, "nivel": 1, "habilitado": True, "orden": 0, "manual": True})()
    ]
    m = by_proceso(_build_skills_payload(op))
    assert m[100]["nativa"] is True and m[100]["manual"] is False
    assert m[100]["nivel"] == 1  # la prioridad se conserva


# --------------------------------------------------------------------------
# Guardado (PUT) contra SQLite
# --------------------------------------------------------------------------

async def test_put_guarda_manual_fuera_del_rango(session):
    await seed_basico(session)  # el rango 7 da 100 y 101; el 200 queda afuera
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL", rangos=[7],
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=0, habilitado=True, manual=True)],
    )
    resp = await service.modificarOperario(1, dto)
    assert resp.status is True

    skill = await _get_skill(session, 1, 200)
    assert skill is not None
    assert skill.manual is True and skill.nivel == 0 and skill.habilitado is True


async def test_put_permite_priorizar_una_manual(session):
    """La prioridad ordena entre elegibles: una manual ya lo es, así que se puede
    marcar SKILL 1 sin tocarle el rango."""
    await seed_basico(session)
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL", rangos=[7],
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=1, habilitado=True, orden=0, manual=True)],
    )
    resp = await service.modificarOperario(1, dto)
    assert resp.status is True

    skill = await _get_skill(session, 1, 200)
    assert skill.manual is True and skill.nivel == 1 and skill.orden == 0


async def test_put_sigue_rechazando_prioridad_sin_habilidad(session):
    """Sin `manual`, priorizar un proceso que el rango no da se sigue rechazando: no
    habilitaría nada y quedaría una fila que no hace efecto."""
    await seed_basico(session)
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL", rangos=[7],
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=1, habilitado=True, manual=False)],
    )
    with pytest.raises(BusinessException):
        await service.modificarOperario(1, dto)
    assert await _get_skill(session, 1, 200) is None


async def test_put_quita_la_manual_cuando_no_viene(session):
    """El PUT manda el estado final: la manual que no viene es la que se sacó."""
    await seed_basico(session)
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=200, nivel=0,
                                     habilitado=True, manual=True))
    await session.commit()
    service = OperarioService(session)

    dto = OperarioRequestDTO(nombre="Juan", apellido="Perez", categoria="OFICIAL",
                             rangos=[7], skills=[])
    await service.modificarOperario(1, dto)
    assert await _get_skill(session, 1, 200) is None


async def test_put_degrada_manual_si_el_rango_pasa_a_darla(session):
    """Si el rango elegido ya incluye el proceso, la carga a mano dejó de aportar: la
    fila no se guarda como manual (y sin prioridad ni apagado, no se guarda)."""
    await seed_basico(session)
    session.add_all([
        Rango(id=8, nombre="Fresador"),
        RangoProceso(id_rango=8, id_proceso=200),
    ])
    await session.commit()
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL", rangos=[7, 8],
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=0, habilitado=True, manual=True)],
    )
    resp = await service.modificarOperario(1, dto)
    assert resp.status is True
    assert await _get_skill(session, 1, 200) is None  # es nativa por el rango 8


async def test_alta_con_manual(session):
    await seed_basico(session)
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Ana", apellido="Gomez", categoria="OFICIAL", rangos=[7],
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=0, habilitado=True, manual=True)],
    )
    resp = await service.crearOperario(dto)
    nuevo_id = resp.data["id"]

    skill = await _get_skill(session, nuevo_id, 200)
    assert skill is not None and skill.manual is True


# --------------------------------------------------------------------------
# Toggles del panel de perfil
# --------------------------------------------------------------------------

async def test_reactivar_manual_no_la_borra(session):
    """El toggle borra la fila de una NATIVA sin prioridad al reactivarla (vuelve al
    estado derivado). Con una manual eso la haría desaparecer, así que se conserva."""
    await seed_basico(session)
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=200, nivel=0,
                                     habilitado=True, manual=True))
    await session.commit()
    service = OperarioService(session)

    await service.actualizarEstadoSkillNativa(1, 200, habilitado=False)
    assert (await _get_skill(session, 1, 200)).habilitado is False

    await service.actualizarEstadoSkillNativa(1, 200, habilitado=True)
    skill = await _get_skill(session, 1, 200)
    assert skill is not None and skill.habilitado is True and skill.manual is True


async def test_quitar_prioridad_a_una_manual_no_la_borra(session):
    await seed_basico(session)
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=200, nivel=1,
                                     habilitado=True, manual=True))
    await session.commit()
    service = OperarioService(session)

    dto = ProcesoSkillDTO(id_proceso=200, nivel=0)
    await service.agregarSkill(1, dto)

    skill = await _get_skill(session, 1, 200)
    assert skill is not None and skill.nivel == 0 and skill.manual is True


async def test_agregar_skill_manual_desde_el_panel(session):
    await seed_basico(session)
    service = OperarioService(session)

    dto = ProcesoSkillDTO(id_proceso=200, nivel=1, manual=True)
    resp = await service.agregarSkill(1, dto)
    assert resp.status is True

    skill = await _get_skill(session, 1, 200)
    assert skill is not None and skill.manual is True and skill.nivel == 1


# --------------------------------------------------------------------------
# Lo que consume el planificador
# --------------------------------------------------------------------------

async def test_repo_lista_manuales_habilitadas(session):
    await seed_basico(session)
    session.add_all([
        OperarioProcesoSkill(id_operario=1, id_proceso=200, nivel=0, habilitado=True, manual=True),
        # Apagada: no se asigna, no tiene que salir del mapa.
        OperarioProcesoSkill(id_operario=1, id_proceso=101, nivel=0, habilitado=False, manual=True),
        # Resto del modelo viejo: prioridad sobre un proceso no nativo, SIN manual.
        # No habilita nada, así que tampoco sale.
        OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=1, habilitado=True, manual=False),
    ])
    await session.commit()

    mapa = await OperarioProcesoSkillRepository(session).get_manuales_por_proceso()
    assert mapa == {200: {1}}
