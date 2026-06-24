"""
Tests del OperarioService para las skills nativas contra SQLite:
  - actualizarEstadoSkillNativa: upsert al desactivar, delete al reactivar,
    sin degradar skills cargadas nivel 1/2,
  - modificarOperario (PUT) preserva los overrides nivel 0,
  - obtenerOperarioPorId aflora la nativa desactivada (flujo completo).
"""
from sqlalchemy import select

from backend.application.OperarioService import OperarioService
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
from backend.dto.ProcesoSkillDTO import ProcesoSkillDTO

from backend.tests.conftest import seed_basico


async def _get_skill(session, id_operario, id_proceso):
    res = await session.execute(
        select(OperarioProcesoSkill).where(
            OperarioProcesoSkill.id_operario == id_operario,
            OperarioProcesoSkill.id_proceso == id_proceso,
        )
    )
    return res.scalar_one_or_none()


async def test_desactivar_nativa_inserta_override(session):
    await seed_basico(session)
    service = OperarioService(session)

    resp = await service.actualizarEstadoSkillNativa(1, 100, habilitado=False)
    assert resp.status is True

    skill = await _get_skill(session, 1, 100)
    assert skill is not None
    assert skill.nivel == 0 and skill.habilitado is False


async def test_reactivar_nativa_borra_override(session):
    await seed_basico(session)
    service = OperarioService(session)

    await service.actualizarEstadoSkillNativa(1, 100, habilitado=False)
    assert await _get_skill(session, 1, 100) is not None

    # Reactivar -> debe BORRAR la fila (no dejar nivel 0 habilitado=True).
    await service.actualizarEstadoSkillNativa(1, 100, habilitado=True)
    assert await _get_skill(session, 1, 100) is None


async def test_no_degrada_skill_manual(session):
    await seed_basico(session)
    # Skill cargada nivel 1 sobre el proceso 100.
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=1, habilitado=True))
    await session.commit()

    service = OperarioService(session)
    await service.actualizarEstadoSkillNativa(1, 100, habilitado=False)

    skill = await _get_skill(session, 1, 100)
    # No se toca: sigue siendo nivel 1 habilitada.
    assert skill.nivel == 1 and skill.habilitado is True


async def test_put_preserva_overrides_nativos(session):
    await seed_basico(session)
    # Override de nativa desactivada (nivel 0) + skill cargada (nivel 1).
    session.add_all([
        OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=0, habilitado=False),
        OperarioProcesoSkill(id_operario=1, id_proceso=101, nivel=1, habilitado=True),
    ])
    await session.commit()

    service = OperarioService(session)
    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL",
        skills=[ProcesoSkillDTO(id_proceso=101, nivel=1, habilitado=True)],
    )
    await service.modificarOperario(1, dto)

    # El override nivel 0 sobre 100 NO se borró.
    override = await _get_skill(session, 1, 100)
    assert override is not None and override.nivel == 0 and override.habilitado is False
    # La skill cargada nivel 1 sobre 101 sigue presente.
    manual = await _get_skill(session, 1, 101)
    assert manual is not None and manual.nivel == 1


async def test_obtener_operario_aflora_nativa_desactivada(session):
    await seed_basico(session)
    service = OperarioService(session)

    await service.actualizarEstadoSkillNativa(1, 100, habilitado=False)

    resp = await service.obtenerOperarioPorId(1)
    assert resp.status is True
    skills = {s["id_proceso"]: s for s in resp.data["skills"]}

    # 100 derivada del rango pero desactivada por override.
    assert skills[100]["nivel"] == 0 and skills[100]["habilitado"] is False
    # 101 sigue como nativa activa.
    assert skills[101]["nivel"] == 0 and skills[101]["habilitado"] is True
