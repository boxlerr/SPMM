from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from datetime import datetime
class OrdenTrabajoService:
    def __init__(self):
        pass

    def crearOrdenTrabajo(self, dto: OrdenTrabajoRequestDTO):
        try:
            orden = OrdenTrabajo(
                id_otvieja=dto.id_otvieja,
                observaciones=dto.observaciones,
                id_prioridad=dto.id_prioridad,
                id_sector=dto.id_sector,
                id_articulo=dto.id_articulo,
                id_maquinaria=dto.id_maquinaria,
                fecha_orden=dto.fecha_orden,
                fecha_entrada=dto.fecha_entrada,
                fecha_prometida=dto.fecha_prometida,
                fecha_entrega=dto.fecha_entrega
            )

            repo = OrdenTrabajoRepository()
            creada = repo.save(orden)

            return ResponseDTO(status=True, data=jsonable_encoder(creada))
        except Exception as e:
            raise InfrastructureException("Error al guardar la Orden de Trabajo.") from e

    def listarOrdenes(self):
        repo = OrdenTrabajoRepository()
        ordenes = repo.find_all()
        return ResponseDTO(status=True, data=jsonable_encoder(ordenes))

    def obtenerOrdenPorId(self, id: int):
        repo = OrdenTrabajoRepository()
        orden = repo.find_by_id(id)
        if not orden:
            return ResponseDTO(status=False, data={}, errorDescription="Orden de Trabajo no encontrada")
        return ResponseDTO(status=True, data=jsonable_encoder(orden))

    def modificarOrden(self, id: int, dto: OrdenTrabajoRequestDTO):
        try:    
            repo = OrdenTrabajoRepository()
            nueva_data = dto.model_dump(exclude_unset=True)
            actualizado = repo.update(id, nueva_data)

            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Orden de Trabajo no encontrada")

            return ResponseDTO(status=True, data=jsonable_encoder(actualizado))  # 👈 IMPORTANTE

        except Exception as e:
            raise InfrastructureException("Error al actualizar la Orden de Trabajo.") from e


    def eliminarOrden(self, id: int):
        try:
            repo = OrdenTrabajoRepository()
            ok = repo.delete(id)
            if not ok:
                return ResponseDTO(status=False, data={}, errorDescription="Orden de Trabajo no encontrada")
            return ResponseDTO(status=True, data={"deleted": id})
        except Exception as e:
            raise InfrastructureException("Error al eliminar la Orden de Trabajo.") from e
        
    def listarPorFechas(self, desde: datetime, hasta: datetime):
        repo = OrdenTrabajoRepository()
        ordenes = repo.find_by_fecha_orden_entre(desde, hasta)
        return ResponseDTO(status=True, data=jsonable_encoder(ordenes))

    def listarPorPrioridad(self, id_prioridad: int):
        repo = OrdenTrabajoRepository()
        ordenes = repo.find_by_prioridad(id_prioridad)
        return ResponseDTO(status=True, data=jsonable_encoder(ordenes))

