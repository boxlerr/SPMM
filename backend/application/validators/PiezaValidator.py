from backend.dto.PiezaRequestDTO import PiezaRequestDTO

def piezaValidator(pieza_dto: PiezaRequestDTO):
    errores = []

    if not pieza_dto.cod_pieza or len(pieza_dto.cod_pieza.strip()) == 0:
        errores.append("El código de la pieza no puede estar vacío")

    if not pieza_dto.descripcion or len(pieza_dto.descripcion.strip()) == 0:
        errores.append("La descripción no puede estar vacía")

    return errores
