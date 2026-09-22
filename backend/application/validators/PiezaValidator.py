import math

from backend.dto.PiezaRequestDTO import PiezaRequestDTO

def piezaValidator(pieza_dto: PiezaRequestDTO):
    errores = []

    if not pieza_dto.cod_pieza or len(pieza_dto.cod_pieza.strip()) == 0:
        errores.append("El código de la pieza no puede estar vacío")

    if not pieza_dto.descripcion or len(pieza_dto.descripcion.strip()) == 0:
        errores.append("La descripción no puede estar vacía")

    return errores


# Más que esto no es un mínimo, es un error de tipeo (un código pegado en la celda
# equivocada). El número es generoso a propósito: el catálogo mezcla unidades, metros
# y kilos, y no hay que frenar a nadie que tenga un mínimo grande de verdad.
STOCK_MINIMO_TOPE = 1_000_000


def stockMinimoValidator(valor):
    """El stock mínimo de una pieza (RF-14). `None` es válido: quita el mínimo.

    El 0 se acepta y quiere decir «avisame sólo si el stock queda negativo», que en
    este catálogo pasa (el sistema viejo deja descontar de más). Negativo no: no hay
    forma de «quedar abajo» de un mínimo negativo que tenga sentido para el pañol.
    """
    errores = []
    if valor is None:
        return errores
    # JSON no trae NaN ni infinito, pero Python los acepta al parsear y Pydantic
    # también: sin esto un NaN se guardaría y la comparación daría siempre falso.
    if not math.isfinite(valor):
        errores.append("El stock mínimo tiene que ser un número")
    elif valor < 0:
        errores.append("El stock mínimo no puede ser negativo")
    elif valor > STOCK_MINIMO_TOPE:
        errores.append(f"El stock mínimo no puede pasar de {STOCK_MINIMO_TOPE:,}".replace(",", "."))
    return errores
