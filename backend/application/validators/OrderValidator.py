from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO

def orderValidator(order_dto: OrdenTrabajoRequestDTO):
    errores = []

    if order_dto.id_otvieja <= 0:
        errores.append("El id de la orden vieja debe ser mayor que 0")

    if order_dto.id_prioridad <= 0:
        errores.append("El id de prioridad debe ser mayor que 0")

    if order_dto.id_sector <= 0:
        errores.append("El id de sector debe ser mayor que 0")

    if order_dto.id_articulo <= 0:
        errores.append("El id de artículo debe ser mayor que 0")

    if order_dto.id_maquinaria <= 0:
        errores.append("El id de la maquinaria debe ser mayor que 0")

    if order_dto.fecha_orden > order_dto.fecha_prometida:
        errores.append("La fecha de orden no puede ser posterior a la fecha prometida")

    if order_dto.fecha_entrada > order_dto.fecha_prometida:
        errores.append("La fecha de entrada no puede ser posterior a la fecha prometida")

    if order_dto.fecha_entrega and order_dto.fecha_entrega < order_dto.fecha_orden:
        errores.append("La fecha de entrega no puede ser anterior a la fecha de orden")

    return errores
