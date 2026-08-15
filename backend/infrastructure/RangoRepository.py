from sqlalchemy import select, text, delete as sa_delete
from backend.domain.Rango import Rango
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger


class RangoRepository:
    def __init__(self, db):
        self.db = db

    async def save(self, rango: Rango):
        try:
            logger.info("Repository - Crear Rango.")
            self.db.add(rango)
            await self.db.commit()
            await self.db.refresh(rango)
            logger.info("Repository - Crear Rango OK.")
            return rango
        except Exception as e:
            logger.error(f"Repository - Error real en save Rango: {e}")
            await self.db.rollback()
            raise InfrastructureException("Error al guardar el Rango.") from e

    async def find_all(self):
        try:
            logger.info("Repository - Obtener todos los rangos.")
            result = await self.db.execute(select(Rango).order_by(Rango.nombre))
            data = result.scalars().all()
            logger.info(f"Repository - Resultado OK ({len(data)} registros).")
            return data
        except Exception as e:
            logger.error(f"Repository - Error real en find_all Rango: {e}")
            raise InfrastructureException("Error al listar los Rangos.") from e

    async def find_procesos_por_rango(self):
        """
        Devuelve {id_rango: [id_proceso, ...]} desde rango_proceso.

        Las claves salen como str porque el destino es JSON: en JS las claves de objeto
        son strings igual, y devolverlas ya normalizadas evita que el front tenga que
        adivinar el tipo.
        """
        try:
            from backend.domain.RangoProceso import RangoProceso

            result = await self.db.execute(
                select(RangoProceso.id_rango, RangoProceso.id_proceso)
            )
            mapa = {}
            for id_rango, id_proceso in result.all():
                mapa.setdefault(str(id_rango), []).append(id_proceso)
            logger.info(f"Repository - Procesos por rango OK ({len(mapa)} rangos).")
            return mapa
        except Exception as e:
            logger.error(f"Repository - Error en find_procesos_por_rango: {e}")
            raise InfrastructureException("Error al listar los procesos por rango.") from e

    async def find_maquinarias_por_rango(self):
        """Mapa {id_rango: [id_maquinaria, ...]}, mismo criterio que find_procesos_por_rango."""
        try:
            from backend.domain.RangoMaquinaria import RangoMaquinaria

            result = await self.db.execute(
                select(RangoMaquinaria.id_rango, RangoMaquinaria.id_maquinaria)
            )
            mapa = {}
            for id_rango, id_maquinaria in result.all():
                mapa.setdefault(str(id_rango), []).append(id_maquinaria)
            logger.info(f"Repository - Maquinarias por rango OK ({len(mapa)} rangos).")
            return mapa
        except Exception as e:
            logger.error(f"Repository - Error en find_maquinarias_por_rango: {e}")
            raise InfrastructureException("Error al listar las maquinarias por rango.") from e

    async def find_cobertura(self):
        """Cobertura cruzada rango ↔ maquinaria (y cuánta gente tiene cada rango).

        Es información de diagnóstico: los huecos acá se pagan callados en el
        planificador. Una máquina sin rango queda fuera del dominio de todo proceso
        que exija rangos, y un rango que no tiene ningún operario deja sin candidatos
        a las máquinas y procesos que solo ese rango habilita —así fue como los tornos
        CNC, marcados con OFICIAL ESPECIALIZADO y TÉCNICO, terminaron sin nadie que
        pudiera usarlos—.
        """
        try:
            from backend.domain.RangoMaquinaria import RangoMaquinaria
            from backend.domain.Maquinaria import Maquinaria
            from backend.domain.OperarioRango import OperarioRango

            rangos = (await self.db.execute(select(Rango).order_by(Rango.nombre))).scalars().all()
            maquinas = (await self.db.execute(
                select(Maquinaria).order_by(Maquinaria.nombre))).scalars().all()

            pares = (await self.db.execute(
                select(RangoMaquinaria.id_rango, RangoMaquinaria.id_maquinaria))).all()

            # Solo operarios DISPONIBLES: un rango que solo tienen puestos vacantes o
            # gente de licencia no habilita a nadie, y mostrarlo como "1 operario" hace
            # creer que está cubierto. Es justo el número que decide si agregar ese
            # rango a una máquina o a un proceso sirve de algo.
            operarios = (await self.db.execute(text("""
                SELECT orr.id_rango, orr.id_operario
                FROM operario_rango orr
                JOIN operario o ON o.id = orr.id_operario
                WHERE o.disponible
            """))).all()

            por_maquina, por_rango = {}, {}
            for id_rango, id_maquinaria in pares:
                por_maquina.setdefault(id_maquinaria, []).append(id_rango)
                por_rango.setdefault(id_rango, []).append(id_maquinaria)

            ops_por_rango = {}
            for id_rango, id_operario in operarios:
                ops_por_rango.setdefault(id_rango, set()).add(id_operario)

            nombre_rango = {r.id: r.nombre for r in rangos}
            nombre_maquina = {m.id: m.nombre for m in maquinas}

            # Procesos: qué rangos los habilitan y, sobre todo, cuánta GENTE puede
            # hacerlos. Un proceso puede tener rangos cargados y aun así no poder
            # hacerlo nadie, si esos rangos no los tiene ninguna persona disponible.
            # Se cuenta igual que el planificador: rango o habilidad manual, menos las
            # nativas apagadas, y solo operarios disponibles.
            procesos = (await self.db.execute(text("""
                WITH disponibles AS (
                    SELECT id FROM operario WHERE disponible
                ),
                por_rango AS (
                    SELECT rp.id_proceso, orr.id_operario
                    FROM rango_proceso rp
                    JOIN operario_rango orr ON orr.id_rango = rp.id_rango
                    JOIN disponibles d ON d.id = orr.id_operario
                ),
                manual AS (
                    SELECT s.id_proceso, s.id_operario
                    FROM operario_proceso_skill s
                    JOIN disponibles d ON d.id = s.id_operario
                    WHERE s.manual AND s.habilitado
                ),
                habilitados AS (
                    SELECT u.id_proceso, u.id_operario
                    FROM (SELECT * FROM por_rango UNION SELECT * FROM manual) u
                    WHERE NOT EXISTS (
                        SELECT 1 FROM operario_proceso_skill a
                        WHERE a.id_proceso = u.id_proceso
                          AND a.id_operario = u.id_operario
                          AND NOT a.habilitado
                    )
                ),
                -- En cuántas líneas de OTs abiertas se usa. El catálogo arrastra
                -- cientos de procesos del legacy que no usa nadie: sin este dato, la
                -- pantalla marca 272 "problemas" y el que importa se pierde entre
                -- ellos. Un proceso sin rango que nadie usa no le hace daño a nadie.
                en_uso AS (
                    SELECT otp.id_proceso, COUNT(*) AS lineas
                    FROM orden_trabajo_proceso otp
                    JOIN orden_trabajo ot ON ot.id = otp.id_orden_trabajo
                    WHERE COALESCE(ot.finalizadototal, 0) = 0
                      AND ot.fecha_entrega IS NULL
                      AND otp.id_estado <> 3
                    GROUP BY otp.id_proceso
                )
                SELECT p.id, p.nombre,
                       COUNT(DISTINCT h.id_operario) AS habilitados,
                       COUNT(DISTINCT m.id_operario) AS por_habilidad_manual,
                       COALESCE(MAX(u.lineas), 0) AS lineas_abiertas
                FROM proceso p
                LEFT JOIN habilitados h ON h.id_proceso = p.id
                LEFT JOIN manual m ON m.id_proceso = p.id
                LEFT JOIN en_uso u ON u.id_proceso = p.id
                GROUP BY p.id, p.nombre
                ORDER BY p.nombre
            """))).fetchall()

            rangos_de_proceso = {}
            for id_proceso, id_rango in (await self.db.execute(
                    text("SELECT id_proceso, id_rango FROM rango_proceso"))).all():
                rangos_de_proceso.setdefault(id_proceso, []).append(id_rango)

            return {
                "procesos": [
                    {
                        "id": p.id,
                        "nombre": p.nombre,
                        "rangos": [
                            {"id": rid, "nombre": nombre_rango.get(rid, f"#{rid}")}
                            for rid in sorted(rangos_de_proceso.get(p.id, []),
                                              key=lambda x: nombre_rango.get(x, ""))
                        ],
                        "habilitados": p.habilitados,
                        "por_habilidad_manual": p.por_habilidad_manual,
                        "lineas_abiertas": p.lineas_abiertas,
                    }
                    for p in procesos
                ],
                "maquinas": [
                    {
                        "id": m.id,
                        "nombre": m.nombre,
                        "cod_maquina": m.cod_maquina,
                        "rangos": [
                            {"id": rid, "nombre": nombre_rango.get(rid, f"#{rid}")}
                            for rid in sorted(por_maquina.get(m.id, []),
                                              key=lambda x: nombre_rango.get(x, ""))
                        ],
                    }
                    for m in maquinas
                ],
                "rangos": [
                    {
                        "id": r.id,
                        "nombre": r.nombre,
                        "maquinas": [
                            {"id": mid, "nombre": nombre_maquina.get(mid, f"#{mid}")}
                            for mid in sorted(por_rango.get(r.id, []),
                                              key=lambda x: nombre_maquina.get(x, ""))
                        ],
                        "operarios": len(ops_por_rango.get(r.id, ())),
                    }
                    for r in rangos
                ],
            }
        except Exception as e:
            logger.error(f"Repository - Error en find_cobertura: {e}")
            raise InfrastructureException("Error al calcular la cobertura de rangos.") from e

    async def find_detalle(self, id: int):
        """
        Rango con sus procesos y maquinarias resueltos a nombre, y QUIÉNES lo tienen.

        La lista de operarios no es decorativa: editar los procesos de un rango cambia
        qué puede hacer toda esa gente, y un número suelto ("3 operarios") no alcanza
        para decidir. Con los nombres a la vista se ve si el cambio toca a quien uno
        cree que toca antes de guardar.

        Va `disponible` porque un rango con gente inactiva no tiene el mismo alcance
        real que el mismo número de gente activa.
        """
        try:
            from backend.domain.RangoProceso import RangoProceso
            from backend.domain.RangoMaquinaria import RangoMaquinaria
            from backend.domain.OperarioRango import OperarioRango
            from backend.domain.Operario import Operario
            from backend.domain.Proceso import Proceso
            from backend.domain.Maquinaria import Maquinaria

            logger.info(f"Repository - Detalle del rango {id}.")

            procesos = (await self.db.execute(
                select(Proceso.id, Proceso.nombre)
                .join(RangoProceso, RangoProceso.id_proceso == Proceso.id)
                .where(RangoProceso.id_rango == id)
                .order_by(Proceso.nombre)
            )).all()

            maquinarias = (await self.db.execute(
                select(Maquinaria.id, Maquinaria.nombre, Maquinaria.cod_maquina)
                .join(RangoMaquinaria, RangoMaquinaria.id_maquinaria == Maquinaria.id)
                .where(RangoMaquinaria.id_rango == id)
                .order_by(Maquinaria.nombre)
            )).all()

            operarios = (await self.db.execute(
                select(Operario.id, Operario.nombre, Operario.apellido, Operario.disponible)
                .join(OperarioRango, OperarioRango.id_operario == Operario.id)
                .where(OperarioRango.id_rango == id)
                .order_by(Operario.apellido, Operario.nombre)
            )).all()

            return {
                "procesos": [{"id": p_id, "nombre": nombre} for p_id, nombre in procesos],
                "maquinarias": [
                    {"id": m_id, "nombre": nombre, "cod_maquina": cod}
                    for m_id, nombre, cod in maquinarias
                ],
                "operarios": [
                    {
                        "id": o_id,
                        "nombre": nombre,
                        "apellido": apellido,
                        "disponible": bool(disponible),
                    }
                    for o_id, nombre, apellido, disponible in operarios
                ],
                # Se mantiene el contador aparte: ya lo consumen el aviso de alcance y
                # la validación de borrado, y derivarlo del largo en cada lugar es ruido.
                "operarios_count": len(operarios),
            }
        except Exception as e:
            logger.error(f"Repository - Error en find_detalle Rango: {e}")
            raise InfrastructureException("Error al obtener el detalle del Rango.") from e

    async def set_procesos(self, id_rango: int, ids_proceso: list[int]):
        """
        Reemplaza el conjunto de procesos del rango por el que se pasa.

        Se hace borrar-e-insertar y no un diff porque la tabla es un par de enteros sin
        payload: no hay nada en la fila que valga la pena conservar, y el conjunto entero
        entra en una sola transacción.

        NO toca `operario_proceso_skill`. Sacar un proceso del rango le quita la
        elegibilidad nativa a todos sus operarios, pero las filas de nivel que hayan
        quedado son inertes: en este modelo `nivel` solo ordena preferencia, no habilita.
        Y las habilidades manuales siguen valiendo, que es justamente para lo que están.
        """
        try:
            from backend.domain.RangoProceso import RangoProceso

            logger.info(f"Repository - Set procesos del rango {id_rango}: {len(ids_proceso)} procesos.")
            await self.db.execute(
                sa_delete(RangoProceso).where(RangoProceso.id_rango == id_rango)
            )
            for id_proceso in dict.fromkeys(ids_proceso):  # dedup preservando orden
                self.db.add(RangoProceso(id_rango=id_rango, id_proceso=id_proceso))
            await self.db.commit()
            logger.info(f"Repository - Procesos del rango {id_rango} actualizados.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en set_procesos: {e}")
            raise InfrastructureException("Error al actualizar los procesos del Rango.") from e

    async def set_maquinarias(self, id_rango: int, ids_maquinaria: list[int]):
        """Reemplaza el conjunto de maquinarias del rango. Mismo criterio que set_procesos."""
        try:
            from backend.domain.RangoMaquinaria import RangoMaquinaria

            logger.info(
                f"Repository - Set maquinarias del rango {id_rango}: {len(ids_maquinaria)} maquinarias."
            )
            await self.db.execute(
                sa_delete(RangoMaquinaria).where(RangoMaquinaria.id_rango == id_rango)
            )
            for id_maquinaria in dict.fromkeys(ids_maquinaria):
                self.db.add(RangoMaquinaria(id_rango=id_rango, id_maquinaria=id_maquinaria))
            await self.db.commit()
            logger.info(f"Repository - Maquinarias del rango {id_rango} actualizadas.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en set_maquinarias: {e}")
            raise InfrastructureException("Error al actualizar las maquinarias del Rango.") from e

    async def set_rangos_de_maquinaria(self, id_maquinaria: int, ids_rango: list[int]):
        """Reemplaza los rangos que habilitan una máquina.

        Es el mismo vínculo que set_maquinarias pero visto desde el otro lado. Hace
        falta porque el hueco se descubre mirando la máquina ("esta no la puede usar
        nadie") y obligaba a irse a la pestaña Rangos, abrir el rango correcto y
        agregarla desde ahí: tres pantallas para un dato que ya tenías delante.
        """
        try:
            from backend.domain.RangoMaquinaria import RangoMaquinaria

            logger.info(
                f"Repository - Set rangos de la maquinaria {id_maquinaria}: {len(ids_rango)} rangos."
            )
            await self.db.execute(
                sa_delete(RangoMaquinaria).where(RangoMaquinaria.id_maquinaria == id_maquinaria)
            )
            for id_rango in dict.fromkeys(ids_rango):
                self.db.add(RangoMaquinaria(id_rango=id_rango, id_maquinaria=id_maquinaria))
            await self.db.commit()
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en set_rangos_de_maquinaria: {e}")
            raise InfrastructureException("Error al actualizar los rangos de la maquinaria.") from e

    async def set_rangos_de_proceso(self, id_proceso: int, ids_rango: list[int]):
        """Reemplaza los rangos que habilitan un proceso (el inverso de set_procesos)."""
        try:
            from backend.domain.RangoProceso import RangoProceso

            logger.info(
                f"Repository - Set rangos del proceso {id_proceso}: {len(ids_rango)} rangos."
            )
            await self.db.execute(
                sa_delete(RangoProceso).where(RangoProceso.id_proceso == id_proceso)
            )
            for id_rango in dict.fromkeys(ids_rango):
                self.db.add(RangoProceso(id_rango=id_rango, id_proceso=id_proceso))
            await self.db.commit()
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error en set_rangos_de_proceso: {e}")
            raise InfrastructureException("Error al actualizar los rangos del proceso.") from e

    async def find_by_id(self, id: int):
        try:
            logger.info(f"Repository - Buscar rango por ID {id}.")
            result = await self.db.execute(select(Rango).where(Rango.id == id))
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Repository - Error real en find_by_id Rango: {e}")
            raise InfrastructureException("Error al buscar el Rango por ID.") from e

    async def update(self, id: int, nueva_data: dict):
        try:
            logger.info(f"Repository - Actualizar rango ID {id}.")
            result = await self.db.execute(select(Rango).where(Rango.id == id))
            rango = result.scalar_one_or_none()
            if not rango:
                logger.info(f"Repository - Rango {id} no encontrado para actualizar.")
                return None

            for key, value in nueva_data.items():
                setattr(rango, key, value)

            await self.db.commit()
            await self.db.refresh(rango)
            logger.info(f"Repository - Rango {id} actualizado correctamente.")
            return rango
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en update Rango: {e}")
            raise InfrastructureException("Error al actualizar el Rango.") from e

    async def delete(self, id: int):
        try:
            logger.info(f"Repository - Eliminar rango ID {id}.")
            result = await self.db.execute(select(Rango).where(Rango.id == id))
            rango = result.scalar_one_or_none()

            if not rango:
                logger.info(f"Repository - Rango {id} no encontrado para eliminar.")
                return False

            await self.db.delete(rango)
            await self.db.commit()
            logger.info(f"Repository - Rango {id} eliminado correctamente.")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Repository - Error real en delete Rango: {e}")
            raise InfrastructureException("Error al eliminar el Rango.") from e
