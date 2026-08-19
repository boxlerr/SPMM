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
from backend.dto.QuitarOrdenesPlanificacionDTO import QuitarOrdenesPlanificacionDTO
from backend.dto.PlanificacionBorradorDTO import GuardarBorradorDTO
from backend.infrastructure.PlanificacionBorradorRepository import PlanificacionBorradorRepository
from backend.core.security import get_current_user

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
    procesos_por_orden = body.procesos_por_orden if body else None

    # Cada intento queda auditado, salga bien o mal. Antes un intento fallado no
    # dejaba rastro en la app: el 15/08 uno murió por memoria y la única evidencia
    # estaba en los logs de Cloud Run.
    from backend.infrastructure.AuditoriaRepository import AuditoriaRepository
    import time as _time
    auditoria = AuditoriaRepository(db)
    tipo = "preview" if preview_mode else ("plan_manual" if manual_plan else "confirmar")
    t0 = _time.monotonic()

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
            procesos_por_orden=procesos_por_orden,
        )
        await auditoria.registrar_intento(
            tipo, ordenes_ids, "ok",
            int((_time.monotonic() - t0) * 1000), salida=resultados,
        )
        # El plan se confirmó: su borrador dejó de ser un borrador. Si no se borra
        # acá, la próxima vez que abran Planificar Órdenes les ofrece "retomar" algo
        # que ya está planificado y confirmado.
        if not preview_mode and ordenes_ids:
            try:
                await PlanificacionBorradorRepository(db).borrar_por_ordenes(ordenes_ids)
            except Exception as e:
                logger.warning(f"No se pudo limpiar el borrador del lote confirmado: {e}")
        return resultados
    except PlanificacionException as e:
        logger.error(f"Error de Planificación: {str(e)}")
        await auditoria.registrar_intento(
            tipo, ordenes_ids, "sin_solucion",
            int((_time.monotonic() - t0) * 1000), error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error inesperado en planificar_endpoint: {str(e)}")
        await auditoria.registrar_intento(
            tipo, ordenes_ids, "error",
            int((_time.monotonic() - t0) * 1000), error=f"{type(e).__name__}: {e}",
        )
        raise HTTPException(status_code=500, detail="Ocurrió un error inesperado al procesar la planificación. Por favor, intente con menos órdenes.")


# ---------------------------------------------------------------------------
# Borradores: el plan calculado y todavía NO confirmado.
#
# La vista previa era pura ida y vuelta —`preview=true` devolvía el resultado y no
# se guardaba en ningún lado—, así que cerrar el modal tiraba un cálculo de varios
# minutos. Con 34 OTs eso es la semana entera del taller.
#
# Ninguno de estos endpoints devuelve 5xx cuando falla el guardado: los llama un
# autosave cada pocos segundos y una caída acá no puede voltear la pantalla en la
# que el usuario está trabajando. La copia del navegador cubre el hueco.
# ---------------------------------------------------------------------------

@router.get("/planificacion/borradores")
async def listar_borradores(db = Depends(get_db), _u = Depends(get_current_user)):
    """Los borradores guardados, del más nuevo al más viejo. Sin el contenido:
    la lista solo necesita saber cuál abrir."""
    return await PlanificacionBorradorRepository(db).listar()


@router.get("/planificacion/borradores/{borrador_id}")
async def obtener_borrador(borrador_id: int, db = Depends(get_db), _u = Depends(get_current_user)):
    borrador = await PlanificacionBorradorRepository(db).obtener(borrador_id)
    if not borrador:
        raise HTTPException(status_code=404, detail="Ese borrador ya no existe.")
    return borrador


@router.post("/planificacion/borradores")
async def guardar_borrador(
    body: GuardarBorradorDTO,
    db = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Crea o pisa un borrador. Devuelve el id para que el autosave siga pisando
    el mismo en vez de dejar un reguero de copias."""
    nombre = " ".join(
        x for x in [current_user.get("nombre"), current_user.get("apellido")] if x
    ) or current_user.get("username")

    borrador_id = await PlanificacionBorradorRepository(db).guardar(
        borrador_id=body.id,
        contenido=body.contenido,
        ordenes_ids=body.ordenes_ids,
        cantidad_procesos=body.cantidad_procesos,
        fecha_desde=body.fecha_desde,
        fecha_hasta=body.fecha_hasta,
        id_usuario=current_user.get("id_usuario"),
        nombre_usuario=nombre,
        automatico=body.automatico,
    )
    # 200 con guardado=False y no un 500: el autosave reintenta en el próximo
    # cambio y el usuario no tiene por qué enterarse de un fallo transitorio.
    return {"id": borrador_id, "guardado": borrador_id is not None}


@router.delete("/planificacion/borradores/{borrador_id}")
async def borrar_borrador(borrador_id: int, db = Depends(get_db), _u = Depends(get_current_user)):
    borrado = await PlanificacionBorradorRepository(db).borrar(borrador_id)
    return {"borrado": borrado}


@router.get("/auditoria/planificacion")
async def auditoria_planificacion(db = Depends(get_db)):
    """Historial de intentos de planificación y de borrados, para la pantalla de
    Auditoría. Lo que un intento muerto por memoria no puede registrar por sí mismo
    (el proceso muere antes) queda igualmente visible: el intento aparece por el
    lado del que sí se guardó, y el hueco entre horas cuenta la historia."""
    from backend.infrastructure.AuditoriaRepository import AuditoriaRepository
    repo = AuditoriaRepository(db)
    return {
        "intentos": await repo.listar_intentos(),
        "borrados": await repo.listar_borrados(),
    }
    
    
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

    from backend.infrastructure.AuditoriaRepository import AuditoriaRepository
    import time as _time
    auditoria = AuditoriaRepository(db)
    t0 = _time.monotonic()

    try:
        resultados = await planificar_pendientes(
            repo_orden,
            repo_operario,
            repo_maquinaria,
            repo_planificacion,
            db,
            ordenes_ids,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
        )
        await auditoria.registrar_intento(
            "re_planificar", ordenes_ids, "ok",
            int((_time.monotonic() - t0) * 1000),
            salida=resultados if isinstance(resultados, dict) else None,
        )
        return resultados
    except PlanificacionException as e:
        logger.error(f"Error de Planificación (pendientes): {str(e)}")
        await auditoria.registrar_intento(
            "re_planificar", ordenes_ids, "sin_solucion",
            int((_time.monotonic() - t0) * 1000), error=str(e),
        )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error inesperado en planificar_pendientes_endpoint: {str(e)}")
        await auditoria.registrar_intento(
            "re_planificar", ordenes_ids, "error",
            int((_time.monotonic() - t0) * 1000), error=f"{type(e).__name__}: {e}",
        )
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

    # La conversión de minutos a fecha vive en el servicio. Acá había una copia con la
    # jornada escrita a mano (555 minutos, 105 muertos), así que cualquier corrección
    # al calendario había que acordarse de hacerla en dos lugares —y la copia ya se
    # había quedado atrás—. Es la MISMA función que usa el planificador al armar el
    # plan, con lo cual el Gantt y la vista previa no se pueden contradecir.
    from backend.application.PlanificacionService import _convertir_minutos_a_fecha
    from backend.infrastructure.DiaBloqueadoRepository import DiaBloqueadoRepository

    # Una sola lectura por request: antes se abría el archivo de feriados dos veces
    # por cada fila del resultado.
    blocked_dates = await DiaBloqueadoRepository(db).listar()

    def convertir_minutos_a_fecha(minutos_acumulados: int):
        return _convertir_minutos_a_fecha(minutos_acumulados, None, blocked_dates)

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

@router.post("/planificacion/quitar-ordenes")
async def quitar_ordenes_planificacion(dto: QuitarOrdenesPlanificacionDTO, db = Depends(get_db)):
    """Saca OTs puntuales de la planificación sin tocar el resto del lote.

    Se usa cuando se planificó una OT por error: la OT vuelve a estar disponible
    para planificar y desaparece de las vistas de planificación.
    """
    if not dto.orden_ids:
        raise HTTPException(status_code=400, detail="No se recibieron órdenes para quitar.")

    repo_planificacion = PlanificacionRepository(db)
    borrados = await repo_planificacion.eliminar_ordenes(dto.orden_ids, dto.id_lote)
    return {
        "message": f"{len(dto.orden_ids)} orden(es) quitadas de la planificación",
        "registros_eliminados": borrados,
    }

@router.delete("/planificacion/lote/{id_lote}")
async def eliminar_planificacion_lote(id_lote: str, db = Depends(get_db)):
    repo_planificacion = PlanificacionRepository(db)
    await repo_planificacion.eliminar_lote(id_lote)
    return {"message": "Lote de planificación eliminado correctamente"}

app.include_router(router)
