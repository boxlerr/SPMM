# backend/presentation/controllers/PlanificacionAPI.py
from fastapi import FastAPI, APIRouter, Depends, HTTPException
from backend.application.PlanificacionService import planificar,planificar_pendientes
from backend.infrastructure.db import SessionLocal
from backend.commons.exceptions.PlanificacionException import PlanificacionException
from backend.commons.loggers.logger import logger

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
    fecha_desde = body.fecha_desde if body else None
    fecha_hasta = body.fecha_hasta if body else None
    forzar_ordenes_ids = body.forzar_ordenes_ids if body else None

    try:
        resultados = await planificar(
            repo_orden,
            repo_operario,
            repo_maquinaria,
            repo_planificacion,
            db,
            ordenes_ids,
            preview=preview_mode,
            plan=manual_plan,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            forzar_ordenes_ids=forzar_ordenes_ids,
        )
        return resultados
    except PlanificacionException as e:
        logger.error(f"Error de Planificación: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error inesperado en planificar_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Ocurrió un error inesperado al procesar la planificación. Por favor, intente con menos órdenes.")
    
    
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
    fecha_desde = body.fecha_desde if body else None
    fecha_hasta = body.fecha_hasta if body else None

    try:
        return await planificar_pendientes(
            repo_orden,
            repo_operario,
            repo_maquinaria,
            repo_planificacion,
            db,
            ordenes_ids,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
        )
    except PlanificacionException as e:
        logger.error(f"Error de Planificación (pendientes): {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error inesperado en planificar_pendientes_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Ocurrió un error inesperado al procesar la planificación. Por favor, intente con menos órdenes.")

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
    from backend.infrastructure.ConfigRepository import ConfigRepository

    # Leer blocked_dates UNA sola vez por request (antes se leía desde disco
    # 2 veces por cada fila del resultado, lo cual escalaba a O(N) lecturas de I/O).
    config_repo = ConfigRepository()
    blocked_dates = set(config_repo.get_blocked_dates())

    def convertir_minutos_a_fecha(minutos_acumulados: int):
        ahora = datetime.now()
        inicio_base = ahora.replace(hour=7, minute=0, second=0, microsecond=0)
        
        def avanzar_a_dia_valido(fecha):
            while True:
                wd = fecha.weekday()
                is_blocked = fecha.strftime("%Y-%m-%d") in blocked_dates
                if wd == 6 or is_blocked: 
                    fecha += timedelta(days=1)
                else:
                    break
            return fecha

        tiempo_actual = avanzar_a_dia_valido(inicio_base)
        minutos_restantes = minutos_acumulados

        while minutos_restantes > 0:
            wd = tiempo_actual.weekday()
            
            if wd < 5:
                capacidad_hoy = 555
            elif wd == 5:
                capacidad_hoy = 300
            else:
                capacidad_hoy = 0

            if capacidad_hoy == 0:
                tiempo_actual += timedelta(days=1)
                tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
                continue
                
            if minutos_restantes >= capacidad_hoy:
                minutos_restantes -= capacidad_hoy
                tiempo_actual += timedelta(days=1)
                tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
            else:
                if wd < 5:
                    if minutos_restantes <= 120:
                        tiempo_actual += timedelta(minutes=minutos_restantes)
                    elif minutos_restantes <= 285:
                        tiempo_actual += timedelta(minutes=minutos_restantes + 15)
                    else:
                        tiempo_actual += timedelta(minutes=minutos_restantes + 105)
                elif wd == 5:
                    tiempo_actual += timedelta(minutes=minutos_restantes)
                
                minutos_restantes = 0
        
        return tiempo_actual.isoformat()
        
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

    if dto.id_maquinaria is not None:
        # 0 = "Sin asignar" desde el frontend -> NULL en la DB.
        if dto.id_maquinaria == 0:
            updates.append("id_maquinaria = NULL")
        else:
            updates.append("id_maquinaria = :id_maquinaria")
            params["id_maquinaria"] = dto.id_maquinaria

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
