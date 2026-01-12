from backend.dto.OrdenTrabajoPiezaRequestDTO import OrdenTrabajoPiezaRequestDTO

def ordenTrabajoPiezaValidator(dto: OrdenTrabajoPiezaRequestDTO):
    errores = []

    if dto.id_orden_trabajo <= 0:
        errores.append("El ID de la orden de trabajo debe ser mayor a 0")
    
    if dto.id_pieza <= 0:
        errores.append("El ID de la pieza debe ser mayor a 0")

    if dto.cantidad <= 0:
        errores.append("La cantidad debe ser mayor a 0")

    return errores
