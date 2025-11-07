from fastapi import FastAPI, APIRouter, HTTPException, Depends, Query
from backend.application.NotificacionService import NotificacionService
from backend.dto.NotificacionRequestDTO import NotificacionCreateDTO, NotificacionUpdateDTO
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Optional

security_optional = HTTPBearer(auto_error=False)

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para sesión asincrónica
async def get_db():
    async with SessionLocal() as session:
        yield session


# Función auxiliar para obtener usuario opcional
async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional)
) -> Optional[dict]:
    """Obtiene el usuario actual si hay token, sino retorna None"""
    if not credentials:
        return None
    try:
        return get_current_user(credentials)
    except:
        return None

# 🔹 POST /notificaciones
@router.post("/notificaciones")
async def crear_notificacion(
    notificacion_dto: NotificacionCreateDTO,
    db=Depends(get_db),
    current_user: Optional[dict] = Depends(get_optional_user)
):
    """Endpoint para crear una Notificación (POST /notificaciones)."""
    try:
        # Asignar el usuario actual si no se especifica
        if not notificacion_dto.id_usuario_creador and current_user:
            notificacion_dto.id_usuario_creador = current_user.get("id_usuario")
        
        service = NotificacionService(db)
        result = await service.crearNotificacion(notificacion_dto)
        return result
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
    db=Depends(get_db)
):
    """Endpoint para listar todas las notificaciones."""
    try:
        logger.info("API - Inicio GET /notificaciones")
        service = NotificacionService(db)
        return await service.listarNotificaciones(limit=limit, offset=offset, solo_no_leidas=solo_no_leidas)
    except InfrastructureException as e:
        logger.error(f"API - Error al listar notificaciones: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al listar notificaciones: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /notificaciones/{id}
@router.get("/notificaciones/{id}")
async def obtener_notificacion(id: int, db=Depends(get_db)):
    """Endpoint para obtener una notificación por ID."""
    try:
        logger.info(f"API - Inicio GET /notificaciones/{id}")
        service = NotificacionService(db)
        return await service.obtenerNotificacionPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al obtener notificación: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 PUT /notificaciones/{id}/leida
@router.put("/notificaciones/{id}/leida")
async def marcar_como_leida(id: int, db=Depends(get_db)):
    """Endpoint para marcar una notificación como leída."""
    try:
        logger.info(f"API - Inicio PUT /notificaciones/{id}/leida")
        service = NotificacionService(db)
        return await service.marcarComoLeida(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al marcar como leída: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 PUT /notificaciones/leer-todas
@router.put("/notificaciones/leer-todas")
async def marcar_todas_como_leidas(db=Depends(get_db)):
    """Endpoint para marcar todas las notificaciones como leídas."""
    try:
        logger.info("API - Inicio PUT /notificaciones/leer-todas")
        service = NotificacionService(db)
        return await service.marcarTodasComoLeidas()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al marcar todas como leídas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /notificaciones/contador/no-leidas
@router.get("/notificaciones/contador/no-leidas")
async def contar_no_leidas(db=Depends(get_db)):
    """Endpoint para obtener el contador de notificaciones no leídas."""
    try:
        logger.info("API - Inicio GET /notificaciones/contador/no-leidas")
        service = NotificacionService(db)
        return await service.contarNoLeidas()
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"API - Error inesperado al contar no leídas: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 DELETE /notificaciones/{id}
@router.delete("/notificaciones/{id}")
async def eliminar_notificacion(id: int, db=Depends(get_db)):
    """Endpoint para eliminar una notificación."""
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
    """Endpoint para eliminar todas las notificaciones."""
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

