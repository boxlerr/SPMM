"""
Tests puros de _build_skills_payload.

El payload es la vista unificada que consume la UI: TODAS las skills nativas del
operario (rango × procesos del rango), cada una con su prioridad (nivel 0/1/2) y si
está apagada. Las filas de operario_proceso_skill son overrides sobre esas nativas,
no un catálogo aparte.
"""
from types import SimpleNamespace

from backend.application.OperarioService import _build_skills_payload


def make_op(skills, rangos_procs):
    """
    skills: lista de (id_proceso, nivel, habilitado) o (id_proceso, nivel, habilitado, orden).
    rangos_procs: lista de listas de id_proceso, una por rango del operario.
    """
    procesos_skill = [
        SimpleNamespace(id_proceso=t[0], nivel=t[1], habilitado=t[2], orden=(t[3] if len(t) > 3 else None))
        for t in skills
    ]
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
    assert m[100] == {"id_proceso": 100, "nivel": 0, "habilitado": True, "orden": None, "nativa": True}
    assert m[101] == {"id_proceso": 101, "nivel": 0, "habilitado": True, "orden": None, "nativa": True}


def test_override_desactiva_nativa():
    # Fila persistida habilitado False -> la nativa queda apagada.
    op = make_op(skills=[(100, 0, False)], rangos_procs=[[100, 101]])
    m = by_proceso(_build_skills_payload(op))
    assert m[100]["nivel"] == 0 and m[100]["habilitado"] is False
    assert m[101]["habilitado"] is True


def test_prioridad_se_aplica_sobre_la_nativa():
    # Marcar SKILL 1 no crea una entrada aparte: anota la nativa que ya existía.
    op = make_op(skills=[(100, 1, True)], rangos_procs=[[100, 101]])
    payload = _build_skills_payload(op)
    m = by_proceso(payload)
    assert len([x for x in payload if x["id_proceso"] == 100]) == 1
    assert m[100]["nivel"] == 1 and m[100]["nativa"] is True
    assert m[101]["nivel"] == 0


def test_nativa_puede_estar_priorizada_y_apagada():
    # Ejes independientes: se conserva la prioridad aunque esté apagada.
    op = make_op(skills=[(100, 2, False)], rangos_procs=[[100]])
    m = by_proceso(_build_skills_payload(op))
    assert m[100]["nivel"] == 2 and m[100]["habilitado"] is False


def test_override_huerfano_fuera_de_rango_se_emite_marcado():
    # Resto del modelo viejo: una fila sobre un proceso que el rango ya no da. Se
    # emite con nativa=False para no esconder lo que está en la base; el planificador
    # la ignora y el próximo guardado la limpia.
    op = make_op(skills=[(200, 1, True)], rangos_procs=[[100]])
    m = by_proceso(_build_skills_payload(op))
    assert m[200]["nativa"] is False and m[200]["nivel"] == 1
    assert m[100]["nativa"] is True and m[100]["nivel"] == 0


def test_dedupe_entre_rangos():
    # Dos rangos que comparten el proceso 100 -> aparece una sola vez.
    op = make_op(skills=[], rangos_procs=[[100], [100, 101]])
    payload = _build_skills_payload(op)
    assert len([x for x in payload if x["id_proceso"] == 100]) == 1
    assert {x["id_proceso"] for x in payload} == {100, 101}
