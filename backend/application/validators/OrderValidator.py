from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO

def orderValidator(order_dto: OrdenTrabajoRequestDTO):
    errores = []

    if not order_dto.descripcion or len(order_dto.descripcion.strip()) == 0:
        errores.append("La descripción no puede estar vacía")
    
    if order_dto.id_operario <= 0:
        errores.append("El id del operario debe ser mayor que 0")
    
    if order_dto.id_maquinaria <= 0:
        errores.append("El id de la maquinaria debe ser mayor que 0")
    
    return errores