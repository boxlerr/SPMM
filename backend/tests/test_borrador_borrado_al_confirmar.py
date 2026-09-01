"""
Confirmar un plan tiene que sacar de "Planes sin confirmar" el borrador que se
confirmó, y ningún otro.

Hasta el 1/9 el backend lo adivinaba: borraba todos los borradores cuyo lote de OTs
estuviera CONTENIDO en el que se confirmaba (`ordenes_ids <@ :ids`), sin filtro de
usuario ni de nada. Confirmar una tanda de 176 OTs se llevaba puestos los borradores
propios y ajenos que no tenían nada que ver con ese plan. Ahora el frontend manda el
`borrador_id` y se borra esa fila; el borrado por lote quedó de respaldo y compara
por IGUALDAD.

Esa igualdad se apoya en que el lote se normalice igual al guardar y al borrar. Es
lo que se fija acá: el SQL no se puede ejercitar sin un Postgres —JSONB no existe en
el SQLite del harness— pero el invariante del que depende sí.
"""
from backend.infrastructure.PlanificacionBorradorRepository import _ids_normalizados


def test_ordena_y_saca_repetidos():
    assert _ids_normalizados([7, 3, 7]) == "[3, 7]"


def test_el_orden_de_entrada_no_cambia_el_resultado():
    # Si `guardar` normalizara distinto que `borrar_por_ordenes`, en JSONB [7, 3] y
    # [3, 7] son valores distintos: el borrador recién confirmado no coincidiría con
    # nada y se quedaría para siempre en la lista de "Planes sin confirmar".
    assert _ids_normalizados([7, 3]) == _ids_normalizados([3, 7])


def test_lote_vacio():
    # `[]` está contenido en cualquier cosa: con el DELETE por contención, un
    # borrador que hubiera quedado sin OTs lo borraba CUALQUIER confirmación. Por
    # igualdad ya no, y además `borrar_por_ordenes` corta antes si el lote es vacío.
    assert _ids_normalizados([]) == "[]"
    assert _ids_normalizados(None) == "[]"
