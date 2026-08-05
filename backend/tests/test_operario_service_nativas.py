"""
Tests del OperarioService para las skills nativas contra SQLite.

Modelo: las nativas (rango × procesos del rango) son el universo de lo que el operario
puede hacer. `operario_proceso_skill` guarda overrides sobre ellas con dos ejes sueltos
— prioridad (nivel 0/1/2) y apagado (habilitado).

  - actualizarEstadoSkillNativa: upsert al desactivar (conservando la prioridad),
    delete al reactivar solo si no quedaba nada que decir,
  - modificarOperario (PUT) rechaza priorizar procesos que no son nativos,
  - obtenerOperarioPorId aflora la nativa desactivada (flujo completo).
"""
import pytest
import sqlalchemy.exc as sa_exc
from sqlalchemy import select

from backend.application.OperarioService import OperarioService
from backend.commons.exceptions.BusinessException import BusinessException
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


async def test_apagar_nativa_conserva_la_prioridad(session):
    await seed_basico(session)
    # Nativa 100 marcada como SKILL 1.
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=1, habilitado=True))
    await session.commit()

    service = OperarioService(session)
    await service.actualizarEstadoSkillNativa(1, 100, habilitado=False)

    skill = await _get_skill(session, 1, 100)
    # Apagar y priorizar son ejes distintos: se apaga sin perder que era SKILL 1.
    assert skill.nivel == 1 and skill.habilitado is False


async def test_reactivar_nativa_priorizada_conserva_la_fila(session):
    await seed_basico(session)
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=2, habilitado=False))
    await session.commit()

    service = OperarioService(session)
    await service.actualizarEstadoSkillNativa(1, 100, habilitado=True)

    skill = await _get_skill(session, 1, 100)
    # No se borra: sigue siendo SKILL 2, ahora prendida.
    assert skill is not None and skill.nivel == 2 and skill.habilitado is True


async def test_put_reemplaza_todos_los_overrides(session):
    """El form manda el estado final de todas las nativas, así que lo que no viene
    volvió al default. Es idempotente: se borra todo y se reinserta."""
    await seed_basico(session)
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

    # 100 no vino en el payload -> vuelve al default derivado (sin fila, habilitada).
    assert await _get_skill(session, 1, 100) is None
    # 101 conserva su prioridad.
    manual = await _get_skill(session, 1, 101)
    assert manual is not None and manual.nivel == 1


async def test_put_persiste_nativa_apagada(session):
    """Apagar una nativa desde el form se persiste como override nivel 0 / habilitado
    False, que es lo que el planificador resta del set de elegibles."""
    await seed_basico(session)
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL",
        skills=[ProcesoSkillDTO(id_proceso=100, nivel=0, habilitado=False)],
    )
    resp = await service.modificarOperario(1, dto)

    assert resp.status is True
    skill = await _get_skill(session, 1, 100)
    assert skill is not None and skill.nivel == 0 and skill.habilitado is False


async def test_put_no_persiste_nativas_en_estado_default(session):
    """Una nativa habilitada y sin marcar es el default derivado del rango: guardar una
    fila por cada una sería escribir ruido en la tabla."""
    await seed_basico(session)
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL",
        skills=[
            ProcesoSkillDTO(id_proceso=100, nivel=0, habilitado=True),
            ProcesoSkillDTO(id_proceso=101, nivel=0, habilitado=True),
        ],
    )
    await service.modificarOperario(1, dto)

    res = await session.execute(
        select(OperarioProcesoSkill).where(OperarioProcesoSkill.id_operario == 1)
    )
    assert res.scalars().all() == []


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


async def test_put_rechaza_prioridad_sobre_proceso_no_nativo(session):
    """Invariante del modelo: SKILLS 1/2 solo ordenan lo que el operario ya sabe hacer.
    Priorizar un proceso que su rango no le da (200) sería habilitárselo por la ventana."""
    await seed_basico(session)  # el rango cubre 100 y 101; 200 quedó afuera
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="CAMBIADO", apellido="Perez", categoria="OFICIAL",
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=1, habilitado=True)],
    )
    with pytest.raises(BusinessException) as exc:
        await service.modificarOperario(1, dto)

    # El aviso nombra el proceso y dice cómo resolverlo.
    assert "Fresado" in str(exc.value)
    assert "SKILL NATIVA" in str(exc.value)
    assert "rango" in str(exc.value)

    # No se guardó nada: ni el nombre ni la skill.
    res = await session.execute(select(Operario).where(Operario.id == 1))
    assert res.scalar_one().nombre == "Juan"
    assert await _get_skill(session, 1, 200) is None


async def test_put_permite_prioridad_sobre_nativa(session):
    """El caso normal: marcar como SKILL 1 una nativa que el rango ya le da."""
    await seed_basico(session)  # 101 es nativa por rango
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL",
        skills=[ProcesoSkillDTO(id_proceso=101, nivel=1, habilitado=True)],
    )
    resp = await service.modificarOperario(1, dto)

    assert resp.status is True
    skill = await _get_skill(session, 1, 101)
    assert skill is not None and skill.nivel == 1


async def test_put_valida_contra_los_rangos_del_mismo_guardado(session):
    """Si el form cambia rangos y prioridades de una, la nativa se valida contra el rango
    NUEVO: validar contra lo persistido rechazaría una skill que el rango nuevo sí da."""
    await seed_basico(session)
    # Rango 8 nuevo, que sí cubre el proceso 200.
    from backend.domain.Rango import Rango
    from backend.domain.RangoProceso import RangoProceso
    session.add_all([Rango(id=8, nombre="Fresador"), RangoProceso(id_rango=8, id_proceso=200)])
    await session.commit()

    service = OperarioService(session)
    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL",
        rangos=[8],
        skills=[ProcesoSkillDTO(id_proceso=200, nivel=1, habilitado=True)],
    )
    resp = await service.modificarOperario(1, dto)

    assert resp.status is True
    skill = await _get_skill(session, 1, 200)
    assert skill is not None and skill.nivel == 1


async def test_put_dedupe_procesos_repetidos(session):
    """El mismo proceso cargado en SKILLS 1 y SKILLS 2 generaba dos INSERT con la misma
    PK. Se queda una sola fila y gana el nivel 1."""
    await seed_basico(session)
    service = OperarioService(session)

    dto = OperarioRequestDTO(
        nombre="Juan", apellido="Perez", categoria="OFICIAL",
        skills=[
            ProcesoSkillDTO(id_proceso=100, nivel=2, habilitado=True),
            ProcesoSkillDTO(id_proceso=100, nivel=1, habilitado=True),
        ],
    )
    resp = await service.modificarOperario(1, dto)

    assert resp.status is True
    res = await session.execute(
        select(OperarioProcesoSkill).where(OperarioProcesoSkill.id_operario == 1)
    )
    skills = res.scalars().all()
    assert len(skills) == 1
    assert skills[0].id_proceso == 100 and skills[0].nivel == 1


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
        skills=[ProcesoSkillDTO(id_proceso=100, nivel=1, habilitado=True)],
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
        skills=[ProcesoSkillDTO(id_proceso=100, nivel=1, habilitado=True)],
    )
    resp = await service.modificarOperario(1, dto)

    session.commit = real_commit

    assert resp.status is True
    assert llamadas["n"] == 2  # falló una vez y reintentó
    # Tras el reintento, la skill quedó guardada.
    assert await _get_skill(session, 1, 100) is not None


# --- agregarSkill: define la PRIORIDAD de una nativa, no da de alta habilidades ---

class _SkillDTO:
    """Stand-in de ProcesoSkillDTO: agregarSkill solo lee id_proceso y nivel."""
    def __init__(self, id_proceso, nivel):
        self.id_proceso = id_proceso
        self.nivel = nivel


async def test_agregar_skill_marca_prioridad_sobre_nativa(session):
    await seed_basico(session)
    service = OperarioService(session)

    resp = await service.agregarSkill(1, _SkillDTO(100, 1))

    assert resp.status is True
    skill = await _get_skill(session, 1, 100)
    assert skill.nivel == 1 and skill.habilitado is True


async def test_agregar_skill_rechaza_proceso_no_nativo(session):
    await seed_basico(session)  # 200 no lo da ningún rango del operario
    service = OperarioService(session)

    with pytest.raises(BusinessException) as exc:
        await service.agregarSkill(1, _SkillDTO(200, 1))

    assert "Fresado" in str(exc.value)
    assert await _get_skill(session, 1, 200) is None


async def test_agregar_skill_nivel_0_borra_la_fila(session):
    """Quitar la prioridad de una nativa habilitada deja la fila sin nada que decir."""
    await seed_basico(session)
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=1, habilitado=True))
    await session.commit()

    service = OperarioService(session)
    await service.agregarSkill(1, _SkillDTO(100, 0))

    assert await _get_skill(session, 1, 100) is None


async def test_agregar_skill_nivel_0_conserva_la_marca_de_apagada(session):
    """Si la nativa está apagada, quitarle la prioridad NO puede borrar el apagado:
    borrar la fila la reactivaría de forma silenciosa."""
    await seed_basico(session)
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=2, habilitado=False))
    await session.commit()

    service = OperarioService(session)
    await service.agregarSkill(1, _SkillDTO(100, 0))

    skill = await _get_skill(session, 1, 100)
    assert skill is not None and skill.nivel == 0 and skill.habilitado is False


async def test_agregar_skill_prioriza_y_reactiva(session):
    """Marcar prioridad implica que la quiere asignable: prende la nativa apagada."""
    await seed_basico(session)
    session.add(OperarioProcesoSkill(id_operario=1, id_proceso=100, nivel=0, habilitado=False))
    await session.commit()

    service = OperarioService(session)
    await service.agregarSkill(1, _SkillDTO(100, 2))

    skill = await _get_skill(session, 1, 100)
    assert skill.nivel == 2 and skill.habilitado is True
