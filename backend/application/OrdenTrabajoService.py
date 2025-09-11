from datetime import datetime
from backend.domain.OrdenTrabajo import OrdenTrabajo

from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.application.validators.OrderValidator import orderValidator #importo la funcion, deberia tener una clase?

class OrdenTrabajoService: ##sacar el Crear
    def __init__(self):
        pass
    

    def crearOrden(self, orden_dto: OrdenTrabajoRequestDTO):
    
        errores = orderValidator(orden_dto)
        if errores:
            return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))
    
        try:
            orden = OrdenTrabajo(
            id_ot=orden_dto.id_ot,
            descripcion=orden_dto.descripcion,
            id_operario=orden_dto.id_operario,
            id_maquinaria=orden_dto.id_maquinaria
            )
            orden.fecha = datetime.now()
            
            orden_repository = OrdenTrabajoRepository()
            
            orden_creada = orden_repository.save(orden)
            
            response = ResponseDTO()
            response.status = True
            response.data = jsonable_encoder(orden_creada)
            response.errorDescription = ''
            
            return response
        except Exception as e:
            response = ResponseDTO(
                status=False,
                data={},
                errorDescription=str(e)
            )
            return response

