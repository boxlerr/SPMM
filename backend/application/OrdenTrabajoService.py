from fastapi import HTTPException
from datetime import datetime
from backend.domain.OrdenTrabajo import OrdenTrabajo

from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.application.validators.OrderValidator import orderValidator #importo la funcion, deberia tener una clase?
from backend.commons.exceptions.InfrastructureException import InfrastructureException

class OrdenTrabajoService: ##sacar el Crear
    def __init__(self):
        pass
    

    def crearOrden(self, orden_dto: OrdenTrabajoRequestDTO):
        try:
            errores = orderValidator(orden_dto)
            if errores:
                return ResponseDTO(
                    status=False,
                    data={},
                    errorDescription="; ".join(errores)
                )

            orden = OrdenTrabajo(
                id_otvieja=orden_dto.id_otvieja,
                observaciones=orden_dto.observaciones,
                id_prioridad=orden_dto.id_prioridad,
                id_sector=orden_dto.id_sector,
                id_articulo=orden_dto.id_articulo,
                id_maquinaria=orden_dto.id_maquinaria,
                fecha_orden=orden_dto.fecha_orden,
                fecha_entrada=orden_dto.fecha_entrada,
                fecha_prometida=orden_dto.fecha_prometida,
                fecha_entrega=orden_dto.fecha_entrega,
            )

            orden_repository = OrdenTrabajoRepository()
            orden_creada = orden_repository.save(orden)

            return ResponseDTO(
                status=True,
                data=jsonable_encoder(orden_creada),
                errorDescription=''
            )

        except Exception as e:
            raise InfrastructureException("Error al guardar la OT.") from e

    def eliminarOrden(self, id: int):
            try:
                orden_repository = OrdenTrabajoRepository()

                orden_existente = orden_repository.find_by_id(id)
                if not orden_existente:
                    return ResponseDTO(
                        status=False,
                        data={},
                        errorDescription="No se encontró la orden de trabajo con ese ID."
                    )

                orden_repository.delete(id)

                return ResponseDTO(
                    status=True,
                    data={"id_eliminado": id},
                    errorDescription=""
                )

            except InfrastructureException as e:
                raise e
            except Exception as e:
                raise InfrastructureException("Error al eliminar la OT.") from e
            
            
            
    