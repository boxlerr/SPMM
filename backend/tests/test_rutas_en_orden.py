"""Una ruta con nombre fijo tiene que declararse ANTES que la comodín que la tapa.

FastAPI resuelve las rutas en el orden en que se declaran y se queda con la primera
que encaja. `PUT /ordenes/{id}` encaja con CUALQUIER cosa en ese lugar, incluido
`estado-masivo`: si la ruta con nombre se declara después, el request entra por la
comodín, que intenta leer "estado-masivo" como un número entero y contesta 422.

No lo agarra ningún test de servicio ni el typecheck del front: la URL es un string y
el endpoint existe. Se ve recién cuando alguien aprieta el botón — y se lee como "no
anda el botón", no como "las rutas están en mal orden".

Es primo de test_rutas_que_llama_el_front.py: aquel cuida que la ruta EXISTA, este
cuida que se pueda LLEGAR a ella.
"""
import pytest

from backend.presentation.main import app


def _rutas(metodo: str) -> list[str]:
    """Las rutas de ese método, en el orden en que FastAPI las va a probar."""
    return [
        r.path for r in app.routes
        if metodo in (getattr(r, "methods", None) or set()) and getattr(r, "path", None)
    ]


# (método, ruta con nombre, comodín que la taparía)
TAPADAS = [
    ("PUT", "/ordenes/estado-masivo", "/ordenes/{id}"),
    # Materia prima (23/09/2026): la barra de acciones de Pendientes cambia muchas líneas.
    ("PUT", "/materia-prima/lineas/lote", "/materia-prima/lineas/{id_linea}"),
]


@pytest.mark.parametrize("metodo,fija,comodin", TAPADAS)
def test_la_ruta_con_nombre_va_antes_que_la_comodin(metodo, fija, comodin):
    rutas = _rutas(metodo)
    assert fija in rutas, f"{metodo} {fija} no existe"
    assert comodin in rutas, f"{metodo} {comodin} no existe (¿se renombró?)"
    assert rutas.index(fija) < rutas.index(comodin), (
        f"{metodo} {fija} está declarada DESPUÉS de {comodin}, así que nunca la va a "
        f"atender: el request entra por la comodín y devuelve 422. Movela más arriba "
        f"en el archivo del router."
    )


def test_ninguna_ruta_fija_queda_tapada_por_una_comodin():
    """La regla general, para las que vengan después.

    Recorre todas las rutas y se fija si alguna con un segmento fijo está declarada
    después de otra idéntica salvo por un parámetro en esa posición.
    """
    problemas = []
    for metodo in ("GET", "PUT", "POST", "DELETE", "PATCH"):
        rutas = _rutas(metodo)
        for i, fija in enumerate(rutas):
            partes_f = fija.strip("/").split("/")
            for comodin in rutas[:i]:
                partes_c = comodin.strip("/").split("/")
                if len(partes_c) != len(partes_f):
                    continue
                # ¿La anterior encaja con esta, y es MÁS general (tiene parámetro
                # donde esta tiene un nombre fijo)?
                encaja, mas_general = True, False
                for pc, pf in zip(partes_c, partes_f):
                    if pc == pf:
                        continue
                    if pc.startswith("{") and not pf.startswith("{"):
                        mas_general = True
                        continue
                    encaja = False
                    break
                if encaja and mas_general:
                    problemas.append(f"{metodo} {fija} queda tapada por {comodin}")

    assert not problemas, (
        "Hay rutas inalcanzables (la comodín las atiende primero):\n  "
        + "\n  ".join(problemas)
        + "\nDeclaralas antes que la comodín en su router."
    )
