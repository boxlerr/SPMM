import math

from backend.dto.ConsumoMaterialRequestDTO import ConsumoMaterialRequestDTO

# Lo más grande que entra en NUMERIC(18,3). Pasarse no es un error de negocio: es un
# número tipeado de más, y sin este tope la base lo rechaza con un 500 que no dice nada.
CANTIDAD_MAXIMA = 999_999_999_999_999

# Una observación es una aclaración, no un informe. Sin tope, un pegado accidental
# de una planilla entera termina en cada renglón del listado.
LARGO_OBSERVACIONES = 1000


def consumoMaterialValidator(dto: ConsumoMaterialRequestDTO) -> list[str]:
    errores = []

    if dto.id_orden_trabajo is None or dto.id_orden_trabajo <= 0:
        errores.append("El consumo tiene que estar asociado a una orden de trabajo.")

    if dto.id_orden_trabajo_pieza is None and dto.id_pieza is None:
        errores.append("Falta decir qué material se consumió (la línea de la orden o la pieza).")
    if dto.id_orden_trabajo_pieza is not None and dto.id_orden_trabajo_pieza <= 0:
        errores.append("La línea de material no es válida.")
    if dto.id_pieza is not None and dto.id_pieza <= 0:
        errores.append("La pieza no es válida.")

    cantidad = dto.cantidad
    if cantidad is None or not math.isfinite(cantidad):
        errores.append("La cantidad consumida tiene que ser un número.")
    # Se mira lo que va a quedar guardado (3 decimales): 0,0004 se redondea a 0 y la
    # base lo rechazaría con un error que el taller no entiende.
    elif round(cantidad, 3) <= 0:
        errores.append("La cantidad consumida tiene que ser mayor a 0. "
                       "Si se cargó de más, anulá esa carga y registrá la correcta.")
    elif cantidad > CANTIDAD_MAXIMA:
        errores.append("La cantidad consumida es demasiado grande. Revisá el número.")

    if dto.observaciones and len(dto.observaciones.strip()) > LARGO_OBSERVACIONES:
        errores.append(f"La observación no puede pasar de {LARGO_OBSERVACIONES} caracteres.")

    return errores
