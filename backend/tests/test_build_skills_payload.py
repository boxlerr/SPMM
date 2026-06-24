"""
Tests puros de _build_skills_payload: combina skills cargadas (nivel 1/2) con
nativas derivadas del rango (nivel 0), aplicando overrides de desactivación.
"""
from types import SimpleNamespace

from backend.application.OperarioService import _build_skills_payload


def make_op(skills, rangos_procs):
    """
    skills: lista de (id_proceso, nivel, habilitado) persistidas.
    rangos_procs: lista de listas de id_proceso, una por rango del operario.
    """
    procesos_skill = [SimpleNamespace(id_proceso=p, nivel=n, habilitado=h) for (p, n, h) in skills]
    rangos = []
    for procs in rangos_procs:
        rango = SimpleNamespace(procesos=[SimpleNamespace(id_proceso=pid) for pid in procs])
        rangos.append(SimpleNamespace(rango=rango))
    return SimpleNamespace(procesos_skill=procesos_skill, rangos=rangos)


def by_proceso(payload):
    return {item["id_proceso"]: item for item in payload}


def test_nativas_derivadas_del_rango():
    op = make_op(skills=[], rangos_procs=[[100, 101]])
    m = by_proceso(_build_skills_payload(op))
    assert m[100] == {"id_proceso": 100, "nivel": 0, "habilitado": True}
    assert m[101] == {"id_proceso": 101, "nivel": 0, "habilitado": True}


def test_override_desactiva_nativa():
    # Fila persistida nivel 0 / habilitado False -> override de desactivación.
    op = make_op(skills=[(100, 0, False)], rangos_procs=[[100, 101]])
    m = by_proceso(_build_skills_payload(op))
    assert m[100]["nivel"] == 0 and m[100]["habilitado"] is False
    assert m[101]["habilitado"] is True


def test_skill_manual_gana_a_nativa():
    op = make_op(skills=[(100, 1, True)], rangos_procs=[[100, 101]])
    payload = _build_skills_payload(op)
    m = by_proceso(payload)
    # 100 aparece UNA sola vez, como nivel 1 (cargada), no como nativa.
    assert len([x for x in payload if x["id_proceso"] == 100]) == 1
    assert m[100]["nivel"] == 1
    assert m[101]["nivel"] == 0


def test_override_huerfano_fuera_de_rango_no_se_emite():
    # Fila nivel 0 para un proceso que ya no está en el rango -> no se muestra.
    op = make_op(skills=[(200, 0, False)], rangos_procs=[[100]])
    m = by_proceso(_build_skills_payload(op))
    assert 200 not in m
    assert m[100]["nivel"] == 0 and m[100]["habilitado"] is True


def test_dedupe_entre_rangos():
    # Dos rangos que comparten el proceso 100 -> aparece una sola vez.
    op = make_op(skills=[], rangos_procs=[[100], [100, 101]])
    payload = _build_skills_payload(op)
    assert len([x for x in payload if x["id_proceso"] == 100]) == 1
    assert {x["id_proceso"] for x in payload} == {100, 101}
