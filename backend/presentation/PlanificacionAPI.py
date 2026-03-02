# backend/presentation/controllers/PlanificacionAPI.py
from fastapi import FastAPI,APIRouter, Depends
from backend.application.PlanificacionService import planificar,planificar_pendientes
from backend.infrastructure.db import SessionLocal

from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.infrastructure.PlanificacionRepository import PlanificacionRepository
from backend.dto.PlanificarRequestDTO import PlanificarRequestDTO
from backend.dto.PlanificacionUpdateDTO import PlanificacionUpdateDTO

from sqlalchemy import text

app = FastAPI()
router = APIRouter()

async def get_db():
    async with SessionLocal() as session:
        yield session

@router.post("/planificar")
async def planificar_endpoint(db = Depends(get_db), body: PlanificarRequestDTO | None = None):

    repo_orden = OrdenTrabajoRepository(db)
    repo_operario = OperarioRepository(db)
    repo_maquinaria = MaquinariaRepository(db)
    repo_planificacion = PlanificacionRepository(db)
    ordenes_ids = body.ordenes_ids if body else None
    preview_mode = body.preview if body else False
    manual_plan = body.plan if body else None

    resultados = await planificar(
        repo_orden,
        repo_operario,
        repo_maquinaria,
        repo_planificacion,
        db,
        ordenes_ids, 
        preview=preview_mode,
        plan=manual_plan
    )
    return resultados
    
    
@router.post("/planificar/pendientes") 
async def planificar_pendientes_endpoint(
    body: PlanificarRequestDTO | None = None,
    db = Depends(get_db)
):
    repo_orden = OrdenTrabajoRepository(db)
    repo_operario = OperarioRepository(db)
    repo_maquinaria = MaquinariaRepository(db)
    repo_planificacion = PlanificacionRepository(db)

    ordenes_ids = body.ordenes_ids if body else None

    return await planificar_pendientes(
        repo_orden,
        repo_operario,
        repo_maquinaria,
        repo_planificacion,
        db,
        ordenes_ids
    )

@router.get("/planificacion")
async def obtener_planificacion(db = Depends(get_db)):
    query = text("""
        SELECT p.*, m.nombre as nombre_maquinaria, o.nombre as nombre_operario, o.apellido as apellido_operario,
               otp.id_estado, ep.descripcion as estado, otp.observaciones as observaciones_proceso,
               ot.observaciones as observaciones_ot,
               ot.fecha_entrada, ot.fecha_prometida, ot.id_prioridad, ot.id_articulo,
               a.cod_articulo, a.descripcion as descripcion_articulo, ot.unidades as cantidad, ot.cantidad_entregada,
               s.nombre as sector, pk.nombre as cliente, ot.id_otvieja as pedido_externo,
               otp.inicio_real, otp.fin_real,
               otp.orden as secuencia
        FROM planificacion p
        LEFT JOIN maquinaria m ON p.id_maquinaria = m.id
        LEFT JOIN operario o ON p.id_operario = o.id
        LEFT JOIN orden_trabajo_proceso otp ON p.orden_id = otp.id_orden_trabajo AND p.proceso_id = otp.id_proceso
        LEFT JOIN estado_proceso ep ON otp.id_estado = ep.id
        LEFT JOIN orden_trabajo ot ON p.orden_id = ot.id
        LEFT JOIN articulo a ON ot.id_articulo = a.id
        LEFT JOIN sector s ON ot.id_sector = s.id
        LEFT JOIN cliente pk ON ot.id_cliente = pk.id
        ORDER BY p.inicio_min ASC
    """)
    result = await db.execute(query)
    rows = result.fetchall()
    
    # Helper for date conversion (duplicated from Service to avoid circular imports or complex refactoring)
    from datetime import datetime, timedelta
    
    def convertir_minutos_a_fecha(minutos_acumulados: int):
        ahora = datetime.now()
        inicio_base = ahora
        if inicio_base.hour < 7:
            inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
        elif inicio_base.hour >= 17:
            inicio_base = inicio_base + timedelta(days=1)
            inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
        
        while inicio_base.weekday() >= 5: # 5=Sab, 6=Dom
            inicio_base += timedelta(days=1)
            inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)

        tiempo_actual = inicio_base
        minutos_restantes = minutos_acumulados

        while minutos_restantes > 0:
            fin_jornada = tiempo_actual.replace(hour=17, minute=0, second=0, microsecond=0)
            if tiempo_actual >= fin_jornada:
                tiempo_actual += timedelta(days=1)
                tiempo_actual = tiempo_actual.replace(hour=7, minute=0, second=0, microsecond=0)
                while tiempo_actual.weekday() >= 5:
                    tiempo_actual += timedelta(days=1)
                    tiempo_actual = tiempo_actual.replace(hour=7, minute=0, second=0, microsecond=0)
                continue

            minutos_disponibles_hoy = (fin_jornada - tiempo_actual).total_seconds() / 60
            
            if minutos_restantes <= minutos_disponibles_hoy:
                tiempo_actual += timedelta(minutes=minutos_restantes)
                minutos_restantes = 0
            else:
                tiempo_actual += timedelta(minutes=minutos_disponibles_hoy)
                minutos_restantes -= minutos_disponibles_hoy
                tiempo_actual += timedelta(days=1)
                tiempo_actual = tiempo_actual.replace(hour=7, minute=0, second=0, microsecond=0)
                while tiempo_actual.weekday() >= 5:
                    tiempo_actual += timedelta(days=1)
                    tiempo_actual = tiempo_actual.replace(hour=7, minute=0, second=0, microsecond=0)
        
        return tiempo_actual.isoformat()

    results = []
    for row in rows:
        item = dict(row._mapping)
        # Calculate derived dates based on inicio_min and fin_min
        if item.get('inicio_min') is not None:
            item['fecha_inicio_estimada'] = convertir_minutos_a_fecha(item['inicio_min'])
        if item.get('fin_min') is not None:
             item['fecha_fin_estimada'] = convertir_minutos_a_fecha(item['fin_min'])
             
        results.append(item)

    return results

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

@router.delete("/planificacion/lote/{id_lote}")
async def eliminar_planificacion_lote(id_lote: str, db = Depends(get_db)):
    repo_planificacion = PlanificacionRepository(db)
    await repo_planificacion.eliminar_lote(id_lote)
    return {"message": "Lote de planificación eliminado correctamente"}

app.include_router(router)
