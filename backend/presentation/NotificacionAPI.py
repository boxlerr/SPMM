from fastapi import FastAPI, APIRouter, HTTPException, Depends, Query
from backend.application.NotificacionService import NotificacionService
from backend.dto.NotificacionRequestDTO import NotificacionCreateDTO, NotificacionUpdateDTO
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger
from backend.core.security import (
    UsuarioActual,
    get_sesiones_permisos,
    get_usuario_actual,
    resolver_permisos_actuales,
)

app = FastAPI()
router = APIRouter()

# ─────────────────────────── quién ve y quién toca qué (RF-24) ───────────────────────────
#
# La campanita es UNA para todo el taller (no hay avisos «para» alguien, y leída es
# leída para todos). Lo que pide cada ruta está en el mapa (core/permisos_rutas.py,
# «notificaciones»): leer y marcar como leída, cualquiera con cuenta activa; crear,
# quien edita personas en Recursos (los únicos avisos que arma la pantalla son esos);
# borrar, sólo el admin.
#
# Acá, dos cosas que el mapa no puede decir solo (revisión del 23/09):
#   · Los avisos de «Usuarios y permisos» («Usuario 'x' (Nombre Apellido) fue creado»)
#     son de una sección confidencial: quien no la ve, no los ve —ni en la lista, ni en
#     el contador, ni por id— ni los puede marcar como leídos. Hasta el 23/09 un operario
#     sin ningún permiso los leía todos.
#   · Quién firma un aviso lo dice la sesión, no el cuerpo: `id_usuario_creador` venía
#     del pedido y cualquiera firmaba avisos a nombre de un admin.


async def _oculta_avisos_de_usuarios(
    usuario: UsuarioActual = Depends(get_usuario_actual),
    sesiones=Depends(get_sesiones_permisos),
) -> bool:
    """True si quien pide NO ve la sección «Usuarios y permisos». Si sus permisos no se
    pueden leer, también True: lo confidencial no se abre sin verificar (y la campanita
    sigue andando con el resto)."""
    if usuario.es_admin:
        return False
    try:
        permisos = await resolver_permisos_actuales(usuario, sesiones)
    except HTTPException:
        return True
    return not permisos.tiene_seccion("configuracion_usuarios")


# Los avisos que puede armar la pantalla: los de Recursos › Recurso humano (alta, cambio
# y baja de una persona). Todo lo demás lo escribe el sistema (el alta de un usuario, la
# OT retrasada, el stock bajo...) y no se puede fabricar desde afuera.
PREFIJO_AVISOS_DE_LA_PANTALLA = "operario_"


# 🔹 Dependencia para sesión asincrónica
async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 POST /notificaciones
@router.post("/notificaciones")
async def crear_notificacion(
    notificacion_dto: NotificacionCreateDTO,
    db=Depends(get_db),
    usuario: UsuarioActual = Depends(get_usuario_actual),
):
    """Endpoint para crear una Notificación (POST /notificaciones).

    La firma quien hace el pedido, según la base: el `id_usuario_creador` del cuerpo no
    se usa. Y sólo se pueden crear los avisos de la pantalla (operario_*)."""
    try:
        if not (notificacion_dto.tipo or "").startswith(PREFIJO_AVISOS_DE_LA_PANTALLA):
            raise HTTPException(
                status_code=422,
                detail={"message": "Ese tipo de aviso lo escribe el sistema, no se puede crear a mano.",
                        "campo": "tipo"},
            )
        notificacion_dto.id_usuario_creador = usuario.id_usuario

        service = NotificacionService(db)
        result = await service.crearNotificacion(notificacion_dto)
        return result
    except HTTPException:
        raise
    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al crear notificación: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /notificaciones
@router.get("/notificaciones")
async def listar_notificaciones(
    limit: int = Query(None, description="Límite de resultados"),
    offset: int = Query(None, description="Offset para paginación"),
    solo_no_leidas: bool = Query(False, description="Solo mostrar no leídas"),
    db=Depends(get_db),
    ocultar: bool = Depends(_oculta_avisos_de_usuarios),
):
    """Endpoint para listar todas las notificaciones (las que ve quien pide)."""
    try:
        logger.info("API - Inicio GET /notificaciones")
        service = NotificacionService(db)
        return await service.listarNotificaciones(limit=limit, offset=offset, solo_no_leidas=solo_no_leidas,
                                                  ocultar_avisos_de_usuarios=ocultar)
    except InfrastructureException as e:
        logger.error(f"API - Error al listar notificaciones: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al listar notificaciones: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /notificaciones/{id}
@router.get("/notificaciones/{id}")
async def obtener_notificacion(id: int, db=Depends(get_db),
                               ocultar: bool = Depends(_oculta_avisos_de_usuarios)):
    """Endpoint para obtener una notificación por ID."""
    try:
        logger.info(f"API - Inicio GET /notificaciones/{id}")
        service = NotificacionService(db)
        return await service.obtenerNotificacionPorId(id, ocultar)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al obtener notificación: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 PUT /notificaciones/{id}/leida
@router.put("/notificaciones/{id}/leida")
async def marcar_como_leida(id: int, db=Depends(get_db),
                            ocultar: bool = Depends(_oculta_avisos_de_usuarios)):
    """Endpoint para marcar una notificación como leída."""
    try:
        logger.info(f"API - Inicio PUT /notificaciones/{id}/leida")
        service = NotificacionService(db)
        return await service.marcarComoLeida(id, ocultar)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al marcar como leída: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 PUT /notificaciones/leer-todas
@router.put("/notificaciones/leer-todas")
async def marcar_todas_como_leidas(db=Depends(get_db),
                                   ocultar: bool = Depends(_oculta_avisos_de_usuarios)):
    """Endpoint para marcar todas las notificaciones como leídas (las que ve quien pide)."""
    try:
        logger.info("API - Inicio PUT /notificaciones/leer-todas")
        service = NotificacionService(db)
        return await service.marcarTodasComoLeidas(ocultar)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al marcar todas como leídas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /notificaciones/contador/no-leidas
@router.get("/notificaciones/contador/no-leidas")
async def contar_no_leidas(db=Depends(get_db),
                           ocultar: bool = Depends(_oculta_avisos_de_usuarios)):
    """Endpoint para obtener el contador de notificaciones no leídas (de las que ve)."""
    try:
        logger.info("API - Inicio GET /notificaciones/contador/no-leidas")
        service = NotificacionService(db)
        return await service.contarNoLeidas(ocultar)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al contar no leídas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 DELETE /notificaciones/{id}
@router.delete("/notificaciones/{id}")
async def eliminar_notificacion(id: int, db=Depends(get_db)):
    """Endpoint para eliminar una notificación. Sólo el admin (el mapa): la campanita es
    de todo el taller."""
    try:
        logger.info(f"API - Inicio DELETE /notificaciones/{id}")
        service = NotificacionService(db)
        result = await service.eliminarNotificacion(id)

        if not result.status:
            return ResponseDTO(status=False, data={}, errorDescription="Notificacion no encontrada")

        return ResponseDTO(status=True, data={"deleted": id})

    except InfrastructureException as e:
        logger.error(f"API - Error al eliminar notificación: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al eliminar notificación: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 DELETE /notificaciones
@router.delete("/notificaciones")
async def eliminar_todas_las_notificaciones(db=Depends(get_db)):
    """Endpoint para eliminar todas las notificaciones. Sólo el admin (el mapa): vacía la
    campanita de todo el taller, no la de quien lo pide."""
    try:
        logger.info("API - Inicio DELETE /notificaciones")
        service = NotificacionService(db)
        return await service.eliminarTodas()
    except InfrastructureException as e:
        logger.error(f"API - Error al eliminar todas las notificaciones: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al eliminar todas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 Registrar rutas
app.include_router(router)

