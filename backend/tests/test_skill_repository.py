"""
Tests del OperarioProcesoSkillRepository contra SQLite:
  - get_map_por_proceso (mapa de PRIORIDAD) excluye nivel 0 y habilitado=False,
  - get_nativas_deshabilitadas devuelve TODA fila con habilitado=False, sin importar
    el nivel: una nativa marcada como SKILL 1/2 y después apagada también tiene que
    salir del set de elegibles.
"""
from backend.domain.Proceso import Proceso
from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
from backend.infrastructure.OperarioProcesoSkillRepository import OperarioProcesoSkillRepository


async def _seed_skills(session):
    session.add_all([
        Proceso(id=100, nombre="Torneado"),
        Proceso(id=101, nombre="Roscado"),
        # nivel 1/2 habilitadas -> deben entrar al mapa
        OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=1, habilitado=True),
        OperarioProcesoSkill(id_operario=2, id_proceso=100, nivel=2, habilitado=True),
        # nivel 1 deshabilitada -> NO entra
        OperarioProcesoSkill(id_operario=3, id_proceso=100, nivel=1, habilitado=False),
        # nativa legacy (nivel 0, habilitada) -> NO entra al mapa
        OperarioProcesoSkill(id_operario=4, id_proceso=101, nivel=0, habilitado=True),
        # nativa desactivada (nivel 0, deshabilitada) -> override
        OperarioProcesoSkill(id_operario=5, id_proceso=101, nivel=0, habilitado=False),
    ])
    await session.commit()


async def test_get_map_excluye_nivel0_y_deshabilitadas(session):
    await _seed_skills(session)
    repo = OperarioProcesoSkillRepository(session)
    mapa = await repo.get_map_por_proceso()

    # Proceso 100: solo operarios 1 y 2 (nivel 1/2 habilitados). El 3 (deshabilitado) fuera.
    assert mapa.get(100) == {1: 1, 2: 2}
    # Proceso 101: ninguna fila nivel 1/2 -> no aparece (las nivel 0 no entran).
    assert 101 not in mapa


async def test_get_nativas_deshabilitadas(session):
    await _seed_skills(session)
    repo = OperarioProcesoSkillRepository(session)
    off = await repo.get_nativas_deshabilitadas()

    # Toda fila apagada, sin importar el nivel:
    #  - proceso 101, operario 5: nativa sin marcar, apagada.
    #  - proceso 100, operario 3: nativa marcada SKILL 1 y apagada. Antes se filtraba
    #    por nivel == 0 y esta se escapaba: el operario seguía siendo asignable.
    assert off == {100: {3}, 101: {5}}
