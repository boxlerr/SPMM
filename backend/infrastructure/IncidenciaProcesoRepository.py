from sqlalchemy import case, distinct, func, select, text

from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Planificacion import Planificacion
from backend.domain.Proceso import Proceso
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class IncidenciaProcesoRepository:
    """Lectura y escritura de las no conformidades (tabla `incidencia_proceso`).

    Hay dos familias de consultas y no es casualidad:

      · `find_recientes` y `metricas` son SQL crudo de Postgres (`to_char`, `btrim`,
        `INTERVAL`). Las escribió la tarjeta del dashboard y siguen igual.
      · `buscar` y `resumen` —el reporte del RF-12— van por el ORM. No es gusto: los
        tests corren sobre SQLite y ese SQL de arriba no existe ahí, así que el reporte
        que hay que poder probar no puede estar escrito en dialecto.
    """

    def __init__(self, db):
        self.db = db

    async def save(self, incidencia: IncidenciaProceso):
        try:
            logger.info("Repository - Crear IncidenciaProceso.")
            self.db.add(incidencia)
            await self.db.commit()
            await self.db.refresh(incidencia)
            return incidencia
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save IncidenciaProceso: {e}")
            raise InfrastructureException("Error al guardar la incidencia.") from e

    async def find_by_id(self, id_incidencia: int) -> IncidenciaProceso | None:
        try:
            result = await self.db.execute(
                select(IncidenciaProceso).where(IncidenciaProceso.id == id_incidencia)
            )
            return result.scalars().first()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id IncidenciaProceso: {e}")
            raise InfrastructureException("Error al buscar la no conformidad.") from e

    async def guardar_cambios(self, incidencia: IncidenciaProceso) -> IncidenciaProceso:
        """Confirma lo que el servicio ya le cambió al objeto."""
        try:
            await self.db.commit()
            await self.db.refresh(incidencia)
            return incidencia
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real al actualizar IncidenciaProceso: {e}")
            raise InfrastructureException("Error al actualizar la no conformidad.") from e

    # ------------------------------------------------------------------
    # El reporte (RF-12)
    # ------------------------------------------------------------------

    def _consulta_filtrada(self, *, id_orden=None, nro_ot=None, tipo=None, gravedad=None,
                           estado=None, desde=None, hasta=None, sin_clasificar=False,
                           id_operario=None, id_incidencia=None):
        """El WHERE que comparten el listado y el resumen: uno solo, así no se separan.

        Todos los filtros son OPCIONALES, incluido `tipo`. Hasta el 22/09 el repositorio
        lo exigía (`WHERE i.tipo = :tipo`), o sea que no había forma de pedir «todas»:
        el reporte de no conformidades era literalmente imposible de armar.
        """
        condiciones = []
        if id_orden:
            condiciones.append(IncidenciaProceso.id_orden_trabajo == id_orden)
        if nro_ot:
            # El número que la gente escribe es el de la orden (`id_otvieja`), no el id
            # interno. Va como subconsulta y no como JOIN para que el mismo filtro sirva
            # igual en el listado (que sí junta la OT) y en el resumen (que no).
            condiciones.append(IncidenciaProceso.id_orden_trabajo.in_(
                select(OrdenTrabajo.id).where(OrdenTrabajo.id_otvieja == nro_ot)
            ))
        if tipo:
            condiciones.append(IncidenciaProceso.tipo == tipo)
        if gravedad:
            condiciones.append(IncidenciaProceso.gravedad == gravedad)
        elif sin_clasificar:
            # «Sin clasificar» es una opción del filtro, no la ausencia de filtro: es la
            # forma de encontrar lo que quedó de antes para ir a completarlo.
            condiciones.append(IncidenciaProceso.gravedad.is_(None))
        if estado:
            condiciones.append(IncidenciaProceso.estado == estado)
        if desde is not None:
            condiciones.append(IncidenciaProceso.fecha_registro >= desde)
        if hasta is not None:
            condiciones.append(IncidenciaProceso.fecha_registro < hasta)
        if id_operario:
            # Quién hizo las piezas (23/09): «¿quién la hizo? Tal empleado».
            condiciones.append(IncidenciaProceso.id_operario == id_operario)
        if id_incidencia:
            condiciones.append(IncidenciaProceso.id == id_incidencia)
        return condiciones

    async def buscar(self, *, id_orden=None, nro_ot=None, tipo=None, gravedad=None,
                     estado=None, desde=None, hasta=None, sin_clasificar=False,
                     id_operario=None, id_incidencia=None, limite: int = 500):
        """Las no conformidades que pide el filtro, lo último primero.

        Trae además el número de OT, el cliente y el producto: sin eso el reporte es una
        lista de ids y el que lo lee tiene que ir a buscar cada orden a mano.
        """
        try:
            # El nombre se arma en Python y no en SQL a propósito: el `btrim(a || ' ' ||
            # b)` de las consultas del dashboard es de Postgres y no existe en SQLite,
            # que es donde corren los tests de este reporte.
            q = (
                select(
                    IncidenciaProceso,
                    OrdenTrabajo.id_otvieja.label("nro_ot"),
                    Proceso.nombre.label("proceso"),
                    Operario.nombre.label("operario_nombre"),
                    Operario.apellido.label("operario_apellido"),
                    Cliente.nombre.label("cliente"),
                    Articulo.descripcion.label("producto"),
                    # El número de paso dentro de la OT (23/09). Si el paso se sacó de la
                    # OT después, no está y queda sólo el proceso.
                    OrdenTrabajoProceso.orden.label("paso"),
                )
                .select_from(IncidenciaProceso)
                .outerjoin(OrdenTrabajo, OrdenTrabajo.id == IncidenciaProceso.id_orden_trabajo)
                .outerjoin(OrdenTrabajoProceso, OrdenTrabajoProceso.id == IncidenciaProceso.id_otp)
                .outerjoin(Proceso, Proceso.id == IncidenciaProceso.id_proceso)
                .outerjoin(Operario, Operario.id == IncidenciaProceso.id_operario)
                .outerjoin(Cliente, Cliente.id == OrdenTrabajo.id_cliente)
                .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
                .order_by(IncidenciaProceso.fecha_registro.desc(), IncidenciaProceso.id.desc())
                .limit(limite)
            )
            for c in self._consulta_filtrada(
                id_orden=id_orden, nro_ot=nro_ot, tipo=tipo, gravedad=gravedad,
                estado=estado, desde=desde, hasta=hasta, sin_clasificar=sin_clasificar,
                id_operario=id_operario, id_incidencia=id_incidencia,
            ):
                q = q.where(c)

            filas = (await self.db.execute(q)).all()
            return [self._fila(f) for f in filas]
        except Exception as e:
            logger.error(f"Repository - Error real en buscar no conformidades: {e}")
            raise InfrastructureException("Error al listar las no conformidades.") from e

    @staticmethod
    def _fila(fila) -> dict:
        i: IncidenciaProceso = fila[0]
        operario = " ".join(
            p for p in [fila.operario_nombre or "", fila.operario_apellido or ""] if p
        ).strip()
        return {
            "id": i.id,
            "id_orden_trabajo": i.id_orden_trabajo,
            "nro_ot": fila.nro_ot,
            "cliente": fila.cliente,
            "producto": fila.producto,
            "id_proceso": i.id_proceso,
            "proceso": fila.proceso,
            "id_otp": i.id_otp,
            "paso": fila.paso,
            "id_operario": i.id_operario,
            "operario": operario or None,
            "tipo": i.tipo,
            # None = sin clasificar. Va tal cual: que la pantalla lo diga con esas
            # palabras y no lo disfrace de MEDIA.
            "gravedad": i.gravedad,
            "estado": i.estado,
            "piezas_afectadas": i.piezas_afectadas,
            "piezas_controladas": i.piezas_controladas,
            "disposicion": i.disposicion,
            "minutos_perdidos": i.minutos_perdidos,
            "operarios_extra": i.operarios_extra,
            "descripcion": i.descripcion,
            "accion_correctiva": i.accion_correctiva,
            "usuario": i.usuario,
            "id_usuario": i.id_usuario,
            "fecha_registro": i.fecha_registro.isoformat() if i.fecha_registro else None,
            "fecha_cierre": i.fecha_cierre.isoformat() if i.fecha_cierre else None,
        }

    async def resumen(self, *, id_orden=None, nro_ot=None, tipo=None, gravedad=None,
                      estado=None, desde=None, hasta=None, sin_clasificar=False,
                      id_operario=None) -> dict:
        """Los totales de TODO lo que matchea, no de lo que entró en el tope.

        Se cuenta aparte a propósito: si el resumen se calculara sobre las filas
        traídas, el día que el filtro pase el tope el encabezado diría un número más
        chico que la realidad y nadie se enteraría.
        """
        try:
            abierta = case((IncidenciaProceso.estado == "ABIERTA", 1), else_=0)
            q = select(
                func.count().label("total"),
                func.coalesce(func.sum(abierta), 0).label("abiertas"),
                func.coalesce(func.sum(IncidenciaProceso.minutos_perdidos), 0).label("minutos"),
                func.coalesce(func.sum(IncidenciaProceso.piezas_afectadas), 0).label("piezas"),
                *self._columnas_de_rechazo(),
                func.count(distinct(IncidenciaProceso.id_orden_trabajo)).label("ordenes"),
            ).select_from(IncidenciaProceso)
            for c in self._consulta_filtrada(
                id_orden=id_orden, nro_ot=nro_ot, tipo=tipo, gravedad=gravedad,
                estado=estado, desde=desde, hasta=hasta, sin_clasificar=sin_clasificar,
                id_operario=id_operario,
            ):
                q = q.where(c)

            fila = (await self.db.execute(q)).mappings().first() or {}
            total = int(fila.get("total") or 0)
            abiertas = int(fila.get("abiertas") or 0)
            return {
                "total": total,
                "abiertas": abiertas,
                "cerradas": total - abiertas,
                "minutos_perdidos": int(fila.get("minutos") or 0),
                "piezas_afectadas": int(fila.get("piezas") or 0),
                **self._rechazo_de(fila),
                "ordenes": int(fila.get("ordenes") or 0),
            }
        except Exception as e:
            logger.error(f"Repository - Error real en resumen no conformidades: {e}")
            raise InfrastructureException("Error al resumir las no conformidades.") from e

    # ------------------------------------------------------------------
    # Los rechazos: cuántas de cuántas, y por persona (23/09)
    # ------------------------------------------------------------------

    @staticmethod
    def _columnas_de_rechazo():
        """Lo que hace falta para decir «10 de 50 controladas».

        El porcentaje se saca SÓLO de las filas que tienen los dos números: sumar las
        rechazadas de una NC que no dijo de cuántas contra las controladas de otra
        daría un porcentaje que no es de nada.
        """
        con_los_dos = (IncidenciaProceso.piezas_afectadas.is_not(None)
                       & IncidenciaProceso.piezas_controladas.is_not(None))
        return (
            func.coalesce(func.sum(IncidenciaProceso.piezas_controladas), 0).label("controladas"),
            func.coalesce(func.sum(case((con_los_dos, IncidenciaProceso.piezas_afectadas), else_=0)), 0)
            .label("rechazadas_con_control"),
            func.coalesce(func.sum(case((con_los_dos, IncidenciaProceso.piezas_controladas), else_=0)), 0)
            .label("controladas_con_rechazo"),
        )

    @staticmethod
    def _rechazo_de(fila) -> dict:
        controladas = int(fila.get("controladas_con_rechazo") or 0)
        rechazadas = int(fila.get("rechazadas_con_control") or 0)
        return {
            "piezas_controladas": int(fila.get("controladas") or 0),
            # None = ninguna dijo de cuántas controladas: no hay porcentaje, y 0 % sería
            # decir que no se rechazó nada.
            "porcentaje_rechazo": (round(100 * rechazadas / controladas, 1) if controladas else None),
        }

    async def por_persona(self, *, nro_ot=None, tipo=None, gravedad=None, estado=None,
                          desde=None, hasta=None, sin_clasificar=False,
                          id_operario=None) -> list[dict]:
        """Las no conformidades agrupadas por QUIÉN hizo las piezas: «piezas rechazadas
        por persona este mes». Con el mismo WHERE que el listado, así los dos cuentan lo
        mismo. Las que no dicen quién van en un renglón aparte (id_operario None): no se
        reparten entre nadie."""
        try:
            abierta = case((IncidenciaProceso.estado == "ABIERTA", 1), else_=0)
            q = (
                select(
                    IncidenciaProceso.id_operario,
                    Operario.nombre.label("operario_nombre"),
                    Operario.apellido.label("operario_apellido"),
                    func.count().label("total"),
                    func.coalesce(func.sum(abierta), 0).label("abiertas"),
                    func.coalesce(func.sum(IncidenciaProceso.piezas_afectadas), 0).label("piezas"),
                    *self._columnas_de_rechazo(),
                    func.count(distinct(IncidenciaProceso.id_orden_trabajo)).label("ordenes"),
                    func.max(IncidenciaProceso.fecha_registro).label("ultima"),
                )
                .select_from(IncidenciaProceso)
                .outerjoin(Operario, Operario.id == IncidenciaProceso.id_operario)
                .group_by(IncidenciaProceso.id_operario, Operario.nombre, Operario.apellido)
            )
            for c in self._consulta_filtrada(
                nro_ot=nro_ot, tipo=tipo, gravedad=gravedad, estado=estado, desde=desde,
                hasta=hasta, sin_clasificar=sin_clasificar, id_operario=id_operario,
            ):
                q = q.where(c)
            salida = []
            for f in (await self.db.execute(q)).mappings().all():
                nombre = " ".join(p for p in [f["operario_nombre"] or "", f["operario_apellido"] or ""] if p).strip()
                total = int(f["total"] or 0)
                abiertas = int(f["abiertas"] or 0)
                salida.append({
                    "id_operario": f["id_operario"],
                    "operario": nombre or None,
                    "no_conformidades": total,
                    "abiertas": abiertas,
                    "cerradas": total - abiertas,
                    "piezas_rechazadas": int(f["piezas"] or 0),
                    **self._rechazo_de(f),
                    "ordenes": int(f["ordenes"] or 0),
                    "ultima": f["ultima"].isoformat() if f["ultima"] else None,
                })
            # Primero quien más piezas tuvo rechazadas; el renglón «sin persona», al final.
            salida.sort(key=lambda x: (x["id_operario"] is None, -x["piezas_rechazadas"],
                                       -x["no_conformidades"], (x["operario"] or "").lower()))
            return salida
        except Exception as e:
            logger.error(f"Repository - Error real en no conformidades por persona: {e}")
            raise InfrastructureException("Error al agrupar las no conformidades por persona.") from e

    # ------------------------------------------------------------------
    # Lo que hace falta para cargar una desde la OT (23/09)
    # ------------------------------------------------------------------

    async def orden(self, *, id_orden: int | None = None, nro_ot: int | None = None) -> dict | None:
        """La OT con lo que se muestra arriba del formulario: número, cliente, producto
        y cuántas unidades lleva."""
        try:
            q = (
                select(
                    OrdenTrabajo.id,
                    OrdenTrabajo.id_otvieja.label("nro_ot"),
                    OrdenTrabajo.unidades,
                    Cliente.nombre.label("cliente"),
                    Articulo.descripcion.label("producto"),
                )
                .select_from(OrdenTrabajo)
                .outerjoin(Cliente, Cliente.id == OrdenTrabajo.id_cliente)
                .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
            )
            if id_orden:
                q = q.where(OrdenTrabajo.id == id_orden)
            elif nro_ot:
                q = q.where(OrdenTrabajo.id_otvieja == nro_ot)
            else:
                return None
            fila = (await self.db.execute(q.limit(1))).mappings().first()
            return dict(fila) if fila else None
        except Exception as e:
            logger.error(f"Repository - Error real al buscar la OT de una no conformidad: {e}")
            raise InfrastructureException("Error al buscar la orden.") from e

    async def pasos_de_la_orden(self, id_orden: int) -> list[dict]:
        """Los pasos de la OT, en orden, con la persona elegida a mano (si hay)."""
        try:
            filas = (await self.db.execute(
                select(
                    OrdenTrabajoProceso.id.label("id_otp"),
                    OrdenTrabajoProceso.orden.label("paso"),
                    OrdenTrabajoProceso.id_proceso,
                    Proceso.nombre.label("proceso"),
                    OrdenTrabajoProceso.id_estado,
                    OrdenTrabajoProceso.id_operario.label("id_operario_elegido"),
                    OrdenTrabajoProceso.cant_operarios,
                )
                .select_from(OrdenTrabajoProceso)
                .outerjoin(Proceso, Proceso.id == OrdenTrabajoProceso.id_proceso)
                .where(OrdenTrabajoProceso.id_orden_trabajo == id_orden)
                .order_by(OrdenTrabajoProceso.orden, OrdenTrabajoProceso.id)
            )).mappings().all()
            return [dict(f) for f in filas]
        except Exception as e:
            logger.error(f"Repository - Error real al leer los pasos de la OT {id_orden}: {e}")
            raise InfrastructureException("Error al leer los pasos de la orden.") from e

    async def plan_de_la_orden(self, id_orden: int) -> list[dict]:
        """Todas las filas de plan de la OT: hace falta el plan entero de cada paso para
        saber cuál es el último que lo tocó (misma regla que los tiempos de RF-06).

        Se lee en un SAVEPOINT: si la tabla del plan no se puede leer, el formulario sale
        igual, sin sugerir a nadie."""
        try:
            async with self.db.begin_nested():
                filas = (await self.db.execute(
                    select(
                        Planificacion.id, Planificacion.orden_id, Planificacion.proceso_id,
                        Planificacion.id_orden_trabajo_proceso, Planificacion.id_operario,
                        Planificacion.id_planificacion_lote, Planificacion.creado_en,
                    ).where(Planificacion.orden_id == id_orden)
                )).all()
                return [dict(f._mapping) for f in filas]
        except Exception as e:
            logger.warning(f"No conformidades: no se pudo leer el plan de la OT {id_orden}: {e}")
            return []

    async def nombres_de_personas(self, ids) -> dict[int, str]:
        ids = sorted({int(i) for i in ids if i is not None})
        if not ids:
            return {}
        try:
            filas = (await self.db.execute(
                select(Operario.id, Operario.nombre, Operario.apellido).where(Operario.id.in_(ids))
            )).all()
            return {f.id: " ".join(p for p in [f.nombre or "", f.apellido or ""] if p).strip() for f in filas}
        except Exception as e:
            logger.error(f"Repository - Error real al leer nombres de personas: {e}")
            raise InfrastructureException("Error al leer las personas.") from e

    async def persona(self, id_operario: int) -> dict | None:
        try:
            f = (await self.db.execute(
                select(Operario.id, Operario.nombre, Operario.apellido).where(Operario.id == id_operario)
            )).first()
            if f is None:
                return None
            return {"id": f.id, "nombre": " ".join(p for p in [f.nombre or "", f.apellido or ""] if p).strip()}
        except Exception as e:
            logger.error(f"Repository - Error real al buscar la persona {id_operario}: {e}")
            raise InfrastructureException("Error al buscar la persona.") from e

    async def paso(self, id_otp: int) -> dict | None:
        """De qué OT es un paso y qué proceso es."""
        try:
            f = (await self.db.execute(
                select(OrdenTrabajoProceso.id_orden_trabajo, OrdenTrabajoProceso.id_proceso,
                       OrdenTrabajoProceso.orden)
                .where(OrdenTrabajoProceso.id == id_otp)
            )).first()
            return dict(f._mapping) if f is not None else None
        except Exception as e:
            logger.error(f"Repository - Error real al buscar el paso {id_otp}: {e}")
            raise InfrastructureException("Error al buscar el paso de la orden.") from e

    # ------------------------------------------------------------------
    # Lo que mira el dashboard (SQL de Postgres)
    # ------------------------------------------------------------------

    async def find_recientes(self, tipo: str | None, desde: str | None, hasta: str | None,
                             limit: int = 50):
        """Lista las incidencias (con nombres de orden/proceso/operario) más recientes.

        `tipo` en None trae TODAS. Antes era obligatorio, y el CAST del parámetro es el
        mismo truco que ya usaban las fechas: sin él, Postgres no puede deducir el tipo
        de un parámetro que llega NULL y contesta «could not determine data type».
        """
        try:
            query = text(f"""
                SELECT
                    i.id,
                    i.id_orden_trabajo,
                    ot.id_otvieja            AS nro_ot,
                    i.id_proceso,
                    p.nombre                 AS proceso,
                    i.id_operario,
                    btrim(COALESCE(o.nombre,'') || ' ' || COALESCE(o.apellido,'')) AS operario,
                    i.tipo,
                    i.gravedad,
                    i.estado,
                    i.minutos_perdidos,
                    i.operarios_extra,
                    i.descripcion,
                    i.fecha_registro
                FROM incidencia_proceso i
                LEFT JOIN orden_trabajo ot ON ot.id = i.id_orden_trabajo
                LEFT JOIN proceso p        ON p.id = i.id_proceso
                LEFT JOIN operario o       ON o.id = i.id_operario
                WHERE (CAST(:tipo AS varchar) IS NULL OR i.tipo = CAST(:tipo AS varchar))
                  AND (CAST(:desde AS date) IS NULL OR i.fecha_registro >= CAST(:desde AS date))
                  AND (CAST(:hasta AS date) IS NULL OR i.fecha_registro < CAST(:hasta AS date) + INTERVAL '1 day')
                ORDER BY i.fecha_registro DESC
                LIMIT {int(limit)}
            """)
            result = await self.db.execute(query, {"tipo": tipo, "desde": desde, "hasta": hasta})
            return [dict(r) for r in result.mappings().all()]
        except Exception as e:
            logger.error(f"Repository - Error real en find_recientes incidencias: {e}")
            raise InfrastructureException("Error al listar incidencias.") from e

    async def metricas(self, tipo: str | None, desde: str | None, hasta: str | None):
        """Totales + desglose por operario y por mes para el dashboard.

        `tipo` en None trae todas las no conformidades juntas. La tarjeta del dashboard
        sigue pidiendo INTERPRETACION_PLANOS explícitamente: ese número lo mira Lucas
        todos los días y no puede cambiar de significado porque acá se haya abierto el
        filtro.
        """
        try:
            params = {"tipo": tipo, "desde": desde, "hasta": hasta}
            rango = (
                " AND (CAST(:desde AS date) IS NULL OR i.fecha_registro >= CAST(:desde AS date)) "
                " AND (CAST(:hasta AS date) IS NULL OR i.fecha_registro < CAST(:hasta AS date) + INTERVAL '1 day') "
            )
            del_tipo = " (CAST(:tipo AS varchar) IS NULL OR i.tipo = CAST(:tipo AS varchar)) "

            totales_row = (await self.db.execute(text(f"""
                SELECT COUNT(*) AS total_incidencias,
                       COALESCE(SUM(i.minutos_perdidos), 0) AS total_minutos,
                       COALESCE(SUM(i.operarios_extra), 0)  AS total_operarios_extra
                FROM incidencia_proceso i
                WHERE {del_tipo} {rango}
            """), params)).mappings().first() or {}

            por_operario = (await self.db.execute(text(f"""
                SELECT i.id_operario,
                       btrim(COALESCE(o.nombre,'') || ' ' || COALESCE(o.apellido,'')) AS operario,
                       COUNT(*) AS incidencias,
                       COALESCE(SUM(i.minutos_perdidos), 0) AS minutos
                FROM incidencia_proceso i
                LEFT JOIN operario o ON o.id = i.id_operario
                WHERE {del_tipo} {rango}
                GROUP BY i.id_operario, o.nombre, o.apellido
                ORDER BY minutos DESC
            """), params)).mappings().all()

            por_mes = (await self.db.execute(text(f"""
                SELECT to_char(i.fecha_registro, 'YYYY-MM') AS mes,
                       COUNT(*) AS incidencias,
                       COALESCE(SUM(i.minutos_perdidos), 0) AS minutos
                FROM incidencia_proceso i
                WHERE {del_tipo} {rango}
                GROUP BY to_char(i.fecha_registro, 'YYYY-MM')
                ORDER BY mes
            """), params)).mappings().all()

            return {
                "total_incidencias": int(totales_row.get("total_incidencias") or 0),
                "total_minutos": int(totales_row.get("total_minutos") or 0),
                "total_operarios_extra": int(totales_row.get("total_operarios_extra") or 0),
                "por_operario": [dict(r) for r in por_operario],
                "por_mes": [dict(r) for r in por_mes],
            }
        except Exception as e:
            logger.error(f"Repository - Error real en metricas incidencias: {e}")
            raise InfrastructureException("Error al calcular métricas de incidencias.") from e
