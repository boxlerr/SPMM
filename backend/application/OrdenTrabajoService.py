from backend.domain.OrdenTrabajo import OrdenTrabajo, CASILLAS_DE_CONTROL
from backend.dto.OrdenTrabajoRequestDTO import OrdenTrabajoRequestDTO
from backend.dto.OrdenTrabajoUpdateDTO import OrdenTrabajoUpdateDTO
from backend.dto.OrdenTrabajoResponseDTO import OrdenTrabajoResponseDTO
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from pydantic import ValidationError
from fastapi.exceptions import RequestValidationError
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from datetime import datetime
from sqlalchemy import func, select

from backend.domain.events.work_order import WorkOrderCreated, WorkOrderStateChanged
from backend.application.event_bus import EventBus
from typing import Optional

def _es_numero_de_ot_repetido(e: Exception) -> bool:
    """¿El error es «ese número de OT ya está»?

    Se mira el nombre del índice y no el tipo de excepción: entre asyncpg, SQLAlchemy y
    el reintento de db_retry, la excepción original llega envuelta en tres capas y el
    tipo cambia según por dónde pasó. El nombre del índice, en cambio, viaja en el texto
    y es de acá — no puede confundirse con ninguna otra violación de unicidad.
    """
    return "ux_orden_trabajo_id_otvieja" in str(e).lower()


class OrdenTrabajoService:
    def __init__(self, db_session, event_bus: Optional[EventBus] = None):
        self.repository = OrdenTrabajoRepository(db_session)
        self.event_bus = event_bus

    async def crearOrdenTrabajo(self, data_json: str, files: list = [], user: dict | None = None):
        import json
        from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
        from backend.domain.Plano import Plano
        from backend.infrastructure.db_retry import run_with_db_retry, motivo_error_db
        from backend.infrastructure.AuditoriaRepository import nombre_de
        from backend.infrastructure.estado_ordenes import ahora_ar

        # El alta llega como texto en un formulario (va con los planos): el DTO se arma
        # acá y no lo valida FastAPI. Un dato inválido (una cantidad negativa o enorme) era
        # un ValidationError suelto, o sea un 500; ahora es el mismo 400 con el campo que
        # da un PUT con el mismo dato.
        try:
            data_dict = json.loads(data_json)
        except ValueError:
            raise BusinessException("Los datos de la orden no se pudieron leer (no es un JSON válido).")
        if not isinstance(data_dict, dict):
            raise BusinessException("Los datos de la orden no tienen la forma esperada.")
        try:
            dto = OrdenTrabajoRequestDTO(**data_dict)
        except ValidationError as e:
            raise RequestValidationError(e.errors())
        logger.info("Service - Crear orden de trabajo completa.")
        db = self.repository.db

        # Leer los archivos UNA sola vez: file.read() no se puede repetir en un reintento.
        archivos_leidos = []
        if files:
            for file in files:
                contenido = await file.read()
                archivos_leidos.append((
                    file.filename,
                    file.content_type.split('/')[-1] if file.content_type else 'bin',
                    contenido,
                ))

        # Guardado ATÓMICO (cabecera + procesos + planos en un único commit) con reintento
        # ante cortes transitorios de la DB. Se reconstruye todo adentro para que, si hubo
        # un rollback por desconexión, el reintento no use objetos ORM inválidos.
        async def _guardar():
            # Auto-generar id_otvieja si vino 0/None (se recalcula en cada intento).
            final_id_otvieja = dto.id_otvieja
            if not final_id_otvieja or final_id_otvieja == 0:
                result = await db.execute(select(func.max(OrdenTrabajo.id_otvieja)))
                max_id = result.scalar()
                final_id_otvieja = (max_id or 0) + 1

            orden = OrdenTrabajo(
                id_otvieja=final_id_otvieja,

                id_prioridad=dto.id_prioridad,
                id_sector=dto.id_sector,
                id_articulo=dto.id_articulo,
                unidades=dto.unidades,
                id_cliente=dto.id_cliente,
                observaciones=dto.observaciones,  # Se usa para el Articulo segun logica frontend
                detalle=dto.detalle,  # 🔹 Nuevo campo detalle usuario
                fecha_orden=dto.fecha_orden,
                fecha_entrada=dto.fecha_entrada,
                fecha_prometida=dto.fecha_prometida,
                fecha_entrega=dto.fecha_entrega,

                # 🔹 Nuevos campos "Pronto"
                n_ped_l=dto.n_ped_l,
                n_pedido=dto.n_pedido,
                subsector=dto.subsector,
                requerido_por=dto.requerido_por,
                aprobado_por=dto.aprobado_por,
                remitos_salida=dto.remitos_salida,
                f_disp_material=dto.f_disp_material,

                fabricacion=1 if dto.fabricacion else 0,
                reparacion=1 if dto.reparacion else 0,
                sin_cargo=1 if dto.sin_cargo else 0,
                stock=1 if dto.stock else 0,
                interno=1 if dto.interno else 0,
                revisada=1 if dto.revisada else 0,
                tercerizado_total=1 if dto.tercerizado_total else 0,
                tercerizado_parcial=1 if dto.tercerizado_parcial else 0,
                suspendida=1 if dto.suspendida else 0,
                email=1 if dto.email else 0,
                tiene_plano=1 if dto.tiene_plano else 0,
                no_lleva_plano=1 if dto.no_lleva_plano else 0,
                programada=1 if dto.programada else 0,
                en_proceso=1 if dto.en_proceso else 0,

                finalizadototal=1 if dto.finalizadototal else 0,
                finalizadoparcial=1 if dto.finalizadoparcial else 0,
                reclamo=1 if dto.reclamo else 0,

                # RF-11: «Estado y control». Si nace controlada, queda dicho quién la
                # marcó y cuándo, igual que al marcarla después (ver el repositorio).
                controlado=1 if dto.controlado else 0,
                controlado_en=ahora_ar() if dto.controlado else None,
                controlado_por=nombre_de(user) if dto.controlado else None,
                finalizado_para_pintar=1 if dto.finalizado_para_pintar else 0,
                finalizado_tercerizacion_intermedia=1 if dto.finalizado_tercerizacion_intermedia else 0,
                finalizado_tercerizacion_final=1 if dto.finalizado_tercerizacion_final else 0,
                cantidad_finalizada_parcial=dto.cantidad_finalizada_parcial,
            )

            db.add(orden)
            await db.flush()  # asigna orden.id sin cerrar la transacción

            # Procesos de la OT.
            for index, proc_dto in enumerate(dto.procesos):
                # maquinaria_id viene como string opcional desde el modal; '' / None = sin preselección.
                _maq = getattr(proc_dto, "maquinaria_id", None)
                id_maquinaria = int(_maq) if (_maq not in (None, "", "0")) else None
                # operario_id ya venía en el DTO desde siempre, pero no había columna
                # donde guardarlo: el modal lo mandaba y el backend lo tiraba.
                _op = getattr(proc_dto, "operario_id", None)
                id_operario = int(_op) if (_op not in (None, "", "0")) else None
                db.add(OrdenTrabajoProceso(
                    id_orden_trabajo=orden.id,
                    id_proceso=proc_dto.proceso_id,
                    orden=index + 1,
                    tiempo_proceso=proc_dto.tiempo_proceso or 0,
                    cant_operarios=proc_dto.cant_operarios or 1,
                    id_maquinaria=id_maquinaria,
                    id_operario=id_operario,
                    no_lleva_maquina=1 if getattr(proc_dto, "no_lleva_maquina", None) else 0,
                ))

            # Planos (archivos ya leídos arriba).
            for (nombre, tipo_archivo, contenido) in archivos_leidos:
                db.add(Plano(
                    nombre=nombre,
                    descripcion="Cargado desde nueva OT",
                    tipo_archivo=tipo_archivo,
                    archivo=contenido,  # BLOB
                    id_orden_trabajo=orden.id,
                ))

            await db.commit()
            await db.refresh(orden)
            return orden

        try:
            # El número de OT se genera con max()+1 y hay un índice único que lo cuida
            # (migrations/2026-09-15_numero_de_ot_unico.sql). Si dos personas crean una
            # orden al mismo tiempo —Camilo y Lucas a la mañana, que es el caso real—
            # las dos leen el mismo máximo y la segunda choca. Reintentar es lo correcto
            # y no lo ve nadie: `_guardar` recalcula el máximo en cada intento, así que
            # el segundo se lleva el número siguiente.
            #
            # Sólo se reintenta cuando el número lo puso el sistema. Si la persona lo
            # escribió a mano y ya existe, reintentar le daría OTRO número distinto del
            # que pidió, en silencio: eso hay que decírselo, no taparlo.
            intentos = 3 if (not dto.id_otvieja or dto.id_otvieja == 0) else 1
            for intento in range(1, intentos + 1):
                try:
                    orden_creada = await run_with_db_retry(db, _guardar, label="crearOrdenTrabajo")
                    break
                except Exception as e:
                    if intento >= intentos or not _es_numero_de_ot_repetido(e):
                        raise
                    logger.warning(
                        f"Service - El número de OT que se generó ya existía "
                        f"(intento {intento}/{intentos}); se recalcula y se reintenta."
                    )
                    try:
                        await db.rollback()
                    except Exception:
                        pass
        except Exception as e:
            try:
                await db.rollback()
            except Exception:
                pass
            logger.error(f"Error creando OT: {e}")
            raise ApplicationException(motivo_error_db(e, "crear la orden de trabajo")) from e

        # 🔹 Evento: Orden Creada (fuera del reintento; si falla el bus, no afecta el guardado)
        if self.event_bus:
            try:
                creator_name = None
                if user:
                    nombre = user.get('nombre', '') or ''
                    apellido = user.get('apellido', '') or ''
                    full_name = f"{nombre} {apellido}".strip()
                    creator_name = full_name.title() if full_name else user.get('username', '').title()

                event = WorkOrderCreated(
                    id=orden_creada.id,
                    id_cliente=orden_creada.id_cliente,
                    unidades=orden_creada.unidades or 0,
                    fecha_prometida=str(orden_creada.fecha_prometida),
                    creator_name=creator_name
                )
                await self.event_bus.publish(event)
            except Exception as e:
                logger.error(f"Service - Error publishing WorkOrderCreated: {e}")

        return ResponseDTO(status=True, data=jsonable_encoder(orden_creada))

    async def listarOrdenes(self):
        logger.info("Service - Listar órdenes de trabajo.")
        ordenes = await self.repository.find_all()
        
        if not ordenes:
            logger.info("Service - No hay órdenes de trabajo registradas.")
        
        # Validate and serialize using DTO to ensure structure
        valid_ordenes = []
        
        # 1. Get all Order IDs
        if ordenes:
            orden_ids = [o.id for o in ordenes]
            # 2. Fetch Planificaciones for these orders safely
            planificaciones = await self.repository.get_planificaciones_by_orden_ids(orden_ids)
            
            # 3. Dos mapas para saber quién hace cada línea:
            #    - por PASADA (orden_trabajo_proceso.id): lo correcto desde que el
            #      mismo proceso puede ir varias veces en la OT.
            #    - por (orden_id, proceso_id): plan viejo, guardado antes de que la
            #      pasada existiera. Se usa sólo como respaldo.
            # Result contains rows: (orden_id, proceso_id, nombre, apellido, id_otp)
            plan_map = {}
            plan_map_por_linea = {}
            for row in planificaciones:
                try:
                    # Robust access using indices since we know the query "SELECT p.orden_id, ... " order
                    oid = row[0]
                    pid = row[1]
                    nombre = row[2]
                    apellido = row[3]
                    id_otp = row[4] if len(row) > 4 else None

                    # Format name to Title Case (e.g. "JUAN PEREZ" -> "Juan Perez")
                    nombre_fmt = nombre.title() if nombre else ""
                    apellido_fmt = apellido.title() if apellido else ""
                    nombre_completo = f"{nombre_fmt} {apellido_fmt}".strip()

                    if id_otp is not None:
                        plan_map_por_linea[int(id_otp)] = nombre_completo
                    if oid is not None and pid is not None:
                        plan_map[(int(oid), int(pid))] = nombre_completo
                except Exception as e:
                    # Log error but don't break the loop or crash
                    logger.warning(f"Service - Skipping malformed row: {row} - {e}")
            
            logger.info(f"Service - Mapeo de operarios construido. Total entradas: {len(plan_map)}")

            if plan_map:
                logger.info(f"Service - Ejemplo clave mapa: {list(plan_map.keys())[0]}")

            # 4. Fetch material status for all orders
            material_statuses = await self.repository.get_material_status(orden_ids)

            for o in ordenes:
                try:
                    # Validate basic structure
                    if len(valid_ordenes) == 0:
                         logger.info(f"debug - Checking order {o.id}: id_cliente={o.id_cliente} cliente={o.cliente}")
                    dto = OrdenTrabajoResponseDTO.model_validate(o)
                    
                    # 5. Inject operario_nombre into processes
                    if dto.procesos:
                        for proc in dto.procesos:
                            # proc is OrdenTrabajoProcesoDTO. It has id_proceso etc.
                            # We need to match with Planificacion. 
                            # OrdenTrabajoProcesoDTO usually has nested 'proceso' with id.
                            # Let's check structure: OrdenTrabajoProcesoDTO has 'proceso' nested object.
                            
                            # Primero por PASADA: con el mismo proceso repetido, la
                            # clave (orden, proceso) le pondría el mismo operario a
                            # todas las pasadas.
                            if proc.id is not None and proc.id in plan_map_por_linea:
                                proc.operario_nombre = plan_map_por_linea[proc.id]
                                continue

                            pid = proc.proceso.id if proc.proceso else None
                            if pid:
                                key = (o.id, pid)
                                # Log first few attempts to verify matching logic
                                if len(valid_ordenes) == 0 and dto.procesos.index(proc) == 0:
                                     logger.info(f"Service - Buscando clave: {key} en mapa.")

                                if key in plan_map:
                                    proc.operario_nombre = plan_map[key]
                    
                    # 6. Inject material status
                    dto.estado_material = material_statuses.get(o.id, 'sin_datos')
                    
                    valid_ordenes.append(jsonable_encoder(dto))
                except ValidationError as e:
                    logger.error(f"Service - Error validando orden ID {o.id}: {e}")
                    continue
        else:
            return ResponseDTO(status=True, data=[])
                
        return ResponseDTO(status=True, data=valid_ordenes)

    async def obtenerOrdenPorId(self, id: int):
        logger.info(f"Service - Obtener orden de trabajo ID: {id}")
        orden = await self.repository.find_by_id(id)

        if not orden:
            raise NotFoundException(f"No se encontró la orden de trabajo con ID {id}")

        dto = OrdenTrabajoResponseDTO.model_validate(orden)
        salida = jsonable_encoder(dto)

        # Lo que el planificador asignó, pegado a cada pasada.
        #
        # Va acá y no en un endpoint nuevo: los dos modales que editan procesos ya
        # piden esta orden, así que lo reciben gratis y sin un segundo viaje que haría
        # parpadear "Sin asignar" antes de que lleguen los datos.
        #
        # Se ata por `id_orden_trabajo_proceso`, que es la pasada exacta. Los planes
        # viejos lo tienen en NULL: para esos se reparte por proceso, en orden de
        # inicio, una fila de plan por cada pasada de ese proceso — la misma regla que
        # usa `update_processes_full` para machear pasadas repetidas.
        plan = await self.repository.get_plan_de_orden(id)
        if plan:
            por_pasada = {f["id_orden_trabajo_proceso"]: f
                          for f in plan if f["id_orden_trabajo_proceso"]}
            sueltas = {}
            for f in plan:
                if not f["id_orden_trabajo_proceso"]:
                    sueltas.setdefault(f["proceso_id"], []).append(f)
            for proc in salida.get("procesos") or []:
                asignado = por_pasada.get(proc.get("id"))
                if asignado is None:
                    cola = sueltas.get((proc.get("proceso") or {}).get("id"))
                    asignado = cola.pop(0) if cola else None
                proc["planificado"] = {
                    "operario": asignado.get("operario") or None,
                    "maquinaria": asignado.get("maquinaria") or None,
                    "sin_asignar": bool(asignado.get("sin_asignar")),
                    "sin_maquinaria": bool(asignado.get("sin_maquinaria")),
                    "forzado": bool(asignado.get("forzado_fuera_rango")),
                    "lote": asignado.get("descripcion_lote"),
                } if asignado else None

        return ResponseDTO(status=True, data=salida)

    async def modificarOrden(self, id: int, dto: OrdenTrabajoUpdateDTO,
                             motivo: str = "edicion", usuario: dict | None = None):
        logger.info(f"Service - Modificar orden de trabajo ID: {id}")
        
        nueva_data = dto.model_dump(exclude_unset=True)

        # `cliente` es el NOMBRE del cliente y viene sólo para mostrarlo en el modal: en
        # la tabla no existe esa columna (el vínculo real es `id_cliente`) y en el modelo
        # ese nombre lo ocupa la relación al objeto Cliente. El alta ya lo ignoraba; acá
        # se saca explícitamente para que quede dicho, aunque el repositorio igual filtra
        # por columnas.
        nueva_data.pop('cliente', None)

        # `id_otvieja` es el número visible de la OT. En el alta un 0 significa
        # "generalo vos", pero acá no hay nada que lo genere: entraba tal cual y le
        # pisaba el número a la orden. Y el modal manda 0 con sólo borrar el campo
        # "Nº OT Vieja". Sin número nuevo, se deja el que ya tenía.
        if not nueva_data.get('id_otvieja'):
            nueva_data.pop('id_otvieja', None)

        # Fechas obligatorias en null: se descartan en vez de tumbar el guardado.
        #
        # La edición en línea de la tabla de Planificación manda `null` cuando alguien
        # vacía la celda, y estas tres columnas son NOT NULL: el UPDATE moría con un
        # error de la base. Se ignora el campo y la orden conserva la fecha que tenía —
        # el aviso de que no puede quedar vacía lo da la pantalla. `fecha_entrega` NO
        # va acá: vaciarla es válido, significa "todavía no se entregó".
        for campo in ('fecha_orden', 'fecha_entrada', 'fecha_prometida'):
            if campo in nueva_data and nueva_data[campo] is None:
                logger.warning(f"Service - OT {id}: se ignora {campo}=null (es obligatoria)")
                nueva_data.pop(campo)

        # 🔹 Convert Boolean fields to Integer (0/1) for compatibility with DB schema
        bool_fields = [
            'fabricacion', 'reparacion', 'sin_cargo', 'stock', 'interno', 'revisada',
            'tercerizado_total', 'tercerizado_parcial', 'suspendida', 'email',
            'tiene_plano', 'no_lleva_plano', 'programada', 'en_proceso', 'finalizadototal',
            'finalizadoparcial', 'reclamo',
            # RF-11: las casillas de «Estado y control» que faltaban. Como sus vecinas, la
            # base guarda 0/1 y no True/False.
            *CASILLAS_DE_CONTROL,
        ]
        for field in bool_fields:
            if field in nueva_data and isinstance(nueva_data[field], bool):
                nueva_data[field] = 1 if nueva_data[field] else 0

        # RF-11: las cuatro casillas nuevas son NOT NULL en la base (a diferencia de sus
        # vecinas, que vienen del legacy y aceptan NULL). Un `null` explícito —la edición
        # en línea de una lista que no conoce el campo, por ejemplo— no es «desmarcala»:
        # es «no sé», y se ignora en vez de tumbar el guardado con un error de la base.
        # Para desmarcar se manda false. `cantidad_finalizada_parcial` sí acepta null
        # (vaciar el «Cant.» es válido).
        for campo in CASILLAS_DE_CONTROL:
            if campo in nueva_data and nueva_data[campo] is None:
                nueva_data.pop(campo)

        # Extract processes to handle separately.
        #
        # Se distingue "no vino la clave" (None -> no se tocan los procesos) de "vino
        # vacía" ([] -> el usuario los sacó todos y hay que borrarlos). Antes las dos
        # cosas caían en la misma bolsa y una lista vacía no llamaba a
        # update_processes_full: el usuario borraba todos los procesos, guardaba, y
        # volvían a aparecer.
        procesos_data = nueva_data.pop('procesos', None)
        
        # Update base order.
        #
        # El `usuario` viaja hasta el repositorio y no se queda acá: editar SÓLO la
        # cabecera (cliente, fechas, cantidades, observaciones) no dejaba ningún
        # rastro. Los procesos sí lo dejaban desde el 10/09, así que una OT podía
        # aparecer con otra fecha prometida y el historial decía que nadie la había
        # tocado.
        orden_actualizada = await self.repository.update(id, nueva_data, usuario=usuario)

        if not orden_actualizada:
            raise NotFoundException(f"No se encontró la orden de trabajo con ID {id}")

        # Update processes intelligently. Con lista vacía, update_processes_full no
        # conserva ninguna y las borra todas, que es justo lo que se pidió.
        if procesos_data is not None:
             await self.repository.update_processes_full(
                 id, procesos_data, motivo=motivo, usuario=usuario)
             # Reload to return full object including new processes
             orden_actualizada = await self.repository.find_by_id(id)

        return ResponseDTO(status=True, data=jsonable_encoder(orden_actualizada))

    async def eliminarOrden(self, id: int):
        logger.info(f"Service - Eliminar orden de trabajo ID: {id}")
        ok = await self.repository.delete(id)

        if not ok:
            raise NotFoundException(f"No se encontró la orden de trabajo con ID {id}")

        return ResponseDTO(status=True, data={"deleted": id})
        
    async def listarPorFechas(self, desde: datetime, hasta: datetime):
        logger.info(f"Service - Listar órdenes por fechas: {desde} a {hasta}")
        ordenes = await self.repository.find_by_fecha_orden_entre(desde, hasta)
        
        if not ordenes:
            logger.info("Service - No hay órdenes en el rango de fechas especificado.")
            return ResponseDTO(status=True, data=[])
        
        valid_ordenes = []
        for o in ordenes:
            try:
                dto = OrdenTrabajoResponseDTO.model_validate(o)
                valid_ordenes.append(jsonable_encoder(dto))
            except Exception as e:
                logger.error(f"Service - Error validando orden ID {o.id}: {e}")
                continue
                
        return ResponseDTO(status=True, data=valid_ordenes)

    async def listarPorPrioridad(self, id_prioridad: int):
        logger.info(f"Service - Listar órdenes por prioridad: {id_prioridad}")
        ordenes = await self.repository.find_by_prioridad(id_prioridad)
        
        if not ordenes:
            logger.info(f"Service - No hay órdenes con prioridad {id_prioridad}.")
            return ResponseDTO(status=True, data=[])
            
        valid_ordenes = []
        for o in ordenes:
            try:
                dto = OrdenTrabajoResponseDTO.model_validate(o)
                valid_ordenes.append(jsonable_encoder(dto))
            except Exception as e:
                logger.error(f"Service - Error validando orden ID {o.id}: {e}")
                continue
        
        return ResponseDTO(status=True, data=valid_ordenes)

    async def obtenerEstadisticasEstados(self):
        """
        Obtiene estadísticas de órdenes agrupadas por estado
        """
        try:
            logger.info("Service - Obtener estadísticas de estados.")
            estadisticas = await self.repository.get_estadisticas_estados()
            logger.info(f"Service - Estadísticas obtenidas: {estadisticas}")
            return ResponseDTO(status=True, data=estadisticas)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener estadísticas de estados.") from e

    async def obtenerOrdenesCriticas(self, dias: int = 7):
        """
        Obtiene las órdenes críticas próximas a vencer
        """
        try:
            logger.info(f"Service - Obtener órdenes críticas (próximas {dias} días).")
            ordenes = await self.repository.get_ordenes_criticas(dias)

            # El día del TALLER, no el del servidor (UTC en Cloud Run). Y la resta es de
            # días: fecha_prometida es datetime y restarle un date tiraba TypeError, o sea
            # un 500 apenas había una sola OT crítica.
            from backend.infrastructure.estado_ordenes import hoy_ar
            hoy = hoy_ar().date()
            ordenes_formateadas = []
            for orden in ordenes:
                dias_restantes = (orden.fecha_prometida.date() - hoy).days

                orden_data = {
                    "id": orden.id,
                    "numero": orden.id_otvieja or orden.id,
                    "articulo": orden.articulo.descripcion if orden.articulo else "Sin artículo",
                    "sector": orden.sector.nombre if orden.sector else "Sin sector",
                    "fecha_prometida": orden.fecha_prometida.isoformat(),
                    "dias_restantes": dias_restantes
                }
                ordenes_formateadas.append(orden_data)
            
            logger.info(f"Service - Órdenes críticas obtenidas: {len(ordenes_formateadas)}")
            return ResponseDTO(status=True, data=ordenes_formateadas)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener órdenes críticas.") from e

    async def obtenerOcupacionPorSector(self):
        """
        Obtiene la ocupación (carga de trabajo) por sector
        """
        try:
            logger.info("Service - Obtener ocupación por sector.")
            ocupacion = await self.repository.get_ocupacion_por_sector()
            logger.info(f"Service - Ocupación obtenida: {len(ocupacion)} sectores")
            return ResponseDTO(status=True, data=ocupacion)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener ocupación por sector.") from e

    async def obtenerProximasEntregasTimeline(self, dias: int = 7):
        """
        Obtiene timeline de próximas entregas agrupadas por fecha
        
        Args:
            dias: Número de días hacia adelante (default: 7)
            
        Returns:
            ResponseDTO con timeline de entregas
        """
        try:
            logger.info(f"Service - Obtener timeline de próximas entregas ({dias} días).")
            timeline = await self.repository.get_proximas_entregas_timeline(dias)
            logger.info(f"Service - Timeline obtenido: {len(timeline)} días")
            return ResponseDTO(status=True, data=timeline)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener timeline de próximas entregas.") from e


    async def marcarEstadoDeOrdenes(self, orden_ids: list[int], id_estado: int, user: dict | None = None):
        """Pone todas las OT elegidas en el mismo estado, de una.

        Se usa desde la lista de planificadas, donde se tildan varias y se marcan
        juntas: tildar cinco OT y tener que abrir los cincuenta pasos de a uno es el
        tipo de cosa que nadie hace, así que el dato queda sin cargar.
        """
        logger.info(f"Service - Estado masivo: {len(orden_ids or [])} OT -> estado {id_estado}")
        if id_estado not in (1, 2, 3):
            raise ApplicationException("Estado inválido.")
        if not orden_ids:
            raise ApplicationException("No se recibieron órdenes.")
        hecho = await self.repository.marcar_estado_de_ordenes(orden_ids, id_estado, usuario=user)
        return ResponseDTO(status=True, data=hecho)

    async def actualizarEstadoProceso(self, id_orden: int, id_proceso: int, id_estado: int, user: dict | None = None, id_otp: int | None = None):
        logger.info(f"Service - Actualizar estado proceso: Orden {id_orden}, Proceso {id_proceso} -> ID Estado {id_estado}")

        # `id_otp` es la PASADA puntual. El mismo proceso puede estar varias veces en
        # la OT, así que sin él el repo tiene que adivinar cuál (toma la del paso más
        # bajo y lo loguea).
        ot_proceso = await self.repository.update_proceso_status(
            id_orden, id_proceso, id_estado, id_otp=id_otp, usuario=user)
        
        if not ot_proceso:
            raise NotFoundException(f"No se encontró la relación Orden {id_orden} - Proceso {id_proceso}")

        # Verificar SIEMPRE si la orden está completa o no
        is_complete = await self.repository.check_all_processes_completed(id_orden)
        print(f"DEBUG: Orden {id_orden} is_complete={is_complete}")
        
        if is_complete:
            print(f"DEBUG: Marking order {id_orden} as completed")
            await self.repository.mark_as_completed(id_orden)
            new_order_state = "Finalizado"
        else:
            # Si no está completa (porque se movió un proceso a no finalizado), marcar como incompleta
            print(f"DEBUG: Marking order {id_orden} as incomplete")
            await self.repository.mark_as_incomplete(id_orden)
            new_order_state = "En Proceso"

        # 🔹 Evento: Cambio de Estado
        if self.event_bus:
            try:
                actor_name = None
                if user:
                     nombre = user.get('nombre', '') or ''
                     apellido = user.get('apellido', '') or ''
                     full_name = f"{nombre} {apellido}".strip()
                     actor_name = full_name.title() if full_name else user.get('username', '').title()

                event = WorkOrderStateChanged(
                    id=id_orden,
                    new_state=new_order_state,
                    previous_state="Desconocido", # Simplificado
                    actor_name=actor_name
                )
                await self.event_bus.publish(event)
            except Exception as e:
                logger.error(f"Service - Error publishing WorkOrderStateChanged: {e}")
            
        return ResponseDTO(status=True, data={
            "updated": True, 
            "id_estado": id_estado, 
            "inicio_real": ot_proceso.inicio_real,
            "fin_real": ot_proceso.fin_real
        })

    async def actualizarObservacionesProceso(self, id_orden: int, id_proceso: int, observaciones: str,
                                             id_otp: int | None = None, usuario: dict | None = None):
        logger.info(f"Service - Actualizar observaciones proceso: Orden {id_orden}, Proceso {id_proceso}")

        ok = await self.repository.update_proceso_observaciones(
            id_orden, id_proceso, observaciones, id_otp=id_otp, usuario=usuario)
        
        if not ok:
            raise NotFoundException(f"No se encontró la relación Orden {id_orden} - Proceso {id_proceso}")
            
        if not ok:
            raise NotFoundException(f"No se encontró la relación Orden {id_orden} - Proceso {id_proceso}")
            
        return ResponseDTO(status=True, data={"updated": True, "observaciones": observaciones})

    async def actualizarOrdenProcesos(self, id_orden: int, process_orders: list[dict],
                                      usuario: dict | None = None):
        logger.info(f"Service - Actualizar orden de procesos para Orden {id_orden}")
        
        ok = await self.repository.update_procesos_order(id_orden, process_orders, usuario=usuario)
        
        if not ok:
             raise ApplicationException(f"Error al actualizar el orden de procesos para la orden {id_orden}")
             
        return ResponseDTO(status=True, data={"updated": True})


    async def listarVersionesProcesos(self, id_orden: int):
        """Las fotos de los procesos de esta OT, para el botón de deshacer."""
        logger.info(f"Service - Versiones de procesos de la OT {id_orden}")
        return ResponseDTO(status=True, data=jsonable_encoder(
            await self.repository.listar_versiones_procesos(id_orden)))

    async def restaurarProcesos(self, id_orden: int, id_version: int, usuario: dict | None = None):
        """Vuelve los procesos de la OT a como estaban en esa foto.

        Se restaura por el MISMO camino que un guardado normal
        (`update_processes_full`), no metiendo las filas viejas de vuelta a mano. Dos
        razones: las filas que siguen existiendo conservan su id —y con él su avance
        y el plan que las apunta—, y la restauración deja su propia foto, así que
        deshacer también se puede deshacer.
        """
        version = await self.repository.obtener_version_procesos(id_version)
        if not version:
            raise NotFoundException(f"No existe la versión {id_version}.")
        if version["id_orden_trabajo"] != id_orden:
            # Sin esto, un id de versión de otra OT le escribiría los procesos de una
            # orden ajena a esta.
            raise ApplicationException(
                f"La versión {id_version} es de otra orden de trabajo.")

        procesos = version["procesos"]
        if isinstance(procesos, str):
            import json
            procesos = json.loads(procesos)

        # `id_estado` y `observaciones` viajan a propósito: un deshacer que devuelve
        # los procesos pero los deja a todos en Pendiente no es un deshacer. Las filas
        # que nunca se borraron conservan su id y sólo se les repone lo que tenían; las
        # que sí se borraron vuelven con su avance en vez de nacer en cero.
        payload = [{
            "proceso_id": p["id_proceso"],
            "id_otp": p.get("id"),
            "tiempo_proceso": p.get("tiempo_proceso") or 0,
            "cant_operarios": p.get("cant_operarios") or 1,
            "maquinaria_id": p.get("id_maquinaria"),
            "operario_id": p.get("id_operario"),
            "no_lleva_maquina": bool(p.get("no_lleva_maquina")),
            "id_estado": p.get("id_estado") or 1,
            "observaciones": p.get("observaciones"),
        } for p in sorted(procesos, key=lambda x: (x.get("orden") or 0, x.get("id") or 0))]

        logger.info(f"Service - Restaurando {len(payload)} procesos en la OT {id_orden} "
                    f"desde la versión {id_version}")
        await self.repository.update_processes_full(
            id_orden, payload, motivo="restaurar", usuario=usuario)
        return ResponseDTO(status=True, data={
            "restaurados": len(payload),
            "desde": jsonable_encoder(version["creado_en"]),
        })

    async def resumenTodas(self):
        """Todas las OT en una lista, con el corte planificada / sin planificar.

        Devuelve además el total y los conteos ya hechos: la pantalla los muestra
        arriba y no tiene por qué recontar 1.400 filas en el navegador.
        """
        logger.info("Service - Resumen de todas las órdenes.")
        ordenes = await self.repository.resumen_todas()

        def entregada(o):
            # Mismo criterio que isOrderDelivered() en el front (lib/utils.ts): el
            # legacy marca "sin entregar" con fecha_entrega = 1950-01-01, no con NULL.
            if o.get("finalizadototal") == 1:
                return True
            f = o.get("fecha_entrega")
            return bool(f and f.year > 1950)

        for o in ordenes:
            o["entregada"] = entregada(o)
            # Fabricación, reparación o sin cargo, en una sola palabra. En la base son
            # tres banderas del legacy que pueden estar varias o ninguna; la pantalla
            # muestra UNA cosa, que es como se lee y como lo pidió Lucas.
            fab, rep = o.get("fabricacion") == 1, o.get("reparacion") == 1
            sc = o.get("sin_cargo") == 1
            o["tipo_trabajo"] = ("ambas" if sum((fab, rep, sc)) > 1 else
                                 "fabricacion" if fab else
                                 "reparacion" if rep else
                                 "sin_cargo" if sc else None)
            # Tres estados y no dos: hay plano, no lleva, o falta y hay que buscarlo.
            o["estado_plano"] = ("tiene" if (o.get("planos") or 0) > 0 or o.get("tiene_plano") == 1
                                 else "no_lleva" if o.get("no_lleva_plano") == 1
                                 else "falta")
            # Una OT entregada ya no está "afuera del plan": está terminada. El corte
            # que importa —lo que falta planificar— es sobre las que siguen abiertas.
            o["estado_plan"] = (
                "entregada" if o["entregada"]
                else "planificada" if o.get("planificada")
                else "sin_planificar"
            )

        resumen = {
            "total": len(ordenes),
            "planificadas": sum(1 for o in ordenes if o["estado_plan"] == "planificada"),
            "sin_planificar": sum(1 for o in ordenes if o["estado_plan"] == "sin_planificar"),
            "entregadas": sum(1 for o in ordenes if o["estado_plan"] == "entregada"),
            "sin_procesos": sum(1 for o in ordenes
                                if o["estado_plan"] == "sin_planificar" and not o["procesos"]),
            # Las que hay que ir a buscar al Drive: sin plano y sin marcar que no lleva.
            "sin_tipo": sum(1 for o in ordenes
                            if o["estado_plan"] != "entregada" and not o["tipo_trabajo"]),
            "falta_plano": sum(1 for o in ordenes
                               if o["estado_plan"] != "entregada" and o["estado_plano"] == "falta"),
            # RF-11: cuántas tienen cada marca de «Estado y control», sobre TODAS (también
            # las entregadas: «¿cuáles se controlaron?» se pregunta después de entregar).
            "controladas": sum(1 for o in ordenes if o.get("controlado") == 1),
            "para_pintar": sum(1 for o in ordenes if o.get("finalizado_para_pintar") == 1),
            "tercerizacion_intermedia": sum(
                1 for o in ordenes if o.get("finalizado_tercerizacion_intermedia") == 1),
            "tercerizacion_final": sum(
                1 for o in ordenes if o.get("finalizado_tercerizacion_final") == 1),
        }
        logger.info(f"Service - Resumen OK: {resumen}")
        return ResponseDTO(status=True, data={"resumen": resumen,
                                              "ordenes": jsonable_encoder(ordenes)})

    async def obtenerOrdenesNoPlanificadas(self):
        """
        Obtiene las órdenes de trabajo que no han sido planificadas
        """
        try:
            logger.info("Service - Obtener órdenes no planificadas.")
            ordenes = await self.repository.find_unplanned()
            
            if not ordenes:
                return ResponseDTO(status=True, data=[])

            # Check material availability
            orden_ids = [o.id for o in ordenes]
            material_statuses = await self.repository.get_material_status(orden_ids)
            
            valid_ordenes = []
            for o in ordenes:
                try:
                    dto = OrdenTrabajoResponseDTO.model_validate(o)
                    dto.estado_material = material_statuses.get(o.id, 'sin_datos')
                    valid_ordenes.append(jsonable_encoder(dto))
                except Exception as e:
                    logger.error(f"Service - Error validando orden ID {o.id}: {e}")
                    continue
                
            logger.info(f"Service - Órdenes no planificadas obtenidas: {len(valid_ordenes)}")
            return ResponseDTO(status=True, data=valid_ordenes)
        except InfrastructureException:
            raise
        except Exception as e:
            raise ApplicationException("Error al obtener órdenes no planificadas.") from e

    
    async def registrarEntrega(self, id_orden: int, cantidad_agregar: int,
                               usuario: dict | None = None):
        logger.info(f"Service - Registrar entrega para Orden {id_orden}: Agregar {cantidad_agregar}")
        
        # 1. Obtener orden actual
        orden = await self.repository.find_by_id(id_orden)
        if not orden:
             raise NotFoundException(f"No se encontró la orden de trabajo con ID {id_orden}")
             
        # 2. Calcular nueva cantidad
        cantidad_actual = orden.cantidad_entregada or 0
        nueva_cantidad = cantidad_actual + cantidad_agregar
        
        if nueva_cantidad < 0:
            nueva_cantidad = 0
            
        # 3. Actualizar
        orden_actualizada = await self.repository.update_cantidad_entregada(
            id_orden, nueva_cantidad, orden.unidades, usuario=usuario)
        
        return ResponseDTO(status=True, data=jsonable_encoder(orden_actualizada))
        
        return ResponseDTO(status=True, data=jsonable_encoder(orden_actualizada))

    async def agregarProceso(self, id_orden: int, id_proceso: int, tiempo_estimado: int, orden: int | None = None, cant_operarios: int = 1, id_maquinaria: int | None = None, id_operario: int | None = None, usuario: dict | None = None):
        logger.info(f"Service - Agregar proceso {id_proceso} a Orden {id_orden}")

        # Verify order exists
        exists = await self.repository.find_by_id(id_orden)
        if not exists:
             raise NotFoundException(f"No se encontró la orden de trabajo con ID {id_orden}")

        # Antes se cortaba acá si el proceso ya estaba en la OT: la PK era
        # (id_orden_trabajo, id_proceso) y la segunda pasada reventaba con un 500.
        # Desde el 28/08/2026 la fila tiene id propio y el mismo proceso PUEDE ir
        # varias veces — es lo normal en el taller (el legacy carga una fila por
        # pasada). Si el taller lo repite, se guarda repetido; corregirlo es decisión
        # de ellos, no nuestra.
        nuevo = await self.repository.agregarProceso(id_orden, id_proceso, tiempo_estimado, orden, cant_operarios, id_maquinaria, id_operario, usuario=usuario)

        return ResponseDTO(status=True, data=jsonable_encoder(nuevo))

    async def editarProceso(self, id_orden: int, id_otp: int, cambios: dict,
                            usuario: dict | None = None):
        """Edita una pasada de proceso ya cargada en la OT (minutos, máquina, persona)."""
        logger.info(f"Service - Editar pasada {id_otp} de la Orden {id_orden}")

        linea = await self.repository.editarProceso(id_orden, id_otp, cambios, usuario=usuario)
        if not linea:
            raise NotFoundException(
                f"No se encontró el proceso {id_otp} en la orden de trabajo {id_orden}"
            )
        return ResponseDTO(status=True, data=jsonable_encoder(linea))

    async def obtenerHistorialProcesos(self, id_articulo: int, excluir_orden_id: int | None = None):
        """
        "Traer historial": trae los procesos de la última OT del mismo producto
        (id_articulo = código + descripción). El frontend los carga en el listado
        todos tildados; el usuario destilda los que esta vez no van.
        """
        logger.info(f"Service - Traer historial de procesos para articulo {id_articulo}")
        procs = await self.repository.obtener_historial_procesos(id_articulo, excluir_orden_id)
        data = [
            {
                "id_proceso": p.id_proceso,
                "nombre_proceso": p.proceso.nombre if p.proceso else None,
                "tiempo_proceso": p.tiempo_proceso,
                "cant_operarios": p.cant_operarios,
                "id_maquinaria": p.id_maquinaria,
                "id_operario": p.id_operario,
                "orden": p.orden,
            }
            for p in procs
        ]
        return ResponseDTO(status=True, data=data)

    async def eliminarProceso(self, id_orden: int, id_proceso: int, id_otp: int | None = None,
                              usuario: dict | None = None):
        logger.info(f"Service - Eliminar proceso {id_proceso} de Orden {id_orden}")

        exists = await self.repository.find_by_id(id_orden)
        if not exists:
            raise NotFoundException(f"No se encontró la orden de trabajo con ID {id_orden}")

        procesos = exists.procesos or []
        if id_otp is not None:
            en_ot = any(p.id == id_otp for p in procesos)
        else:
            en_ot = any(p.id_proceso == id_proceso for p in procesos)
        if not en_ot:
            raise NotFoundException(f"El proceso {id_proceso} no está cargado en la OT {id_orden}.")

        # Borra UNA pasada, no todas las del mismo proceso.
        await self.repository.eliminarProceso(id_orden, id_proceso, id_otp=id_otp, usuario=usuario)
        return ResponseDTO(status=True, data={"message": "Proceso eliminado correctamente"})
