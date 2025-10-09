from backend.domain.Operario import Operario
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
from backend.infrastructure.OperarioRepository import OperarioRepository

from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException


class OperarioService:
    """
    Capa de aplicación de Operario.
    """

    def __init__(self):
        pass

    def crearOperario(self, operario_dto: OperarioRequestDTO):
        try:
            # Validación mínima
            if not operario_dto.nombre or not operario_dto.apellido:
                raise BusinessException("Nombre y Apellido son obligatorios.")
            
            # Esta validación ya no es necesaria si el DTO es correcto, pero la dejo por seguridad
            if not operario_dto.fecha_nacimiento or not operario_dto.fecha_ingreso:
                raise BusinessException("Fecha de nacimiento y fecha de ingreso son obligatorias.")

            operario = Operario(
                nombre=operario_dto.nombre,
                apellido=operario_dto.apellido,
                fecha_nacimiento=operario_dto.fecha_nacimiento,
                fecha_ingreso=operario_dto.fecha_ingreso,
                sector=operario_dto.sector,
                categoria=operario_dto.categoria,
                disponible=operario_dto.disponible if operario_dto.disponible is not None else True,
                telefono=operario_dto.telefono,
                celular=operario_dto.celular,
                dni=operario_dto.dni,
            )

            repo = OperarioRepository()
            operario_creado = repo.save(operario)

            response = ResponseDTO()
            response.status = True
            response.data = jsonable_encoder(operario_creado)
            response.errorDescription = ""

            return response

        except BusinessException as e:
            raise e
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
                    "disponible": o.disponible,
                    "fecha_nacimiento": o.fecha_nacimiento.isoformat() if o.fecha_nacimiento else None,
                    "fecha_ingreso": o.fecha_ingreso.isoformat() if o.fecha_ingreso else None,
                    "telefono": o.telefono,
                    "celular": o.celular,
                    "dni": o.dni,
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
                "disponible": o.disponible,
                "fecha_nacimiento": o.fecha_nacimiento.isoformat() if o.fecha_nacimiento else None,
                "fecha_ingreso": o.fecha_ingreso.isoformat() if o.fecha_ingreso else None,
                "telefono": o.telefono,
                "celular": o.celular,
                "dni": o.dni,
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