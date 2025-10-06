from backend.domain.Operario import Operario
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
from backend.infrastructure.OperarioRepository import OperarioRepository

from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException


class OperarioService:
    """
    Capa de aplicación de Operario: validación mínima, delega en repo y
    devuelve `ResponseDTO`.
    """

    def __init__(self):
        pass

    def crearOperario(self, operario_dto: OperarioRequestDTO):
        try:
            # Validación mínima (igual criterio que en otros servicios)
            if not operario_dto.nombre or not operario_dto.apellido:
                raise BusinessException("Nombre y Apellido son obligatorios.")

            operario = Operario(
                nombre=operario_dto.nombre,
                apellido=operario_dto.apellido,
                fecha_nacimiento=operario_dto.fecha_nacimiento,
                fecha_ingreso=operario_dto.fecha_ingreso,
                sector=operario_dto.sector,
                categoria=operario_dto.categoria,
                disponible=operario_dto.disponible if operario_dto.disponible is not None else True,
                cant_hs_trabajadas=operario_dto.cant_hs_trabajadas if operario_dto.cant_hs_trabajadas is not None else 0,
                dias_trabajo=operario_dto.dias_trabajo,
            )

            repo = OperarioRepository()
            operario_creado = repo.save(operario)

            response = ResponseDTO()
            response.status = True
            response.data = jsonable_encoder(operario_creado)
            response.errorDescription = ""

            return response

        except Exception as e:
            raise InfrastructureException("Error al guardar el Operario.") from e

    def eliminarOperario(self, id: int):
        try:
            ok = OperarioRepository().delete(id)
            response = ResponseDTO()
            response.status = bool(ok)
            response.data = {"deleted": bool(ok)}
            response.errorDescription = "" if ok else "Operario no encontrado"
            return response
        except Exception as e:
            raise InfrastructureException("Error al eliminar el Operario.") from e

    def listarOperarios(self):
        try:
            data = [
                {
                    "id": o.id,
                    "nombre": o.nombre,
                    "apellido": o.apellido,
                    "sector": o.sector,
                    "categoria": o.categoria,
                }
                for o in OperarioRepository().find_all()
            ]
            return ResponseDTO(status=True, data=data, errorDescription="")
        except Exception as e:
            raise InfrastructureException("Error al listar Operarios.") from e

    def obtenerOperarioPorId(self, id: int):
        try:
            o = OperarioRepository().find_by_id(id)
            if not o:
                return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")
            return ResponseDTO(status=True, data={
                "id": o.id,
                "nombre": o.nombre,
                "apellido": o.apellido,
                "sector": o.sector,
                "categoria": o.categoria,
            }, errorDescription="")
        except Exception as e:
            raise InfrastructureException("Error al obtener Operario.") from e

    def modificarOperario(self, id: int, operario_dto: OperarioRequestDTO):
        try:
            nueva_data = operario_dto.dict(exclude_unset=True)
            actualizado = OperarioRepository().update(id, nueva_data)
            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")
            return ResponseDTO(status=True, data={"id": actualizado.id}, errorDescription="")
        except Exception as e:
            raise InfrastructureException("Error al actualizar Operario.") from e


