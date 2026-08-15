from sqlalchemy import select, delete as sa_delete
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

            operarios = (await self.db.execute(
                select(OperarioRango.id_rango, OperarioRango.id_operario))).all()

            por_maquina, por_rango = {}, {}
            for id_rango, id_maquinaria in pares:
                por_maquina.setdefault(id_maquinaria, []).append(id_rango)
                por_rango.setdefault(id_rango, []).append(id_maquinaria)

            ops_por_rango = {}
            for id_rango, id_operario in operarios:
                ops_por_rango.setdefault(id_rango, set()).add(id_operario)

            nombre_rango = {r.id: r.nombre for r in rangos}
            nombre_maquina = {m.id: m.nombre for m in maquinas}

            return {
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
