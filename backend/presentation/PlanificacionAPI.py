# backend/presentation/controllers/PlanificacionAPI.py
from fastapi import FastAPI,APIRouter, Depends
from backend.application.PlanificacionService import planificar
from backend.infrastructure.db import SessionLocal

from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.infrastructure.PlanificacionRepository import PlanificacionRepository

from sqlalchemy import text

app = FastAPI()
router = APIRouter()

async def get_db():
    async with SessionLocal() as session:
        yield session

@router.post("/planificar")
async def planificar_endpoint(db = Depends(get_db)):
    """repo_orden = OrdenTrabajoRepository(db)
    repo_proceso = ProcesoRepository(db)
    repo_maquina = MaquinariaRepository(db)
    repo_operario = OperarioRepository(db)"""

    """resultados = await planificar(repo_orden, repo_proceso, repo_maquina, repo_operario)
    return resultados"""
    
    repo_orden = OrdenTrabajoRepository(db)
    repo_operario = OperarioRepository(db)
    repo_maquinaria = MaquinariaRepository(db)
    repo_planificacion = PlanificacionRepository(db)
    resultados = await planificar(repo_orden,repo_operario,repo_maquinaria,repo_planificacion,db)
    return resultados
    
    


@router.get("/planificacion")
async def obtener_planificacion(db = Depends(get_db)):
    query = text("""
        SELECT p.*, m.nombre as nombre_maquinaria, o.nombre as nombre_operario, o.apellido as apellido_operario,
               otp.id_estado, ep.descripcion as estado, otp.observaciones as observaciones_proceso,
               ot.observaciones as observaciones_ot,
               ot.fecha_entrada, ot.fecha_prometida, ot.id_prioridad, ot.id_articulo,
               a.cod_articulo, ot.unidades as cantidad, s.nombre as sector, ot.id_otvieja as pedido_externo
        FROM planificacion p
        LEFT JOIN maquinaria m ON p.id_maquinaria = m.id
        LEFT JOIN operario o ON p.id_operario = o.id
        LEFT JOIN orden_trabajo_proceso otp ON p.orden_id = otp.id_orden_trabajo AND p.proceso_id = otp.id_proceso
        LEFT JOIN estado_proceso ep ON otp.id_estado = ep.id
        LEFT JOIN orden_trabajo ot ON p.orden_id = ot.id
        LEFT JOIN articulo a ON ot.id_articulo = a.id
        LEFT JOIN sector s ON ot.id_sector = s.id
        ORDER BY p.inicio_min ASC
    """)
    result = await db.execute(query)
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]

from backend.dto.PlanificacionUpdateDTO import PlanificacionUpdateDTO

@router.put("/planificacion/{id}")
async def actualizar_planificacion(id: int, dto: PlanificacionUpdateDTO, db = Depends(get_db)):
    # Construir query dinámica
    updates = []
    params = {"id": id}
    
    if dto.inicio_min is not None:
        updates.append("inicio_min = :inicio_min")
        params["inicio_min"] = dto.inicio_min
        
    if dto.fin_min is not None:
        updates.append("fin_min = :fin_min")
        params["fin_min"] = dto.fin_min
        
    if dto.id_operario is not None:
        updates.append("id_operario = :id_operario")
        params["id_operario"] = dto.id_operario

    if not updates:
        return {"message": "No changes provided"}

    query = text(f"""
        UPDATE planificacion
        SET {", ".join(updates)}
        WHERE id = :id
    """)
    
    await db.execute(query, params)
    await db.commit()
    
    return {"message": "Planificación actualizada correctamente"}

app.include_router(router)
