from backend.dto.PrioridadRequestDTO import PrioridadRequestDTO

def prioridadValidator(dto: PrioridadRequestDTO):
    errores = []

    if not dto.descripcion or len(dto.descripcion.strip()) == 0:
        errores.append("La descripción de la prioridad no puede estar vacía")

    if dto.descripcion and len(dto.descripcion) > 100:
        errores.append("La descripción no puede superar los 100 caracteres")

    if dto.detalle and len(dto.detalle) > 255:
        errores.append("El detalle no puede superar los 255 caracteres")

    return errores
