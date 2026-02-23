from backend.domain.Operario import Operario
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger


class OperarioService:
    """
    Capa de aplicación de Operario (versión asincrónica).
    Maneja validaciones, conversión a DTO y llamadas al repositorio asincrónico.
    """

    def __init__(self, db_session):
        self.repository = OperarioRepository(db_session)

    # 🔹 Crear Operario
    async def crearOperario(self, operario_dto: OperarioRequestDTO):
        try:
            if not operario_dto.nombre or not operario_dto.apellido:
                raise BusinessException("Nombre y Apellido son obligatorios.")

            procesos_skill = []
            if operario_dto.skills:
                from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
                for s in operario_dto.skills:
                    procesos_skill.append(OperarioProcesoSkill(
                        id_proceso=s.id_proceso,
                        nivel=s.nivel,
                        habilitado=s.habilitado
                    ))


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
                email=operario_dto.email,
                procesos_skill=procesos_skill,
            )

            operario_creado = await self.repository.save(operario)

            return ResponseDTO(
                status=True,
                data=jsonable_encoder(operario_creado),
                errorDescription=""
            )

        except BusinessException as e:
            raise e
        except Exception as e:
            logger.error(f"Service - Error al crear Operario: {e}")
            raise InfrastructureException("Error al guardar el Operario.") from e

    # 🔹 Eliminar Operario
    async def eliminarOperario(self, id: int):
        try:
            logger.info(f"Service - Eliminando Operario id={id}")
            ok = await self.repository.delete(id)

            if not ok:
                return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")

            return ResponseDTO(status=True, data={"deleted": id}, errorDescription="")
        except Exception as e:
            logger.error(f"Service - Error al eliminar Operario: {e}")
            raise InfrastructureException("Error al eliminar el Operario.") from e

    # 🔹 Listar Operarios
    async def listarOperarios(self):
        try:
            logger.info("Service - Listar Operarios.")
            operarios = await self.repository.find_all()

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
                    "email": o.email,
                    "rangos": [r.id_rango for r in o.rangos],
                    "skills": [{"id_proceso": s.id_proceso, "nivel": s.nivel, "habilitado": s.habilitado} for s in o.procesos_skill]
                }
                for o in operarios
            ]

            return ResponseDTO(status=True, data=data, errorDescription="")
        except Exception as e:
            logger.error(f"Service - Error al listar Operarios: {e}")
            raise InfrastructureException("Error al listar Operarios.") from e

    # 🔹 Obtener Operario por ID
    async def obtenerOperarioPorId(self, id: int):
        try:
            logger.info(f"Service - Obtener Operario id={id}")
            o = await self.repository.find_by_id(id)

            if not o:
                return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")

            return ResponseDTO(
                status=True,
                data={
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
                    "email": o.email,
                    "skills": [{"id_proceso": s.id_proceso, "nivel": s.nivel, "habilitado": s.habilitado} for s in o.procesos_skill]
                },
                errorDescription=""
            )   
        except Exception as e:
            logger.error(f"Service - Error al obtener Operario: {e}")
            raise InfrastructureException("Error al obtener Operario.") from e

    # 🔹 Modificar Operario
    async def modificarOperario(self, id: int, operario_dto: OperarioRequestDTO):
        try:
            nueva_data = operario_dto.dict(exclude_unset=True)
            skills_data = nueva_data.pop("skills", None)

            if skills_data is not None:
                pass # validations removed

            actualizado = await self.repository.update(id, nueva_data)

            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")

            if skills_data is not None:
                from sqlalchemy import delete
                from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
                await self.repository.db.execute(delete(OperarioProcesoSkill).where(OperarioProcesoSkill.id_operario == id))
                for s in skills_data:
                    self.repository.db.add(OperarioProcesoSkill(
                        id_operario=id,
                        id_proceso=s["id_proceso"],
                        nivel=s["nivel"],
                        habilitado=s.get("habilitado", True)
                    ))
                await self.repository.db.commit()

            return ResponseDTO(
                status=True,
                data={"id": actualizado.id},
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al actualizar Operario: {e}")
            raise InfrastructureException("Error al actualizar el Operario.") from e

    # 🔹 Actualizar estado de habilidad (habilitado/deshabilitado)
    async def actualizarEstadoSkill(self, id_operario: int, id_proceso: int, habilitado: bool):
        try:
            from sqlalchemy import select
            from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
            
            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.id_operario == id_operario,
                OperarioProcesoSkill.id_proceso == id_proceso
            )
            result = await self.repository.db.execute(stmt)
            skill = result.scalar_one_or_none()
            if not skill:
                return ResponseDTO(status=False, data={}, errorDescription="Habilidad no encontrada")
                
            skill.habilitado = habilitado
            await self.repository.db.commit()
            
            return ResponseDTO(status=True, data={"id_operario": id_operario, "id_proceso": id_proceso, "habilitado": habilitado}, errorDescription="")
        except Exception as e:
            await self.repository.db.rollback()
            logger.error(f"Service - Error al actualizar estado de skill: {e}")
            raise InfrastructureException("Error al actualizar la habilidad.") from e

    # 🔹 Agregar nueva habilidad a operario
    async def agregarSkill(self, id_operario: int, dto):
        try:
            from sqlalchemy import select
            from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
            
            # Check if it already exists
            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.id_operario == id_operario,
                OperarioProcesoSkill.id_proceso == dto.id_proceso
            )
            result = await self.repository.db.execute(stmt)
            existing = result.scalar_one_or_none()
            
            if existing:
                # Actualizar el nivel o la habilitacion si ya existe
                existing.nivel = dto.nivel
                existing.habilitado = True
            else:
                # Agregar nueva
                nueva_skill = OperarioProcesoSkill(
                    id_operario=id_operario,
                    id_proceso=dto.id_proceso,
                    nivel=dto.nivel,
                    habilitado=True
                )
                self.repository.db.add(nueva_skill)
                
            await self.repository.db.commit()
            return ResponseDTO(status=True, data={"id_operario": id_operario, "id_proceso": dto.id_proceso, "nivel": dto.nivel}, errorDescription="")
        except Exception as e:
            await self.repository.db.rollback()
            logger.error(f"Service - Error al agregar skill: {e}")
            raise InfrastructureException("Error al agregar la habilidad.") from e

    # 🔹 Eliminar habilidad de operario
    async def eliminarSkill(self, id_operario: int, id_proceso: int):
        try:
            from sqlalchemy import delete
            from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
            
            stmt = delete(OperarioProcesoSkill).where(
                OperarioProcesoSkill.id_operario == id_operario,
                OperarioProcesoSkill.id_proceso == id_proceso
            )
            await self.repository.db.execute(stmt)
            await self.repository.db.commit()
            
            return ResponseDTO(status=True, data={"id_operario": id_operario, "id_proceso_eliminado": id_proceso}, errorDescription="")
        except Exception as e:
            await self.repository.db.rollback()
            logger.error(f"Service - Error al eliminar skill: {e}")
            raise InfrastructureException("Error al eliminar la habilidad.") from e
