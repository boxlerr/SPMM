from sqlalchemy import update, select

from backend.domain.Rango import Rango
from backend.domain.Operario import Operario
from backend.dto.RangoRequestDTO import RangoRequestDTO
from backend.infrastructure.RangoRepository import RangoRepository
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.NotFoundException import NotFoundException
from fastapi.encoders import jsonable_encoder
from backend.commons.loggers.logger import logger


class RangoService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = RangoRepository(db_session)

    async def crearRango(self, rango_dto: RangoRequestDTO):
        try:
            logger.info("Service - Crear rango.")
            nombre = (rango_dto.nombre or "").strip()
            if not nombre:
                raise BusinessException("El nombre del Rango es obligatorio.")

            rango = Rango(nombre=nombre)
            rango_creado = await self.repository.save(rango)
            return ResponseDTO(status=True, data=jsonable_encoder(rango_creado))
        except (InfrastructureException, BusinessException):
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear el Rango.") from e

    async def listarRangos(self):
        logger.info("Service - Listar rangos.")
        rangos = await self.repository.find_all()
        return ResponseDTO(status=True, data=jsonable_encoder(rangos))

    async def listarProcesosPorRango(self):
        """Mapa {id_rango: [id_proceso, ...]} para derivar las SKILLS NATIVAS en la UI."""
        logger.info("Service - Listar procesos por rango.")
        mapa = await self.repository.find_procesos_por_rango()
        return ResponseDTO(status=True, data=mapa)

    async def listarMaquinariasPorRango(self):
        """Mapa {id_rango: [id_maquinaria, ...]}."""
        logger.info("Service - Listar maquinarias por rango.")
        mapa = await self.repository.find_maquinarias_por_rango()
        return ResponseDTO(status=True, data=mapa)

    async def obtenerCobertura(self):
        """Cobertura rango ↔ maquinaria, para mostrar los huecos en Recursos."""
        try:
            logger.info("Service - Cobertura de rangos.")
            data = await self.repository.find_cobertura()
            return ResponseDTO(status=True, data=jsonable_encoder(data))
        except InfrastructureException as e:
            logger.error(f"Service - Error de infraestructura en cobertura: {e}")
            raise ApplicationException("No se pudo calcular la cobertura de rangos.") from e

    async def modificarRangosDeMaquinaria(self, id_maquinaria: int, ids_rango: list[int]):
        """Qué rangos habilitan una máquina, editado desde la máquina."""
        try:
            from backend.domain.Rango import Rango as _R
            await self._validar_ids(_R, ids_rango, "rango")
            await self.repository.set_rangos_de_maquinaria(id_maquinaria, ids_rango)
            return ResponseDTO(status=True, data={"id_maquinaria": id_maquinaria, "rangos": ids_rango})
        except (BusinessException, NotFoundException):
            raise
        except InfrastructureException as e:
            logger.error(f"Service - Error al actualizar rangos de la maquinaria: {e}")
            raise ApplicationException("No se pudieron actualizar los rangos de la maquinaria.") from e

    async def modificarRangosDeProceso(self, id_proceso: int, ids_rango: list[int]):
        """Qué rangos habilitan un proceso, editado desde el proceso."""
        try:
            from backend.domain.Rango import Rango as _R
            await self._validar_ids(_R, ids_rango, "rango")
            await self.repository.set_rangos_de_proceso(id_proceso, ids_rango)
            return ResponseDTO(status=True, data={"id_proceso": id_proceso, "rangos": ids_rango})
        except (BusinessException, NotFoundException):
            raise
        except InfrastructureException as e:
            logger.error(f"Service - Error al actualizar rangos del proceso: {e}")
            raise ApplicationException("No se pudieron actualizar los rangos del proceso.") from e

    async def obtenerDetalleRango(self, id: int):
        """Rango + sus procesos y maquinarias + cuántos operarios lo tienen."""
        logger.info(f"Service - Detalle del rango ID: {id}")
        rango = await self.repository.find_by_id(id)
        if not rango:
            raise NotFoundException(f"No se encontró el rango con ID {id}")

        detalle = await self.repository.find_detalle(id)
        return ResponseDTO(
            status=True,
            data={"id": rango.id, "nombre": rango.nombre, **detalle},
        )

    async def _validar_ids(self, modelo, ids: list[int], etiqueta: str):
        """
        Corta con un error de negocio si alguno de los IDs no existe.

        Sin esto el fallo sale como violación de FK, que llega al usuario como un 500
        ilegible en vez de decirle cuál de los que eligió no está.
        """
        if not ids:
            return
        existentes = set(
            (await self.db.execute(select(modelo.id).where(modelo.id.in_(ids)))).scalars().all()
        )
        faltantes = [i for i in dict.fromkeys(ids) if i not in existentes]
        if faltantes:
            raise BusinessException(
                f"Estos {etiqueta} no existen: {', '.join(str(i) for i in faltantes)}."
            )

    async def modificarProcesosRango(self, id: int, ids_proceso: list[int]):
        """
        Reemplaza los procesos que habilita el rango.

        Es la operación de mayor alcance del módulo: cambia qué puede hacer TODA la gente
        que tiene el rango, no un operario. Por eso la respuesta devuelve el detalle
        completo recalculado, para que la UI muestre en el acto a cuántos alcanzó.
        """
        from backend.domain.Proceso import Proceso

        logger.info(f"Service - Modificar procesos del rango ID: {id}")
        rango = await self.repository.find_by_id(id)
        if not rango:
            raise NotFoundException(f"No se encontró el rango con ID {id}")

        await self._validar_ids(Proceso, ids_proceso, "procesos")
        await self.repository.set_procesos(id, ids_proceso)

        detalle = await self.repository.find_detalle(id)
        return ResponseDTO(
            status=True,
            data={"id": rango.id, "nombre": rango.nombre, **detalle},
        )

    async def modificarMaquinariasRango(self, id: int, ids_maquinaria: list[int]):
        """Reemplaza las maquinarias del rango. Mismo alcance que modificarProcesosRango."""
        from backend.domain.Maquinaria import Maquinaria

        logger.info(f"Service - Modificar maquinarias del rango ID: {id}")
        rango = await self.repository.find_by_id(id)
        if not rango:
            raise NotFoundException(f"No se encontró el rango con ID {id}")

        await self._validar_ids(Maquinaria, ids_maquinaria, "maquinarias")
        await self.repository.set_maquinarias(id, ids_maquinaria)

        detalle = await self.repository.find_detalle(id)
        return ResponseDTO(
            status=True,
            data={"id": rango.id, "nombre": rango.nombre, **detalle},
        )

    async def obtenerRangoPorId(self, id: int):
        logger.info(f"Service - Obtener rango ID: {id}")
        rango = await self.repository.find_by_id(id)
        if not rango:
            raise NotFoundException(f"No se encontró el rango con ID {id}")
        return ResponseDTO(status=True, data=jsonable_encoder(rango))

    async def modificarRango(self, id: int, rango_dto: RangoRequestDTO):
        logger.info(f"Service - Modificar rango ID: {id}")
        nombre = (rango_dto.nombre or "").strip()
        if not nombre:
            raise BusinessException("El nombre del Rango es obligatorio.")

        # Capturar el nombre anterior antes de actualizar, para propagar el renombre
        # a los operarios que tenían ese rango como categoría.
        rango_actual = await self.repository.find_by_id(id)
        if not rango_actual:
            raise NotFoundException(f"No se encontró el rango con ID {id}")
        nombre_anterior = rango_actual.nombre

        nueva_data = rango_dto.dict(exclude_unset=True)
        rango_actualizado = await self.repository.update(id, nueva_data)
        if not rango_actualizado:
            raise NotFoundException(f"No se encontró el rango con ID {id}")

        # Si cambió el nombre, actualizar la categoría de los operarios afectados.
        if nombre_anterior and nombre_anterior != rango_actualizado.nombre:
            try:
                await self.db.execute(
                    update(Operario)
                    .where(Operario.categoria == nombre_anterior)
                    .values(categoria=rango_actualizado.nombre)
                )
                await self.db.commit()
                logger.info(
                    f"Service - Operarios con categoria '{nombre_anterior}' "
                    f"actualizados a '{rango_actualizado.nombre}'."
                )
            except Exception as e:
                await self.db.rollback()
                logger.error(f"Service - Error al propagar renombre de rango a operarios: {e}")
                raise ApplicationException(
                    "Error al propagar el nuevo nombre del rango a los operarios."
                ) from e

        return ResponseDTO(status=True, data=jsonable_encoder(rango_actualizado))

    @staticmethod
    def _motivo_del_borrado(nombre_rango: str, detalle: dict) -> str:
        """
        Qué se lleva puesto el borrado, escrito para leerse en un cartel.

        Nombra a la gente y no solo cuánta: "2 operarios" no alcanza para decidir,
        lo que decide es ver que uno de los dos es Leonardo. Se cortan en 5 para que
        el cartel siga siendo un cartel.
        """
        operarios = detalle["operarios"]
        cantidad = len(operarios)
        nombres = [f"{o['nombre']} {o['apellido']}".strip() for o in operarios]
        listados = ", ".join(nombres[:5])
        if cantidad > 5:
            listados += f" y {cantidad - 5} más"

        # Singular/plural a mano: el cartel lo lee el encargado, no un programador.
        tiene = "lo tiene" if cantidad == 1 else "lo tienen"
        pierde = "pierde" if cantidad == 1 else "pierden"
        queda = "queda" if cantidad == 1 else "quedan"
        ficha = "su ficha" if cantidad == 1 else "cada ficha"

        procesos = len(detalle["procesos"])
        que_pierde = (
            f"{pierde} los {procesos} procesos que este rango habilita y {queda} sin esa categoría"
            if procesos > 1
            else f"{pierde} el proceso que este rango habilita y {queda} sin esa categoría"
            if procesos == 1
            else f"{queda} sin esa categoría"
        )

        return (
            f"«{nombre_rango}» {tiene} {cantidad} operario{'' if cantidad == 1 else 's'}: "
            f"{listados}. Si lo eliminás {que_pierde}. "
            f"Las habilidades cargadas a mano en {ficha} no se tocan."
        )

    async def eliminarRango(self, id: int, forzar: bool = False):
        """
        Borra el rango junto con los procesos y maquinarias que tenía asignados.

        Si algún operario lo tiene, la PRIMERA pasada no borra nada: devuelve el
        motivo —quiénes son y qué pierden— para que la pantalla lo muestre. La
        segunda, con `forzar`, borra y se lo saca a esa gente.

        Antes esto cortaba y obligaba a reasignar a mano uno por uno. El pedido fue
        al revés: que diga qué se pierde y deje decidir. Lo que sigue sin poder pasar
        es que pase en silencio, que era lo único importante.
        """
        logger.info(f"Service - Eliminar rango ID: {id} (forzar={forzar})")

        rango = await self.repository.find_by_id(id)
        if not rango:
            raise NotFoundException(f"No se encontró el rango con ID {id}")

        detalle = await self.repository.find_detalle(id)
        en_uso = detalle["operarios_count"]

        if en_uso and not forzar:
            raise ConfirmacionRequeridaException(
                self._motivo_del_borrado(rango.nombre, detalle)
            )

        ok = await self.repository.delete(id, desasignar_operarios=bool(en_uso))
        if not ok:
            raise NotFoundException(f"No se encontró el rango con ID {id}")

        data = {"deleted": id}
        if en_uso:
            # La pantalla lo pega al "eliminado correctamente": lo que se confirmó
            # tiene que verse hecho, no darse por hecho.
            data["aviso"] = (
                f"{en_uso} operario{'' if en_uso == 1 else 's'} "
                f"{'quedó' if en_uso == 1 else 'quedaron'} sin esa categoría."
            )
        return ResponseDTO(status=True, data=data)
