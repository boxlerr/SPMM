from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

def procesoValidator(dto: ProcesoRequestDTO):
    errores = []

    if dto.nombre and len(dto.nombre.strip()) == 0:
        errores.append("El nombre no puede estar vacío si se envía.")

    if dto.nombre and len(dto.nombre) > 255:
        errores.append("El nombre no puede superar los 255 caracteres.")

    if dto.descripcion and len(dto.descripcion.strip()) == 0:
        errores.append("La descripción no puede estar vacía si se envía.")

    return errores
