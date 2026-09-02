from sqlalchemy import select
from backend.domain.Proceso import Proceso
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.application.validators.ProcesoValidator import procesoValidator
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException



from backend.commons.loggers.logger import logger

class ProcesoService:
    def __init__(self, db_session):
        self.repository = ProcesoRepository(db_session)

    async def crearProceso(self, proceso_dto: ProcesoRequestDTO):
        try:
            logger.info("Service - Crear proceso.")

            # Validación de negocio
            errores = procesoValidator(proceso_dto)
            if errores:
                raise BusinessException("; ".join(errores))

            proceso = Proceso(
                nombre=proceso_dto.nombre,
                descripcion=proceso_dto.descripcion
            )

            proceso_creado = await self.repository.save(proceso)

            return ResponseDTO(status=True, data=jsonable_encoder(proceso_creado))
        #Las maneja el exception_hanlder pero acá se le da el formato
        #Error al guardar (viene del repo) → InfrastructureException
        #Error de validación (ej. nombre vacío) → BusinessException
        #Otro error inesperado → ApplicationException
        except InfrastructureException:
            raise  
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear el Proceso.") from e


    async def listarProcesos(self):
        logger.info("Service - Listar procesos.")
        procesos = await self.repository.find_all()

        #   Posibles errores:
        # - Error de conexión / consulta SQL → InfrastructureException (repo)
        # - Ninguno si la lista está vacía (devuelve lista vacía)
        
        if not procesos:
            logger.info("Service - No hay procesos registrados.")

        
        return ResponseDTO(status=True, data=jsonable_encoder(procesos))

    async def obtenerProcesoPorId(self, id: int):
        logger.info(f"Service - Obtener proceso ID: {id}")
        proceso = await self.repository.find_by_id(id)

        #  Posibles errores:
        # - Proceso no existe → NotFoundException (lanzarla acá)
        # - Error de base de datos → InfrastructureException (repo)
        if not proceso:
            raise NotFoundException(f"No se encontró el proceso con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(proceso))

    async def modificarProceso(self, id: int, proceso_dto: ProcesoRequestDTO):
        logger.info(f"Service - Modificar proceso ID: {id}")

        #   Posibles errores:
        # - Validaciones de negocio → BusinessException
        # - Proceso inexistente → NotFoundException
        # - Error SQL → InfrastructureException (repo)

        errores = procesoValidator(proceso_dto)
        if errores:
            raise BusinessException("; ".join(errores))

        nueva_data = proceso_dto.dict(exclude_unset=True)
        proceso_actualizado = await self.repository.update(id, nueva_data)

        if not proceso_actualizado:
            raise NotFoundException(f"No se encontró el proceso con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(proceso_actualizado))

    async def modificarMaquinariasDeProceso(self, id: int, ids_maquinaria: list[int]):
        """En qué máquinas se hace este proceso.

        Reemplaza la lista entera, igual que los rangos: es lo que el editor manda al
        guardar. Lista vacía es una respuesta válida y significa «todavía no lo
        cargaron»; el planificador ahí sigue deduciéndolo del nombre, como hasta ahora.
        """
        try:
            from backend.domain.Maquinaria import Maquinaria

            existentes = (await self.repository.db.execute(
                select(Maquinaria.id).where(Maquinaria.id.in_(ids_maquinaria or []))
            )).scalars().all() if ids_maquinaria else []
            faltantes = set(ids_maquinaria or []) - set(existentes)
            if faltantes:
                raise NotFoundException(
                    f"No existe la maquinaria {', '.join(str(x) for x in sorted(faltantes))}."
                )

            await self.repository.set_maquinarias_de_proceso(id, ids_maquinaria or [])
            return ResponseDTO(status=True, data={"id_proceso": id, "maquinarias": ids_maquinaria or []})
        except (BusinessException, NotFoundException):
            raise
        except InfrastructureException as e:
            logger.error(f"Service - Error al actualizar las máquinas del proceso: {e}")
            raise ApplicationException(
                "No se pudieron actualizar las máquinas del proceso."
            ) from e

    @staticmethod
    def _motivo_del_borrado(nombre: str, ots: list, rangos: int, maquinas: int) -> str:
        """Qué se lleva puesto borrar un proceso, escrito para leerse en un cartel.

        Se nombran las OT por su número VISIBLE y no por el id interno: el que decide
        va a ir a mirarlas, y el id interno no figura en ningún papel del taller.
        """
        cuantas = len(ots)
        listadas = ", ".join(f"#{o}" for o in ots[:5])
        if cuantas > 5:
            listadas += f" y {cuantas - 5} más"

        partes = [
            f"«{nombre}» está en {cuantas} "
            f"{'orden' if cuantas == 1 else 'órdenes'}: {listadas}. "
            f"Si lo eliminás, ese paso se va de "
            f"{'esa orden' if cuantas == 1 else 'esas órdenes'} y el trabajo que tenga "
            f"cargado se pierde."
        ]
        extras = []
        if rangos:
            extras.append(f"{rangos} {'categoría' if rangos == 1 else 'categorías'}")
        if maquinas:
            extras.append(f"{maquinas} {'máquina' if maquinas == 1 else 'máquinas'}")
        if extras:
            partes.append(f"También se borra lo que tenía cargado en Recursos: {' y '.join(extras)}.")
        return " ".join(partes)

    async def eliminarProceso(self, id: int, forzar: bool = False):
        """Borra un proceso del catálogo.

        Existe porque el catálogo tiene basura: variantes de tipeo que el sync del
        sistema viejo daba de alta como procesos nuevos («AGUJEREADo y ROSCADO»,
        «TORNO T1 trBAJO 3 dias 24h», «PLEGADORA0»). Nacen sin categoría y sin máquina,
        así que el planificador se los puede dar a cualquiera.

        Si el proceso está en alguna OT, la primera pasada NO borra: contesta 409 con
        quiénes son y qué se pierde. Con `forzar` sí, y se lleva las filas de esas OT.
        Avisar, no bloquear — pero avisando de verdad, porque acá se pierde trabajo
        cargado, no solo una categoría.
        """
        from sqlalchemy import text as _text

        logger.info(f"Service - Eliminar proceso ID: {id} (forzar={forzar})")
        db = self.repository.db

        proceso = await self.repository.find_by_id(id)
        if not proceso:
            raise NotFoundException(f"No se encontró el proceso con ID {id}")

        ots = [r[0] for r in (await db.execute(_text("""
            SELECT DISTINCT COALESCE(ot.id_otvieja, ot.id)
            FROM orden_trabajo_proceso otp
            JOIN orden_trabajo ot ON ot.id = otp.id_orden_trabajo
            WHERE otp.id_proceso = :p
            ORDER BY 1
        """), {"p": id})).all()]
        rangos = (await db.execute(_text(
            "SELECT COUNT(*) FROM rango_proceso WHERE id_proceso = :p"), {"p": id})).scalar() or 0
        maquinas = (await db.execute(_text(
            "SELECT COUNT(*) FROM proceso_maquinaria WHERE id_proceso = :p"), {"p": id})).scalar() or 0

        if ots and not forzar:
            raise ConfirmacionRequeridaException(
                self._motivo_del_borrado(proceso.nombre or f"#{id}", ots, rangos, maquinas)
            )

        try:
            # A mano y en la misma transacción: estas dos FK son NO ACTION, así que sin
            # esto el borrado revienta con un error de constraint que en pantalla se ve
            # como "error de conexión" y no dice nada.
            await db.execute(_text("DELETE FROM orden_trabajo_proceso WHERE id_proceso = :p"), {"p": id})
            await db.execute(_text("DELETE FROM rango_proceso WHERE id_proceso = :p"), {"p": id})
            await db.execute(_text("DELETE FROM incidencia_proceso WHERE id_proceso = :p"), {"p": id})
            await db.execute(_text("DELETE FROM proceso WHERE id = :p"), {"p": id})
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.error(f"Service - Error al eliminar el proceso {id}: {e}")
            raise ApplicationException("No se pudo eliminar el proceso.") from e

        return ResponseDTO(status=True, data={
            "deleted": id,
            "ordenes_afectadas": len(ots),
        })
