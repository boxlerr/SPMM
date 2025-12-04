from fastapi import APIRouter, Depends, UploadFile, File, Form
from backend.infrastructure.db import SessionLocal
from backend.application.PlanoService import PlanoService
from backend.dto.PlanoRequestDTO import PlanoRequestDTO
from backend.commons.loggers.logger import logger

router = APIRouter()

# Dependencia para obtener la sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session


# 🔹 Crear Plano
@router.post("/planos")
async def crear_plano(
    nombre: str = Form(...),
    descripcion: str = Form(None),
    tipo_archivo: str = Form(...),
    id_orden_trabajo: int = Form(...),
    archivo: UploadFile = File(...),
    db=Depends(get_db)
):
    logger.info("API - Inicio POST /planos")

    contenido = await archivo.read()

    dto = PlanoRequestDTO(
        nombre=nombre,
        descripcion=descripcion,
        tipo_archivo=tipo_archivo,
        archivo=contenido,
        id_orden_trabajo=id_orden_trabajo
    )

    service = PlanoService(db)
    result = await service.crearPlano(dto)
    return result


# 🔹 Obtener plano por ID
@router.get("/planos/{id}")
async def obtener_plano(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /planos/{id}")
    service = PlanoService(db)
    return await service.obtenerPlanoPorId(id)


# 🔹 Listar planos por Orden de Trabajo
@router.get("/planos/orden/{id_orden}")
async def obtener_planos_por_orden(id_orden: int, db=Depends(get_db)):
    logger.info(f"API - Inicio GET /planos/orden/{id_orden}")
    service = PlanoService(db)
    return await service.obtenerPlanosPorOrdenTrabajo(id_orden)


# 🔹 Modificar plano (incluye reemplazar archivo)
@router.put("/planos/{id}")
async def modificar_plano(
    id: int,
    nombre: str = Form(...),
    descripcion: str = Form(None),
    tipo_archivo: str = Form(...),
    archivo: UploadFile = File(...),
    db=Depends(get_db)
):
    logger.info(f"API - Inicio PUT /planos/{id}")

    contenido = await archivo.read()

    dto = PlanoRequestDTO(
        nombre=nombre,
        descripcion=descripcion,
        tipo_archivo=tipo_archivo,
        archivo=contenido,
        id_orden_trabajo=0  # no cambia
    )

    service = PlanoService(db)
    return await service.modificarPlano(id, dto)


# 🔹 Eliminar Plano
@router.delete("/planos/{id}")
async def eliminar_plano(id: int, db=Depends(get_db)):
    logger.info(f"API - Inicio DELETE /planos/{id}")
    service = PlanoService(db)
    return await service.eliminarPlano(id)
