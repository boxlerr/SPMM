from sqlalchemy import select
from sqlalchemy.orm import joinedload
from sqlalchemy import func, case
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from datetime import datetime, date

from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Proceso import Proceso

class OrdenTrabajoRepository:
    def __init__(self, db):
        self.db = db

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
            result = await self.db.execute(select(OrdenTrabajo))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all: {e}")
            raise InfrastructureException("Error al listar las Órdenes de Trabajo.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar orden de trabajo por ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id: {e}")
            raise InfrastructureException("Error al buscar la Orden de Trabajo por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()
            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(orden, key, value)

            await self.db.commit()
            await self.db.refresh(orden)
            logger.info(f"Repository - Orden de trabajo {id} actualizada correctamente.")
            return orden
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update: {e}")
            raise InfrastructureException("Error al actualizar la Orden de Trabajo.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar orden de trabajo ID {id}.")
            result = await self.db.execute(select(OrdenTrabajo).where(OrdenTrabajo.id == id))
            orden = result.scalar_one_or_none()

            if not orden:
                logger.info(f"Repository - Orden de trabajo {id} no encontrada para eliminar.")
                return False

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
            result = await self.db.execute(select(OrdenTrabajo).where(
                OrdenTrabajo.id_prioridad == id_prioridad
            ))
            data = result.scalars().all()
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


    async def update_proceso_status(self, id_orden: int, id_proceso: int, id_estado: int):
        try:
            logger.info(f"Repository - Actualizar estado proceso: Orden {id_orden}, Proceso {id_proceso}, ID Estado {id_estado}")
            
            # Buscar la relación específica
            query = select(OrdenTrabajoProceso).where(
                OrdenTrabajoProceso.id_orden_trabajo == id_orden,
                OrdenTrabajoProceso.id_proceso == id_proceso
            )
            result = await self.db.execute(query)
            ot_proceso = result.scalar_one_or_none()
            
            if not ot_proceso:
                logger.info("Repository - Relación Orden-Proceso no encontrada.")
                return False
                
            ot_proceso.id_estado = id_estado
            await self.db.commit()
            await self.db.refresh(ot_proceso)
            
            logger.info("Repository - Estado actualizado correctamente.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en update_proceso_status: {e}")
            raise InfrastructureException("Error al actualizar estado del proceso.") from e

    async def update_proceso_observaciones(self, id_orden: int, id_proceso: int, observaciones: str):
        try:
            logger.info(f"Repository - Actualizar observaciones proceso: Orden {id_orden}, Proceso {id_proceso}")
            
            query = select(OrdenTrabajoProceso).where(
                OrdenTrabajoProceso.id_orden_trabajo == id_orden,
                OrdenTrabajoProceso.id_proceso == id_proceso
            )
            result = await self.db.execute(query)
            ot_proceso = result.scalar_one_or_none()
            
            if not ot_proceso:
                logger.info("Repository - Relación Orden-Proceso no encontrada.")
                return False
                
            ot_proceso.observaciones = observaciones
            await self.db.commit()
            await self.db.refresh(ot_proceso)
            
            logger.info("Repository - Observaciones actualizadas correctamente.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en update_proceso_observaciones: {e}")
            raise InfrastructureException("Error al actualizar observaciones del proceso.") from e

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
                joinedload(OrdenTrabajo.prioridad)
            )
            
            result = await self.db.execute(query)
            ordenes = result.scalars().unique().all()
            
            logger.info(f"Repository - Órdenes no planificadas encontradas: {len(ordenes)}")
            return ordenes
            
        except Exception as e:
            logger.error(f"Repository - Error en find_unplanned: {e}")
            raise InfrastructureException("Error al buscar órdenes no planificadas.") from e
