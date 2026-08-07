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

    Modelo: el universo de lo que el operario sabe hacer son sus SKILLS NATIVAS
    (rango del operario × procesos del rango) MÁS las MANUALES (las que se le
    cargaron a mano, para lo que el rango no contempla). `operario_proceso_skill` no
    es un catálogo paralelo: es una tabla de overrides sobre las nativas + las filas
    propias de las manuales, con tres ejes sueltos:

      - `manual`     -> True = la habilidad la agregó alguien a mano
      - `nivel`      -> prioridad: 0 = sin marcar, 1 = SKILL 1, 2 = SKILL 2
      - `habilitado` -> si está apagada para este operario

    Cada entrada sale como {id_proceso, nivel, habilitado, orden, nativa, manual}.
    Una nativa sin fila de override queda en nivel 0 / habilitada.

    Una fila manual sobre un proceso que HOY es nativo sale como nativa (manual=False):
    el rango ya se lo da, la carga a mano dejó de aportar. El próximo guardado limpia
    el flag.

    Las filas nivel 1/2 sobre procesos que el rango YA NO da y que no son manuales
    salen con nativa=False y manual=False: son restos del modelo viejo (SKILLS 1/2
    como catálogo abierto). El planificador las ignora —la prioridad solo pesa sobre
    quien ya es elegible— y el próximo guardado las limpia, pero se emiten igual para
    no esconder datos que están en la base.
    """
    overrides = {
        s.id_proceso: {
            "nivel": s.nivel or 0,
            "habilitado": s.habilitado,
            "orden": s.orden,
            "manual": bool(getattr(s, "manual", False)),
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
                # Ser nativa manda: si el rango ya lo da, el flag manual no aporta.
                "manual": False,
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
            "manual": ov["manual"],
        })

    return payload


def _normalizar_skills(skills):
    """
    Normaliza lo que manda el form: una sola entrada por proceso. Acepta dicts o DTOs.

    Solo se persisten las filas que dicen algo — habilidad manual (`manual`),
    prioridad marcada (nivel 1/2) o habilidad apagada (habilitado=False). Una nativa
    habilitada y sin marcar es el estado por defecto derivado del rango: guardarla
    sería escribir una fila por cada proceso de cada operario para no decir nada.

    Una MANUAL sí se guarda aunque esté en nivel 0 y habilitada: ahí la fila no es un
    override, es el único registro de que el operario tiene esa habilidad. Si se
    borrara, la habilidad desaparecería.

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
        manual = bool(datos.get("manual", False))
        if nivel == 0 and habilitado and not manual:
            continue  # estado por defecto de una nativa: no hace falta fila
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
                # Que la entrada perdedora del duplicado sea manual no se pierde: el
                # flag es del proceso, no del nivel.
                "manual": manual or bool((previo or {}).get("manual")),
            }
        elif manual:
            previo["manual"] = True
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


async def _resolver_manuales_y_validar(db, id_operario, skills_normalizadas, rangos_data=None):
    """
    Cruza lo que manda el form contra las NATIVAS de hoy y devuelve la lista final a
    persistir.

    Hace dos cosas:

    1. Limpia el flag `manual` de lo que ya es nativo. Si el rango pasó a dar un proceso
       que estaba cargado a mano, la carga a mano dejó de aportar: se degrada a nativa.
       Si además no tenía prioridad ni estaba apagada, la fila entera se descarta —no
       queda nada que decir sobre esa nativa—.

    2. Invariante del modelo: SKILLS 1 y 2 solo ordenan preferencia DENTRO de lo que el
       operario ya sabe hacer (nativo o manual). Marcar como SKILL 1/2 un proceso que no
       tiene por ningún lado no habilitaría nada —el planificador ignora la prioridad de
       quien no es elegible— así que se rechaza con un aviso entendible en vez de
       guardar algo que no hace efecto.

    (El modelo anterior era el inverso: rechazaba marcar una nativa y dejaba cargar
    cualquier proceso suelto. Eso hacía que SKILLS 1/2 fuera un universo aparte del de
    las nativas, que es justo lo que se corrigió.)

    Lanza BusinessException nombrando los procesos que no corresponden.
    """
    if not skills_normalizadas:
        return skills_normalizadas

    nativos = await _procesos_nativos(db, id_operario, rangos_data)

    resueltas = []
    for s in skills_normalizadas:
        if s.get("manual") and s["id_proceso"] in nativos:
            s = {**s, "manual": False}
            if s["nivel"] == 0 and s["habilitado"]:
                continue  # el rango ya se lo da: la fila no aporta nada
        resueltas.append(s)

    intrusos = [
        s["id_proceso"]
        for s in resueltas
        if s["nivel"] in (1, 2) and not s.get("manual") and s["id_proceso"] not in nativos
    ]
    if not intrusos:
        return resueltas

    from sqlalchemy import select
    from backend.domain.Proceso import Proceso

    nombres = (await db.execute(
        select(Proceso.nombre).where(Proceso.id.in_(intrusos)).order_by(Proceso.nombre)
    )).scalars().all()
    detalle = ", ".join(nombres) if nombres else ", ".join(str(p) for p in intrusos)

    if len(intrusos) == 1:
        raise BusinessException(
            f"{detalle} no es una habilidad de este operario, así que no se le puede dar "
            f"prioridad. Agregala como habilidad manual o asignale un rango que incluya "
            f"ese proceso, y después marcala como SKILL 1 o SKILL 2."
        )
    raise BusinessException(
        f"Estos procesos no son habilidades de este operario y no se les puede dar "
        f"prioridad: {detalle}. Agregalos como habilidades manuales o asignale los rangos "
        f"que los incluyan, y después marcalos como SKILL 1 o SKILL 2."
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
            skills_norm = await _resolver_manuales_y_validar(
                db, None, skills_norm, operario_dto.rangos or []
            )

            procesos_skill = [
                OperarioProcesoSkill(
                    id_proceso=s["id_proceso"],
                    nivel=s["nivel"],
                    habilitado=s["habilitado"],
                    orden=s.get("orden"),
                    manual=bool(s.get("manual")),
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
            # Se valida ANTES de escribir nada: marcar como SKILL 1/2 un proceso que el
            # operario no tiene (ni nativo ni manual) es un error del usuario, no de la
            # base, y tiene que llegarle como aviso entendible.
            #
            # El resultado va a una variable local y no pisa `skills_data`: el retry
            # vuelve a entrar acá y tiene que resolver contra lo que mandó el form, no
            # contra una resolución anterior.
            skills_a_guardar = (
                await _resolver_manuales_y_validar(db, id, skills_data, rangos_data)
                if skills_data
                else skills_data
            )

            result = await db.execute(select(Operario).where(Operario.id == id))
            operario = result.scalar_one_or_none()
            if not operario:
                return _NO_ENCONTRADO
            for key, value in nueva_data.items():
                setattr(operario, key, value)

            # Las filas se reemplazan por completo: el form manda el estado final de
            # todas las habilidades (manuales + prioridad + apagadas), así que lo que no
            # viene es que volvió al default —o, para una manual, que se quitó—. El
            # borrado total también limpia de paso las filas huérfanas del modelo viejo
            # (nivel 1/2 sobre procesos que el rango ya no da).
            if skills_data is not None:
                await db.execute(
                    delete(OperarioProcesoSkill).where(
                        OperarioProcesoSkill.id_operario == id,
                    )
                )
                for s in (skills_a_guardar or []):
                    db.add(OperarioProcesoSkill(
                        id_operario=id,
                        id_proceso=s["id_proceso"],
                        nivel=s["nivel"],
                        habilitado=s.get("habilitado", True),
                        orden=s.get("orden"),
                        manual=bool(s.get("manual")),
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

        Una habilidad MANUAL nunca se borra acá: su fila no es un override sobre algo
        derivado, es la habilidad misma. Borrarla al reactivar la haría desaparecer.
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
                    if skill.nivel in (1, 2) or skill.manual:
                        # Tiene prioridad o es manual: se prende y la fila se conserva.
                        skill.habilitado = True
                        nivel_resultante = skill.nivel or 0
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

    # 🔹 Definir la PRIORIDAD de una habilidad, o agregar una MANUAL
    async def agregarSkill(self, id_operario: int, dto):
        """
        Dos usos, según venga `manual` en el DTO:

        - `manual=True`  -> agrega la habilidad al operario. Es la única forma de que
          sepa hacer algo que su rango no le da (para el resto, el conjunto lo fijan
          las nativas). Se puede combinar con nivel 1/2 para priorizarla de una.
        - `manual=False` -> marca la prioridad de una habilidad que ya tiene:
            - nivel 1/2 -> se prioriza y queda habilitada.
            - nivel 0   -> se quita la prioridad. Si además estaba habilitada y no era
              manual, se borra la fila: no queda nada que persistir. Si era manual la
              fila se conserva, porque es lo único que sostiene la habilidad.
        """
        try:
            from sqlalchemy import select, delete
            from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill

            nivel = dto.nivel or 0
            manual_pedido = bool(getattr(dto, "manual", False))

            stmt = select(OperarioProcesoSkill).where(
                OperarioProcesoSkill.id_operario == id_operario,
                OperarioProcesoSkill.id_proceso == dto.id_proceso
            )
            result = await self.repository.db.execute(stmt)
            existing = result.scalar_one_or_none()

            # La prioridad solo ordena entre elegibles: marcarla sobre un proceso que el
            # operario no tiene (ni nativo ni manual) no habilitaría nada.
            manual_vigente = manual_pedido or bool(getattr(existing, "manual", False))
            if nivel in (1, 2) and not manual_vigente:
                await _resolver_manuales_y_validar(
                    self.repository.db,
                    id_operario,
                    [{"id_proceso": dto.id_proceso, "nivel": nivel, "habilitado": True}],
                )

            if existing is not None:
                if manual_pedido:
                    existing.manual = True
                if nivel == 0 and existing.habilitado and not existing.manual:
                    await self.repository.db.execute(
                        delete(OperarioProcesoSkill).where(
                            OperarioProcesoSkill.id_operario == id_operario,
                            OperarioProcesoSkill.id_proceso == dto.id_proceso,
                        )
                    )
                else:
                    existing.nivel = nivel
                    if nivel in (1, 2):
                        existing.habilitado = True
            elif nivel in (1, 2) or manual_pedido:
                self.repository.db.add(OperarioProcesoSkill(
                    id_operario=id_operario,
                    id_proceso=dto.id_proceso,
                    nivel=nivel,
                    habilitado=True,
                    manual=manual_pedido,
                ))

            await self.repository.db.commit()
            return ResponseDTO(
                status=True,
                data={
                    "id_operario": id_operario,
                    "id_proceso": dto.id_proceso,
                    "nivel": nivel,
                    "manual": manual_vigente,
                },
                errorDescription="",
            )
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
