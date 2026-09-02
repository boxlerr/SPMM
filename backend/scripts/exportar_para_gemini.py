"""
Exporta el historial para analizarlo con Gemini.

Sale de la reunión del 2/9 con Lucas: quiere comparar los tiempos estimados contra los
reales para afinar la estimación de los procesos.

⚠️ LO PRIMERO QUE HAY QUE SABER: el tiempo real por proceso NO está cargado. De 5.577
pasadas, 48 tienen inicio y fin real, y las 5.577 figuran en estado «Pendiente» — nadie
marca el avance en el sistema. Así que la comparación proceso por proceso no se puede
hacer todavía, por más vueltas que se le dé a los datos.

Lo que SÍ hay, y es lo que exporta esto:

  1. `metlo-procesos.csv` — una fila por pasada de proceso, con los minutos ESTIMADOS.
     Sirve para ver la dispersión de las estimaciones: hoy «SOLDADURA CON MIG» está
     cargada entre 1 y 3.840 minutos según la OT. Eso solo ya es material para revisar.

  2. `metlo-ordenes.csv` — una fila por OT, con fecha prometida y fecha de entrega.
     Son 960 órdenes comparables: ES un estimado contra un real, pero a nivel de orden
     y no de proceso.

  3. `metlo-resumen.md` — lo mismo contado en texto, con los agregados ya hechos.
     Va aparte porque NotebookLM toma texto y markdown seguro; un CSV puede no
     entrarle según la versión.

Corre:  venv/bin/python -m backend.scripts.exportar_para_gemini [carpeta_destino]
"""
import asyncio
import csv
import os
import re
import sys
from collections import defaultdict

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

URL = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or ""
if URL.startswith("postgresql://"):
    URL = URL.replace("postgresql://", "postgresql+asyncpg://", 1)
URL = re.sub(r"\?.*$", "", URL)

DESTINO = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads")

# Una fila por pasada. Se nombra todo por su nombre visible: el que abre el CSV no
# tiene la base al lado para traducir ids.
Q_PROCESOS = """
SELECT
    COALESCE(ot.id_otvieja, ot.id)            AS ot,
    TO_CHAR(ot.fecha_entrada, 'YYYY-MM-DD')   AS fecha_entrada,
    COALESCE(c.nombre, '')                    AS cliente,
    COALESCE(a.cod_articulo, '')              AS codigo_producto,
    COALESCE(a.descripcion, '')               AS producto,
    ot.unidades                               AS cantidad,
    COALESCE(pr.descripcion, '')              AS prioridad,
    otp.orden                                 AS paso,
    p.nombre                                  AS proceso,
    COALESCE(m.nombre, '')                    AS maquina_elegida,
    otp.tiempo_proceso                        AS minutos_estimados,
    otp.cant_operarios                        AS personas,
    COALESCE(o.nombre || ' ' || o.apellido, '') AS persona_elegida,
    TO_CHAR(otp.inicio_real, 'YYYY-MM-DD HH24:MI') AS inicio_real,
    TO_CHAR(otp.fin_real,    'YYYY-MM-DD HH24:MI') AS fin_real,
    CASE WHEN otp.inicio_real IS NOT NULL AND otp.fin_real IS NOT NULL
         THEN ROUND(EXTRACT(EPOCH FROM (otp.fin_real - otp.inicio_real)) / 60)
    END                                       AS minutos_reales,
    COALESCE(e.descripcion, '')               AS estado
FROM orden_trabajo_proceso otp
JOIN orden_trabajo ot ON ot.id = otp.id_orden_trabajo
JOIN proceso p        ON p.id  = otp.id_proceso
LEFT JOIN cliente c   ON c.id  = ot.id_cliente
LEFT JOIN articulo a  ON a.id  = ot.id_articulo
LEFT JOIN prioridad pr ON pr.id = ot.id_prioridad
LEFT JOIN maquinaria m ON m.id = otp.id_maquinaria
LEFT JOIN operario o  ON o.id  = otp.id_operario
LEFT JOIN estado_proceso e ON e.id = otp.id_estado
ORDER BY ot.fecha_entrada DESC NULLS LAST, ot, otp.orden
"""

# Una fila por OT. Acá sí hay un estimado contra un real: prometida contra entrega.
# El año 1950 es el centinela del sistema viejo para "sin fecha".
Q_ORDENES = """
SELECT
    COALESCE(ot.id_otvieja, ot.id)          AS ot,
    TO_CHAR(ot.fecha_entrada, 'YYYY-MM-DD') AS fecha_entrada,
    TO_CHAR(NULLIF_1950(ot.fecha_prometida), 'YYYY-MM-DD') AS fecha_prometida,
    TO_CHAR(NULLIF_1950(ot.fecha_entrega),   'YYYY-MM-DD') AS fecha_entrega,
    CASE WHEN NULLIF_1950(ot.fecha_prometida) IS NOT NULL
          AND NULLIF_1950(ot.fecha_entrega)   IS NOT NULL
         THEN (ot.fecha_entrega::date - ot.fecha_prometida::date)
    END                                     AS dias_de_atraso,
    COALESCE(c.nombre, '')                  AS cliente,
    COALESCE(a.cod_articulo, '')            AS codigo_producto,
    COALESCE(a.descripcion, '')             AS producto,
    ot.unidades                             AS cantidad,
    ot.cantidad_entregada                   AS entregado,
    COALESCE(pr.descripcion, '')            AS prioridad,
    COALESCE(s.nombre, '')                  AS sector,
    (SELECT COUNT(*) FROM orden_trabajo_proceso x WHERE x.id_orden_trabajo = ot.id) AS pasos,
    (SELECT COALESCE(SUM(x.tiempo_proceso), 0) FROM orden_trabajo_proceso x
      WHERE x.id_orden_trabajo = ot.id)     AS minutos_estimados_totales,
    CASE WHEN COALESCE(ot.finalizadototal, 0) = 1 THEN 'finalizada' ELSE 'abierta' END AS estado
FROM orden_trabajo ot
LEFT JOIN cliente c    ON c.id  = ot.id_cliente
LEFT JOIN articulo a   ON a.id  = ot.id_articulo
LEFT JOIN prioridad pr ON pr.id = ot.id_prioridad
LEFT JOIN sector s     ON s.id  = ot.id_sector
ORDER BY ot.fecha_entrada DESC NULLS LAST
"""

# El legacy dejaba '1950-01-01' donde no había fecha. Sin esto, el atraso da 27.000 días.
FUNCION_1950 = """
CREATE OR REPLACE FUNCTION NULLIF_1950(f timestamp) RETURNS timestamp AS $$
  SELECT CASE WHEN f IS NULL OR EXTRACT(YEAR FROM f) <= 1950 THEN NULL ELSE f END;
$$ LANGUAGE SQL IMMUTABLE;
"""


def _escribir_csv(ruta, filas):
    if not filas:
        return 0
    with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
        w.writeheader()
        w.writerows(filas)
    return len(filas)


def _resumen(procesos, ordenes) -> str:
    con_real = [p for p in procesos if p["minutos_reales"] is not None]
    comparables = [o for o in ordenes if o["dias_de_atraso"] is not None]
    a_tiempo = [o for o in comparables if o["dias_de_atraso"] <= 0]

    por_proceso = defaultdict(list)
    for p in procesos:
        if p["minutos_estimados"]:
            por_proceso[p["proceso"]].append(p["minutos_estimados"])
    dispersos = sorted(
        ((n, v) for n, v in por_proceso.items() if len(v) >= 20),
        key=lambda kv: max(kv[1]) / max(1, min(kv[1])),
        reverse=True,
    )[:15]

    lineas = [
        "# Metalúrgica Longchamps — historial de órdenes de trabajo",
        "",
        f"Exportado del sistema SPMM. {len(ordenes)} órdenes y {len(procesos)} pasadas de proceso.",
        "",
        "## Lo primero: qué hay y qué no",
        "",
        f"- **El tiempo real por proceso casi no está cargado**: {len(con_real)} de {len(procesos)} "
        "pasadas tienen hora de inicio y de fin. El resto figura en «Pendiente». Comparar "
        "estimado contra real proceso por proceso todavía no se puede.",
        f"- **A nivel de orden sí hay con qué**: {len(comparables)} órdenes tienen fecha prometida "
        "y fecha de entrega, así que ahí se puede medir el cumplimiento.",
        f"- De esas, **{len(a_tiempo)} se entregaron en fecha o antes** "
        f"({round(100 * len(a_tiempo) / max(1, len(comparables)))}%).",
        "",
        "## Los procesos con la estimación más dispar",
        "",
        "El mismo trabajo cargado con tiempos muy distintos según la orden. No quiere decir "
        "que esté mal —una pieza grande lleva más que una chica— pero es por donde conviene "
        "empezar a mirar si se quiere estandarizar.",
        "",
        "| Proceso | Veces | Mínimo | Máximo | Promedio |",
        "|---|---|---|---|---|",
    ]
    for nombre, vals in dispersos:
        lineas.append(
            f"| {nombre} | {len(vals)} | {min(vals)} min | {max(vals)} min | "
            f"{round(sum(vals) / len(vals))} min |"
        )

    lineas += [
        "",
        "## Qué hay en cada archivo",
        "",
        "**metlo-procesos.csv** — una fila por pasada de proceso de cada orden:",
        "",
        "- `ot`, `fecha_entrada`, `cliente`, `codigo_producto`, `producto`, `cantidad`, `prioridad`",
        "- `paso`: el número de orden del proceso dentro de la OT",
        "- `proceso`: qué trabajo es",
        "- `maquina_elegida` / `persona_elegida`: sólo si alguien las eligió a mano al cargar",
        "- `minutos_estimados`: lo que se cargó como tiempo previsto",
        "- `personas`: cuántas hacen falta en simultáneo",
        "- `inicio_real`, `fin_real`, `minutos_reales`: lo poco que hay cargado",
        "- `estado`",
        "",
        "**metlo-ordenes.csv** — una fila por orden:",
        "",
        "- `fecha_prometida` contra `fecha_entrega`, y `dias_de_atraso` (negativo = antes de tiempo)",
        "- `pasos` y `minutos_estimados_totales`: el tamaño del trabajo",
        "- `cantidad` contra `entregado`",
        "",
        "## Preguntas que estos datos SÍ pueden contestar",
        "",
        "- ¿Qué clientes o productos se entregan sistemáticamente tarde?",
        "- ¿El atraso tiene que ver con la cantidad de pasos o con los minutos totales?",
        "- ¿Qué procesos tienen la estimación más despareja entre órdenes parecidas?",
        "- ¿Cuánto tiempo total se le carga a cada máquina por mes?",
        "",
        "## Y las que NO, hasta que se cargue el avance",
        "",
        "- Cuánto tarda de verdad cada proceso.",
        "- Qué tan buena es la estimación de cada uno.",
        "- Quién tarda más o menos en el mismo trabajo.",
        "",
        "Para eso hace falta que el taller marque inicio y fin en el sistema. Es el dato que "
        "hoy falta, y ninguna herramienta de análisis lo puede inventar.",
    ]
    return "\n".join(lineas)


async def main():
    eng = create_async_engine(URL)
    async with eng.begin() as c:
        await c.execute(sa.text(FUNCION_1950))
    async with eng.connect() as c:
        procesos = [dict(r) for r in (await c.execute(sa.text(Q_PROCESOS))).mappings()]
        ordenes = [dict(r) for r in (await c.execute(sa.text(Q_ORDENES))).mappings()]
    await eng.dispose()

    os.makedirs(DESTINO, exist_ok=True)
    n1 = _escribir_csv(os.path.join(DESTINO, "metlo-procesos.csv"), procesos)
    n2 = _escribir_csv(os.path.join(DESTINO, "metlo-ordenes.csv"), ordenes)
    md = os.path.join(DESTINO, "metlo-resumen.md")
    with open(md, "w", encoding="utf-8") as f:
        f.write(_resumen(procesos, ordenes))

    print(f"metlo-procesos.csv  → {n1} filas")
    print(f"metlo-ordenes.csv   → {n2} filas")
    print(f"metlo-resumen.md    → listo")
    print(f"\nEn {DESTINO}")


if __name__ == "__main__":
    asyncio.run(main())
