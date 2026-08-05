"""
Desempate por POSICIÓN dentro de SKILLS 1 / SKILLS 2.

`orden` (0 = primero) refina la preferencia dentro de un mismo nivel, pero el nivel
sigue mandando: un SKILL 1 al fondo de una lista larga tiene que seguir ganándole a
un SKILL 2 al tope. Si el aporte de la posición no estuviera acotado, una lista de 74
skills haría que la posición pesara más que el nivel — que es justo lo que no se
quiere.

Se prueba la escala de penalizaciones que arma _agregar_funcion_objetivo: menor penalización
= más preferido por el solver.
"""
import inspect


import pytest

from backend.application import PlanificacionService as ps


def _tabla_penalizaciones():
    """
    Reconstruye `_penal_prioridad` desde el fuente de _agregar_funcion_objetivo.

    Es una closure interna (usa las constantes locales de la función), así que no se
    puede importar. Extraer el bloque y ejecutarlo mantiene el test pegado al código
    real: si alguien cambia las constantes, este test las ve.
    """
    fuente = inspect.getsource(ps._agregar_funcion_objetivo)
    ini = fuente.index("    PENAL_SKILL1")
    fin = fuente.index("    for (orden_id, proc_id, secuencia, fecha_prometida")
    bloque = inspect.cleandoc(fuente[ini:fin])
    entorno = {}
    exec(bloque, entorno)
    return entorno["_penal_prioridad"], entorno


PENAL, CONST = _tabla_penalizaciones()


def test_primero_de_skill1_es_lo_mas_preferido():
    assert PENAL((1, 0)) == 0


def test_dentro_del_nivel_gana_el_de_arriba():
    assert PENAL((1, 0)) < PENAL((1, 1)) < PENAL((1, 5))
    assert PENAL((2, 0)) < PENAL((2, 3))


def test_el_nivel_manda_sobre_la_posicion():
    # El último de una lista de 74 en SKILL 1 sigue ganándole al primero de SKILL 2.
    assert PENAL((1, 73)) < PENAL((2, 0))
    # Y el último de SKILL 2 le gana a una nativa sin marcar.
    assert PENAL((2, 73)) < PENAL(None)


def test_sin_posicion_va_al_final_de_su_lista():
    assert PENAL((1, None)) > PENAL((1, 10))
    # Pero sigue siendo SKILL 1: no se degrada a SKILL 2.
    assert PENAL((1, None)) < PENAL((2, 0))


def test_nativa_sin_marcar_es_la_menos_preferida():
    assert PENAL(None) > PENAL((2, 73))


def test_acepta_nivel_pelado_sin_romper():
    # El mapa pasó a emitir tuplas al agregar `orden`; un llamador viejo que pase el
    # nivel suelto no puede reventar el armado del modelo.
    assert PENAL(1) == PENAL((1, None))


def test_el_aporte_de_posicion_esta_acotado():
    # Sin tope, una lista larga haría que la posición superara el salto entre niveles.
    salto_entre_niveles = CONST["PENAL_SKILL2"] - CONST["PENAL_SKILL1"]
    assert CONST["TOPE_PENAL_POSICION"] < salto_entre_niveles
    assert PENAL((1, 9999)) - PENAL((1, 0)) <= CONST["TOPE_PENAL_POSICION"]


@pytest.mark.parametrize("entrada", [(1, 0), (1, 3), (2, 0), (2, 3), (0, None), None])
def test_ninguna_penalizacion_es_negativa(entrada):
    assert PENAL(entrada) >= 0
