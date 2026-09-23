from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from backend.application.OperarioService import OperarioService
from backend.dto.OperarioRequestDTO import OperarioRequestDTO
from backend.dto.ProcesoSkillDTO import ProcesoSkillUpdateDTO, ProcesoSkillDTO
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from backend.infrastructure import historial_cambios

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para sesión asincrónica
async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 POST /operarios
@router.post("/operarios")
async def crear_operario(operario_dto: OperarioRequestDTO, request: Request, db=Depends(get_db)):
    """Endpoint para crear un Operario (POST /operarios)."""
    try:
        service = OperarioService(db)
        result = await service.crearOperario(operario_dto)
        # RF-17: el alta no lleva el número en la dirección; sin esto la fila de
        # Auditoría no se puede atar a la persona (historial_cambios.dejar_dicho_alta).
        nombre = " ".join(x for x in (operario_dto.nombre, operario_dto.apellido) if x).strip()
        historial_cambios.dejar_dicho_alta(
            request, id_entidad=historial_cambios.id_de_respuesta(result),
            frase=f"dio de alta a {nombre}" if nombre else None)
        return result
    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 DELETE /operarios/{id}
@router.delete("/operarios/{id}")
async def eliminar_operario(id: int, request: Request, forzar: bool = False, db=Depends(get_db)):
    """Borra una persona.

    Si tiene categorías, habilidades o pasos elegidos a mano, sin `forzar` responde
    409 con el motivo en vez de borrar; con `forzar=true` la borra igual. Mismo
    contrato que DELETE /procesos/{id}.
    """
    logger.info(f"API - Inicio DELETE /operarios/{id} (forzar={forzar})")
    # RF-17: quién era, leído ANTES de borrarla. Después la fila ya no está y el
    # historial de la persona dada de baja no tendría cómo nombrarla. Nunca frena el
    # borrado (historial_cambios.quien_era_sin_romper).
    antes = await historial_cambios.quien_era_sin_romper(db, id)
    service = OperarioService(db)
    resultado = await service.eliminarOperario(id, forzar=forzar)
    if getattr(resultado, "status", False):
        historial_cambios.dejar_dicho_baja(request, id, antes)
    return resultado


# 🔹 GET /operarios
@router.get("/operarios")
async def listar_operarios(db=Depends(get_db)):
    try:
        logger.info("API - Inicio GET /operarios")
        service = OperarioService(db)
        return await service.listarOperarios()
    except InfrastructureException as e:
        logger.error(f"API - Error al listar operarios: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 GET /operarios/{id}
@router.get("/operarios/{id}")
async def obtener_operario(id: int, db=Depends(get_db)):
    try:
        logger.info(f"API - Inicio GET /operarios/{id}")
        service = OperarioService(db)
        return await service.obtenerOperarioPorId(id)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 PUT /operarios/{id}
#    Con el usuario del token: si el guardado lo pasa de Activo a Ausente (o al revés),
#    queda anotado quién y cuándo en su asistencia (RF-06).
@router.put("/operarios/{id}")
async def modificar_operario(id: int, operario_dto: OperarioRequestDTO, request: Request,
                             db=Depends(get_db), usuario: dict = Depends(get_current_user)):
    try:
        logger.info(f"API - Inicio PUT /operarios/{id}")
        # RF-17: la ficha antes y después (rangos y habilidades incluidos), para que
        # Auditoría diga QUÉ cambió. Nunca frena el guardado (historial_cambios.py).
        antes = await historial_cambios.foto_de_persona_sin_romper(db, id)
        service = OperarioService(db)
        resultado = await service.modificarOperario(id, operario_dto, usuario=usuario)
        await historial_cambios.dejar_dicho_cambios_de_persona(request, db, id, antes)
        return resultado
    except BusinessException as e:
        # Aviso para el usuario (ej. la skill ya está cargada como nativa), no un error.
        raise HTTPException(status_code=422, detail=str(e))
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🔹 Registrar rutas
app.include_router(router)

# 🔹 PUT /operarios/{id}/skills/{id_proceso}/estado
@router.put("/operarios/{id}/skills/{id_proceso}/estado")
async def actualizar_estado_skill(id: int, id_proceso: int, dto: ProcesoSkillUpdateDTO, db=Depends(get_db)):
    try:
        service = OperarioService(db)
        return await service.actualizarEstadoSkill(id, id_proceso, dto.habilitado)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 PUT /operarios/{id}/skills-nativas/{id_proceso}/estado
@router.put("/operarios/{id}/skills-nativas/{id_proceso}/estado")
async def actualizar_estado_skill_nativa(id: int, id_proceso: int, dto: ProcesoSkillUpdateDTO, db=Depends(get_db)):
    try:
        service = OperarioService(db)
        return await service.actualizarEstadoSkillNativa(id, id_proceso, dto.habilitado)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 POST /operarios/{id}/skills — define la PRIORIDAD de una skill nativa
#    (nivel 1 = SKILL 1, 2 = SKILL 2, 0 = sin marcar). No da de alta habilidades:
#    el conjunto lo fijan los rangos del operario.
@router.post("/operarios/{id}/skills")
async def agregar_skill(id: int, dto: ProcesoSkillDTO, db=Depends(get_db)):
    try:
        service = OperarioService(db)
        return await service.agregarSkill(id, dto)
    except BusinessException as e:
        raise HTTPException(status_code=422, detail=str(e))
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🔹 DELETE /operarios/{id}/skills/{id_proceso}
@router.delete("/operarios/{id}/skills/{id_proceso}")
async def eliminar_skill(id: int, id_proceso: int, db=Depends(get_db)):
    try:
        service = OperarioService(db)
        return await service.eliminarSkill(id, id_proceso)
    except InfrastructureException as e:
        raise HTTPException(status_code=500, detail=str(e))
