# Importaciones de módulos
from backend.domain.Maquinaria import Maquinaria
from backend.dto.MaquinariaRequestDTO import MaquinariaRequestDTO
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.loggers.logger import logger
from backend.infrastructure import auditoria_procesos as auditoria_proc


class MaquinariaService:
    """
    Capa de aplicación de Maquinaria (versión asincrónica).
    Maneja validaciones, conversión a DTO y llamadas al repositorio asincrónico.
    """

    def __init__(self, db_session):
        self.repository = MaquinariaRepository(db_session)

    # Crear Maquinaria
    async def crearMaquinaria(self, maquinaria_dto: MaquinariaRequestDTO):
        try:
            if not maquinaria_dto.nombre:
                raise BusinessException("El nombre de la maquinaria es obligatorio.")

            maquinaria = Maquinaria(
                nombre=maquinaria_dto.nombre,
                cod_maquina=maquinaria_dto.cod_maquina,
                limitacion=maquinaria_dto.limitacion,
                capacidad=maquinaria_dto.capacidad,
                especialidad=maquinaria_dto.especialidad,
            )

            maquinaria_creada = await self.repository.save(maquinaria)

            return ResponseDTO(
                status=True,
                data=jsonable_encoder(maquinaria_creada),
                errorDescription=""
            )

        except BusinessException as e:
            raise e
        except Exception as e:
            logger.error(f"Service - Error al crear Maquinaria: {e}")
            raise InfrastructureException("Error al guardar la Maquinaria.") from e

    # Eliminar Maquinaria
    async def eliminarMaquinaria(self, id: int, forzar: bool = False):
        """Borra una máquina, avisando primero qué se lleva puesto.

        Antes borraba de una y, si alguna fila la apuntaba, reventaba con un error de
        constraint que en pantalla se leía «puede que la base de datos se haya
        desconectado» — culpando a la conexión por un problema de datos. El que
        borraba no tenía ni con qué decidir ni cómo seguir.

        Ahora es el mismo trato que los procesos y los rangos: la primera pasada NO
        borra y contesta 409 con el motivo; con `forzar` sí. Avisar, no bloquear.
        """
        from sqlalchemy import text as _text
        from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException

        logger.info(f"Service - Eliminando Maquinaria id={id} (forzar={forzar})")
        db = self.repository.db

        maq = await self.repository.find_by_id(id)
        if not maq:
            return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

        procesos = (await db.execute(_text(
            "SELECT COUNT(*) FROM proceso_maquinaria WHERE id_maquinaria = :m"), {"m": id})).scalar() or 0
        rangos = (await db.execute(_text(
            "SELECT COUNT(*) FROM rango_maquinaria WHERE id_maquinaria = :m"), {"m": id})).scalar() or 0
        # Las preselecciones son lo más caro: alguien eligió a mano esta máquina para
        # un paso de una OT, y eso se pierde sin dejar rastro.
        pasos = (await db.execute(_text(
            "SELECT COUNT(*) FROM orden_trabajo_proceso WHERE id_maquinaria = :m"), {"m": id})).scalar() or 0

        if (procesos or rangos or pasos) and not forzar:
            partes = []
            if pasos:
                partes.append(f"{pasos} {'paso' if pasos == 1 else 'pasos'} de órdenes "
                              f"{'la tiene' if pasos == 1 else 'la tienen'} elegida a mano")
            if procesos:
                partes.append(f"{procesos} {'trabajo' if procesos == 1 else 'trabajos'} se "
                              f"{'hace' if procesos == 1 else 'hacen'} en ella")
            if rangos:
                partes.append(f"{rangos} {'categoría' if rangos == 1 else 'categorías'} "
                              f"{'la puede' if rangos == 1 else 'la pueden'} usar")
            raise ConfirmacionRequeridaException(
                f"«{maq.nombre}» está en uso: " + ", ".join(partes) +
                ". Si la eliminás, esos pasos quedan sin máquina y el planificador "
                "les va a buscar otra."
            )

        try:
            # Qué pasos quedan sin su máquina elegida, anotado ANTES de blanquearlos:
            # después ya no hay a quién preguntarle cuál tenían. Va a mano porque esto
            # es un UPDATE masivo en SQL crudo y la auditoría de procesos se engancha
            # al ORM. Ver infrastructure/auditoria_procesos.py.
            con_esta_maquina = await auditoria_proc.leer_pasadas(
                db, "id_maquinaria = :m", {"m": id}
            )
            await auditoria_proc.anotar(
                db, con_esta_maquina, "edicion", nuevos={"id_maquinaria": None},
                origen="Al borrar una máquina",
            )

            # A mano y en la misma transacción: `orden_trabajo_proceso.id_maquinaria`
            # es NO ACTION, así que sin esto el borrado revienta con un error de
            # constraint. Las otras dos son CASCADE y se van solas.
            await db.execute(_text(
                "UPDATE orden_trabajo_proceso SET id_maquinaria = NULL WHERE id_maquinaria = :m"), {"m": id})
            # Ver el comentario del mismo `expire_all` en OperarioService: sin esto
            # SQLAlchemy intenta blanquear la FK de las filas hijas que ya borramos.
            db.expire_all()
            ok = await self.repository.delete(id)
            if not ok:
                return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.error(f"Service - Error al eliminar Maquinaria: {e}")
            raise InfrastructureException("Error al eliminar la Maquinaria.") from e

        aviso = (f"{pasos} {'paso quedó' if pasos == 1 else 'pasos quedaron'} sin máquina elegida."
                 if pasos else "")
        return ResponseDTO(status=True, data={"deleted": id, "aviso": aviso}, errorDescription="")

    # Listar Maquinarias
    async def listarMaquinarias(self):
        try:
            logger.info("Service - Listar Maquinarias.")
            maquinarias = await self.repository.find_all()

            data = [
                {
                    "id": m.id,
                    "nombre": m.nombre,
                    "cod_maquina": m.cod_maquina,
                    "limitacion": m.limitacion,
                    "capacidad": m.capacidad,
                    "especialidad": m.especialidad,
                }
                for m in maquinarias
            ]

            return ResponseDTO(status=True, data=data, errorDescription="")
        except Exception as e:
            logger.error(f"Service - Error al listar Maquinarias: {e}")
            raise InfrastructureException("Error al listar Maquinarias.") from e

    # Obtener Maquinaria por ID
    async def obtenerMaquinariaPorId(self, id: int):
        try:
            logger.info(f"Service - Obtener Maquinaria id={id}")
            m = await self.repository.find_by_id(id)

            if not m:
                return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

            return ResponseDTO(
                status=True,
                data={
                    "id": m.id,
                    "nombre": m.nombre,
                    "cod_maquina": m.cod_maquina,
                    "limitacion": m.limitacion,
                    "capacidad": m.capacidad,
                    "especialidad": m.especialidad,
                },
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al obtener Maquinaria: {e}")
            raise InfrastructureException("Error al obtener la Maquinaria.") from e

    # Modificar Maquinaria
    async def modificarMaquinaria(self, id: int, maquinaria_dto: MaquinariaRequestDTO):
        try:
            nueva_data = maquinaria_dto.dict(exclude_unset=True)
            actualizado = await self.repository.update(id, nueva_data)

            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

            return ResponseDTO(
                status=True,
                data={"id": actualizado.id},
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al actualizar Maquinaria: {e}")
            raise InfrastructureException("Error al actualizar la Maquinaria.") from e
