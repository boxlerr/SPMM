from sqlalchemy import select, func, text as sa_text
from sqlalchemy.orm import aliased
from backend.domain.Plano import Plano
from backend.domain.Articulo import Articulo
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


# Las columnas que se leen en CUALQUIER listado. La que no está es `archivo`, y es a
# propósito. Medido sobre la carpeta de Drive del taller (6/9/2026): 613 PDFs, mediana
# 108 KB, el más grande 6,7 MB, 226 MB en total. La biblioteca los lista de a 48, así que
# traer el blob en un listado son ~5 MB de mediana por página —y 300 MB si alguien pide
# todo—, contra el pooler de Supabase y el contenedor de Cloud Run.
# En vez del blob va su tamaño, que además es lo que necesita el front para decidir si
# vale la pena bajarlo para dibujar la miniatura.
# El archivo lo trae únicamente find_by_id, que es de donde sale la descarga.
def _columnas_listado():
    return (
        Plano.id,
        Plano.nombre,
        Plano.descripcion,
        Plano.tipo_archivo,
        Plano.fecha_subida,
        Plano.id_orden_trabajo,
        Plano.id_articulo,
        func.octet_length(Plano.archivo).label("bytes"),
    )


# El código de artículo, normalizado, para comparar dos filas del catálogo.
#
# Se normaliza EXACTAMENTE igual que el importador (`normalizar_codigo` en
# backend/scripts/planos/importar_planos.py): sacar los espacios de los bordes,
# colapsar los del medio y pasar a mayúsculas. Si los dos lados normalizaran distinto,
# el importador vería un solo código —y colgaría el plano de una sola fila— mientras
# que estas consultas verían dos códigos y no las unirían: el plano quedaría invisible
# en la fila hermana, justo lo que esto existe para evitar. Hoy no cambia nada (en el
# catálogo no hay ningún código con espacios dobles en el medio), pero es la clase de
# diferencia que no avisa cuando aparece.
#
# Está suelta acá arriba, y no adentro de _articulos_del_mismo_codigo como estaba, para
# que las dos consultas que la necesitan —la de los planos de un artículo y la del
# listado de OTs con plano disponible— compartan una sola definición. Tenerla escrita
# dos veces es exactamente el desfasaje que el párrafo de arriba pide evitar.
def _codigo_normalizado(col):
    return func.upper(func.regexp_replace(func.btrim(col), r"\s+", " ", "g"))


class PlanoRepository:
    def __init__(self, db):
        self.db = db

    async def find_ordenes_con_plano(self) -> set[int]:
        """IDs de las OTs que tienen al menos un plano REALMENTE adjunto.

        Lo consume el planificador. Antes miraba `orden_trabajo.tiene_plano`, que
        viene del legacy (sync_db lo copia de v.tplano) y está en 1 en la enorme
        mayoría de las OTs aunque no haya ningún archivo cargado. Como el filtro de
        interpretación de planos es DURO, eso dejaba fuera de la planificación a
        todos los operarios que no leen planos —pasantes, ayudantes, tercerizados—
        en OTs que en realidad no tienen plano ninguno.

        REGLA CRÍTICA: acá van SOLO los planos adjuntos DIRECTAMENTE a la OT. Las OTs
        cuyo ARTÍCULO tiene plano NO entran, aunque desde 2026-09-06 el plano de
        artículo exista y la pantalla de la OT lo muestre. El motivo es el mismo
        filtro duro: hoy la tabla está casi vacía, o sea que el filtro está apagado, y
        si al importar los ~600 planos de productos se prendiera solo, de un día para
        el otro cientos de OTs quedarían reservadas a los que leen planos. Esa es una
        decisión del taller, no nuestra. Si alguna vez se quiere, se prende a mano.
        """
        try:
            result = await self.db.execute(
                select(Plano.id_orden_trabajo)
                .where(Plano.id_orden_trabajo.is_not(None))
                .distinct()
            )
            return {row[0] for row in result.all() if row[0] is not None}
        except Exception as e:
            logger.error(f"Repository - Error en find_ordenes_con_plano: {e}")
            raise InfrastructureException(
                "Error al consultar qué órdenes tienen plano adjunto."
            ) from e

    async def find_resumen_por_orden(self) -> dict:
        """Cuántos DIBUJOS y cuántas FOTOS tiene para mirar cada OT.

        Devuelve {id_orden: {"planos": n, "fotos": n, "de_la_orden": n}}, solo con las OT
        que tienen algo. Es dato de PANTALLA: no filtra ni restringe nada (el filtro duro
        del planificador lo sigue decidiendo find_ordenes_con_plano, que mira solo la OT).

        Se cuenta y no se devuelve un simple sí/no porque la columna tiene que decir QUÉ
        hay: "Plano" no es lo mismo que "3 fotos". De las 198 órdenes que muestran algo,
        46 tienen únicamente fotos de la pieza, y llamarles plano manda al que planifica a
        buscar un dibujo que no existe.

        El salto de la OT al plano del producto va por CÓDIGO normalizado y no por id de
        artículo: el catálogo repite códigos y el plano cuelga de una sola de esas filas.
        """
        try:
            logger.info("Repository - Resumen de planos por orden (para mostrar).")
            sql = sa_text(r"""
                with archivos_de_la_ot as (
                    select p.id_orden_trabajo as orden_id, p.tipo_archivo, 1 as propio
                    from plano p
                    where p.id_orden_trabajo is not null
                ),
                archivos_del_producto as (
                    select o.id as orden_id, p.tipo_archivo, 0 as propio
                    from orden_trabajo o
                    join articulo ao on ao.id = o.id_articulo
                    join articulo ag
                      on upper(regexp_replace(btrim(ag.cod_articulo), '\s+', ' ', 'g'))
                       = upper(regexp_replace(btrim(ao.cod_articulo), '\s+', ' ', 'g'))
                    join plano p on p.id_articulo = ag.id
                ),
                todo as (
                    select * from archivos_de_la_ot
                    union all
                    select * from archivos_del_producto
                )
                select orden_id,
                       count(*) filter (where tipo_archivo ilike '%pdf%')     as planos,
                       count(*) filter (where tipo_archivo not ilike '%pdf%') as fotos,
                       count(*) filter (where propio = 1)                     as de_la_orden
                from todo
                group by orden_id
            """)
            filas = (await self.db.execute(sql)).mappings().all()
            return {
                int(f["orden_id"]): {
                    "planos": int(f["planos"]),
                    "fotos": int(f["fotos"]),
                    "de_la_orden": int(f["de_la_orden"]),
                }
                for f in filas
                if f["orden_id"] is not None
            }
        except Exception as e:
            logger.error(f"Repository - Error en find_resumen_por_orden: {e}")
            raise InfrastructureException(
                "Error al consultar qué planos tiene cada orden."
            ) from e

    async def find_ordenes_con_plano_disponible(self) -> tuple[set[int], set[int]]:
        """Qué OTs tienen un plano PARA MIRAR. Es dato de pantalla: no filtra nada.

        Devuelve dos conjuntos de ids de OT:
          · `propios`: la OT tiene un plano pegado a la orden.
          · `del_producto`: el ARTÍCULO que fabrica esa OT tiene plano. Es el mismo
            dibujo de la pieza, cargado en el catálogo en vez de en la orden.

        Existe porque la pantalla de Órdenes de Trabajo venía preguntando "¿esta OT
        tiene plano?" con find_ordenes_con_plano, que en realidad contesta otra cosa.
        Hoy en producción hay 1183 planos y TODOS cuelgan del artículo, ninguno de una
        OT: la columna Plano decía "Sin archivo" en todas las filas mientras 198 órdenes
        tenían el plano de su producto a un clic.

        Acá se separan las dos preguntas, que hasta ahora compartían la misma fuente:
          · lo que se MUESTRA  -> este método: "¿hay un dibujo para abrir?"
          · lo que RESTRINGE   -> find_ordenes_con_plano: "¿esta OT exige saber leer
            planos?". Ese sigue mirando SOLO la OT y no se toca. Prender el filtro duro
            para 198 OTs de golpe deja esos procesos reservados a los que interpretan
            planos, y eso lo decide el taller, no nosotros.

        Por lo mismo `propios` no sale de llamar a find_ordenes_con_plano aunque hoy dé
        el mismo conjunto: si mañana el filtro del planificador cambia de criterio, la
        pantalla no tiene por qué cambiar atrás de él. Separadas de verdad o no están
        separadas.

        Los dos conjuntos se pueden pisar (una OT con plano propio cuyo artículo además
        tiene el suyo). Se devuelven crudos y el que muestra decide con cuál se queda;
        restarlos acá le sacaría información al front.

        Nunca trae la columna `archivo`: son 396 MB de blobs y acá solo hacen falta ids.
        """
        try:
            logger.info("Repository - Órdenes con plano disponible (para mostrar).")

            resultado_propios = await self.db.execute(
                select(Plano.id_orden_trabajo)
                .where(Plano.id_orden_trabajo.is_not(None))
                .distinct()
            )
            propios = {row[0] for row in resultado_propios.all() if row[0] is not None}

            # El salto de la OT al plano del producto no se hace por id de artículo
            # pelado: el catálogo tiene 20 códigos repetidos (un espacio de más, o un
            # código que abarca un rango de piezas y se cargó una fila por pieza) y el
            # importador cuelga el único plano de Drive de UNA sola de esas filas. La OT
            # que apunta a la fila gemela quedaría sin plano sin motivo visible. Es el
            # mismo problema —y la misma solución— que _articulos_del_mismo_codigo, pero
            # para todas las OTs de una, así que va como join y no como subconsulta por
            # artículo.
            articulo_de_la_ot = aliased(Articulo)
            articulo_gemelo = aliased(Articulo)

            resultado_producto = await self.db.execute(
                select(OrdenTrabajo.id)
                .join(articulo_de_la_ot, OrdenTrabajo.id_articulo == articulo_de_la_ot.id)
                .join(
                    articulo_gemelo,
                    _codigo_normalizado(articulo_gemelo.cod_articulo)
                    == _codigo_normalizado(articulo_de_la_ot.cod_articulo),
                )
                .join(Plano, Plano.id_articulo == articulo_gemelo.id)
                .distinct()
            )
            del_producto = {row[0] for row in resultado_producto.all() if row[0] is not None}

            logger.info(
                f"Repository - Resultado OK ({len(propios)} con plano propio, "
                f"{len(del_producto)} con plano del producto)."
            )
            return propios, del_producto
        except Exception as e:
            logger.error(f"Repository - Error en find_ordenes_con_plano_disponible: {e}")
            raise InfrastructureException(
                "Error al consultar qué órdenes tienen un plano para ver."
            ) from e

    async def find_articulos_con_plano(self) -> set[int]:
        """IDs de los artículos que tienen plano.

        Es el equivalente de find_ordenes_con_plano para el catálogo, pero NO alimenta
        ningún filtro del planificador: solo sirve para marcar en la pantalla de
        artículos cuáles ya tienen el plano cargado y cuáles faltan.
        """
        try:
            result = await self.db.execute(
                select(Plano.id_articulo)
                .where(Plano.id_articulo.is_not(None))
                .distinct()
            )
            return {row[0] for row in result.all() if row[0] is not None}
        except Exception as e:
            logger.error(f"Repository - Error en find_articulos_con_plano: {e}")
            raise InfrastructureException(
                "Error al consultar qué artículos tienen plano."
            ) from e

    async def save(self, plano: Plano):
        try:
            logger.info("Repository - Crear Plano.")
            self.db.add(plano)
            await self.db.commit()
            await self.db.refresh(plano)
            logger.info("Repository - Crear Plano OK.")
            return plano
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en save Plano: {e}")
            raise InfrastructureException("Error al guardar un nuevo Plano.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar Plano ID {id}.")
            result = await self.db.execute(select(Plano).where(Plano.id == id))
            plano = result.scalar_one_or_none()

            if not plano:
                logger.info(f"Repository - Plano {id} no encontrado para eliminar.")
                return False

            await self.db.delete(plano)
            await self.db.commit()
            logger.info(f"Repository - Plano {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete Plano: {e}")
            raise InfrastructureException("Error al eliminar el Plano.") from e

    async def find_by_id(self, id: int):
        """El único método que trae el archivo entero: de acá sale la descarga."""
        try:
            logger.info(f"Repository - Buscar Plano por ID {id}.")
            result = await self.db.execute(select(Plano).where(Plano.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id Plano: {e}")
            raise InfrastructureException("Error al buscar el Plano por ID.") from e

    async def find_ficha(self, id: int):
        """Los datos de un plano SIN el archivo.

        Existe aparte de find_by_id porque pedir la ficha no tiene por qué levantar el
        blob: lo traía del pooler, lo pasaba por el contenedor y lo tiraba para devolver
        un JSON de doscientos bytes. Es el mismo cuidado de _columnas_listado, que acá
        faltaba.
        """
        try:
            logger.info(f"Repository - Ficha de Plano ID {id}.")
            result = await self.db.execute(
                select(*_columnas_listado()).where(Plano.id == id)
            )
            fila = result.mappings().first()
            return dict(fila) if fila else None
        except Exception as e:
            logger.error(f"Repository - Error real en find_ficha Plano: {e}")
            raise InfrastructureException("Error al buscar el Plano por ID.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los Planos.")
            result = await self.db.execute(
                select(*_columnas_listado()).order_by(Plano.id.asc())
            )
            data = [dict(fila) for fila in result.mappings().all()]
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all Plano: {e}")
            raise InfrastructureException("Error al listar Planos.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar Plano ID {id}.")
            result = await self.db.execute(select(Plano).where(Plano.id == id))
            plano = result.scalar_one_or_none()

            if not plano:
                logger.info(f"Repository - Plano {id} no encontrado para actualizar.")
                return None

            # Actualizar solo los campos presentes (mismo estilo Articulo)
            for key, value in nueva_data.items():
                setattr(plano, key, value)

            await self.db.commit()
            await self.db.refresh(plano)
            logger.info(f"Repository - Plano {id} actualizado correctamente.")
            return plano
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update Plano: {e}")
            raise InfrastructureException("Error al actualizar el Plano.") from e

    async def find_by_orden_trabajo(self, id_orden: int):
        """Solo los planos pegados a esta OT. Sin el archivo (ver _columnas_listado)."""
        try:
            logger.info(f"Repository - Obtener Planos por OrdenTrabajo ID {id_orden}.")
            result = await self.db.execute(
                select(*_columnas_listado())
                .where(Plano.id_orden_trabajo == id_orden)
                .order_by(Plano.id.asc())
            )
            data = [dict(fila) for fila in result.mappings().all()]
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_orden_trabajo: {e}")
            raise InfrastructureException("Error al obtener Planos por Orden de Trabajo.") from e

    def _articulos_del_mismo_codigo(self, id_articulo: int):
        """Los artículos que comparten código con este, incluido él mismo.

        El catálogo tiene el mismo código cargado más de una vez: 20 códigos repetidos,
        algunos por un espacio de más (' -00E002' y '-00E002' son dos filas del mismo
        eje) y otros porque un código abarca un rango de piezas y se cargó una fila por
        pieza (CLLEE030031 son 24 filas). En Drive hay UN plano por código, así que el
        importador lo cuelga de una sola de esas filas.

        Si se buscara por id pelado, la OT que apunta a cualquiera de las otras filas
        quedaría sin plano sin motivo visible. Se busca por código normalizado —el mismo
        criterio con el que el importador machea la carpeta— y así el plano aparece en
        todas. Duplicar el archivo por cada fila repetida sería la otra salida, pero deja
        copias que después hay que borrar de a una cuando el taller limpie el catálogo.

        El criterio de comparación vive en _codigo_normalizado, arriba de todo: tiene que
        ser el mismo que usa el importador y el mismo que usa la consulta del listado.
        """
        codigo = (
            select(_codigo_normalizado(Articulo.cod_articulo))
            .where(Articulo.id == id_articulo)
            .scalar_subquery()
        )
        return (
            select(Articulo.id)
            .where(_codigo_normalizado(Articulo.cod_articulo) == codigo)
            .scalar_subquery()
        )

    async def find_by_articulo(self, id_articulo: int):
        """Los planos del producto. Sin el archivo (ver _columnas_listado)."""
        try:
            logger.info(f"Repository - Obtener Planos por Articulo ID {id_articulo}.")
            result = await self.db.execute(
                select(*_columnas_listado())
                .where(Plano.id_articulo.in_(self._articulos_del_mismo_codigo(id_articulo)))
                .order_by(Plano.id.asc())
            )
            data = [dict(fila) for fila in result.mappings().all()]
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_articulo: {e}")
            raise InfrastructureException("Error al obtener Planos por Artículo.") from e

    async def find_por_orden_con_articulo(self, id_orden: int):
        """Todo lo que el taller tiene que ver abierto en esa OT.

        Los planos de la OT MÁS los del artículo que se está fabricando. Van juntos
        porque para el que está en la máquina son lo mismo: el dibujo de la pieza. Lo
        que sí cambia es de dónde salió, y eso importa para la pantalla —el de la OT se
        puede borrar desde ahí, el del artículo es del catálogo y lo tocás en el
        catálogo—, así que cada fila viaja con `origen`.

        Ojo: NO alimenta el filtro de planos del planificador. Eso lo sigue decidiendo
        find_ordenes_con_plano, que mira solo la OT.
        """
        try:
            logger.info(f"Repository - Obtener Planos (OT + artículo) por OT ID {id_orden}.")

            resultado_articulo = await self.db.execute(
                select(OrdenTrabajo.id_articulo).where(OrdenTrabajo.id == id_orden)
            )
            id_articulo = resultado_articulo.scalar_one_or_none()

            resultado_ot = await self.db.execute(
                select(*_columnas_listado())
                .where(Plano.id_orden_trabajo == id_orden)
                .order_by(Plano.id.asc())
            )
            data = [{**fila, "origen": "ot"} for fila in resultado_ot.mappings().all()]

            if id_articulo is not None:
                vistos = {fila["id"] for fila in data}
                resultado_art = await self.db.execute(
                    select(*_columnas_listado())
                    .where(Plano.id_articulo.in_(self._articulos_del_mismo_codigo(id_articulo)))
                    .order_by(Plano.id.asc())
                )
                # Un plano puede tener las dos FK cargadas (se subió a la OT y además se
                # marcó como plano del producto). Sin este filtro saldría dos veces en
                # la misma lista.
                data += [
                    {**fila, "origen": "articulo"}
                    for fila in resultado_art.mappings().all()
                    if fila["id"] not in vistos
                ]

            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_por_orden_con_articulo: {e}")
            raise InfrastructureException(
                "Error al obtener los planos de la Orden de Trabajo."
            ) from e

    async def buscar(self, texto: str | None = None, limit: int = 50, offset: int = 0):
        """Biblioteca de planos, paginada. Devuelve (filas, total).

        Es la pantalla donde el taller busca un plano sin pasar por una OT: escribe el
        código del artículo, un pedazo de la descripción o el nombre del archivo. Por
        eso el `ilike` va contra los tres.

        El join con artículo es LEFT: los planos cargados sobre una OT puntual no
        tienen artículo y tienen que aparecer igual en la búsqueda por nombre.

        Acá tampoco viaja el archivo. Con ~600 planos paginados de a 50, traer los
        blobs serían cientos de megas por página.
        """
        try:
            logger.info(f"Repository - Buscar Planos (texto={texto!r}, limit={limit}, offset={offset}).")

            filtro = None
            if texto and texto.strip():
                patron = f"%{texto.strip()}%"
                filtro = (
                    Articulo.cod_articulo.ilike(patron)
                    | Articulo.descripcion.ilike(patron)
                    | Plano.nombre.ilike(patron)
                )

            query_total = select(func.count()).select_from(Plano).join(
                Articulo, Plano.id_articulo == Articulo.id, isouter=True
            )
            if filtro is not None:
                query_total = query_total.where(filtro)

            resultado_total = await self.db.execute(query_total)
            total = resultado_total.scalar() or 0

            query = (
                select(
                    Plano.id,
                    Plano.nombre,
                    Plano.descripcion,
                    Plano.tipo_archivo,
                    Plano.fecha_subida,
                    func.octet_length(Plano.archivo).label("bytes"),
                    Plano.id_articulo,
                    Articulo.cod_articulo,
                    Articulo.descripcion.label("descripcion_articulo"),
                    Plano.id_orden_trabajo,
                )
                .join(Articulo, Plano.id_articulo == Articulo.id, isouter=True)
                # Por código de artículo, que es como los busca el taller. En Postgres
                # los NULL (los planos de OT suelta) quedan al final solos.
                .order_by(Articulo.cod_articulo.asc(), Plano.nombre.asc(), Plano.id.asc())
                .limit(limit)
                .offset(offset)
            )
            if filtro is not None:
                query = query.where(filtro)

            resultado = await self.db.execute(query)
            data = [dict(fila) for fila in resultado.mappings().all()]

            logger.info(f"Repository - Resultado OK ({len(data)} de {total} registros).")
            return data, total
        except Exception as e:
            logger.error(f"Repository - Error real en buscar Planos: {e}")
            raise InfrastructureException("Error al buscar Planos.") from e

    async def find_by_drive_file_id(self, drive_file_id: str):
        """El plano que ya se importó de ese archivo de Drive, si existe.

        Lo usa el importador para no duplicar: si vuelve a pasar por la carpeta y el
        archivo ya está, compara `drive_md5` y solo reemplaza cuando cambió. Tampoco
        trae el blob: para decidir alcanza con el checksum, y el que se quiere guardar
        es el nuevo, no el viejo.
        """
        try:
            logger.info(f"Repository - Buscar Plano por drive_file_id {drive_file_id}.")
            result = await self.db.execute(
                select(
                    Plano.id,
                    Plano.nombre,
                    Plano.tipo_archivo,
                    Plano.fecha_subida,
                    Plano.id_orden_trabajo,
                    Plano.id_articulo,
                    Plano.drive_file_id,
                    Plano.drive_md5,
                    Plano.drive_modificado,
                ).where(Plano.drive_file_id == drive_file_id)
            )
            fila = result.mappings().first()
            return dict(fila) if fila is not None else None
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_drive_file_id: {e}")
            raise InfrastructureException(
                "Error al buscar el Plano por su archivo de Drive."
            ) from e
