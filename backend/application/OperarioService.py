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
    Devuelve la lista completa de habilidades del operario tal como las ve la UI.

    Modelo: las SKILLS NATIVAS (rango del operario × procesos del rango) son el
    universo de lo que sabe hacer. `operario_proceso_skill` no es un catálogo
    paralelo, es una tabla de OVERRIDES sobre esas nativas, con dos ejes sueltos:

      - `nivel`      -> prioridad: 0 = sin marcar, 1 = SKILL 1, 2 = SKILL 2
      - `habilitado` -> si está apagada para este operario

    Cada entrada sale como {id_proceso, nivel, habilitado, nativa}. Una nativa sin
    fila de override queda en nivel 0 / habilitada.

    Las filas nivel 1/2 sobre procesos que el rango YA NO da salen con nativa=False:
    son restos del modelo viejo (SKILLS 1/2 como catálogo abierto). El planificador
    las ignora —la prioridad solo pesa sobre quien ya es elegible— y el próximo
    guardado las limpia, pero se emiten igual para no esconder datos que están en la
    base.
    """
    overrides = {
        s.id_proceso: {
            "nivel": s.nivel or 0,
            "habilitado": s.habilitado,
            "orden": s.orden,
        }
        for s in (operario.procesos_skill or [])
    }

    payload = []
    nativos = set()

    for op_rango in (operario.rangos or []):
        rango = getattr(op_rango, "rango", None)
        if rango is None:
            continue
        for rp in (rango.procesos or []):
            if rp.id_proceso in nativos:
                continue
            nativos.add(rp.id_proceso)
            ov = overrides.get(rp.id_proceso, {})
            payload.append({
                "id_proceso": rp.id_proceso,
                "nivel": ov.get("nivel", 0),
                "habilitado": ov.get("habilitado", True),
                "orden": ov.get("orden"),
                "nativa": True,
            })

    for id_proceso, ov in overrides.items():
        if id_proceso in nativos:
            continue
        payload.append({
            "id_proceso": id_proceso,
            "nivel": ov["nivel"],
            "habilitado": ov["habilitado"],
            "orden": ov["orden"],
            "nativa": False,
        })

    return payload


def _normalizar_skills(skills):
    """
    Normaliza lo que manda el form: una sola entrada por proceso. Acepta dicts o DTOs.

    Solo se persisten los overrides que dicen algo — prioridad marcada (nivel 1/2) o
    nativa apagada (habilitado=False). Una nativa habilitada y sin marcar es el estado
    por defecto derivado del rango: guardarla sería escribir una fila por cada proceso
    de cada operario para no decir nada.

    La deduplicación no es cosmética: dos entradas del mismo proceso terminan en dos
    INSERT con la misma PK (id_operario, id_proceso) y revientan el guardado. Ante
    duplicados gana la prioridad más alta (SKILL 1 sobre SKILL 2).
    """
    por_proceso = {}
    for s in (skills or []):
        datos = s if isinstance(s, dict) else s.dict()
        nivel = datos.get("nivel") or 0
        if nivel not in (0, 1, 2):
            continue
        habilitado = datos.get("habilitado", True)
        if nivel == 0 and habilitado:
            continue  # estado por defecto: no hace falta fila
        id_proceso = datos.get("id_proceso")
        if id_proceso is None:
            continue
        previo = por_proceso.get(id_proceso)
        # Menor nivel = mayor prioridad, pero 0 (sin marcar) nunca le gana a 1/2.
        if previo is None or _rank_nivel(nivel) < _rank_nivel(previo["nivel"]):
            orden = datos.get("orden")
            por_proceso[id_proceso] = {
                "id_proceso": id_proceso,
                "nivel": nivel,
                "habilitado": habilitado,
                # Solo tiene sentido posicionar dentro de SKILLS 1/2.
                "orden": int(orden) if nivel in (1, 2) and orden is not None else None,
            }
    return list(por_proceso.values())


def _rank_nivel(nivel):
    """Orden de preferencia: SKILL 1 < SKILL 2 < sin marcar."""
    return {1: 0, 2: 1}.get(nivel, 2)


async def _procesos_nativos(db, id_operario, rangos_data=None):
    """
    Devuelve el set de id_proceso que los rangos del operario le habilitan hoy: sus
    SKILLS NATIVAS.

    `rangos_data` es la lista de rangos que viene en el MISMO guardado. Si está, manda
    ella y no lo persistido: el form puede cambiar rangos y prioridades de una, y
    validar contra los rangos viejos rechazaría una skill que el rango nuevo sí da
    (o dejaría pasar una que ya no).
    """
    from sqlalchemy import select
    from backend.domain.OperarioRango import OperarioRango
    from backend.domain.RangoProceso import RangoProceso

    if rangos_data is not None:
        rangos = [r for r in rangos_data if r is not None]
        if not rangos:
            return set()
        stmt = select(RangoProceso.id_proceso).where(RangoProceso.id_rango.in_(rangos))
    else:
        stmt = (
            select(RangoProceso.id_proceso)
            .join(OperarioRango, OperarioRango.id_rango == RangoProceso.id_rango)
            .where(OperarioRango.id_operario == id_operario)
        )
    return set((await db.execute(stmt)).scalars().all())


async def _validar_prioridades_sobre_nativas(db, id_operario, skills_normalizadas, rangos_data=None):
    """
    Invariante del modelo: SKILLS 1 y 2 solo pueden marcar procesos que el operario ya
    tiene como NATIVOS. Son un orden de preferencia dentro de lo que sabe hacer, no una
    forma de habilitarle un proceso que su rango no le da — para eso se cambia el rango.

    (El modelo anterior era el inverso: rechazaba marcar una nativa y dejaba cargar
    cualquier proceso suelto. Eso hacía que SKILLS 1/2 fuera un universo aparte del de
    las nativas, que es justo lo que se corrigió.)

    Lanza BusinessException nombrando los procesos que no corresponden.
    """
    marcados = [s["id_proceso"] for s in skills_normalizadas if s["nivel"] in (1, 2)]
    if not marcados:
        return

    nativos = await _procesos_nativos(db, id_operario, rangos_data)
    intrusos = [p for p in marcados if p not in nativos]
    if not intrusos:
        return

    from sqlalchemy import select
    from backend.domain.Proceso import Proceso

    nombres = (await db.execute(
        select(Proceso.nombre).where(Proceso.id.in_(intrusos)).order_by(Proceso.nombre)
    )).scalars().all()
    detalle = ", ".join(nombres) if nombres else ", ".join(str(p) for p in intrusos)

    if len(intrusos) == 1:
        raise BusinessException(
            f"{detalle} no es una SKILL NATIVA de este operario, así que no se le puede dar "
            f"prioridad. Asignale un rango que incluya ese proceso y después marcalo como "
            f"SKILL 1 o SKILL 2."
        )
    raise BusinessException(
        f"Estos procesos no son SKILLS NATIVAS de este operario y no se les puede dar "
        f"prioridad: {detalle}. Asignale los rangos que los incluyan y después marcalos "
        f"como SKILL 1 o SKILL 2."
    )


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
        from backend.infrastructure.db_retry import run_with_db_retry, motivo_error_db
        if not operario_dto.nombre or not operario_dto.apellido:
            raise BusinessException("Nombre y Apellido son obligatorios.")

        db = self.repository.db

        # Guardado ATÓMICO (operario + skills + rangos en un único commit) con reintento
        # ante cortes transitorios de la DB. Se reconstruye todo adentro para que, si hubo
        # un rollback por desconexión, el reintento no use objetos ORM inválidos.
        async def _guardar():
            from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
            from backend.domain.OperarioRango import OperarioRango

            skills_norm = _normalizar_skills(operario_dto.skills)
            # El operario todavía no existe, así que las nativas se validan contra los
            # rangos que vienen en el alta.
            await _validar_prioridades_sobre_nativas(
                db, None, skills_norm, operario_dto.rangos or []
            )

            procesos_skill = [
                OperarioProcesoSkill(
                    id_proceso=s["id_proceso"],
                    nivel=s["nivel"],
                    habilitado=s["habilitado"],
                    orden=s.get("orden"),
                )
                for s in skills_norm
            ]

            operario = Operario(
                nombre=operario_dto.nombre,
                apellido=operario_dto.apellido,
                fecha_nacimiento=operario_dto.fecha_nacimiento,
                fecha_ingreso=operario_dto.fecha_ingreso,
                sector=operario_dto.sector,
                categoria=operario_dto.categoria,
                disponible=operario_dto.disponible if operario_dto.disponible is not None else True,
                interpreta_planos=bool(operario_dto.interpreta_planos),
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

            db.add(operario)
            await db.flush()  # asigna el id sin cerrar la transacción

            # Vincular rangos (operario_rango) -> de aqui salen las SKILLS NATIVAS.
            if operario_dto.rangos is not None:
                vistos = set()
                for rid in operario_dto.rangos:
                    if rid is None or rid in vistos:
                        continue
                    vistos.add(rid)
                    db.add(OperarioRango(id_operario=operario.id, id_rango=rid))

            await db.commit()
            await db.refresh(operario)
            return operario

        try:
            operario_creado = await run_with_db_retry(db, _guardar, label="crearOperario")
        except Exception as e:
            try:
                await db.rollback()
            except Exception:
                pass
            logger.error(f"Service - Error al crear Operario: {e}")
            raise InfrastructureException(motivo_error_db(e, "crear el operario")) from e

        return ResponseDTO(
            status=True,
            data=jsonable_encoder(operario_creado),
            errorDescription=""
        )

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
                    "interpreta_planos": bool(getattr(o, "interpreta_planos", False)),
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
                    "interpreta_planos": bool(getattr(o, "interpreta_planos", False)),
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
                },
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al obtener Operario: {e}")
            raise InfrastructureException("Error al obtener Operario.") from e

    # 🔹 Modificar Operario
    async def modificarOperario(self, id: int, operario_dto: OperarioRequestDTO):
        # Guardado ATÓMICO: datos del operario + skills + rangos se aplican en una
        # sola transacción con un único commit al final. Si algo falla a mitad de
        # camino (p. ej. la DB se desconecta), se hace rollback y NO queda un
        # guardado parcial: o se guarda todo o no se guarda nada.
        from sqlalchemy import select, delete
        from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
        from backend.domain.OperarioRango import OperarioRango
        from backend.infrastructure.db_retry import run_with_db_retry, motivo_error_db
        db = self.repository.db

        # Preproceso (puro, una sola vez): no toca la DB, así que no se reintenta.
        nueva_data = operario_dto.dict(exclude_unset=True)
        skills_data = nueva_data.pop("skills", None)
        if skills_data is not None:
            skills_data = _normalizar_skills(skills_data)
        # 'rangos' no es columna de Operario: se sincroniza la tabla operario_rango aparte.
        rangos_data = nueva_data.pop("rangos", None)

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

        _NO_ENCONTRADO = object()

        # Toda la escritura va en un único commit y se reintenta ante un corte
        # transitorio de la DB. Es idempotente (reemplaza skills/rangos por completo),
        # así que reintentar es seguro. Se reconstruye todo adentro para que, tras un
        # rollback, no queden objetos ORM inválidos.
        async def _guardar():
            # Se valida ANTES de escribir nada: marcar como SKILL 1/2 un proceso que no
            # es nativo del operario es un error del usuario, no de la base, y tiene que
            # llegarle como aviso entendible.
            if skills_data:
                await _validar_prioridades_sobre_nativas(db, id, skills_data, rangos_data)

            result = await db.execute(select(Operario).where(Operario.id == id))
            operario = result.scalar_one_or_none()
            if not operario:
                return _NO_ENCONTRADO
            for key, value in nueva_data.items():
                setattr(operario, key, value)

            # Los overrides se reemplazan por completo: el form manda el estado final de
            # todas las nativas (prioridad + apagadas), así que lo que no viene es que
            # volvió al default. El borrado total también limpia de paso las filas
            # huérfanas del modelo viejo (nivel 1/2 sobre procesos que el rango ya no da).
            if skills_data is not None:
                await db.execute(
                    delete(OperarioProcesoSkill).where(
                        OperarioProcesoSkill.id_operario == id,
                    )
                )
                for s in skills_data:
                    db.add(OperarioProcesoSkill(
                        id_operario=id,
                        id_proceso=s["id_proceso"],
                        nivel=s["nivel"],
                        habilitado=s.get("habilitado", True),
                        orden=s.get("orden"),
                    ))

            # Rangos (operario_rango): borrar y reinsertar deduplicado.
            if rangos_data is not None:
                await db.execute(
                    delete(OperarioRango).where(OperarioRango.id_operario == id)
                )
                vistos = set()
                for rid in rangos_data:
                    if rid is None or rid in vistos:
                        continue
                    vistos.add(rid)
                    db.add(OperarioRango(id_operario=id, id_rango=rid))

            await db.commit()
            return operario

        try:
            resultado = await run_with_db_retry(db, _guardar, label=f"modificarOperario#{id}")
        except BusinessException:
            # Aviso para el usuario (ej. la skill ya está cargada): se devuelve tal cual,
            # sin disfrazarlo de error de infraestructura.
            try:
                await db.rollback()
            except Exception:
                pass
            raise
        except Exception as e:
            try:
                await db.rollback()
            except Exception:
                pass
            logger.error(f"Service - Error al actualizar Operario: {e}")
            raise InfrastructureException(motivo_error_db(e, "guardar los cambios del operario")) from e

        if resultado is _NO_ENCONTRADO:
            return ResponseDTO(status=False, data={}, errorDescription="Operario no encontrado")

        return ResponseDTO(status=True, data={"id": id}, errorDescription="")

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
        Las nativas no tienen fila por defecto (se derivan del rango): la fila de
        `operario_proceso_skill` es un OVERRIDE sobre la nativa derivada, y guarda dos
        cosas independientes — si está apagada (`habilitado`) y qué prioridad tiene
        (`nivel`: 0 = sin marcar, 1 = SKILL 1, 2 = SKILL 2).

        Apagar y priorizar son ejes distintos, así que el toggle NO pisa el nivel:
        una nativa marcada como SKILL 1 que se apaga y se vuelve a prender tiene que
        seguir siendo SKILL 1. Al reactivar solo se borra la fila si además no tenía
        prioridad (nivel 0), porque ahí ya no aporta nada y conviene volver al estado
        derivado limpio.
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
            nivel_resultante = 0

            if not habilitado:
                # Desactivar nativa -> upsert habilitado=False, conservando la prioridad.
                if skill is None:
                    self.repository.db.add(OperarioProcesoSkill(
                        id_operario=id_operario,
                        id_proceso=id_proceso,
                        nivel=0,
                        habilitado=False,
                    ))
                else:
                    skill.habilitado = False
                    nivel_resultante = skill.nivel or 0
            else:
                if skill is not None:
                    if skill.nivel in (1, 2):
                        # Tiene prioridad: se prende, pero la fila se conserva.
                        skill.habilitado = True
                        nivel_resultante = skill.nivel
                    else:
                        # Sin prioridad: la fila ya no dice nada -> volver al derivado.
                        await self.repository.db.execute(
                            delete(OperarioProcesoSkill).where(
                                OperarioProcesoSkill.id_operario == id_operario,
                                OperarioProcesoSkill.id_proceso == id_proceso,
                            )
                        )

            await self.repository.db.commit()
            return ResponseDTO(
                status=True,
                data={
                    "id_operario": id_operario,
                    "id_proceso": id_proceso,
                    "habilitado": habilitado,
                    "nivel": nivel_resultante,
                },
                errorDescription="",
            )
        except Exception as e:
            await self.repository.db.rollback()
            logger.error(f"Service - Error al actualizar estado de nativa: {e}")
            raise InfrastructureException("Error al actualizar la habilidad nativa.") from e

    # 🔹 Definir la PRIORIDAD de una skill nativa (SKILL 1 / SKILL 2 / sin marcar)
    async def agregarSkill(self, id_operario: int, dto):
        """
        Ya no "agrega" una habilidad: el conjunto de lo que el operario sabe hacer lo
        fijan sus rangos (skills nativas). Esto marca la prioridad de una de ellas.

        - nivel 1/2 -> se prioriza y queda habilitada.
        - nivel 0   -> se quita la prioridad. Si además estaba habilitada, se borra la
          fila: sin prioridad y sin apagado no queda nada que persistir.
        """
        try:
            from sqlalchemy import select, delete
            from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill

            nivel = dto.nivel or 0
            if nivel in (1, 2):
                await _validar_prioridades_sobre_nativas(
                    self.repository.db,
                    id_operario,
                    [{"id_proceso": dto.id_proceso, "nivel": nivel}],
                )

            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.id_operario == id_operario,
                OperarioProcesoSkill.id_proceso == dto.id_proceso
            )
            result = await self.repository.db.execute(stmt)
            existing = result.scalar_one_or_none()

            if nivel == 0:
                if existing is not None and existing.habilitado:
                    await self.repository.db.execute(
                        delete(OperarioProcesoSkill).where(
                            OperarioProcesoSkill.id_operario == id_operario,
                            OperarioProcesoSkill.id_proceso == dto.id_proceso,
                        )
                    )
                elif existing is not None:
                    existing.nivel = 0
            elif existing:
                existing.nivel = nivel
                existing.habilitado = True
            else:
                self.repository.db.add(OperarioProcesoSkill(
                    id_operario=id_operario,
                    id_proceso=dto.id_proceso,
                    nivel=nivel,
                    habilitado=True,
                ))

            await self.repository.db.commit()
            return ResponseDTO(status=True, data={"id_operario": id_operario, "id_proceso": dto.id_proceso, "nivel": nivel}, errorDescription="")
        except BusinessException:
            await self.repository.db.rollback()
            raise
        except Exception as e:
            await self.repository.db.rollback()
            logger.error(f"Service - Error al definir la prioridad de la skill: {e}")
            raise InfrastructureException("Error al actualizar la prioridad de la habilidad.") from e

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
