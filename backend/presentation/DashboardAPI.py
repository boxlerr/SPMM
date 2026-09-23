"""
El Dashboard (RF-02: «tablero con el estado actual de todas las órdenes en curso,
ordenadas por prioridad, fechas y estado»).

Cada tarjeta y la lista que abre leen el estado de la OT de la misma expresión
(infrastructure/estado_ordenes.py): la tarjeta «Retrasadas 40» abre una lista de 40.
Hasta el 23/09 las listas de Pendientes y Retrasadas usaban GETDATE, de SQL Server, y en
Postgres se abrían vacías; y el rótulo de cada fila tomaba el 1950-01-01 del sistema
viejo como fecha de entrega y mostraba OT abiertas como «Completada». Ver ese módulo.

Las fechas que salen de acá son AAAA-MM-DD o null: un centinela (1950-01-01, 3000-01-01)
sale como null, «sin fecha», nunca como una fecha.

Las listas traen `numero` (el N° de OT con el que el taller conoce la orden,
id_otvieja) además de `id` (la clave interna): la pantalla mostraba la clave interna
como si fuera el número de la OT.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import text

from backend.infrastructure.db import SessionLocal
from backend.infrastructure.estado_ordenes import (
    ALIAS,
    ESTADO_SQL,
    ESTADOS,
    POR_ENTREGAR_SQL,
    ROTULO,
    consulta,
    fecha_o_nada,
    fecha_real,
    hoy_ar,
    leer_fecha,
    parametros,
)

router = APIRouter(prefix="/api/dashboard")

# Órdenes críticas y próximas entregas: hoy y los 7 días que siguen, enteros. Antes se
# cortaba con la HORA (now() .. now() + 7 días), así que una OT prometida para hoy a las
# 00:00 dejaba de ser «crítica» apenas pasada la medianoche: justo la más urgente.
DIAS_PROXIMOS = 7


async def get_db():
    async with SessionLocal() as session:
        yield session


def _dia(valor) -> datetime | None:
    """El día (00:00) de un valor leído de la base, venga como datetime, date o texto."""
    f = leer_fecha(valor)
    return f.replace(hour=0, minute=0, second=0, microsecond=0) if f else None


# Lo que muestra cada fila de las listas del Dashboard. UNA consulta para todas (la de
# un estado, la de una prioridad, la de un día): así una OT se ve igual abra la lista
# que abra. LEFT JOIN en todo: una OT sin cliente, sin sector o con un artículo que ya no
# está en el catálogo sigue siendo una OT y la tarjeta la cuenta.
_FILAS_SQL = f"""
    SELECT
        ot.id,
        ot.id_otvieja,
        a.descripcion   AS articulo,
        a.cod_articulo,
        ot.fecha_entrada,
        ot.unidades,
        ot.fecha_prometida,
        ot.fecha_entrega,
        s.nombre        AS sector,
        c.nombre        AS cliente,
        p.descripcion   AS prioridad,
        {ESTADO_SQL}    AS estado,
        (SELECT COUNT(*) FROM orden_trabajo_proceso x
          WHERE x.id_orden_trabajo = ot.id) AS total_procesos,
        (SELECT COUNT(*) FROM orden_trabajo_proceso x
          WHERE x.id_orden_trabajo = ot.id AND x.id_estado = 3) AS procesos_completados,
        (SELECT pr.nombre FROM orden_trabajo_proceso x
           JOIN proceso pr ON pr.id = x.id_proceso
          WHERE x.id_orden_trabajo = ot.id AND x.id_estado = 2
          ORDER BY x.orden, x.id
          LIMIT 1) AS proceso_actual
    FROM orden_trabajo ot
    LEFT JOIN articulo  a ON a.id = ot.id_articulo
    LEFT JOIN sector    s ON s.id = ot.id_sector
    LEFT JOIN prioridad p ON p.id = ot.id_prioridad
    LEFT JOIN cliente   c ON c.id = ot.id_cliente
"""


def _fila(r) -> dict:
    total = int(r.total_procesos or 0)
    terminados = int(r.procesos_completados or 0)
    return {
        "id": r.id,
        "numero": r.id_otvieja or r.id,
        "articulo": r.articulo or "Sin artículo",
        "cod_articulo": r.cod_articulo,
        "fecha_entrada": fecha_o_nada(r.fecha_entrada),
        "fecha_prometida": fecha_o_nada(r.fecha_prometida),
        # La entrega REAL, o null. Antes, en las OT abiertas, este campo traía la
        # prometida y la columna «F. Entrega» mostraba como entregada una fecha que era
        # una promesa.
        "fecha_entrega": fecha_o_nada(r.fecha_entrega),
        "estado": ROTULO.get(r.estado, r.estado),
        "estado_codigo": r.estado,
        "sector": r.sector or "Sin sector",
        "cliente": r.cliente or "Sin Cliente",
        "prioridad": r.prioridad or "Sin prioridad",
        # Las unidades de la OT. null si no se cargaron: antes se inventaba un 1.
        "cantidad": r.unidades,
        "proceso_actual": r.proceso_actual,
        "procesos_totales": total,
        "procesos_pendientes": total - terminados,
    }


@router.get("/estadisticas")
async def get_estadisticas(db=Depends(get_db)):
    """Cuántas OT hay en cada estado (las cuatro tarjetas de «Estado de Órdenes»).

    Los cuatro estados salen de un CASE (estado_ordenes.ESTADO_SQL): cada OT cae en uno
    solo y los cuatro suman el total, que son TODAS las OT de la base. No depende de los
    catálogos (artículo, sector, prioridad): una OT sin esos datos cuenta igual.
    """
    try:
        query = consulta(f"""
            WITH est AS (
                SELECT {ESTADO_SQL} AS estado, ot.fecha_orden
                FROM orden_trabajo ot
            )
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN estado = 'completadas' THEN 1 ELSE 0 END) AS completadas,
                SUM(CASE WHEN estado = 'en_curso'    THEN 1 ELSE 0 END) AS en_proceso,
                SUM(CASE WHEN estado = 'retrasadas'  THEN 1 ELSE 0 END) AS retrasadas,
                SUM(CASE WHEN estado = 'pendientes'  THEN 1 ELSE 0 END) AS pendientes,
                SUM(CASE WHEN fecha_orden >= :hoy     THEN 1 ELSE 0 END) AS creadas_hoy
            FROM est
        """)
        result = await db.execute(query, parametros())
        row = result.mappings().first() or {}

        total = int(row.get("total") or 0)
        completadas = int(row.get("completadas") or 0)
        en_proceso = int(row.get("en_proceso") or 0)
        retrasadas = int(row.get("retrasadas") or 0)
        pendientes = int(row.get("pendientes") or 0)
        creadas_hoy = int(row.get("creadas_hoy") or 0)

        # Los porcentajes se calculan sobre el total real (los 4 estados ya cubren todo).
        denom = max(total, 1)

        data = {
            "total": total,
            "completadas": completadas,
            "en_proceso": en_proceso,
            "pendientes": pendientes,
            "retrasadas": retrasadas,
            "creadas_hoy": creadas_hoy,
            "porcentaje_completadas": round((completadas / denom) * 100, 1),
            "porcentaje_en_proceso": round((en_proceso / denom) * 100, 1),
            "porcentaje_pendientes": round((pendientes / denom) * 100, 1),
            "porcentaje_retrasadas": round((retrasadas / denom) * 100, 1),
        }

        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en estadisticas: {e}")
        return {"success": False, "error": str(e)}


async def _por_entregar_entre(db, desde: datetime, hasta: datetime, limite: int | None = None):
    """Las OT por entregar con fecha prometida en [desde, hasta), la más próxima primero.

    Es la misma selección para las órdenes críticas, la línea de próximas entregas y la
    lista de un día: el número de un día de la línea es el largo de su lista.
    """
    sql = f"""
        SELECT * FROM ({_FILAS_SQL}
            WHERE {POR_ENTREGAR_SQL}
              AND ot.fecha_prometida >= :desde
              AND ot.fecha_prometida <  :hasta
        ) t
        ORDER BY t.fecha_prometida ASC, t.id ASC
    """
    if limite:
        sql += f" LIMIT {int(limite)}"
    result = await db.execute(consulta(sql), parametros(desde=desde, hasta=hasta))
    return result.fetchall()


@router.get("/ordenes-criticas")
async def get_ordenes_criticas(db=Depends(get_db)):
    """Las OT por entregar prometidas para hoy o los próximos 7 días (las 10 primeras).

    «Por entregar» = ni finalizada ni con una entrega real cargada: una OT finalizada no
    está «por vencer» aunque nadie le haya cargado la fecha de entrega.
    """
    try:
        hoy = hoy_ar()
        filas = await _por_entregar_entre(db, hoy, hoy + timedelta(days=DIAS_PROXIMOS + 1), limite=10)
        data = []
        for r in filas:
            f = _fila(r)
            dia = _dia(r.fecha_prometida)
            data.append({
                "id": f["id"],
                "numero": f["numero"],
                "articulo": f["articulo"],
                # Se llama «fecha_entrega» porque así lo lee la tarjeta: es la fecha en
                # que hay que entregarla, la prometida.
                "fecha_entrega": f["fecha_prometida"],
                "dias_restantes": (dia - hoy).days if dia else 0,
                "prioridad": f["prioridad"],
                "estado": f["estado"],
            })
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ordenes-criticas: {e}")
        return {"success": False, "error": str(e)}


@router.get("/timeline-entregas")
async def get_timeline_entregas(db=Depends(get_db)):
    """Cuántas OT por entregar hay prometidas para cada día, de hoy a hoy + 7.

    Se agrupa acá y no con un GROUP BY de la fecha: así sale de la MISMA selección que la
    lista del día (_por_entregar_entre) y no hay un CAST que cada base lea distinto.
    """
    try:
        hoy = hoy_ar()
        filas = await _por_entregar_entre(db, hoy, hoy + timedelta(days=DIAS_PROXIMOS + 1))
        por_dia: dict[str, int] = {}
        for r in filas:
            dia = _dia(r.fecha_prometida)
            if dia is None:
                continue
            clave = dia.strftime("%Y-%m-%d")
            por_dia[clave] = por_dia.get(clave, 0) + 1
        data = [{"fecha": f, "ordenes": n} for f, n in sorted(por_dia.items())]
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en timeline-entregas: {e}")
        return {"success": False, "error": str(e)}


@router.get("/clientes-mayor-volumen")
async def get_clientes_mayor_volumen(db=Depends(get_db)):
    """Los 5 clientes con más órdenes (todas, históricas y actuales)."""
    try:
        query = text("""
            SELECT c.nombre as cliente, COUNT(ot.id) as cantidad
            FROM orden_trabajo ot
            JOIN cliente c ON ot.id_cliente = c.id
            GROUP BY c.nombre
            ORDER BY cantidad DESC
            LIMIT 5
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
    """Los 5 artículos con más unidades en OT finalizadas."""
    try:
        # COALESCE: en Postgres, ORDER BY ... DESC pone los NULL PRIMERO (SQL Server los
        # ponía al final). Un artículo cuyas OT no tienen unidades cargadas encabezaba el
        # ranking con «null».
        query = text("""
            SELECT a.descripcion as articulo, COALESCE(SUM(ot.unidades), 0) as cantidad
            FROM orden_trabajo ot
            JOIN articulo a ON ot.id_articulo = a.id
            WHERE COALESCE(ot.finalizadototal, 0) = 1
            GROUP BY a.descripcion
            ORDER BY cantidad DESC
            LIMIT 5
        """)

        result = await db.execute(query)
        articulos = result.fetchall()

        data = []
        for row in articulos:
            data.append({
                "articulo": row.articulo,
                "cantidad": int(row.cantidad or 0)
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
                SELECT ot.id, SUM(COALESCE(otp.tiempo_proceso, 0)) as tiempo_total
                FROM orden_trabajo ot
                LEFT JOIN orden_trabajo_proceso otp ON ot.id = otp.id_orden_trabajo
                WHERE COALESCE(ot.finalizadototal, 0) = 1
                GROUP BY ot.id
            ) AS tiempos_por_orden
            WHERE tiempo_total > 0
        """)

        result = await db.execute(query)
        promedio_horas = float(result.scalar() or 0)

        dias = int(promedio_horas // 24)
        horas = int(promedio_horas % 24)

        return {"success": True, "data": {"dias": dias, "horas": horas}}
    except Exception as e:
        print(f"Error en tiempo-promedio: {e}")
        return {"success": False, "error": str(e)}


@router.get("/ordenes-por-prioridad/{prioridad}")
async def get_ordenes_por_prioridad(prioridad: str, db=Depends(get_db)):
    """Las OT de una prioridad (históricas y actuales): la barra de «Órdenes por
    prioridad» que se tocó. Son las mismas que cuenta esa barra."""
    try:
        query = consulta(f"""
            SELECT * FROM ({_FILAS_SQL}
                WHERE p.descripcion = :prioridad
            ) t
            ORDER BY t.id DESC
        """)
        result = await db.execute(query, parametros(prioridad=prioridad))
        data = []
        for r in result.fetchall():
            f = _fila(r)
            # Esta lista muestra UNA fecha: la entrega si ya salió, si no la prometida.
            f["fecha_entrega"] = f["fecha_entrega"] or f["fecha_prometida"]
            data.append(f)
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en ordenes-por-prioridad: {e}")
        return {"success": False, "error": str(e)}


@router.get("/ordenes-por-estado/{estado}")
async def get_ordenes_por_estado(estado: str, db=Depends(get_db)):
    """Las OT de un estado: la lista que abre cada tarjeta de «Estado de Órdenes».

    Filtra con la MISMA expresión que cuenta la tarjeta, así que trae exactamente las
    que la tarjeta dice. Orden de salida: las abiertas por fecha prometida, la más
    urgente arriba y las sin fecha al final; las completadas, la última entregada arriba.
    La pantalla después reordena por la columna que se toque.
    """
    try:
        codigo = ALIAS.get((estado or "").strip().lower())
        if codigo not in ESTADOS:
            return {"success": False, "error": "Estado no válido"}

        # Las sin fecha van juntas al final y entre ellas por número: el centinela no
        # es una fecha y no tiene por qué ordenar (un 1950 no va «antes» que un 3000).
        if codigo == "completadas":
            real = fecha_real("t.fecha_entrega")
            orden = (f"CASE WHEN {real} THEN 0 ELSE 1 END, "
                     f"CASE WHEN {real} THEN t.fecha_entrega END DESC, t.id DESC")
        else:
            real = fecha_real("t.fecha_prometida")
            orden = (f"CASE WHEN {real} THEN 0 ELSE 1 END, "
                     f"CASE WHEN {real} THEN t.fecha_prometida END ASC, t.id ASC")

        query = consulta(f"""
            SELECT * FROM ({_FILAS_SQL}) t
            WHERE t.estado = :estado
            ORDER BY {orden}
        """)
        result = await db.execute(query, parametros(estado=codigo))
        return {"success": True, "data": [_fila(r) for r in result.fetchall()]}
    except Exception as e:
        print(f"Error en ordenes-por-estado: {e}")
        return {"success": False, "error": str(e)}


@router.get("/ordenes-por-fecha/{fecha}")
async def get_ordenes_por_fecha(fecha: str, db=Depends(get_db)):
    """Las OT por entregar prometidas para un día: el día de la línea de entregas que se
    tocó. Mismo criterio que cuenta la línea."""
    try:
        try:
            dia = datetime.strptime(fecha, "%Y-%m-%d")
        except ValueError:
            return {"success": False, "error": "Formato de fecha inválido. Use YYYY-MM-DD"}

        filas = await _por_entregar_entre(db, dia, dia + timedelta(days=1))
        return {"success": True, "data": [_fila(r) for r in filas]}
    except Exception as e:
        print(f"Error en ordenes-por-fecha: {e}")
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Rendimiento: tiempo ESTIMADO vs REAL (dashboards pedidos por Metlo, reunión 2-jul).
# El tiempo real sale de fin_real - inicio_real de orden_trabajo_proceso, que se
# estampan solos al marcar el proceso En Proceso -> Finalizado. Sólo contamos
# procesos con inicio_real y fin_real REALES: excluimos el sentinel '1900-01-01'
# (valor placeholder que dejó el sistema viejo) y filas con fin < inicio.
# ---------------------------------------------------------------------------

@router.get("/rendimiento-procesos")
async def get_rendimiento_procesos(db=Depends(get_db)):
    """Estimado vs real agrupado por proceso. Vacío hasta que se marque avance."""
    try:
        query = text("""
            SELECT
                p.id     AS proceso_id,
                p.nombre AS proceso,
                COUNT(*) AS cantidad,
                SUM(COALESCE(otp.tiempo_proceso, 0))                  AS estimado_min,
                SUM(FLOOR(EXTRACT(EPOCH FROM (otp.fin_real - otp.inicio_real)) / 60)) AS real_min
            FROM orden_trabajo_proceso otp
            JOIN proceso p ON p.id = otp.id_proceso
            WHERE otp.inicio_real IS NOT NULL AND otp.fin_real IS NOT NULL
              AND otp.inicio_real > '1950-01-01' AND otp.fin_real > '1950-01-01'
              AND otp.fin_real >= otp.inicio_real
            GROUP BY p.id, p.nombre
            ORDER BY real_min DESC
        """)
        result = await db.execute(query)
        rows = result.mappings().all()
        data = []
        for r in rows:
            est = int(r.get("estimado_min") or 0)
            rea = int(r.get("real_min") or 0)
            desvio = round(((rea - est) / est) * 100, 1) if est > 0 else None
            data.append({
                "proceso_id": r.get("proceso_id"),
                "proceso": r.get("proceso"),
                "cantidad": int(r.get("cantidad") or 0),
                "estimado_min": est,
                "real_min": rea,
                "desvio_pct": desvio,
            })
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en rendimiento-procesos: {e}")
        return {"success": False, "error": str(e)}


@router.get("/rendimiento-operarios")
async def get_rendimiento_operarios(db=Depends(get_db)):
    """Estimado vs real agrupado por operario (cruza planificacion con los tiempos reales).
    Sirve para el ranking de rendimiento. Vacío hasta que se marque avance."""
    try:
        query = text("""
            SELECT
                o.id                              AS operario_id,
                CONCAT(o.nombre, ' ', o.apellido) AS operario,
                COUNT(*) AS cantidad,
                SUM(COALESCE(otp.tiempo_proceso, 0))                  AS estimado_min,
                SUM(FLOOR(EXTRACT(EPOCH FROM (otp.fin_real - otp.inicio_real)) / 60)) AS real_min
            FROM orden_trabajo_proceso otp
            JOIN planificacion pl ON pl.orden_id = otp.id_orden_trabajo AND pl.proceso_id = otp.id_proceso
            JOIN operario o ON o.id = pl.id_operario
            WHERE otp.inicio_real IS NOT NULL AND otp.fin_real IS NOT NULL
              AND otp.inicio_real > '1950-01-01' AND otp.fin_real > '1950-01-01'
              AND otp.fin_real >= otp.inicio_real
              AND pl.id_operario IS NOT NULL
            GROUP BY o.id, o.nombre, o.apellido
            ORDER BY cantidad DESC
        """)
        result = await db.execute(query)
        rows = result.mappings().all()
        data = []
        for r in rows:
            est = int(r.get("estimado_min") or 0)
            rea = int(r.get("real_min") or 0)
            desvio = round(((rea - est) / est) * 100, 1) if est > 0 else None
            data.append({
                "operario_id": r.get("operario_id"),
                "operario": r.get("operario"),
                "cantidad": int(r.get("cantidad") or 0),
                "estimado_min": est,
                "real_min": rea,
                "desvio_pct": desvio,
            })
        return {"success": True, "data": data}
    except Exception as e:
        print(f"Error en rendimiento-operarios: {e}")
        return {"success": False, "error": str(e)}
