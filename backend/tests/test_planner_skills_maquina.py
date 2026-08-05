"""
Elegibilidad en el planificador = SKILLS NATIVAS (rango del operario × rangos del proceso).

Modelo acordado con Lucas (5/8): la nativa dice quién PUEDE hacer el proceso;
SKILLS 1 y 2 solo ordenan la preferencia dentro de ese conjunto y nunca restringen.
Para que alguien no haga algo que su rango le habilita, se DESACTIVA esa nativa.

Verifica _crear_variables_y_dominios (sin tocar la base):
  - un proceso de máquina se abre a los operarios con el rango, tengan o no
    SKILL 1/2 cargada (antes quedaba sin asignar: era el "modo skill-map");
  - tener SKILL 1/2 no excluye al resto de las nativas;
  - desactivar la nativa sí saca al operario;
  - un proceso sin ninguna nativa habilitada queda sin asignar (solo DUMMY).

Contexto: reemplaza al modo skill-map anterior, que restringía el proceso a quienes
tuvieran nivel 1/2 y dejaba fuera a nativas perfectamente capaces (98/137 procesos de
máquina quedaban sin asignar — ver backend/scripts/auditoria_skills.py).
"""
from ortools.sat.python import cp_model

import backend.application.PlanificacionService as ps
from backend.application.PlanificacionService import _crear_variables_y_dominios

OP_DOMAIN_VALS_IDX = 13
DUMMY_OP_ID = 999999
MAQUINAS = [(20, set(), "TORNO A", "TORNO-A"), (21, set(), "TORNO B", "TORNO-B")]


def _dominio_operarios(nombre, usa_maquina, op_skill_levels, rangos_proc,
                       operarios=None, nativas_off=None):
    operarios = operarios if operarios is not None else [(10, 7), (11, 7)]
    ps.H = 100000
    model = cp_model.CpModel()
    # (orden, proc, sec, fecha, peso, dur, rangos_proc, nombre, usa_maquina, familia, op_skill_levels)
    procesos_norm = [(1, 100, 1, None, 5, 60, rangos_proc, nombre, usa_maquina, "", op_skill_levels)]
    ret = _crear_variables_y_dominios(
        model, procesos_norm, operarios, MAQUINAS, set(), set(), nativas_off or {}
    )
    return ret[OP_DOMAIN_VALS_IDX][(1, 1)]


def test_maquina_sin_skills_se_abre_a_las_nativas():
    # CILINDRADO = PRODUCCION_MAQUINA. Sin SKILL 1/2 cargada, los operarios con el
    # rango [7] son elegibles igual: el rango ya dice que saben hacerlo.
    dom = _dominio_operarios("CILINDRADO", True, {}, [7])
    assert 10 in dom and 11 in dom


def test_skill_cargada_no_excluye_a_las_demas_nativas():
    # El operario 10 tiene SKILL 1; el 11 solo la nativa. Ambos siguen siendo
    # elegibles — la marca de 10 se paga en la función objetivo, no en el dominio.
    dom = _dominio_operarios("CILINDRADO", True, {10: 1}, [7])
    assert 10 in dom and 11 in dom


def test_maquina_respeta_el_rango():
    # El rango sigue mandando: un operario cuyo rango no habilita el proceso no entra.
    dom = _dominio_operarios("CILINDRADO", True, {}, [7], operarios=[(10, 7), (11, 9)])
    assert 10 in dom
    assert 11 not in dom


def test_nativa_desactivada_sale_aunque_sea_maquina():
    # Única forma de sacar a alguien de un proceso que su rango le da.
    dom = _dominio_operarios("CILINDRADO", True, {}, [7], nativas_off={100: {10}})
    assert 10 not in dom
    assert 11 in dom


def test_maquina_sin_ninguna_nativa_queda_sin_asignar():
    # Si el rango del proceso no lo cubre nadie, no hay a quién asignarlo.
    dom = _dominio_operarios("CILINDRADO", True, {}, [7], operarios=[(10, 9), (11, 9)])
    assert dom == [DUMMY_OP_ID]


def test_manual_sin_skill_sigue_por_rango():
    # Proceso NO-máquina (usa_maquina=False): el camino por rango sigue igual,
    # los operarios con el rango del proceso quedan válidos.
    dom = _dominio_operarios("armado", False, {}, [7])
    assert 10 in dom and 11 in dom


def test_manual_sin_rango_ni_skill_abre_a_todos():
    # Regresión: proceso manual sin rango ni skills -> abierto (comportamiento previo).
    dom = _dominio_operarios("armado", False, {}, [])
    assert 10 in dom and 11 in dom


def test_operario_con_varios_rangos_no_duplica_el_dominio():
    # find_with_rangos devuelve una fila por (operario, rango): un operario con dos
    # rangos que habilitan el proceso aparecía dos veces en el dominio del solver.
    dom = _dominio_operarios("armado", False, {}, [7, 8], operarios=[(10, 7), (10, 8), (11, 7)])
    assert dom.count(10) == 1
    assert 11 in dom
