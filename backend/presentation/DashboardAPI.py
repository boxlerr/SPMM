from fastapi import APIRouter, Depends
from backend.infrastructure.db import SessionLocal
from sqlalchemy import func, case, text
from datetime import datetime, timedelta
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.Sector import Sector
from backend.domain.Proceso import Proceso
from backend.domain.Articulo import Articulo
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
        
        # Completadas: tienen fecha_entrega
        completadas = await db.execute(text("SELECT COUNT(*) FROM orden_trabajo WHERE fecha_entrega IS NOT NULL"))
        completadas = completadas.scalar()
        
        # Retrasadas: no tienen fecha_entrega y fecha_prometida < hoy
        retrasadas = await db.execute(text("SELECT COUNT(*) FROM orden_trabajo WHERE fecha_entrega IS NULL AND fecha_prometida < GETDATE()"))
        retrasadas = retrasadas.scalar()
        
        # En Proceso: no tienen fecha_entrega y fecha_prometida >= hoy
        en_proceso = await db.execute(text("SELECT COUNT(*) FROM orden_trabajo WHERE fecha_entrega IS NULL AND fecha_prometida >= GETDATE()"))
        en_proceso = en_proceso.scalar()
        
        # Pendientes: asumimos que son las mismas que en proceso por ahora, o definimos lógica extra
        pendientes = 0 # No hay campo de estado explícito para diferenciar pendiente de en proceso sin más datos
        
        # Calcular porcentajes
        total = max(total_ordenes, 1)
        
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
                a.nombre as articulo, 
                ot.fecha_prometida, 
                p.descripcion as prioridad
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            WHERE ot.fecha_entrega IS NULL 
            AND ot.fecha_prometida <= DATEADD(day, 7, GETDATE())
            AND ot.fecha_prometida >= GETDATE()
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

@router.get("/ocupacion-sectores")
async def get_ocupacion_sectores(db=Depends(get_db)):
    """Obtiene la ocupación de cada sector (Histórico + Actual)"""
    try:
        query = text("""
            SELECT s.nombre as sector, COUNT(ot.id) as ordenes_activas
            FROM orden_trabajo ot
            JOIN sector s ON ot.id_sector = s.id
            GROUP BY s.nombre
        """)
        
        result = await db.execute(query)
        ocupacion = result.fetchall()
        
        total_ordenes = sum(row.ordenes_activas for row in ocupacion)
        total = max(total_ordenes, 1)
        
        data = []
        for row in ocupacion:
            data.append({
                "sector": row.sector,
                "ordenes_activas": row.ordenes_activas,
                "porcentaje": round((row.ordenes_activas / total) * 100, 1)
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ocupacion-sectores: {e}")
        return {"success": False, "error": str(e)}

@router.get("/timeline-entregas")
async def get_timeline_entregas(db=Depends(get_db)):
    """Obtiene el timeline de entregas para los próximos 7 días"""
    try:
        query = text("""
            SELECT CAST(fecha_prometida AS DATE) as fecha, COUNT(*) as ordenes
            FROM orden_trabajo
            WHERE fecha_entrega IS NULL
            AND fecha_prometida >= GETDATE()
            AND fecha_prometida <= DATEADD(day, 7, GETDATE())
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

@router.get("/procesos-mas-utilizados")
async def get_procesos_mas_utilizados(db=Depends(get_db)):
    """Obtiene los procesos más utilizados"""
    try:
        # Usamos orden_trabajo_proceso para contar
        query = text("""
            SELECT TOP 5 p.nombre as proceso, COUNT(otp.id_orden_trabajo) as cantidad
            FROM orden_trabajo_proceso otp
            JOIN proceso p ON otp.id_proceso = p.id
            GROUP BY p.nombre
            ORDER BY cantidad DESC
        """)
        
        result = await db.execute(query)
        procesos = result.fetchall()
        
        data = []
        for row in procesos:
            data.append({
                "proceso": row.proceso,
                "cantidad": row.cantidad
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en procesos-mas-utilizados: {e}")
        return {"success": False, "error": str(e)}

@router.get("/distribucion-prioridades")
async def get_distribucion_prioridades(db=Depends(get_db)):
    """Obtiene la distribución de órdenes por prioridad (Histórico + Actual)"""
    try:
        query = text("""
            SELECT p.descripcion as prioridad, COUNT(ot.id) as cantidad
            FROM orden_trabajo ot
            JOIN prioridad p ON ot.id_prioridad = p.id
            GROUP BY p.descripcion
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
            SELECT TOP 5 a.descripcion as articulo, COUNT(ot.id) as cantidad
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            WHERE ot.fecha_entrega IS NOT NULL
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
                WHERE ot.fecha_entrega IS NOT NULL
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
                s.nombre as sector
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
            WHERE p.descripcion = :prioridad
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
            where_clause = "ot.fecha_entrega IS NOT NULL"
        elif estado_lower == "en_proceso":
            where_clause = "ot.fecha_entrega IS NULL AND ot.fecha_prometida >= GETDATE()"
        elif estado_lower == "retrasadas":
            where_clause = "ot.fecha_entrega IS NULL AND ot.fecha_prometida < GETDATE()"
        elif estado_lower == "pendientes":
            # Por ahora, pendientes no tiene lógica específica
            where_clause = "1 = 0"  # Retorna vacío
        else:
            return {"success": False, "error": "Estado no válido"}
        
        query = text(f"""
            SELECT 
                ot.id, 
                a.descripcion as articulo, 
                ot.fecha_prometida, 
                ot.fecha_entrega,
                s.nombre as sector,
                p.descripcion as prioridad
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            JOIN sector s ON ot.id_sector = s.id
            JOIN prioridad p ON ot.id_prioridad = p.id
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
                fecha_prom = orden.fecha_prometida.date() if orden.fecha_prometida else None
                if fecha_prom and fecha_prom < hoy:
                    estado_display = "Retrasada"
                else:
                    estado_display = "En Proceso"
                fecha_display = orden.fecha_prometida
            
            data.append({
                "id": orden.id,
                "articulo": orden.articulo,
                "fecha_entrega": fecha_display.strftime("%Y-%m-%d") if fecha_display else None,
                "estado": estado_display,
                "sector": orden.sector,
                "prioridad": orden.prioridad,
                "cantidad": 1  # Default
            })
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ordenes-por-estado: {e}")
        return {"success": False, "error": str(e)}
