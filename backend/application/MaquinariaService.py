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


# ─────────────────────────── RF-08: las listas cerradas ───────────────────────────
#
# La clave es lo que se guarda en la base; el valor, cómo se lee en pantalla. El front
# ofrece exactamente las mismas claves (frontend/src/app/recursos/_maquinaOpciones.ts) y
# un test compara las dos listas: si alguien agrega un tipo de un lado y no del otro,
# se pone rojo antes de que la pantalla ofrezca algo que el backend rechaza.

# Qué clase de máquina es. Son las familias con las que el planificador clasifica
# máquinas y procesos (familia_requerida_from_proceso en PlanificacionService.py), más
# OTRO: así el día que se quiera cruzar el tipo cargado contra la familia que pide un
# proceso, los dos lados hablan el mismo idioma. Otro test cuida que toda familia del
# planificador esté acá.
TIPOS_MAQUINA: dict[str, str] = {
    "TORNO": "Torno",
    "FRESADORA": "Fresadora",
    "AGUJEREADORA": "Agujereadora",
    "LIMADORA": "Limadora",
    "RECTIFICADORA": "Rectificadora",
    "GUILLOTINA": "Guillotina",
    "PRENSA": "Prensa",
    "PLEGADORA": "Plegadora",
    "SIERRA_CIRCULAR": "Sierra circular",
    "OXICORTE": "Oxicorte",
    "SOLDADORA_TIG": "Soldadora TIG",
    "SOLDADORA_MIG": "Soldadora MIG/MAG",
    "OTRO": "Otro",
}

# Si la máquina está para trabajar. Por ahora es INFORMATIVO: el planificador no lo mira
# (ver el comentario de la columna en domain/Maquinaria.py).
ESTADOS_OPERATIVOS: dict[str, str] = {
    "operativa": "Operativa",
    "en_mantenimiento": "En mantenimiento",
    "fuera_de_servicio": "Fuera de servicio",
}
ESTADO_POR_DEFECTO = "operativa"

# Tope de la frecuencia de mantenimiento: diez años. Más que eso es un error de tipeo
# (un 3650 que quiso ser 365), no una frecuencia.
FRECUENCIA_MAXIMA_DIAS = 3650


def _clave(valor: str) -> str:
    """'En mantenimiento ' → 'en_mantenimiento'. Lo que la gente tipea, a la clave."""
    return "_".join(str(valor).strip().split())


def validar_tipo(valor: str | None) -> str | None:
    """Vacío pasa (es «sin cargar»); un tipo que no está en la lista, no."""
    if valor is None or str(valor).strip() == "":
        return None
    limpio = _clave(valor).upper()
    if limpio not in TIPOS_MAQUINA:
        raise BusinessException(
            f"«{valor}» no es un tipo de máquina válido. Los posibles son: "
            + ", ".join(TIPOS_MAQUINA.values()) + "."
        )
    return limpio


def validar_estado(valor: str | None) -> str | None:
    """None = no vino (el que llama decide qué hacer); un valor fuera de la lista, 422."""
    if valor is None:
        return None
    limpio = _clave(valor).lower()
    if limpio not in ESTADOS_OPERATIVOS:
        raise BusinessException(
            f"«{valor}» no es un estado válido. Los posibles son: "
            + ", ".join(ESTADOS_OPERATIVOS.values()) + "."
        )
    return limpio


def validar_frecuencia(valor: int | None) -> int | None:
    """Días entre mantenimientos. None = no se lleva; 0 o negativo no es una frecuencia."""
    if valor is None:
        return None
    if valor < 1 or valor > FRECUENCIA_MAXIMA_DIAS:
        raise BusinessException(
            f"La frecuencia de mantenimiento tiene que ser de 1 a {FRECUENCIA_MAXIMA_DIAS} "
            "días. Si a esta máquina no se le lleva, dejala vacía."
        )
    return valor


def maquinaria_a_dict(m: Maquinaria) -> dict:
    """Lo que el front recibe de una máquina.

    UN solo lugar: antes el alta, el listado y el detalle armaban cada uno su dict a
    mano, y un campo nuevo que se olvidaba en uno quedaba invisible en esa pantalla.
    """
    return {
        "id": m.id,
        "nombre": m.nombre,
        "cod_maquina": m.cod_maquina,
        "limitacion": m.limitacion,
        "capacidad": m.capacidad,
        "especialidad": m.especialidad,
        "tipo": m.tipo,
        # `or` por si una fila viene sin el valor (no debería: la columna es NOT NULL).
        "estado_operativo": m.estado_operativo or ESTADO_POR_DEFECTO,
        "frecuencia_mantenimiento_dias": m.frecuencia_mantenimiento_dias,
    }


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
                tipo=validar_tipo(maquinaria_dto.tipo),
                # Un front viejo no manda el estado: la máquina nueva nace operativa,
                # igual que las que ya estaban cargadas.
                estado_operativo=validar_estado(maquinaria_dto.estado_operativo) or ESTADO_POR_DEFECTO,
                frecuencia_mantenimiento_dias=validar_frecuencia(
                    maquinaria_dto.frecuencia_mantenimiento_dias
                ),
            )

            maquinaria_creada = await self.repository.save(maquinaria)

            return ResponseDTO(
                status=True,
                data=jsonable_encoder(maquinaria_a_dict(maquinaria_creada)),
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

            data = [maquinaria_a_dict(m) for m in maquinarias]

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
                data=maquinaria_a_dict(m),
                errorDescription=""
            )
        except Exception as e:
            logger.error(f"Service - Error al obtener Maquinaria: {e}")
            raise InfrastructureException("Error al obtener la Maquinaria.") from e

    # Modificar Maquinaria
    async def modificarMaquinaria(self, id: int, maquinaria_dto: MaquinariaRequestDTO):
        try:
            # `exclude_unset`: sólo se toca lo que VINO en el cuerpo. Es lo que deja que un
            # front viejo —que no conoce tipo, estado ni frecuencia— edite el nombre sin
            # borrarle a la máquina lo que otro cargó desde el front nuevo.
            nueva_data = maquinaria_dto.dict(exclude_unset=True)

            if "tipo" in nueva_data:
                nueva_data["tipo"] = validar_tipo(nueva_data["tipo"])
            if "estado_operativo" in nueva_data:
                estado = validar_estado(nueva_data["estado_operativo"])
                if estado is None:
                    # null no es un estado: la columna es NOT NULL y guardarlo tiraría un
                    # 500. Se lee como «no lo cambio», no como «vacialo».
                    nueva_data.pop("estado_operativo")
                else:
                    nueva_data["estado_operativo"] = estado
            if "frecuencia_mantenimiento_dias" in nueva_data:
                # Acá None SÍ es un valor: «a esta máquina ya no se le lleva frecuencia».
                nueva_data["frecuencia_mantenimiento_dias"] = validar_frecuencia(
                    nueva_data["frecuencia_mantenimiento_dias"]
                )

            actualizado = await self.repository.update(id, nueva_data)

            if not actualizado:
                return ResponseDTO(status=False, data={}, errorDescription="Maquinaria no encontrada")

            # La máquina entera y no sólo el id: el front la usa para dejar la fila como
            # quedó guardada (con el tipo y el estado ya normalizados) sin volver a pedir
            # la lista. Sigue trayendo `id`, que es lo único que leía el front viejo.
            return ResponseDTO(
                status=True,
                data=maquinaria_a_dict(actualizado),
                errorDescription=""
            )
        except BusinessException:
            # Un estado o un tipo fuera de la lista es un 422 con el motivo, no un 500
            # que diga «error al actualizar».
            raise
        except Exception as e:
            logger.error(f"Service - Error al actualizar Maquinaria: {e}")
            raise InfrastructureException("Error al actualizar la Maquinaria.") from e
