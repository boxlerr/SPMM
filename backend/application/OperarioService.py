from datetime import time
from backend.domain.Operario import Operario


_DIAS_VALIDOS = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}


def _normalizar_dias_trabajo(valor):
    """
    Normaliza un valor de dias_trabajo a una cadena CSV con códigos válidos.
    Acepta lista o string. Si no se pueden extraer días válidos, devuelve None
    para que el caller decida si usar el default.
    """
    if valor is None:
        return None
    if isinstance(valor, str):
        items = [v.strip().upper() for v in valor.split(",") if v.strip()]
    else:
        items = [str(v).strip().upper() for v in valor if str(v).strip()]
    items = [d for d in items if d in _DIAS_VALIDOS]
    if not items:
        return None
    # Preservar orden semanal canónico, sin duplicados.
    orden = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    return ",".join(d for d in orden if d in items)


def _build_skills_payload(operario):
    """
    Combina las skills cargadas manualmente (nivel 1 y 2) con las skills nativas
    computadas desde los rangos del operario (nivel 0).

    - Las nivel 1/2 se emiten tal cual.
    - Las nativas se derivan de operario.rangos × rango.procesos.
    - Las filas persistidas nivel 0 NO se emiten como entradas sueltas: actúan como
      override del estado `habilitado` de la nativa derivada (marca de "nativa
      desactivada"). Una nativa sin override queda habilitada por defecto.
    - Si un id_proceso aparece como cargado (nivel 1/2) y como nativo, gana el cargado.
    """
    payload = []
    procesos_vistos = set()
    overrides_nativas = {}  # id_proceso -> habilitado (desde filas nivel 0 persistidas)

    for s in (operario.procesos_skill or []):
        if s.nivel == 0:
            # Override de nativa: solo guarda el estado, no se emite por sí solo.
            overrides_nativas[s.id_proceso] = s.habilitado
            continue
        payload.append({
            "id_proceso": s.id_proceso,
            "nivel": s.nivel,
            "habilitado": s.habilitado,
        })
        procesos_vistos.add(s.id_proceso)

    for op_rango in (operario.rangos or []):
        rango = getattr(op_rango, "rango", None)
        if rango is None:
            continue
        for rp in (rango.procesos or []):
            if rp.id_proceso in procesos_vistos:
                continue
            payload.append({
                "id_proceso": rp.id_proceso,
                "nivel": 0,
                "habilitado": overrides_nativas.get(rp.id_proceso, True),
            })
            procesos_vistos.add(rp.id_proceso)

    return payload


def _validar_pausa(valor, default):
    """Convierte a int, recorta a [0, 240] minutos. Devuelve default si inválido."""
    if valor is None:
        return default
    try:
        n = int(valor)
    except (TypeError, ValueError):
        return default
    return max(0, min(240, n))
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
                hora_inicio=time.fromisoformat(operario_dto.hora_inicio) if operario_dto.hora_inicio else time(7, 0),
                hora_fin=time.fromisoformat(operario_dto.hora_fin) if operario_dto.hora_fin else time(16, 0),
                dias_trabajo=_normalizar_dias_trabajo(operario_dto.dias_trabajo) or "MON,TUE,WED,THU,FRI",
                min_desayuno=_validar_pausa(operario_dto.min_desayuno, 15),
                min_almuerzo=_validar_pausa(operario_dto.min_almuerzo, 30),
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
                    "hora_inicio": o.hora_inicio.strftime("%H:%M") if o.hora_inicio else "07:00",
                    "hora_fin": o.hora_fin.strftime("%H:%M") if o.hora_fin else "16:00",
                    "dias_trabajo": getattr(o, "dias_trabajo", None) or "MON,TUE,WED,THU,FRI",
                    "min_desayuno": getattr(o, "min_desayuno", None) if getattr(o, "min_desayuno", None) is not None else 15,
                    "min_almuerzo": getattr(o, "min_almuerzo", None) if getattr(o, "min_almuerzo", None) is not None else 30,
                    "rangos": [r.id_rango for r in o.rangos],
                    "skills": _build_skills_payload(o),
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
                    "hora_inicio": o.hora_inicio.strftime("%H:%M") if o.hora_inicio else "07:00",
                    "hora_fin": o.hora_fin.strftime("%H:%M") if o.hora_fin else "16:00",
                    "dias_trabajo": getattr(o, "dias_trabajo", None) or "MON,TUE,WED,THU,FRI",
                    "min_desayuno": getattr(o, "min_desayuno", None) if getattr(o, "min_desayuno", None) is not None else 15,
                    "min_almuerzo": getattr(o, "min_almuerzo", None) if getattr(o, "min_almuerzo", None) is not None else 30,
                    "skills": _build_skills_payload(o),
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

            if "hora_inicio" in nueva_data and isinstance(nueva_data["hora_inicio"], str):
                nueva_data["hora_inicio"] = time.fromisoformat(nueva_data["hora_inicio"])
            if "hora_fin" in nueva_data and isinstance(nueva_data["hora_fin"], str):
                nueva_data["hora_fin"] = time.fromisoformat(nueva_data["hora_fin"])

            if "dias_trabajo" in nueva_data:
                normalizados = _normalizar_dias_trabajo(nueva_data["dias_trabajo"])
                if normalizados is None:
                    # valor inválido: no actualizar para evitar dejar al operario sin días
                    nueva_data.pop("dias_trabajo")
                else:
                    nueva_data["dias_trabajo"] = normalizados
            if "min_desayuno" in nueva_data:
                nueva_data["min_desayuno"] = _validar_pausa(nueva_data["min_desayuno"], 15)
            if "min_almuerzo" in nueva_data:
                nueva_data["min_almuerzo"] = _validar_pausa(nueva_data["min_almuerzo"], 30)

            actualizado = await self.repository.update(id, nueva_data)

            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")

            if skills_data is not None:
                from sqlalchemy import delete
                from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
                # Solo se reemplazan las skills cargadas (nivel 1/2). Las filas nivel 0
                # (overrides de nativas desactivadas) NO se tocan: el form no las maneja
                # y borrarlas acá las perdería en cada edición del operario.
                await self.repository.db.execute(
                    delete(OperarioProcesoSkill).where(
                        OperarioProcesoSkill.id_operario == id,
                        OperarioProcesoSkill.nivel.in_([1, 2]),
                    )
                )
                for s in skills_data:
                    # Ignorar nivel 0 si llegara desde el form: las nativas no se cargan manualmente.
                    if s.get("nivel") == 0:
                        continue
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

    # 🔹 Actualizar estado de una skill NATIVA (derivada del rango)
    async def actualizarEstadoSkillNativa(self, id_operario: int, id_proceso: int, habilitado: bool):
        """
        Las nativas no tienen fila por defecto (se derivan del rango). Para desactivar
        una, se persiste una fila nivel=0, habilitado=False como override. Reactivarla
        borra la fila y vuelve al estado derivado por defecto.

        Importante: al reactivar se BORRA la fila (no se pone habilitado=True). Una fila
        nivel=0, habilitado=True entraría en get_map_por_proceso si no estuviera acotado
        a nivel 1/2, y podría disparar el modo skill-map del planificador.
        """
        try:
            from sqlalchemy import select, delete
            from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill

            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.id_operario == id_operario,
                OperarioProcesoSkill.id_proceso == id_proceso,
            )
            result = await self.repository.db.execute(stmt)
            skill = result.scalar_one_or_none()

            if not habilitado:
                # Desactivar nativa -> upsert override nivel=0, habilitado=False
                if skill is None:
                    self.repository.db.add(OperarioProcesoSkill(
                        id_operario=id_operario,
                        id_proceso=id_proceso,
                        nivel=0,
                        habilitado=False,
                    ))
                else:
                    # Solo override de nativas; no degradar una skill cargada nivel 1/2.
                    if skill.nivel not in (1, 2):
                        skill.nivel = 0
                        skill.habilitado = False
            else:
                # Reactivar nativa -> borrar el override (vuelve al default derivado).
                # No tocar skills cargadas nivel 1/2.
                if skill is not None and skill.nivel == 0:
                    await self.repository.db.execute(
                        delete(OperarioProcesoSkill).where(
                            OperarioProcesoSkill.id_operario == id_operario,
                            OperarioProcesoSkill.id_proceso == id_proceso,
                            OperarioProcesoSkill.nivel == 0,
                        )
                    )

            await self.repository.db.commit()
            return ResponseDTO(
                status=True,
                data={"id_operario": id_operario, "id_proceso": id_proceso, "habilitado": habilitado, "nivel": 0},
                errorDescription="",
            )
        except Exception as e:
            await self.repository.db.rollback()
            logger.error(f"Service - Error al actualizar estado de nativa: {e}")
            raise InfrastructureException("Error al actualizar la habilidad nativa.") from e

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
