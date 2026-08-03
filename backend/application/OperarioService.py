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


def _normalizar_skills(skills):
    """
    Normaliza las skills que manda el form: una sola entrada por proceso (gana
    SKILL 1 sobre SKILL 2) y sin nivel 0 — las nativas se derivan del rango, no se
    cargan a mano. Acepta dicts o DTOs.

    La deduplicación no es cosmética: dos entradas del mismo proceso terminan en dos
    INSERT con la misma PK (id_operario, id_proceso) y revientan el guardado.
    """
    por_proceso = {}
    for s in (skills or []):
        datos = s if isinstance(s, dict) else s.dict()
        nivel = datos.get("nivel")
        if nivel not in (1, 2):
            continue
        id_proceso = datos.get("id_proceso")
        previo = por_proceso.get(id_proceso)
        if previo is None or nivel < previo["nivel"]:
            por_proceso[id_proceso] = {
                "id_proceso": id_proceso,
                "nivel": nivel,
                "habilitado": datos.get("habilitado", True),
            }
    return list(por_proceso.values())


async def _clasificar_nativas_que_chocan(db, id_operario, skills_normalizadas):
    """
    Las filas nivel 0 de los procesos que el form quiere cargar como SKILL 1/2 chocan
    contra la PK (id_operario, id_proceso) al insertar. Se parten en dos grupos según
    lo que el usuario VE en pantalla:

      - visibles: el proceso sigue estando en algún rango del operario, así que figura
        en su lista de SKILLS NATIVAS. Se avisa y no se guarda: el usuario ve la nativa
        y decide (sacarla del form o apagar la nativa).
      - huérfanas: el rango ya no da ese proceso, así que la fila no se muestra en
        ninguna parte. Es un resto de cargas viejas, inerte para el planificador
        (get_map_por_proceso solo mira nivel 1/2, y restar una nativa que el rango ya
        no otorga no cambia nada). Avisar por algo invisible solo confunde: se borra
        y la reemplaza la skill cargada.

    Devuelve (visibles, ids_huerfanas) donde visibles es [(nombre_proceso, habilitado)].
    """
    ids = [s["id_proceso"] for s in skills_normalizadas]
    if not ids:
        return [], []

    from sqlalchemy import select
    from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
    from backend.domain.OperarioRango import OperarioRango
    from backend.domain.Proceso import Proceso
    from backend.domain.RangoProceso import RangoProceso

    filas = (await db.execute(
        select(OperarioProcesoSkill.id_proceso, Proceso.nombre, OperarioProcesoSkill.habilitado)
        .join(Proceso, Proceso.id == OperarioProcesoSkill.id_proceso)
        .where(
            OperarioProcesoSkill.id_operario == id_operario,
            OperarioProcesoSkill.nivel == 0,
            OperarioProcesoSkill.id_proceso.in_(ids),
        )
        .order_by(Proceso.nombre)
    )).all()
    if not filas:
        return [], []

    # Procesos que los rangos del operario le dan hoy: son los que ve como nativas.
    derivados = set((await db.execute(
        select(RangoProceso.id_proceso)
        .join(OperarioRango, OperarioRango.id_rango == RangoProceso.id_rango)
        .where(OperarioRango.id_operario == id_operario)
    )).scalars().all())

    visibles = [(n, h) for id_proceso, n, h in filas if id_proceso in derivados]
    huerfanas = [id_proceso for id_proceso, _, _ in filas if id_proceso not in derivados]
    return visibles, huerfanas


def _mensaje_nativas_que_chocan(filas):
    """Arma el aviso que ve el usuario cuando el proceso ya está cargado como nativa."""
    detalle = ", ".join(
        f"{nombre}{'' if habilitado else ' (desactivada)'}" for nombre, habilitado in filas
    )
    if len(filas) == 1:
        return (
            f"{detalle} ya está cargada como SKILL NATIVA en este operario. "
            f"Quitala de SKILLS 1 / SKILLS 2, o eliminá la nativa desde el detalle del operario."
        )
    return (
        f"Estos procesos ya están cargados como SKILL NATIVA en este operario: {detalle}. "
        f"Quitalos de SKILLS 1 / SKILLS 2, o eliminá las nativas desde el detalle del operario."
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

            procesos_skill = [
                OperarioProcesoSkill(
                    id_proceso=s["id_proceso"],
                    nivel=s["nivel"],
                    habilitado=s["habilitado"],
                )
                for s in _normalizar_skills(operario_dto.skills)
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
        from sqlalchemy import select, delete, or_
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
            # Las filas nivel 0 (nativas) NO se tocan al guardar: el form no las maneja y
            # borrarlas las perdería. Por eso se chequea ANTES de escribir nada si alguno
            # de los procesos que vienen ya está cargado como nativa: sin ese aviso el
            # INSERT choca contra la PK (id_operario, id_proceso) y el usuario ve un error
            # de base de datos en vez de entender que ya la tenía cargada.
            huerfanas = []
            if skills_data:
                visibles, huerfanas = await _clasificar_nativas_que_chocan(db, id, skills_data)
                if visibles:
                    raise BusinessException(_mensaje_nativas_que_chocan(visibles))

            result = await db.execute(select(Operario).where(Operario.id == id))
            operario = result.scalar_one_or_none()
            if not operario:
                return _NO_ENCONTRADO
            for key, value in nueva_data.items():
                setattr(operario, key, value)

            # Skills cargadas (nivel 1/2): se reemplazan por completo. Las nativas
            # huérfanas de esos mismos procesos se borran de paso: no las ve nadie y le
            # dejan el lugar a la skill que se está cargando.
            if skills_data is not None:
                condicion = OperarioProcesoSkill.nivel.in_([1, 2])
                if huerfanas:
                    condicion = or_(condicion, OperarioProcesoSkill.id_proceso.in_(huerfanas))
                await db.execute(
                    delete(OperarioProcesoSkill).where(
                        OperarioProcesoSkill.id_operario == id,
                        condicion,
                    )
                )
                for s in skills_data:
                    db.add(OperarioProcesoSkill(
                        id_operario=id,
                        id_proceso=s["id_proceso"],
                        nivel=s["nivel"],
                        habilitado=s.get("habilitado", True),
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
