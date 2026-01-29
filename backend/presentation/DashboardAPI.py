from fastapi import APIRouter, Depends
from backend.infrastructure.db import SessionLocal
from sqlalchemy import func, case, text
from datetime import datetime, timedelta
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.Sector import Sector
from backend.domain.Proceso import Proceso
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Prioridad import Prioridad

router = APIRouter(prefix="/api/dashboard")

async def get_db():
    async with SessionLocal() as session:
        yield session

@router.get("/estadisticas")
async def get_estadisticas(db=Depends(get_db)):
    """Obtiene estadísticas generales de órdenes de trabajo"""
    try:
        # Total de órdenes
        total_ordenes = await db.execute(text("SELECT COUNT(*) FROM orden_trabajo"))
        total_ordenes = total_ordenes.scalar()
        
        # Completadas: finalizadototal = 1
        completadas = await db.execute(text("SELECT COUNT(*) FROM orden_trabajo WHERE finalizadototal = 1"))
        completadas = completadas.scalar()
        
        # Retrasadas: finalizadototal != 1, fecha_prometida < hoy, Y NO tienen procesos iniciados
        retrasadas = await db.execute(text("""
            SELECT COUNT(ot.id) 
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            WHERE (ot.finalizadototal IS NULL OR ot.finalizadototal = 0)
            AND ot.fecha_prometida < GETDATE()
            AND NOT EXISTS (
                SELECT 1 FROM orden_trabajo_proceso otp 
                WHERE otp.id_orden_trabajo = ot.id 
                AND otp.id_estado > 1
            )
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
        """))
        retrasadas = retrasadas.scalar()
        
        # En Proceso (En Curso): finalizadototal != 1, tiene procesos iniciados (estado > 1)
        # NOTA: Incluye órdenes retrasadas si ya iniciaron
        en_proceso = await db.execute(text("""
            SELECT COUNT(ot.id) 
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            WHERE (ot.finalizadototal IS NULL OR ot.finalizadototal = 0)
            AND EXISTS (
                SELECT 1 FROM orden_trabajo_proceso otp 
                WHERE otp.id_orden_trabajo = ot.id 
                AND otp.id_estado > 1
            )
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
        """))
        en_proceso = en_proceso.scalar()
        
        # Pendientes: finalizadototal != 1, fecha_prometida >= HOY, NO tiene procesos iniciados
        pendientes = await db.execute(text("""
            SELECT COUNT(ot.id) 
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            WHERE (ot.finalizadototal IS NULL OR ot.finalizadototal = 0)
            AND ot.fecha_prometida >= GETDATE() 
            AND NOT EXISTS (
                SELECT 1 FROM orden_trabajo_proceso otp 
                WHERE otp.id_orden_trabajo = ot.id 
                AND otp.id_estado > 1
            )
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
        """))
        pendientes = pendientes.scalar()
        
        # Calcular porcentajes
        # Usamos la suma de las partes para asegurar que los porcentajes sumen 100%
        # y sean consistentes con lo que se muestra en el dashboard
        total = completadas + en_proceso + pendientes + retrasadas
        total = max(total, 1)
        
        data = {
            "completadas": completadas,
            "en_proceso": en_proceso,
            "pendientes": pendientes,
            "retrasadas": retrasadas,
            "porcentaje_completadas": round((completadas / total) * 100, 1),
            "porcentaje_en_proceso": round((en_proceso / total) * 100, 1),
            "porcentaje_pendientes": round((pendientes / total) * 100, 1),
            "porcentaje_retrasadas": round((retrasadas / total) * 100, 1),
        }
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en estadisticas: {e}")
        return {"success": False, "error": str(e)}

@router.get("/ordenes-criticas")
async def get_ordenes_criticas(db=Depends(get_db)):
    """Obtiene órdenes críticas (próximas a vencer en 7 días)"""
    try:
        # Query raw para asegurar compatibilidad
        query = text("""
            SELECT TOP 10 
                ot.id, 
                a.descripcion as articulo, 
                ot.fecha_prometida, 
                p.descripcion as prioridad
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            WHERE (ot.fecha_entrega IS NULL OR ot.fecha_entrega = '1950-01-01')
            AND ot.fecha_prometida <= DATEADD(day, 7, GETDATE())
            AND ot.fecha_prometida >= GETDATE()
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
            ORDER BY ot.fecha_prometida ASC
        """)
        
        result = await db.execute(query)
        ordenes = result.fetchall()
        
        data = []
        hoy = datetime.now().date()
        
        for orden in ordenes:
            fecha_prometida = orden.fecha_prometida.date() if orden.fecha_prometida else None
            dias_restantes = (fecha_prometida - hoy).days if fecha_prometida else 0
            
            data.append({
                "id": orden.id,
                "articulo": orden.articulo,
                "fecha_entrega": fecha_prometida.strftime("%Y-%m-%d") if fecha_prometida else None,
                "dias_restantes": dias_restantes,
                "prioridad": orden.prioridad or "Media",
                "estado": "En Proceso" # Calculado
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ordenes-criticas: {e}")
        return {"success": False, "error": str(e)}


@router.get("/timeline-entregas")
async def get_timeline_entregas(db=Depends(get_db)):
    """Obtiene el timeline de entregas para los próximos 7 días"""
    try:
        query = text("""
            SELECT CAST(fecha_prometida AS DATE) as fecha, COUNT(*) as ordenes
            FROM orden_trabajo ot
            WHERE (fecha_entrega IS NULL OR fecha_entrega = '1950-01-01')
            AND fecha_prometida >= GETDATE()
            AND fecha_prometida <= DATEADD(day, 7, GETDATE())
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
            GROUP BY CAST(fecha_prometida AS DATE)
            ORDER BY fecha ASC
        """)
        
        result = await db.execute(query)
        timeline = result.fetchall()
        
        data = []
        for row in timeline:
            data.append({
                "fecha": row.fecha.strftime("%Y-%m-%d"),
                "ordenes": row.ordenes
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en timeline-entregas: {e}")
        return {"success": False, "error": str(e)}

@router.get("/clientes-mayor-volumen")
async def get_clientes_mayor_volumen(db=Depends(get_db)):
    """Obtiene los clientes con mayor volumen de órdenes activas"""
    try:
        query = text("""
            SELECT TOP 5 c.nombre as cliente, COUNT(ot.id) as cantidad
            FROM orden_trabajo ot
            JOIN cliente c ON ot.id_cliente = c.id
            WHERE EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
            GROUP BY c.nombre
            ORDER BY cantidad DESC
        """)
        
        result = await db.execute(query)
        clientes = result.fetchall()
        
        data = []
        for row in clientes:
            data.append({
                "cliente": row.cliente,
                "cantidad": row.cantidad
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en clientes-mayor-volumen: {e}")
        return {"success": False, "error": str(e)}

@router.get("/distribucion-prioridades")
async def get_distribucion_prioridades(db=Depends(get_db)):
    """Obtiene la distribución de órdenes por prioridad (Histórico + Actual)"""
    try:
        query = text("""
            SELECT p.descripcion as prioridad, COUNT(ot.id) as cantidad
            FROM orden_trabajo ot
            JOIN prioridad p ON ot.id_prioridad = p.id
            WHERE EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
            GROUP BY p.descripcion
            ORDER BY 
                CASE 
                    WHEN p.descripcion LIKE '%Urgente%' THEN 1 
                    WHEN p.descripcion = 'Reclamo' THEN 2 
                    WHEN p.descripcion = 'Normal' THEN 3 
                    ELSE 4 
                END ASC
        """)
        
        result = await db.execute(query)
        distribucion = result.fetchall()
        
        total_ordenes = sum(row.cantidad for row in distribucion)
        total = max(total_ordenes, 1)
        
        data = []
        for row in distribucion:
            data.append({
                "prioridad": row.prioridad,
                "cantidad": row.cantidad,
                "porcentaje": round((row.cantidad / total) * 100, 1)
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en distribucion-prioridades: {e}")
        return {"success": False, "error": str(e)}

@router.get("/top-articulos")
async def get_top_articulos(db=Depends(get_db)):
    """Obtiene los artículos más producidos"""
    try:
        # Contamos órdenes por artículo ya que no tenemos cantidad
        query = text("""
            SELECT TOP 5 a.descripcion as articulo, SUM(ot.unidades) as cantidad
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            WHERE ot.fecha_entrega IS NOT NULL AND ot.fecha_entrega > '1950-01-01'
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
            GROUP BY a.descripcion
            ORDER BY cantidad DESC
        """)
        
        result = await db.execute(query)
        articulos = result.fetchall()
        
        data = []
        for row in articulos:
            data.append({
                "articulo": row.articulo,
                "cantidad": row.cantidad
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en top-articulos: {e}")
        return {"success": False, "error": str(e)}

@router.get("/tiempo-promedio")
async def get_tiempo_promedio(db=Depends(get_db)):
    """Obtiene el tiempo promedio de producción basado en la suma de tiempos de procesos"""
    try:
        # Calculamos el promedio sumando los tiempo_proceso de cada orden completada
        query = text("""
            SELECT AVG(tiempo_total) as promedio_horas
            FROM (
                SELECT ot.id, SUM(ISNULL(otp.tiempo_proceso, 0)) as tiempo_total
                FROM orden_trabajo ot
                LEFT JOIN orden_trabajo_proceso otp ON ot.id = otp.id_orden_trabajo
                WHERE ot.fecha_entrega IS NOT NULL AND ot.fecha_entrega > '1950-01-01'
                AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
                GROUP BY ot.id
            ) AS tiempos_por_orden
            WHERE tiempo_total > 0
        """)
        
        result = await db.execute(query)
        promedio_horas = result.scalar() or 0
        
        dias = int(promedio_horas // 24)
        horas = int(promedio_horas % 24)
        
        return {"success": True, "data": {"dias": dias, "horas": horas}}
    except Exception as e:
        print(f"Error en tiempo-promedio: {e}")
        return {"success": False, "error": str(e)}

@router.get("/ordenes-por-prioridad/{prioridad}")
async def get_ordenes_por_prioridad(prioridad: str, db=Depends(get_db)):
    """Obtiene todas las órdenes de una prioridad específica (Histórico + Actual)"""
    try:
        query = text("""
            SELECT 
                ot.id, 
                a.descripcion as articulo, 
                ot.fecha_prometida, 
                ot.fecha_entrega,
                s.nombre as sector,
                c.nombre as cliente
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            LEFT JOIN cliente c ON ot.id_cliente = c.id
            WHERE p.descripcion = :prioridad
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
        """)
        
        result = await db.execute(query, {"prioridad": prioridad})
        ordenes = result.fetchall()
        
        data = []
        for orden in ordenes:
            # Determinar estado
            estado = "Completada" if orden.fecha_entrega else "En Proceso"
            
            data.append({
                "id": orden.id,
                "articulo": orden.articulo,
                "fecha_entrega": orden.fecha_entrega.strftime("%Y-%m-%d") if orden.fecha_entrega else (orden.fecha_prometida.strftime("%Y-%m-%d") if orden.fecha_prometida else None),
                "estado": estado,
                "sector": orden.sector,
                "cliente": orden.cliente or "Sin Cliente",
                "cantidad": 1 # Default
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ordenes-por-prioridad: {e}")
        return {"success": False, "error": str(e)}

@router.get("/ordenes-por-estado/{estado}")
async def get_ordenes_por_estado(estado: str, db=Depends(get_db)):
    """Obtiene todas las órdenes de un estado específico"""
    try:
        # Determinar el filtro según el estado
        estado_lower = estado.lower()
        
        if estado_lower == "completadas":
            where_clause = "ot.finalizadototal = 1"
        elif estado_lower == "en_proceso" or estado_lower == "en_curso":
            where_clause = """
                (ot.finalizadototal IS NULL OR ot.finalizadototal = 0)
                AND EXISTS (
                    SELECT 1 FROM orden_trabajo_proceso otp 
                    WHERE otp.id_orden_trabajo = ot.id 
                    AND otp.id_estado > 1
                )
            """
        elif estado_lower == "retrasadas":
            where_clause = """
                (ot.finalizadototal IS NULL OR ot.finalizadototal = 0)
                AND ot.fecha_prometida < GETDATE() 
                AND NOT EXISTS (
                    SELECT 1 FROM orden_trabajo_proceso otp 
                    WHERE otp.id_orden_trabajo = ot.id 
                    AND otp.id_estado > 1
                )
            """
        elif estado_lower == "pendientes":
            where_clause = """
                (ot.finalizadototal IS NULL OR ot.finalizadototal = 0)
                AND ot.fecha_prometida >= GETDATE() 
                AND NOT EXISTS (
                    SELECT 1 FROM orden_trabajo_proceso otp 
                    WHERE otp.id_orden_trabajo = ot.id 
                    AND otp.id_estado > 1
                )
            """
        else:
            return {"success": False, "error": "Estado no válido"}
        
        # Add planificacion filter to all except completed (consistent with get_estadisticas)
        if estado_lower != "completadas":
            where_clause += " AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)"
        
        query = text(f"""
            SELECT 
                ot.id, 
                a.descripcion as articulo,
                a.cod_articulo,
                ot.fecha_entrada,
                ot.unidades,
                ot.fecha_prometida, 
                ot.fecha_entrega,
                s.nombre as sector,
                c.nombre as cliente,
                p.descripcion as prioridad,
                (SELECT COUNT(*) FROM orden_trabajo_proceso otp WHERE otp.id_orden_trabajo = ot.id) as total_procesos,
                (SELECT COUNT(*) FROM orden_trabajo_proceso otp WHERE otp.id_orden_trabajo = ot.id AND otp.id_estado = 3) as procesos_completados,
                (SELECT TOP 1 pr.nombre 
                 FROM orden_trabajo_proceso otp 
                 JOIN proceso pr ON otp.id_proceso = pr.id 
                 WHERE otp.id_orden_trabajo = ot.id AND otp.id_estado = 2) as proceso_actual
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            LEFT JOIN cliente c ON ot.id_cliente = c.id
            WHERE {where_clause}
            ORDER BY ot.fecha_prometida DESC
        """)
        
        result = await db.execute(query)
        ordenes = result.fetchall()
        
        data = []
        for orden in ordenes:
            # Determinar estado display
            if orden.fecha_entrega:
                estado_display = "Completada"
                fecha_display = orden.fecha_entrega
            else:
                hoy = datetime.now().date()
                # Handle both datetime and date objects safely
                if isinstance(orden.fecha_prometida, datetime):
                    fecha_prom = orden.fecha_prometida.date()
                else:
                    fecha_prom = orden.fecha_prometida
                
                # Logic for display status
                if estado_lower == "pendientes":
                    estado_display = "Pendiente"
                elif estado_lower == "retrasadas":
                    estado_display = "Retrasada"
                elif estado_lower in ["en_proceso", "en_curso"]:
                    estado_display = "En Curso"
                else:
                    # Fallback logic
                    if fecha_prom and fecha_prom < hoy:
                        estado_display = "Retrasada"
                    else:
                        estado_display = "En Proceso"

                # Handle placeholder date 3000-01-01
                if fecha_prom and fecha_prom.year == 3000:
                    fecha_display = None # Will show as "Sin fecha" in frontend
                else:
                    fecha_display = orden.fecha_prometida
            
            # Calculate pending processes
            total_procs = orden.total_procesos or 0
            completed_procs = orden.procesos_completados or 0
            pending_procs = total_procs - completed_procs
            
            data.append({
                "id": orden.id,
                "articulo": orden.articulo,
                "cod_articulo": orden.cod_articulo,
                "fecha_entrada": orden.fecha_entrada.strftime("%Y-%m-%d") if orden.fecha_entrada else None,
                "fecha_entrega": fecha_display.strftime("%Y-%m-%d") if fecha_display else None,
                "fecha_prometida": orden.fecha_prometida.strftime("%Y-%m-%d") if orden.fecha_prometida else None,
                "estado": estado_display,
                "sector": orden.sector,
                "cliente": orden.cliente or "Sin Cliente",
                "prioridad": orden.prioridad,
                "cantidad": orden.unidades or 1,
                "proceso_actual": orden.proceso_actual,
                "procesos_totales": total_procs,
                "procesos_pendientes": pending_procs
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ordenes-por-estado: {e}")
        return {"success": False, "error": str(e)}

@router.get("/ordenes-por-fecha/{fecha}")
async def get_ordenes_por_fecha(fecha: str, db=Depends(get_db)):
    """Obtiene todas las órdenes prometidas para una fecha específica"""
    try:
        print(f"DEBUG: Buscando órdenes para fecha: {fecha}")
        # Validar formato de fecha
        try:
            fecha_obj = datetime.strptime(fecha, "%Y-%m-%d").date()
        except ValueError:
            return {"success": False, "error": "Formato de fecha inválido. Use YYYY-MM-DD"}

        query = text("""
            SELECT 
                ot.id, 
                a.descripcion as articulo, 
                ot.fecha_prometida, 
                ot.fecha_entrega,
                s.nombre as sector,
                c.nombre as cliente,
                p.descripcion as prioridad,
                (SELECT COUNT(*) FROM orden_trabajo_proceso otp WHERE otp.id_orden_trabajo = ot.id) as total_procesos,
                (SELECT COUNT(*) FROM orden_trabajo_proceso otp WHERE otp.id_orden_trabajo = ot.id AND otp.id_estado = 3) as procesos_completados,
                (SELECT TOP 1 pr.nombre 
                 FROM orden_trabajo_proceso otp 
                 JOIN proceso pr ON otp.id_proceso = pr.id 
                 WHERE otp.id_orden_trabajo = ot.id AND otp.id_estado = 2) as proceso_actual
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            LEFT JOIN cliente c ON ot.id_cliente = c.id
            WHERE ot.fecha_prometida >= :fecha_inicio AND ot.fecha_prometida < :fecha_fin
            AND (ot.fecha_entrega IS NULL OR ot.fecha_entrega = '1950-01-01')
            AND EXISTS (SELECT 1 FROM planificacion pl WHERE pl.orden_id = ot.id)
            ORDER BY ot.id ASC
        """)
        
        # Create range for the whole day
        fecha_fin = fecha_obj + timedelta(days=1)
        
        # Pass both datetimes
        result = await db.execute(query, {
            "fecha_inicio": datetime.combine(fecha_obj, datetime.min.time()),
            "fecha_fin": datetime.combine(fecha_fin, datetime.min.time())
        })
        ordenes = result.fetchall()
        
        print(f"DEBUG: Encontradas {len(ordenes)} órdenes para {fecha}")
        
        data = []
        for orden in ordenes:
            # Calculate pending processes
            total_procs = orden.total_procesos or 0
            completed_procs = orden.procesos_completados or 0
            pending_procs = total_procs - completed_procs
            
            data.append({
                "id": orden.id,
                "articulo": orden.articulo,
                "fecha_entrega": orden.fecha_prometida.strftime("%Y-%m-%d") if orden.fecha_prometida else None,
                "estado": "En Proceso", # Default for timeline items
                "sector": orden.sector,
                "cliente": orden.cliente or "Sin Cliente",
                "prioridad": orden.prioridad,
                "cantidad": 1,  # Default
                "proceso_actual": orden.proceso_actual,
                "procesos_totales": total_procs,
                "procesos_pendientes": pending_procs
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ordenes-por-fecha: {e}")
        return {"success": False, "error": str(e)}
