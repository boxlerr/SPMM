"""
Tests del OperarioService para las skills nativas contra SQLite:
  - actualizarEstadoSkillNativa: upsert al desactivar, delete al reactivar,
    sin degradar skills cargadas nivel 1/2,
  - modificarOperario (PUT) preserva los overrides nivel 0,
  - obtenerOperarioPorId aflora la nativa desactivada (flujo completo).
"""
import pytest
import sqlalchemy.exc as sa_exc
from sqlalchemy import select

from backend.application.OperarioService import OperarioService
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.domain.Operario import Operario
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


async def test_modificar_operario_es_atomico_si_falla_commit(session):
    """Si el commit falla a mitad del guardado (p. ej. la DB se desconecta), se hace
    rollback y NO queda un guardado parcial: ni los datos, ni las skills, ni los rangos."""
    await seed_basico(session)
    # Skill manual previa (nivel 1 sobre 101) para verificar que no se pierde si falla.
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=101, nivel=1, habilitado=True))
    await session.commit()

    service = OperarioService(session)

    # Simular corte de DB: el commit del guardado explota.
    original_commit = session.commit

    async def commit_que_falla():
        raise RuntimeError("conexion caida a mitad del commit")

    session.commit = commit_que_falla

    dto = OperarioRequestDTO(
        nombre="CAMBIADO", apellido="Perez", categoria="OFICIAL",
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=1, habilitado=True)],
    )
    with pytest.raises(InfrastructureException):
        await service.modificarOperario(1, dto)

    # Restaurar el commit real para poder leer el estado persistido.
    session.commit = original_commit

    res = await session.execute(select(Operario).where(Operario.id == 1))
    op = res.scalar_one()
    # El cambio de nombre NO se aplicó.
    assert op.nombre == "Juan"
    # La skill manual previa (101) sigue viva; la nueva (200) nunca se insertó.
    assert await _get_skill(session, 1, 101) is not None
    assert await _get_skill(session, 1, 200) is None


async def test_modificar_operario_reintenta_ante_desconexion_transitoria(session):
    """Si el commit falla por un corte transitorio de la DB, el servicio reintenta
    solo y termina guardando (sin que el usuario tenga que hacer nada)."""
    await seed_basico(session)
    service = OperarioService(session)

    # Primer commit: simula '08S01 Communication link failure'. Segundo: commit real.
    real_commit = session.commit
    llamadas = {"n": 0}

    async def commit_flaky():
        llamadas["n"] += 1
        if llamadas["n"] == 1:
            raise sa_exc.OperationalError(
                "UPDATE operario ...", {},
                Exception("[08S01] Communication link failure"),
            )
        return await real_commit()

    session.commit = commit_flaky

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL",
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=1, habilitado=True)],
    )
    resp = await service.modificarOperario(1, dto)

    session.commit = real_commit

    assert resp.status is True
    assert llamadas["n"] == 2  # falló una vez y reintentó
    # Tras el reintento, la skill quedó guardada.
    assert await _get_skill(session, 1, 200) is not None
