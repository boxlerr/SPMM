
from fastapi import FastAPI, APIRouter,Depends

from backend.application.ProcesoService import ProcesoService
from backend.commons.ResponseDTO import ResponseDTO
from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO
from backend.infrastructure.db import SessionLocal
from backend.commons.loggers.logger import logger

app = FastAPI()
router = APIRouter()

# 🔹 Dependencia para obtener sesión async
async def get_db():
    async with SessionLocal() as session:
        yield session
    
# 🔹 Crear proceso
@router.post("/procesos")
async def crear_proceso(proceso_dto: ProcesoRequestDTO, db=Depends(get_db)):
    logger.info("API Crear proceso- Inicio POST /procesos")
    service = ProcesoService(db)
    result = await service.crearProceso(proceso_dto)
    return result

# 🔹 Listar todos los procesos
@router.get("/procesos")
async def listar_procesos(db=Depends(get_db)):
    logger.info("API - Inicio GET /procesos")
    service = ProcesoService(db)
    return await service.listarProcesos()

# 🔹 Obtener proceso por ID
@router.get("/procesos/{id}")
async def obtener_proceso(id: int, db=Depends(get_db)):
    service = ProcesoService(db)
    return await service.obtenerProcesoPorId(id)

# 🔹 Modificar proceso
@router.put("/procesos/{id}")
async def modificar_proceso(id: int, proceso_dto: ProcesoRequestDTO, db=Depends(get_db)):
    service = ProcesoService(db)
    return await service.modificarProceso(id, proceso_dto)

# 🔹 Quién puede hacer cada proceso
@router.get("/procesos/quien-puede")
async def quien_puede_hacer_cada_proceso(db=Depends(get_db)):
    """{proceso_id: [operario_id]} — quién puede hacer cada proceso, con el MISMO
    criterio que usa el planificador para elegir.

    Es lo que permite que los desplegables de la OT muestren en gris a quien no puede
    hacer ese trabajo, en vez de dejar elegir a cualquiera y que el problema aparezca
    recién al planificar. No bloquea: elegir a alguien igual es una decisión válida —
    si alguien se lesiona, el trabajo lo tiene que hacer otro y el sistema no puede
    ser el que diga que no.

    Elegibilidad = rango del operario × rangos del proceso, más las habilidades
    cargadas a mano, menos las apagadas en la ficha.
    """
    from sqlalchemy import text as _text

    logger.info("API - Inicio GET /procesos/quien-puede")

    # Por rango: el cruce es exacto, igual que en el solver.
    filas = (await db.execute(_text("""
        SELECT rp.id_proceso, orr.id_operario
        FROM rango_proceso rp
        JOIN operario_rango orr ON orr.id_rango = rp.id_rango
        JOIN operario o ON o.id = orr.id_operario
        WHERE o.disponible
    """))).all()
    puede: dict[int, set[int]] = {}
    for id_proceso, id_operario in filas:
        puede.setdefault(id_proceso, set()).add(id_operario)

    # Las cargadas a mano suman; las apagadas restan, incluso si el rango alcanzaba.
    for id_proceso, id_operario, manual, habilitado in (await db.execute(_text("""
        SELECT s.id_proceso, s.id_operario, s.manual, s.habilitado
        FROM operario_proceso_skill s
        JOIN operario o ON o.id = s.id_operario
        WHERE o.disponible
    """))).all():
        if habilitado is False:
            puede.get(id_proceso, set()).discard(id_operario)
        elif manual:
            puede.setdefault(id_proceso, set()).add(id_operario)

    return ResponseDTO(status=True, data={str(k): sorted(v) for k, v in puede.items()})


# 🔹 En qué máquinas se hace este proceso
@router.put("/procesos/{id}/maquinarias")
async def modificar_maquinarias_de_proceso(id: int, body: dict, db=Depends(get_db)):
    """Reemplaza la lista de máquinas donde se hace el proceso.

    Body: {"maquinarias": [1, 2, 3]}. Lista vacía es válida y significa «no cargado»:
    ahí el planificador vuelve a deducir la máquina del nombre del proceso.
    """
    logger.info(f"API - Inicio PUT /procesos/{id}/maquinarias")
    service = ProcesoService(db)
    return await service.modificarMaquinariasDeProceso(id, body.get("maquinarias") or [])


# 🔹 Eliminar proceso
@router.delete("/procesos/{id}")
async def eliminar_proceso(id: int, forzar: bool = False, db=Depends(get_db)):
    """Borra un proceso del catálogo.

    Si está en alguna OT, sin `forzar` responde 409 con el motivo (en cuáles está y
    qué se pierde) en vez de borrar; con `forzar=true` lo borra y se lleva esas filas.
    """
    logger.info(f"API - Inicio DELETE /procesos/{id} (forzar={forzar})")
    service = ProcesoService(db)
    return await service.eliminarProceso(id, forzar=forzar)

app.include_router(router)
