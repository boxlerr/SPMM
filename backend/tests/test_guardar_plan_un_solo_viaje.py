"""Guardar el plan tiene que ser UN envío a la base, no uno por paso.

Medido contra Supabase el 15/09: cada ida y vuelta a São Paulo cuesta ~79 ms. Con un
INSERT por fila, guardar un plan de 97 pasos se iba 7,55 s SOLO en viajes; en una sola
operación tarda 0,08 s. El trabajo de la base es despreciable al lado de la latencia,
así que lo único que importa es cuántas veces se cruza el océano.

Esto se rompe fácil sin querer: alguien mueve el `execute` adentro del `for` para
"loguear cada fila" o para manejar un error puntual, y el guardado vuelve a tardar
ocho segundos sin que ningún test lo note.
"""
import re
from pathlib import Path

FUENTE = (Path(__file__).resolve().parent.parent
          / "infrastructure" / "PlanificacionRepository.py").read_text()


def _cuerpo(nombre: str) -> str:
    """El cuerpo de un método, hasta el siguiente def del mismo nivel."""
    i = FUENTE.index(f"async def {nombre}(")
    resto = FUENTE[i:]
    m = re.search(r"\n    async def |\n    def ", resto[10:])
    return resto[: 10 + m.start()] if m else resto


def test_el_insert_del_plan_no_esta_adentro_del_for():
    cuerpo = _cuerpo("insertar_planificacion_lote")
    assert "insert_query" in cuerpo, "cambió el nombre de la consulta; revisar este test"

    lineas = cuerpo.splitlines()
    dentro_del_for = False
    sangria_for = 0
    for ln in lineas:
        if not ln.strip():
            continue
        sangria = len(ln) - len(ln.lstrip())
        if dentro_del_for and sangria <= sangria_for:
            dentro_del_for = False
        if re.match(r"\s*for .+ in resultados", ln):
            dentro_del_for, sangria_for = True, sangria
            continue
        if dentro_del_for and "execute(insert_query" in ln:
            raise AssertionError(
                "El INSERT del plan volvió a estar adentro del for: eso es una ida y "
                "vuelta a la base por cada paso del plan (~79 ms cada una). Junten las "
                "filas en una lista y pásenla entera a execute()."
            )


def test_se_manda_la_lista_entera_de_una():
    cuerpo = _cuerpo("insertar_planificacion_lote")
    assert re.search(r"execute\(\s*insert_query,\s*filas\s*\)", cuerpo), (
        "No se encontró el envío único `execute(insert_query, filas)`."
    )
    # Y un solo commit: si aparecen dos, alguien partió el guardado en tandas y un
    # plan puede quedar guardado a medias.
    assert cuerpo.count("await self.db.commit()") == 1
