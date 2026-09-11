from sqlalchemy import select, inspect, text
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy import func, case
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from backend.dto.fechas import sin_zona
from backend.infrastructure.db_retry import motivo_error_db
from datetime import datetime, date

from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Proceso import Proceso
from backend.domain.Cliente import Cliente
from backend.infrastructure.AuditoriaRepository import nombre_de
from zoneinfo import ZoneInfo

# El contenedor de Cloud Run no fija TZ, así que datetime.now() da UTC y todo lo que
# se estampa desde acá quedaba 3 horas adelantado respecto del resto de la auditoría
# —que sí usa hora local— y del reloj del taller. Mismo helper que
# AuditoriaRepository y PlanificacionRepository.
_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")


def _ahora_ar() -> datetime:
    """Hora actual en Argentina, naive (las columnas son timestamp sin zona)."""
    return datetime.now(_TZ_AR).replace(tzinfo=None)


class OrdenTrabajoRepository:
    def __init__(self, db):
        self.db = db

    async def _sellar_modificacion(self, id_orden: int, usuario: dict | None):
        """Deja escrito quién y cuándo tocó la OT, en TODA puerta que la modifique.

        Se llama pegado al cambio y ANTES del commit, en la misma transacción: si el
        cambio se guarda, el rastro se guarda; si se va al rollback, no queda un sello
        de algo que nunca pasó. Por eso va como UPDATE suelto y no tocando el objeto
        ORM — la mayoría de las puertas (agregar un proceso, cambiarle el estado,
        reordenar) ni siquiera tienen la cabecera cargada, y hacer un SELECT extra por
        cada una para sellarla sería pagar dos consultas donde alcanza una.

        Sin usuario queda NULL. Un cambio que no sabemos quién hizo tiene que verse
        distinto de uno hecho por una máquina, y las dos cosas tienen que verse
        distintas de un autor inventado — que es lo único que no se hace nunca.
        """
        await self.db.execute(text(
            "UPDATE orden_trabajo SET modificado_en = :cuando, modificado_por = :quien "
            "WHERE id = :id"
        ), {"cuando": _ahora_ar(), "quien": nombre_de(usuario), "id": id_orden})

    async def save(self, orden: OrdenTrabajo):
        try:
            logger.info("Repository - Crear Orden de Trabajo.")
            self.db.add(orden)
            await self.db.commit()
            await self.db.refresh(orden)
            logger.info("Repository - Crear Orden de Trabajo OK.")
            return orden
        except Exception as e:
            logger.error(f"Repository - Error real en save: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar la Orden de Trabajo.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todas las órdenes de trabajo.")
            # joinedload para relaciones 1-a-1 (no inflan filas).
            # selectinload para 'procesos' (1-a-muchos): evita el producto cartesiano
            # que multiplicaba miles de filas y disparaba la latencia del endpoint /ordenes.
            result = await self.db.execute(
                select(OrdenTrabajo)
                .options(
                    joinedload(OrdenTrabajo.articulo),
                    joinedload(OrdenTrabajo.sector),
                    joinedload(OrdenTrabajo.cliente),
                    joinedload(OrdenTrabajo.prioridad),
                    selectinload(OrdenTrabajo.procesos).options(
                        joinedload(OrdenTrabajoProceso.proceso),
                        joinedload(OrdenTrabajoProceso.estado_proceso)
                    )
                )
                .order_by(OrdenTrabajo.id.desc())
            )
            data = result.scalars().unique().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar las Órdenes de Trabajo.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar orden de trabajo por ID {id}.")
            result = await self.db.execute(
                select(OrdenTrabajo)
                .where(OrdenTrabajo.id == id)
                .options(
                    joinedload(OrdenTrabajo.articulo),
                    joinedload(OrdenTrabajo.sector),
                    joinedload(OrdenTrabajo.cliente),
                    joinedload(OrdenTrabajo.prioridad),
                    # `procesos` es una colección → usamos selectinload para no romper
                    # el scalar_one_or_none (joinedload de colecciones requiere .unique()).
                    selectinload(OrdenTrabajo.procesos).options(
                        joinedload(OrdenTrabajoProceso.proceso),
                        joinedload(OrdenTrabajoProceso.estado_proceso)
                    )
                )
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar la Orden de Trabajo por ID.") from e

    async def update(self, id: int, nueva_data: dict, usuario: dict | None = None,
                     estampar: bool = True):
        """Guarda la cabecera de la OT (cliente, fechas, cantidades, observaciones).

        `estampar=False` es para el que NO es una persona: el sync del legacy y los
        scripts de migración. Que el sistema viejo pise una OT importada no es alguien
        modificándola, y si lo estampáramos, toda la base terminaría diciendo que la
        última modificación la hizo el sync a las 4 de la mañana — que es exactamente
        el ruido que haría inútil la columna. Hoy el sync no pasa por acá (desde el
        2/9 no se traen más OT del legacy), pero el día que vuelva tiene que tener por
        dónde entrar sin mentir.
        """
        try:
            logger.info(f"Repository - Actualizar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()
            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para actualizar.")
                return None

            # Se escriben SÓLO las columnas de la tabla.
            #
            # El setattr era ciego y el DTO de update trae campos que son de pantalla:
            # `cliente` es el NOMBRE del cliente (un string) mientras que en el modelo
            # `cliente` es la relación al objeto Cliente. Meterle el string a la relación
            # hacía morir el flush con "'str' object has no attribute
            # '_sa_instance_state'", se iba todo al rollback y la OT no guardaba NADA:
            # el modal sólo mostraba "Error al actualizar la Orden de Trabajo". El
            # cliente de verdad viaja aparte, en `id_cliente`, que sí es columna.
            #
            # Filtrar por columnas deja el error fuera de la clase entera en vez de
            # tapar un campo: si mañana el DTO gana otro campo de pantalla, el guardado
            # sigue funcionando. Lo que se descarta se avisa en el log, así no se
            # esconde un campo que sí se quería guardar y está mal escrito.
            columnas = {attr.key for attr in inspect(OrdenTrabajo).column_attrs}
            descartados = [k for k in nueva_data if k not in columnas]
            if descartados:
                logger.warning(
                    f"Repository - update OT {id}: se ignoran campos que no son columnas "
                    f"de orden_trabajo: {sorted(descartados)}"
                )

            # El sello lo pone el backend, no el que llama. Son columnas de la tabla,
            # así que el filtro de arriba las dejaría pasar: si el día de mañana el DTO
            # las expone, cualquiera podría escribir quién tocó la OT — y el dato existe
            # justamente para no tener que creerle a nadie.
            for reservada in ("modificado_en", "modificado_por"):
                nueva_data.pop(reservada, None)

            # Red de contención de la zona horaria. El normalizado real vive en el DTO
            # (backend/dto/fechas.py), que es por donde entran el alta y la edición;
            # esto cubre a cualquier otro que llame al repositorio con una fecha con
            # zona. Las columnas de fecha son `timestamp without time zone` y asyncpg
            # rechaza la mezcla con un DataError que el usuario veía como
            # «Error al actualizar la Orden de Trabajo».
            # Se anota si ALGO cambió de verdad, para no sellar un guardado vacío.
            #
            # El modal manda la cabecera completa en cada PUT, así que abrir una OT y
            # apretar Guardar sin tocar nada llegaba acá con veinte campos idénticos a
            # los que ya estaban. Sellando siempre, la columna terminaba contestando
            # «quién apretó Guardar por última vez» en vez de «quién la modificó», que
            # es lo que promete. Y el dato existe justamente para poder creerle.
            hubo_cambio = False
            for key, value in nueva_data.items():
                if key not in columnas:
                    continue
                limpio = sin_zona(value)
                if getattr(orden, key) != limpio:
                    hubo_cambio = True
                setattr(orden, key, limpio)

            if estampar and hubo_cambio:
                await self._sellar_modificacion(id, usuario)

            await self.db.commit()
            await self.db.refresh(orden)
            logger.info(f"Repository - Orden de trabajo {id} actualizada correctamente.")
            return orden
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            # El mensaje lleva el MOTIVO. Antes decía sólo «Error al actualizar la Orden
            # de Trabajo»: el usuario mandaba una foto del cartel y no se podía saber qué
            # había pasado sin ir a buscar los logs del servidor. Dos bugs distintos
            # (el nombre del cliente contra la relación, y las fechas con zona horaria)
            # se veían exactamente igual, y por eso el segundo pareció que el primero
            # no se había arreglado.
            raise InfrastructureException(
                motivo_error_db(e, "guardar los cambios de la Orden de Trabajo")
            ) from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()

            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para eliminar.")
                return False

            # Delete related records explicitly to avoid FK constraints
            from sqlalchemy import text
            
            # 1. Delete from Planificacion (if exists)
            # Using raw SQL to avoid circular dependency issues if Planificacion model is not easily accessible
            await self.db.execute(text("DELETE FROM planificacion WHERE orden_id = :id"), {"id": id})
            
            # 2. Delete from OrdenTrabajoProceso
            await self.db.execute(text("DELETE FROM orden_trabajo_proceso WHERE id_orden_trabajo = :id"), {"id": id})
            
            # 3. Delete from Plano
            await self.db.execute(text("DELETE FROM plano WHERE id_orden_trabajo = :id"), {"id": id})

            # 4. Finally delete the Order
            await self.db.delete(orden)
            
            await self.db.commit()
            logger.info(f"Repository - Orden de trabajo {id} eliminada correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete: {e}")
            raise InfrastructureException("Error al eliminar la Orden de Trabajo.") from e
            
    async def find_by_fecha_orden_entre(self, desde: datetime, hasta: datetime):
        try:
            logger.info(f"Repository - Buscar órdenes entre {desde} y {hasta}.")
            result = await self.db.execute(select(OrdenTrabajo).where(
                OrdenTrabajo.fecha_orden >= desde,
                OrdenTrabajo.fecha_orden <= hasta
            ))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_fecha_orden_entre: {e}")
            raise InfrastructureException("Error al filtrar por fechas.") from e

    async def find_by_prioridad(self, id_prioridad: int):
        try:
            logger.info(f"Repository - Buscar órdenes por prioridad {id_prioridad}.")
            result = await self.db.execute(
                select(OrdenTrabajo)
                .where(OrdenTrabajo.id_prioridad == id_prioridad)
                .options(
                    joinedload(OrdenTrabajo.articulo),
                    joinedload(OrdenTrabajo.cliente),
                    joinedload(OrdenTrabajo.sector),
                    joinedload(OrdenTrabajo.prioridad)
                )
            )
            data = result.scalars().unique().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_prioridad: {e}")
            raise InfrastructureException("Error al filtrar por prioridad.") from e

    async def find_with_procesos(self):
        try:
            logger.info("Repository - Obtener órdenes con sus procesos, prioridades y rangos.")

            result = await self.db.execute(
                select(OrdenTrabajo)
                .options(
                    joinedload(OrdenTrabajo.procesos)
                    .options(
                        joinedload(OrdenTrabajoProceso.proceso).joinedload(Proceso.rangos),
                        joinedload(OrdenTrabajoProceso.estado_proceso)
                    ),
                    joinedload(OrdenTrabajo.prioridad) 
                )
            )

            logger.info("Repository - Resultado OK: órdenes encontradas.")
            return result.scalars().unique().all()

        except Exception as e:
            logger.error(f"Repository - Error en find_with_procesos: {e}")
            raise InfrastructureException("Error al obtener órdenes con procesos asociados.") from e

    async def find_with_procesos_by_ids(self, ordenes_ids: list[int]):
        try:
            logger.info(f"Repository - Obtener órdenes con procesos por IDs: {ordenes_ids}")

            if not ordenes_ids:
                logger.info("Repository - Lista de IDs vacía, no se buscarán órdenes.")
                return []

            result = await self.db.execute(
                select(OrdenTrabajo)
                .where(OrdenTrabajo.id.in_(ordenes_ids))
                .options(
                    joinedload(OrdenTrabajo.procesos)
                    .options(
                        joinedload(OrdenTrabajoProceso.proceso)
                        .joinedload(Proceso.rangos),
                        joinedload(OrdenTrabajoProceso.estado_proceso)
                    ),
                    joinedload(OrdenTrabajo.prioridad)
                )
            )

            ordenes = result.scalars().unique().all()

            logger.info(f"Repository - Resultado OK: {len(ordenes)} órdenes encontradas.")
            return ordenes

        except Exception as e:
            logger.error(f"Repository - Error en find_with_procesos_by_ids: {e}")
            raise InfrastructureException("Error al obtener órdenes con procesos por IDs.") from e

    async def find_with_pending_procesos(self, ordenes_ids: list[int] | None = None):
        try:
            logger.info("Repository - Obtener órdenes con procesos pendientes.")

            query = (
                select(OrdenTrabajo)
                .join(OrdenTrabajo.procesos)
                .where(OrdenTrabajoProceso.id_estado != 3)  # NO finalizados
                .options(
                    joinedload(OrdenTrabajo.procesos)
                    .options(
                        joinedload(OrdenTrabajoProceso.proceso)
                        .joinedload(Proceso.rangos),
                        joinedload(OrdenTrabajoProceso.estado_proceso)
                    ),
                    joinedload(OrdenTrabajo.prioridad)
                )
            )

            if ordenes_ids:
                query = query.where(OrdenTrabajo.id.in_(ordenes_ids))

            result = await self.db.execute(query)
            ordenes = result.scalars().unique().all()

            logger.info(f"Repository - Órdenes con procesos pendientes: {len(ordenes)}")
            return ordenes

        except Exception as e:
            logger.error(f"Repository - Error en find_with_pending_procesos: {e}")
            raise InfrastructureException(
                "Error al obtener órdenes con procesos pendientes."
            ) from e

    async def get_estadisticas_estados(self):
        """
        Obtiene el conteo de órdenes por estado:
        - completadas: fecha_entrega > 1950-01-01
        - en_proceso: fecha_entrada > 1950-01-01 y fecha_entrega = 1950-01-01 y fecha_prometida >= HOY y >= 2020
        - pendientes: fecha_entrada = 1950-01-01 y fecha_entrega = 1950-01-01
        - retrasadas: fecha_prometida < HOY y >= 2020 y fecha_entrega = 1950-01-01
        
        Nota: Fechas prometidas < 2020 se consideran inválidas y se ignoran
        """
        try:
            logger.info("Repository - Obtener estadísticas de estados de órdenes.")
            
            hoy = date.today()
            fecha_nula = date(1950, 1, 1)  # Valor usado como NULL en la BD
            fecha_minima_valida = date(2020, 1, 1)  # Fechas prometidas válidas deben ser >= 2020
            
            # Query para contar estados
            query = select(
                func.count(case(
                    (OrdenTrabajo.fecha_entrega > fecha_nula, 1)
                )).label('completadas'),
                func.count(case(
                    ((OrdenTrabajo.fecha_entrada > fecha_nula) & 
                     (OrdenTrabajo.fecha_entrega == fecha_nula) &
                     (OrdenTrabajo.fecha_prometida >= hoy) &
                     (OrdenTrabajo.fecha_prometida >= fecha_minima_valida), 1)
                )).label('en_proceso'),
                func.count(case(
                    ((OrdenTrabajo.fecha_entrada == fecha_nula) & 
                     (OrdenTrabajo.fecha_entrega == fecha_nula), 1)
                )).label('pendientes'),
                func.count(case(
                    ((OrdenTrabajo.fecha_prometida < hoy) & 
                     (OrdenTrabajo.fecha_entrega == fecha_nula) &
                     (OrdenTrabajo.fecha_prometida >= fecha_minima_valida), 1)
                )).label('retrasadas')
            )
            
            result = await self.db.execute(query)
            row = result.fetchone()
            
            estadisticas = {
                'completadas': row.completadas or 0,
                'en_proceso': row.en_proceso or 0,
                'pendientes': row.pendientes or 0,
                'retrasadas': row.retrasadas or 0,
                'total': (row.completadas or 0) + (row.en_proceso or 0) + 
                        (row.pendientes or 0) + (row.retrasadas or 0)
            }
            
            logger.info(f"Repository - Estadísticas OK: {estadisticas}")
            return estadisticas
            
        except Exception as e:
            logger.error(f"Repository - Error en get_estadisticas_estados: {e}")
            raise InfrastructureException("Error al obtener estadísticas de estados.") from e

    async def get_ordenes_criticas(self, dias: int = 7):
        """
        Obtiene las órdenes críticas próximas a vencer.
        Retorna órdenes donde:
        - fecha_entrega = 1950-01-01 (no completadas)
        - fecha_prometida está entre HOY y HOY + dias
        - fecha_prometida >= 2020-01-01 (fechas válidas solamente)
        Ordena por fecha_prometida ASC (las más urgentes primero)
        
        Nota: Fechas prometidas < 2020 se consideran inválidas y se ignoran
        """
        try:
            from datetime import timedelta
            logger.info(f"Repository - Obtener órdenes críticas (próximas {dias} días).")
            
            hoy = date.today()
            fecha_limite = hoy + timedelta(days=dias)
            fecha_nula = date(1950, 1, 1)  # Valor usado como NULL en la BD
            fecha_minima_valida = date(2020, 1, 1)  # Solo fechas prometidas >= 2020 son válidas
            
            # Query con joins para obtener información completa
            query = select(OrdenTrabajo).where(
                OrdenTrabajo.fecha_entrega == fecha_nula,  # No completadas
                OrdenTrabajo.fecha_prometida >= hoy,  # Fecha prometida futura
                OrdenTrabajo.fecha_prometida <= fecha_limite,  # Dentro del rango
                OrdenTrabajo.fecha_prometida >= fecha_minima_valida  # Filtrar fechas antiguas/inválidas
            ).options(
                joinedload(OrdenTrabajo.articulo),
                joinedload(OrdenTrabajo.sector)
            ).order_by(OrdenTrabajo.fecha_prometida.asc())
            
            result = await self.db.execute(query)
            ordenes = result.scalars().unique().all()
            
            logger.info(f"Repository - Órdenes críticas encontradas: {len(ordenes)}")
            return ordenes
            
        except Exception as e:
            logger.error(f"Repository - Error en get_ordenes_criticas: {e}")
            raise InfrastructureException("Error al obtener órdenes críticas.") from e

    async def get_ocupacion_por_sector(self):
        """
        Obtiene la carga de trabajo (ocupación) por sector.
        Calcula el número de órdenes activas (no completadas) en cada sector.
        """
        try:
            from backend.domain.Sector import Sector
            logger.info("Repository - Obtener ocupación por sector.")
            
            hoy = date.today()
            fecha_nula = date(1950, 1, 1)
            fecha_minima_valida = date(2020, 1, 1)
            
            # Query para contar órdenes activas por sector
            query = select(
                Sector.nombre.label('sector'),
                func.count(OrdenTrabajo.id).label('ordenes_activas')
            ).select_from(Sector).outerjoin(
                OrdenTrabajo,
                (Sector.id_sector == OrdenTrabajo.id_sector) &
                (OrdenTrabajo.fecha_entrega == fecha_nula) &  # NO completadas
                (OrdenTrabajo.fecha_prometida > fecha_minima_valida)  # Fechas válidas
            ).group_by(Sector.nombre).order_by(
                func.count(OrdenTrabajo.id).desc()
            )
            
            result = await self.db.execute(query)
            sectores = result.all()
            
            # Calcular el total de órdenes activas para porcentajes
            total_ordenes = sum(s.ordenes_activas for s in sectores)
            
            # Formatear resultado con porcentajes
            ocupacion = []
            for sector in sectores:
                # Calcular porcentaje basado en el total
                # Si hay 0 órdenes, todos están en 0%
                porcentaje = round((sector.ordenes_activas / total_ordenes * 100), 1) if total_ordenes > 0 else 0
                
                ocupacion.append({
                    'sector': sector.sector,
                    'ordenes_activas': sector.ordenes_activas,
                    'porcentaje': porcentaje
                })
            
            logger.info(f"Repository - Ocupación por sector: {len(ocupacion)} sectores")
            return ocupacion
            
        except Exception as e:
            logger.error(f"Repository - Error en get_ocupacion_por_sector: {e}")
            raise InfrastructureException("Error al obtener ocupación por sector.") from e

    async def get_proximas_entregas_timeline(self, dias: int = 7):
        """
        Obtiene las órdenes con entregas en los próximos N días, agrupadas por fecha.
        Útil para visualización en timeline.
        
        Args:
            dias: Número de días hacia adelante (default: 7)
            
        Returns:
            Lista de diccionarios con {fecha, cantidad_ordenes, ordenes[...]}
        """
        try:
            from datetime import timedelta
            logger.info(f"Repository - Obtener timeline de próximas entregas ({dias} días)")
            
            hoy = date.today()
            fecha_limite = hoy + timedelta(days=dias)
            fecha_nula = date(1950, 1, 1)
            fecha_minima_valida = date(2020, 1, 1)
            
            # Obtener todas las órdenes con entrega en el rango
            query = select(OrdenTrabajo).where(
                OrdenTrabajo.fecha_entrega == fecha_nula,  # NO completadas
                OrdenTrabajo.fecha_prometida >= hoy,  # Desde hoy
                OrdenTrabajo.fecha_prometida <= fecha_limite,  # Hasta hoy + dias
                OrdenTrabajo.fecha_prometida >= fecha_minima_valida  # Fechas válidas
            ).options(
                joinedload(OrdenTrabajo.articulo),
                joinedload(OrdenTrabajo.sector)
            ).order_by(OrdenTrabajo.fecha_prometida.asc())
            
            result = await self.db.execute(query)
            ordenes = result.scalars().unique().all()
            
            # Agrupar por fecha
            entregas_por_fecha = {}
            for orden in ordenes:
                fecha_str = orden.fecha_prometida.strftime('%Y-%m-%d')
                if fecha_str not in entregas_por_fecha:
                    entregas_por_fecha[fecha_str] = []
                
                entregas_por_fecha[fecha_str].append({
                    'id': orden.id,
                    'articulo': orden.articulo.descripcion if orden.articulo else 'Sin artículo',
                    'sector': orden.sector.nombre if orden.sector else 'Sin sector',
                })
            
            # Formatear para timeline (incluir todos los días del rango, incluso sin órdenes)
            timeline = []
            fecha_actual = hoy
            while fecha_actual <= fecha_limite:
                fecha_str = fecha_actual.strftime('%Y-%m-%d')
                ordenes_del_dia = entregas_por_fecha.get(fecha_str, [])
                
                timeline.append({
                    'fecha': fecha_str,
                    'fecha_formato': fecha_actual.strftime('%d/%m'),
                    'dia_semana': ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][fecha_actual.weekday()],
                    'cantidad_ordenes': len(ordenes_del_dia),
                    'ordenes': ordenes_del_dia[:5]  # Limitar a 5 para preview
                })
                
                fecha_actual += timedelta(days=1)
            
            logger.info(f"Repository - Timeline generado: {len(timeline)} días, {len(ordenes)} órdenes")
            return timeline
            
        except Exception as e:
            logger.error(f"Repository - Error en get_proximas_entregas_timeline: {e}")
            raise InfrastructureException("Error al obtener timeline de próximas entregas.") from e


    async def _buscar_linea(self, id_orden: int, id_proceso: int | None, id_otp: int | None):
        """
        Resuelve UNA pasada de proceso dentro de la OT.

        `id_otp` (orden_trabajo_proceso.id) es la forma correcta desde que el mismo
        proceso puede ir varias veces en la misma orden. Se sigue aceptando el par
        (orden, proceso) porque es lo que mandan los clientes viejos: si hay más de
        una pasada se toma la del paso más bajo y se avisa, en vez de romper.
        """
        if id_otp is not None:
            query = select(OrdenTrabajoProceso).where(
                OrdenTrabajoProceso.id == id_otp,
                OrdenTrabajoProceso.id_orden_trabajo == id_orden,
            )
            return (await self.db.execute(query)).scalar_one_or_none()

        query = select(OrdenTrabajoProceso).where(
            OrdenTrabajoProceso.id_orden_trabajo == id_orden,
            OrdenTrabajoProceso.id_proceso == id_proceso,
        ).order_by(OrdenTrabajoProceso.orden, OrdenTrabajoProceso.id)
        lineas = (await self.db.execute(query)).scalars().all()

        if len(lineas) > 1:
            logger.warning(
                f"Repository - La OT {id_orden} tiene {len(lineas)} pasadas del proceso "
                f"{id_proceso} y se pidió sin id de pasada: se toma la del paso "
                f"{lineas[0].orden} (id {lineas[0].id}). Mandá id_otp para no adivinar."
            )
        return lineas[0] if lineas else None

    async def update_proceso_status(self, id_orden: int, id_proceso: int, id_estado: int,
                                    id_otp: int | None = None, usuario: dict | None = None):
        try:
            logger.info(f"Repository - Actualizar estado proceso: Orden {id_orden}, Proceso {id_proceso}, ID Estado {id_estado}")

            ot_proceso = await self._buscar_linea(id_orden, id_proceso, id_otp)

            if not ot_proceso:
                logger.info("Repository - Relación Orden-Proceso no encontrada.")
                return False

            ot_proceso.id_estado = id_estado
            
            # Logic for Real Minutes Tracking
            # Logic for Real Minutes Tracking
            if id_estado == 1: # Pendiente (Reset)
                ot_proceso.inicio_real = None
                ot_proceso.fin_real = None
            elif id_estado == 2:  # En Proceso
                if not ot_proceso.inicio_real:
                    # Hora local AR. Con datetime.now() pelado, en Cloud Run (TZ=UTC)
                    # el taller veía que un proceso había arrancado 3 horas más tarde
                    # de lo que lo arrancó.
                    ot_proceso.inicio_real = _ahora_ar()
                # If reverting from finalized to in-process, clear finish time
                ot_proceso.fin_real = None
            elif id_estado == 3:  # Finalizado
                ot_proceso.fin_real = _ahora_ar()

            # Mover un proceso de la OT es modificar la OT: es el cambio que más se
            # hace y el que más se pregunta después ("¿quién lo dio por terminado?").
            await self._sellar_modificacion(id_orden, usuario)

            await self.db.commit()
            await self.db.refresh(ot_proceso)
            
            logger.info("Repository - Estado actualizado correctamente.")
            return ot_proceso
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en update_proceso_status: {e}")
            raise InfrastructureException("Error al actualizar estado del proceso.") from e

    async def update_proceso_observaciones(self, id_orden: int, id_proceso: int, observaciones: str,
                                           id_otp: int | None = None, usuario: dict | None = None):
        try:
            logger.info(f"Repository - Actualizar observaciones proceso: Orden {id_orden}, Proceso {id_proceso}")

            ot_proceso = await self._buscar_linea(id_orden, id_proceso, id_otp)

            if not ot_proceso:
                logger.info("Repository - Relación Orden-Proceso no encontrada.")
                return False
                
            ot_proceso.observaciones = observaciones
            await self._sellar_modificacion(id_orden, usuario)
            await self.db.commit()
            await self.db.refresh(ot_proceso)
            
            logger.info("Repository - Observaciones actualizadas correctamente.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en update_proceso_observaciones: {e}")
            raise InfrastructureException("Error al actualizar observaciones del proceso.") from e

    async def update_procesos_order(self, id_orden: int, process_orders: list[dict],
                                    usuario: dict | None = None):
        """
        Actualiza el orden de los procesos para una orden de trabajo.
        process_orders: lista de dicts {id_otp?: int, id_proceso: int, orden: int}

        Si viene `id_otp` se mueve ESA pasada. Sin él se resuelve por proceso, que
        con pasadas repetidas es ambiguo: se van consumiendo de a una en el orden en
        que llegan, así reordenar una lista completa sigue funcionando.
        """
        try:
            logger.info(f"Repository - Actualizar orden de procesos para Orden {id_orden}")

            query = select(OrdenTrabajoProceso).where(
                OrdenTrabajoProceso.id_orden_trabajo == id_orden
            ).order_by(OrdenTrabajoProceso.orden, OrdenTrabajoProceso.id)
            lineas = (await self.db.execute(query)).scalars().all()
            por_id = {l.id: l for l in lineas}
            pendientes_por_proceso = {}
            for l in lineas:
                pendientes_por_proceso.setdefault(l.id_proceso, []).append(l)

            for item in process_orders:
                ot_proceso = None
                _otp = item.get('id_otp')
                if _otp is not None:
                    ot_proceso = por_id.get(int(_otp))
                else:
                    cola = pendientes_por_proceso.get(item.get('id_proceso'), [])
                    ot_proceso = cola.pop(0) if cola else None

                if ot_proceso:
                    ot_proceso.orden = item['orden']

            await self._sellar_modificacion(id_orden, usuario)

            await self.db.commit()
            logger.info("Repository - Orden de procesos actualizado correctamente.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en update_procesos_order: {e}")
            raise InfrastructureException("Error al actualizar orden de procesos.") from e


    async def find_unplanned(self):
        """
        Obtiene las órdenes de trabajo que NO están en la tabla de planificación.
        """
        try:
            logger.info("Repository - Buscar órdenes no planificadas.")
            
            # Subquery para obtener IDs de órdenes ya planificadas
            # Asumiendo que existe una tabla/modelo Planificacion
            # Si no tienes el modelo importado, puedes usar text() o importarlo
            # Para evitar dependencias circulares, usaremos text() si es simple, 
            # o mejor, asumimos que la tabla se llama 'planificacion'
            
            from sqlalchemy import text
            
            query = select(OrdenTrabajo).where(
                ~OrdenTrabajo.id.in_(
                    select(text("orden_id FROM planificacion"))
                )
            ).options(
                joinedload(OrdenTrabajo.articulo),
                joinedload(OrdenTrabajo.sector),
                joinedload(OrdenTrabajo.cliente),
                joinedload(OrdenTrabajo.prioridad),
                # Cargar procesos eager para que el frontend pueda filtrar por
                # "OTs con procesos" sin obtener listas vacías (procesos undefined).
                # Bug previo: find_unplanned no cargaba procesos -> el filtro
                # showWithProcessesOnly descartaba todas las OTs porque order.procesos
                # llegaba vacío en el JSON. Resultado: la pantalla "No Planificadas"
                # mostraba 113 mientras el Planificador (que sí los cargaba) mostraba 138.
                joinedload(OrdenTrabajo.procesos).options(
                    joinedload(OrdenTrabajoProceso.proceso),
                    joinedload(OrdenTrabajoProceso.estado_proceso)
                ),
                # Cargar planos eager para que el frontend pueda mostrar el badge
                # "Plano: Sí/No" en la fila de cada OT sin queries N+1.
                joinedload(OrdenTrabajo.planos)
            )
            
            result = await self.db.execute(query)
            ordenes = result.scalars().unique().all()
            
            logger.info(f"Repository - Órdenes no planificadas encontradas: {len(ordenes)}")
            return ordenes
            
        except Exception as e:
            logger.error(f"Repository - Error en find_unplanned: {e}")
            raise InfrastructureException("Error al buscar órdenes no planificadas.") from e

    async def check_all_processes_completed(self, id_orden: int) -> bool:
        """
        Verifica si todos los procesos de una orden están en estado Finalizado (ID 3).
        """
        try:
            logger.info(f"Repository - Verificar si orden {id_orden} está completa.")
            
            # Contar total de procesos
            query_total = select(func.count()).where(OrdenTrabajoProceso.id_orden_trabajo == id_orden)
            result_total = await self.db.execute(query_total)
            total = result_total.scalar() or 0
            
            if total == 0:
                return False # Si no tiene procesos, no se considera completa automáticamente (o sí? depende de la lógica, asumimos no)

            # Contar procesos finalizados (id_estado = 3)
            query_completed = select(func.count()).where(
                OrdenTrabajoProceso.id_orden_trabajo == id_orden,
                OrdenTrabajoProceso.id_estado == 3
            )
            result_completed = await self.db.execute(query_completed)
            completed = result_completed.scalar() or 0
            
            is_complete = total == completed
            logger.info(f"Repository - Orden {id_orden}: {completed}/{total} procesos finalizados. Completa: {is_complete}")
            return is_complete
            
        except Exception as e:
            logger.error(f"Repository - Error en check_all_processes_completed: {e}")
            raise InfrastructureException("Error al verificar completitud de la orden.") from e

    async def mark_as_completed(self, id_orden: int):
        """
        Marca la orden como completada estableciendo fecha_entrega = NOW.
        """
        try:
            logger.info(f"Repository - Marcar orden {id_orden} como completada.")
            
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id_orden))
            orden = result.scalar_one_or_none()
            
            if not orden:
                logger.error(f"Repository - Orden {id_orden} no encontrada para marcar como completada.")
                return False
                
            # Hora local AR: la fecha de entrega se muestra y se compara contra el
            # resto de las fechas de la base, que están todas en hora de Argentina.
            orden.fecha_entrega = _ahora_ar()
            await self.db.commit()
            await self.db.refresh(orden)

            logger.info(f"Repository - Orden {id_orden} marcada como completada correctamente.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en mark_as_completed: {e}")
            raise InfrastructureException("Error al marcar orden como completada.") from e

    async def mark_as_incomplete(self, id_orden: int):
        """
        Marca la orden como NO completada estableciendo fecha_entrega = 1950-01-01 (NULL).
        """
        try:
            logger.info(f"Repository - Marcar orden {id_orden} como NO completada.")
            
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id_orden))
            orden = result.scalar_one_or_none()
            
            if not orden:
                logger.error(f"Repository - Orden {id_orden} no encontrada para marcar como NO completada.")
                return False
            
            print(f"DEBUG: Repository marking {id_orden} as incomplete (1950-01-01)")
            orden.fecha_entrega = datetime(1950, 1, 1) # Use datetime instead of date
            await self.db.commit()
            await self.db.refresh(orden)
            
            logger.info(f"Repository - Orden {id_orden} marcada como NO completada correctamente.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en mark_as_incomplete: {e}")

    async def get_planificaciones_by_orden_ids(self, orden_ids: list[int]):
        """
        Obtiene las planificaciones (con operario) para una lista de órdenes.
        Usa RAW SQL para máxima compatibilidad y seguridad.
        """
        if not orden_ids:
            return []
            
        try:
            from sqlalchemy import text, bindparam
            
            # Use bindparam with expanding=True to correctly handle IN clause with list/tuple
            query = text("""
                SELECT p.orden_id, p.proceso_id, o.nombre, o.apellido, p.id_orden_trabajo_proceso
                FROM planificacion p
                JOIN operario o ON p.id_operario = o.id
                WHERE p.orden_id IN :orden_ids
            """).bindparams(bindparam('orden_ids', expanding=True))
            
            # Pass the list directly when using expanding=True
            result = await self.db.execute(query, {"orden_ids": orden_ids})
            return result.fetchall()
            
        except Exception as e:
            logger.error(f"Repository - Error obteniendo planificaciones (Raw): {e}")
            return []

    async def _guardar_version_procesos(self, id_orden: int, procesos, motivo: str,
                                        usuario: dict | None = None):
        """Deja una foto de los procesos ANTES de tocarlos, para poder deshacer.

        Nunca levanta: que el historial falle no puede impedirle a alguien guardar
        una OT. Se avisa en el log y se sigue — es lo mismo que hace la auditoría de
        planificación, y por la misma razón.
        """
        import json
        try:
            await self.db.execute(text("""
                CREATE TABLE IF NOT EXISTS orden_trabajo_proceso_version (
                    id BIGSERIAL PRIMARY KEY,
                    id_orden_trabajo INTEGER NOT NULL,
                    creado_en TIMESTAMP NOT NULL,
                    id_usuario INTEGER,
                    usuario VARCHAR(120),
                    motivo VARCHAR(60),
                    procesos JSONB NOT NULL
                )"""))
            foto = [{
                "id": p.id, "id_proceso": p.id_proceso, "orden": p.orden,
                "tiempo_proceso": p.tiempo_proceso, "cant_operarios": p.cant_operarios,
                "id_maquinaria": p.id_maquinaria, "id_operario": p.id_operario,
                "id_estado": p.id_estado, "observaciones": p.observaciones,
            } for p in procesos]
            await self.db.execute(text("""
                INSERT INTO orden_trabajo_proceso_version
                    (id_orden_trabajo, creado_en, id_usuario, usuario, motivo, procesos)
                VALUES (:ot, :creado, :id_usuario, :usuario, :motivo, CAST(:procesos AS JSONB))
            """), {
                "ot": id_orden, "creado": _ahora_ar(),
                "id_usuario": (usuario or {}).get("id_usuario"),
                "usuario": nombre_de(usuario), "motivo": motivo[:60],
                "procesos": json.dumps(foto),
            })
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo guardar la versión de procesos "
                           f"de la OT {id_orden}: {e}")

    async def listar_versiones_procesos(self, id_orden: int, limite: int = 20):
        """Las fotos de esta OT, de la más nueva a la más vieja."""
        try:
            filas = await self.db.execute(text("""
                SELECT id, creado_en, usuario, motivo,
                       jsonb_array_length(procesos) AS cantidad
                FROM orden_trabajo_proceso_version
                WHERE id_orden_trabajo = :ot
                ORDER BY creado_en DESC
                LIMIT :lim
            """), {"ot": id_orden, "lim": limite})
            return [dict(f._mapping) for f in filas]
        except Exception:
            return []  # la tabla se crea recién en el primer cambio

    async def obtener_version_procesos(self, id_version: int):
        filas = await self.db.execute(text("""
            SELECT id, id_orden_trabajo, creado_en, usuario, motivo, procesos
            FROM orden_trabajo_proceso_version WHERE id = :id
        """), {"id": id_version})
        fila = filas.first()
        return dict(fila._mapping) if fila else None

    async def update_processes_full(self, id_orden: int, new_processes_data: list[dict],
                                    motivo: str = "edicion", usuario: dict | None = None):
        """
        Actualiza la lista completa de procesos de una orden, preservando estados de los existentes.
        """
        try:
            logger.info(f"Repository - Actualización inteligente de procesos para Orden {id_orden}")
            
            # 1. Obtener procesos actuales
            stmt = select(OrdenTrabajoProceso).where(OrdenTrabajoProceso.id_orden_trabajo == id_orden)
            result = await self.db.execute(stmt)
            current_processes = result.scalars().all()

            # La foto va ANTES de tocar nada, y con los procesos que ya leímos: es la
            # única forma de poder deshacer. Va en su propia transacción (hace commit),
            # así que si el guardado de abajo falla, la foto queda igual — sobra una
            # versión idéntica a lo que hay, que no molesta a nadie.
            #
            # Y va SIEMPRE, aunque la OT no tuviera NINGÚN proceso. Antes ese caso se
            # salteaba, que es como decir que la lista vacía no es un estado: la
            # primera carga de procesos sobre una OT vacía —el caso más común desde
            # que se cargan desde la planificación— quedaba sin foto previa y era el
            # único cambio de procesos que no se podía deshacer. Una foto de cero
            # procesos es exactamente lo que hace falta para volver atrás esa carga.
            await self._guardar_version_procesos(id_orden, current_processes, motivo, usuario)
            
            # El mismo proceso puede estar varias veces en la OT, así que no se puede
            # mapear por id_proceso (colapsaría las pasadas en una). Se machea por id
            # de pasada cuando el cliente lo manda, y si no, de a una por proceso en
            # el orden en que llegan — que es como venía funcionando cuando no había
            # repetidos.
            por_id = {p.id: p for p in current_processes}
            pendientes_por_proceso = {}
            for p in sorted(current_processes, key=lambda x: (x.orden or 0, x.id)):
                pendientes_por_proceso.setdefault(p.id_proceso, []).append(p)

            # 2. Procesar la nueva lista
            # new_processes_data es lista de dicts con keys: proceso_id, orden, (opcional: fecha_inicio, fecha_fin)

            conservadas = set()

            for index, item in enumerate(new_processes_data):
                pid = item.get('proceso_id')
                if not pid: continue

                # Update fields based on new DTO structure (no dates, just minutes)
                minutes = item.get('tiempo_proceso')
                cant_ops = item.get('cant_operarios')
                # Máquina preseleccionada: puede venir como int, string o None.
                # '', '0' o None = sin preselección. La clave 'maquinaria_id' es
                # opcional: si NO viene en el item, no tocamos el valor existente.
                _has_maq = 'maquinaria_id' in item
                _maq_raw = item.get('maquinaria_id')
                id_maquinaria = int(_maq_raw) if (_maq_raw not in (None, "", "0")) else None
                # Persona preseleccionada: mismo contrato que la máquina, incluido el
                # "si no viene la clave, no se toca lo que ya estaba guardado".
                _has_op = 'operario_id' in item
                _op_raw = item.get('operario_id')
                id_operario = int(_op_raw) if (_op_raw not in (None, "", "0")) else None

                _otp = item.get('id_otp')
                if _otp is not None:
                    existing_proc = por_id.get(int(_otp))
                    if existing_proc is not None and existing_proc in pendientes_por_proceso.get(pid, []):
                        pendientes_por_proceso[pid].remove(existing_proc)
                else:
                    cola = pendientes_por_proceso.get(pid, [])
                    existing_proc = cola.pop(0) if cola else None

                if existing_proc is not None:
                    # UPDATE existing
                    conservadas.add(existing_proc.id)
                    existing_proc.orden = index + 1
                    if minutes is not None:
                        existing_proc.tiempo_proceso = minutes
                    if cant_ops is not None:
                        existing_proc.cant_operarios = cant_ops
                    if _has_maq:
                        existing_proc.id_maquinaria = id_maquinaria
                    if _has_op:
                        existing_proc.id_operario = id_operario
                    # Mismo criterio que arriba: sólo el deshacer las manda, y sólo
                    # el deshacer tiene por qué pisar el avance de una fila viva.
                    if 'id_estado' in item and item['id_estado']:
                        existing_proc.id_estado = item['id_estado']
                    if 'observaciones' in item:
                        existing_proc.observaciones = item['observaciones']
                else:
                    # CREATE new.
                    #
                    # `id_estado` y `observaciones` normalmente NO vienen: una línea
                    # nueva nace Pendiente y sin observaciones, y así fue siempre. Las
                    # manda solamente el DESHACER, y sin eso no sería un deshacer: una
                    # fila que se borró por error volvía en Pendiente y con el avance
                    # del taller perdido, que es justo lo que uno quiere recuperar.
                    new_proc = OrdenTrabajoProceso(
                        id_orden_trabajo=id_orden,
                        id_proceso=pid,
                        orden=index + 1,
                        id_estado=item.get('id_estado') or 1,
                        tiempo_proceso=minutes or 0,
                        cant_operarios=cant_ops or 1,
                        id_maquinaria=id_maquinaria,
                        id_operario=id_operario,
                        observaciones=item.get('observaciones'),
                    )
                    self.db.add(new_proc)
            
            # 3. Eliminar los que ya no están
            for proc in current_processes:
                if proc.id not in conservadas:
                    await self.db.delete(proc)

            await self._sellar_modificacion(id_orden, usuario)

            await self.db.commit()
            logger.info("Repository - Procesos actualizados correctamente.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en update_processes_full: {e}")
            raise InfrastructureException(motivo_error_db(e, "guardar los procesos de la Orden de Trabajo")) from e

    
    async def update_cantidad_entregada(self, id_orden: int, nueva_cantidad: int,
                                        total_unidades: int | None, usuario: dict | None = None):
        try:
            logger.info(f"Repository - Actualizar entrega Orden {id_orden}: {nueva_cantidad}")
            
            query = select(OrdenTrabajo).where(OrdenTrabajo.id == id_orden)
            result = await self.db.execute(query)
            orden = result.scalar_one_or_none()
            
            if not orden:
                return None
                
            orden.cantidad_entregada = nueva_cantidad
            
            # Logic to auto-complete if delivered >= total?
            # User might want manual control, but commonly full delivery = complete.
            # However, "Complete" status is based on Processes in this system (check_all_processes_completed).
            # But the user screenshot shows "ENTREGA COMPLETA" text.
            # Let's just update the quantity. The status badge is derived from processes usually.
            # Wait, check `get_estadisticas_estados` in Repository:
            # "completadas: fecha_entrega > 1950-01-01"
            # So if we deliver everything, should we set `fecha_entrega` to NOW?
            # YES, if nueva_cantidad >= total_unidades, assuming total is set.
            
            if total_unidades and nueva_cantidad >= total_unidades:
                if not orden.fecha_entrega or orden.fecha_entrega.year == 1950:
                    orden.fecha_entrega = _ahora_ar()
            elif total_unidades and nueva_cantidad < total_unidades:
                # If reverting (e.g. subtracted), maybe clear completion date?
                # Only if it was previously auto-completed. Safer to leave it if manual?
                # Let's enforce: if incomplete delivery, fecha_entrega = 1950 (open)
                orden.fecha_entrega = datetime(1950, 1, 1)

            await self._sellar_modificacion(id_orden, usuario)

            await self.db.commit()
            await self.db.refresh(orden)
            return orden
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en update_cantidad_entregada: {e}")
            raise InfrastructureException("Error al actualizar la cantidad entregada.") from e

    async def eliminarProceso(self, id_orden: int, id_proceso: int, id_otp: int | None = None,
                              usuario: dict | None = None):
        from sqlalchemy import text
        try:
            logger.info(f"Repository - Eliminar proceso {id_proceso} de Orden {id_orden}")

            # Con pasadas repetidas, borrar por (orden, proceso) se llevaría puestas
            # TODAS las del mismo proceso. Se resuelve la pasada primero y se borra
            # esa sola.
            linea = await self._buscar_linea(id_orden, id_proceso, id_otp)
            if not linea:
                logger.info("Repository - Relación Orden-Proceso no encontrada.")
                return False

            # Primero limpiamos planificacion si tiene una entrada (puede no tenerla
            # si es un proceso huérfano nunca planificado). El plan viejo (anterior a
            # la migración del 28/08) no tiene la pasada cargada: para ese se cae al
            # par (orden, proceso), que era como se guardaba.
            await self.db.execute(
                text("""DELETE FROM planificacion
                         WHERE id_orden_trabajo_proceso = :otp
                            OR (id_orden_trabajo_proceso IS NULL
                                AND orden_id = :oid AND proceso_id = :pid)"""),
                {"otp": linea.id, "oid": id_orden, "pid": id_proceso}
            )

            # Después el registro de orden_trabajo_proceso.
            await self.db.execute(
                text("DELETE FROM orden_trabajo_proceso WHERE id = :otp"),
                {"otp": linea.id}
            )

            await self._sellar_modificacion(id_orden, usuario)

            await self.db.commit()
            logger.info("Repository - Proceso eliminado correctamente.")
            return True

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en eliminarProceso: {e}")
            raise InfrastructureException("Error al eliminar proceso de la orden.") from e

    async def editarProceso(self, id_orden: int, id_otp: int, cambios: dict,
                            usuario: dict | None = None):
        """
        Edita UNA pasada de proceso de la OT (la fila `id_otp`).

        Se toca sólo lo que viene en `cambios`: así el que edita los minutos desde la
        lista no le borra sin querer la máquina o la persona que ya tenía elegidas.
        El estado y el avance (inicio_real/fin_real) no se tocan nunca acá — para eso
        están los endpoints de estado.
        """
        try:
            logger.info(f"Repository - Editar pasada {id_otp} de la Orden {id_orden}")
            linea = await self._buscar_linea(id_orden, None, id_otp)
            if not linea:
                return None

            editables = {"id_proceso", "tiempo_proceso", "cant_operarios",
                         "id_maquinaria", "id_operario"}
            for k, v in cambios.items():
                if k in editables:
                    setattr(linea, k, v)

            await self._sellar_modificacion(id_orden, usuario)

            await self.db.commit()
            await self.db.refresh(linea)
            logger.info("Repository - Pasada editada correctamente.")
            return linea
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en editarProceso: {e}")
            raise InfrastructureException(
                motivo_error_db(e, "guardar los cambios del proceso")
            ) from e

    async def agregarProceso(self, id_orden: int, id_proceso: int, tiempo_estimado: int, orden: int | None = None, cant_operarios: int = 1, id_maquinaria: int | None = None, id_operario: int | None = None, usuario: dict | None = None):
        try:
            logger.info(f"Repository - Agregar proceso {id_proceso} a Orden {id_orden}")

            # Si no viene `orden`, calculamos max(orden)+1 dentro de la misma transacción
            # para que el nuevo proceso quede al final (1 si no había ninguno).
            if orden is None:
                max_orden_q = select(func.coalesce(func.max(OrdenTrabajoProceso.orden), 0)).where(
                    OrdenTrabajoProceso.id_orden_trabajo == id_orden
                )
                result = await self.db.execute(max_orden_q)
                orden = (result.scalar() or 0) + 1

            nuevo_proceso = OrdenTrabajoProceso(
                id_orden_trabajo=id_orden,
                id_proceso=id_proceso,
                orden=orden,
                tiempo_proceso=tiempo_estimado,
                cant_operarios=cant_operarios or 1,
                id_maquinaria=id_maquinaria,  # None = sin preselección
                id_operario=id_operario,      # None = sin preselección
                id_estado=1  # Default: Pendiente
            )
            
            self.db.add(nuevo_proceso)
            await self._sellar_modificacion(id_orden, usuario)
            await self.db.commit()
            await self.db.refresh(nuevo_proceso)
            
            logger.info("Repository - Proceso agregado correctamente.")
            return nuevo_proceso
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en agregarProceso: {e}")
            raise InfrastructureException("Error al agregar proceso a la orden.") from e

    async def obtener_historial_procesos(self, id_articulo: int, excluir_orden_id: int | None = None):
        """
        "Traer historial": devuelve los procesos de la ÚLTIMA OT (por fecha_orden)
        del mismo producto (id_articulo) que tenga procesos cargados. El producto
        (artículo) = código + descripción, tal como pidió Lucas. [] si no hay historial.
        """
        try:
            # 1. id de la OT más reciente de ese artículo que TENGA procesos.
            con_procesos = select(OrdenTrabajoProceso.id_orden_trabajo).distinct()
            ot_id_q = (
                select(OrdenTrabajo.id)
                .where(OrdenTrabajo.id_articulo == id_articulo)
                .where(OrdenTrabajo.id.in_(con_procesos))
                .order_by(OrdenTrabajo.fecha_orden.desc(), OrdenTrabajo.id.desc())
                .limit(1)
            )
            if excluir_orden_id:
                ot_id_q = ot_id_q.where(OrdenTrabajo.id != excluir_orden_id)
            ot_id = (await self.db.execute(ot_id_q)).scalar_one_or_none()
            if not ot_id:
                return []

            # 2. procesos de esa OT, con el nombre del proceso, ordenados por 'orden'.
            proc_q = (
                select(OrdenTrabajoProceso)
                .where(OrdenTrabajoProceso.id_orden_trabajo == ot_id)
                .options(joinedload(OrdenTrabajoProceso.proceso))
                .order_by(OrdenTrabajoProceso.orden)
            )
            procs = (await self.db.execute(proc_q)).scalars().all()
            return list(procs)
        except Exception as e:
            logger.error(f"Repository - Error en obtener_historial_procesos: {e}")
            raise InfrastructureException("Error al traer el historial de procesos.") from e

    async def get_material_status(self, orden_ids: list[int]) -> dict[int, str]:
        """
        Devuelve un dict con el estado del material para cada orden:
        - 'ok': disponible = 1 para todas las piezas
        - 'pedido': disponible = 0 pero pedido = 1 para alguna/s piezas
        - 'sin_stock': disponible = 0 y pedido = 0 para alguna pieza
        - 'sin_datos': no tiene piezas asociadas (sin información)
        """
        if not orden_ids:
            return {}
            
        try:
            from sqlalchemy import text, bindparam
            
            # Query: Get material status for each order
            # We aggregate: if ANY piece is not available and not ordered = sin_stock
            # If ANY piece is not available but ordered = pedido
            # If ALL pieces are available = ok
            query = text("""
                SELECT 
                    otp.id_orden_trabajo,
                    MIN(CASE 
                        WHEN COALESCE(otp.disponible, 0) = 0 AND COALESCE(otp.pedido, 0) = 0 THEN 1  -- sin_stock = priority 1
                        WHEN COALESCE(otp.disponible, 0) = 0 AND COALESCE(otp.pedido, 0) = 1 THEN 2  -- pedido = priority 2
                        ELSE 3  -- ok = priority 3
                    END) as status_priority
                FROM orden_trabajo_pieza otp
                WHERE otp.id_orden_trabajo IN :orden_ids
                GROUP BY otp.id_orden_trabajo
            """).bindparams(bindparam('orden_ids', expanding=True))
            
            result = await self.db.execute(query, {"orden_ids": orden_ids})
            rows = result.fetchall()
            
            # Map priority to status string
            status_map = {1: 'sin_stock', 2: 'pedido', 3: 'ok'}
            material_status = {}
            
            for row in rows:
                oid = row[0]
                priority = row[1]
                material_status[oid] = status_map.get(priority, 'sin_datos')
            
            # Orders not in result have no pieces = sin_datos
            for oid in orden_ids:
                if oid not in material_status:
                    material_status[oid] = 'sin_datos'
            
            return material_status
            
        except Exception as e:
            logger.error(f"Repository - Error verificando material: {e}")
            return {oid: 'sin_datos' for oid in orden_ids}



    async def resumen_todas(self):
        """Una fila por OT — TODAS, planificadas y no— para la pantalla de Órdenes.

        Por qué una consulta cruda y no el ORM: la pantalla muestra el taller entero
        (hoy ~1.400 OTs) y lo único que necesita de cada una es la cabecera más tres
        conteos. Traerlas con `joinedload(procesos)` es el camino que hace lenta a
        Operaciones —una fila por proceso, miles de objetos que después se colapsan—
        y acá los conteos los hace Postgres.

        `planificada` sale de que la OT tenga filas en `planificacion`: es el mismo
        criterio con el que Operaciones arma su listado, así que los números de las
        dos pantallas dan igual. `entregada` replica isOrderDelivered() del front
        (finalizadototal=1 o fecha_entrega con año > 1950; el legacy usa 1950-01-01
        como "sin entregar").
        """
        from sqlalchemy import text
        try:
            logger.info("Repository - Resumen de todas las órdenes.")
            filas = await self.db.execute(text("""
                with plan as (
                    select orden_id,
                           count(*) as procesos_planificados,
                           max(creado_en) as planificada_en,
                           max(id_planificacion_lote::text) as lote
                    from planificacion group by orden_id
                ),
                proc as (
                    select id_orden_trabajo,
                           count(*) as procesos,
                           count(*) filter (where id_estado = 3) as procesos_finalizados
                    from orden_trabajo_proceso group by id_orden_trabajo
                ),
                dib as (
                    select id_articulo, count(*) as n
                    from plano where id_articulo is not null group by id_articulo
                )
                select ot.id,
                       ot.id_otvieja,
                       c.nombre                       as cliente,
                       a.cod_articulo                 as codigo,
                       a.descripcion                  as articulo,
                       ot.detalle,
                       ot.unidades,
                       ot.cantidad_entregada,
                       ot.fecha_orden,
                       ot.fecha_prometida,
                       ot.fecha_entrega,
                       -- Quién la tocó por última vez y cuándo. Va acá y no sólo en la
                       -- OT abierta: la pregunta "¿esto lo cambió alguien?" se hace
                       -- mirando la lista, no entrando de a una.
                       ot.modificado_en,
                       ot.modificado_por,
                       ot.finalizadototal,
                       ot.suspendida,
                       ot.fabricacion,
                       ot.reparacion,
                       ot.tiene_plano,
                       ot.no_lleva_plano,
                       p.descripcion                  as prioridad,
                       coalesce(proc.procesos, 0)             as procesos,
                       coalesce(proc.procesos_finalizados, 0) as procesos_finalizados,
                       coalesce(dib.n, 0)                     as planos,
                       (plan.orden_id is not null)    as planificada,
                       plan.procesos_planificados,
                       plan.planificada_en,
                       plan.lote
                from orden_trabajo ot
                left join cliente   c    on c.id = ot.id_cliente
                left join articulo  a    on a.id = ot.id_articulo
                left join prioridad p    on p.id = ot.id_prioridad
                left join proc           on proc.id_orden_trabajo = ot.id
                left join dib            on dib.id_articulo = ot.id_articulo
                left join plan           on plan.orden_id = ot.id
                order by ot.fecha_prometida desc nulls last, ot.id desc
            """))
            ordenes = [dict(f) for f in filas.mappings()]
            logger.info(f"Repository - Resumen OK: {len(ordenes)} órdenes.")
            return ordenes
        except Exception as e:
            logger.error(f"Repository - Error en resumen_todas: {e}")
            raise InfrastructureException(
                motivo_error_db(e, "listar todas las órdenes de trabajo")) from e

    async def get_plan_de_orden(self, id_orden: int):
        """Lo que el PLANIFICADOR asignó para esta OT, por pasada.

        Es distinto de `orden_trabajo_proceso.id_operario` / `id_maquinaria`, que son
        la PRESELECCIÓN —lo que alguien fuerza a mano— y casi siempre están vacíos.
        Al abrir una OT ya planificada, el editor mostraba "Sin máquina" y "Sin
        asignar" en todas las filas y parecía que se habían perdido los datos: estaba
        mirando el campo equivocado.

        LEFT JOIN a operario y maquinaria a propósito: las filas sin persona o sin
        máquina reservada son justo las que hay que poder ver.
        """
        try:
            filas = await self.db.execute(text("""
                SELECT p.id_orden_trabajo_proceso,
                       p.proceso_id,
                       p.inicio_min,
                       p.sin_asignar,
                       p.sin_maquinaria,
                       p.forzado_fuera_rango,
                       p.descripcion_lote,
                       TRIM(CONCAT(o.nombre, ' ', COALESCE(o.apellido, ''))) AS operario,
                       m.nombre AS maquinaria
                FROM planificacion p
                LEFT JOIN operario   o ON o.id = p.id_operario
                LEFT JOIN maquinaria m ON m.id = p.id_maquinaria
                WHERE p.orden_id = :id
                ORDER BY p.inicio_min ASC
            """), {"id": id_orden})
            return [dict(f._mapping) for f in filas]
        except Exception as e:
            # Que no se pueda leer el plan no puede impedir abrir la OT: el editor
            # simplemente no muestra los chips, como antes.
            logger.warning(f"Repository - No se pudo leer el plan de la OT {id_orden}: {e}")
            return []
