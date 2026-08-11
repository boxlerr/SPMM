"""
Audita los procesos SIN RANGO que se usan en OTs.

Por qué importa: la elegibilidad sale de los rangos (rango del operario × rangos del
proceso). Un proceso sin ningún rango cargado no significa "no lo hace nadie" sino lo
contrario — en PlanificacionService, `if not rangos_proc: operarios_validos =
REAL_OP_IDS[:]`, o sea que se lo puede asignar a CUALQUIERA, incluido quien no sabe
hacerlo. Y no se nota: el plan sale igual, solo que con la persona equivocada.

De dónde salen: el catálogo se cosecha de texto libre del legacy (sync_db.Q_PROCESOS
saca un DISTINCT de lo que se tipeó en cada línea de OT), así que cada variante de
tipeo entra como proceso nuevo y nace sin rango.

El script NO escribe nada. Usa las mismas funciones del planificador para clasificar,
así que lo que reporta es lo que realmente pasa en una corrida — incluido el rescate
por nombre de máquina, que salva a algunos sin que se vea en la tabla `rango_proceso`.

Uso:
    venv/bin/python -m backend.scripts.auditoria_procesos_sin_rango
"""
import asyncio
import os
import re

import asyncpg
from dotenv import load_dotenv

from backend.application.PlanificacionService import (
    _get_tipo_proceso,
    familia_requerida_from_proceso,
    proceso_usa_maquina,
)


def _url():
    load_dotenv()
    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("Falta SUPABASE_DB_URL (o DATABASE_URL) en el entorno/.env")
    # asyncpg no entiende el prefijo de SQLAlchemy ni los params de driver.
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url).split("?")[0]


async def auditar(conn):
    maquinas = await conn.fetch("""
        select m.nombre,
               coalesce(array_agg(rm.id_rango) filter (where rm.id_rango is not null), '{}') as rangos
        from maquinaria m
        left join rango_maquinaria rm on rm.id_maquinaria = m.id
        group by m.id, m.nombre
    """)
    rangos_nombre = {r["id"]: r["nombre"] for r in await conn.fetch("select id, nombre from rango")}

    procesos = await conn.fetch("""
        select p.id, p.nombre,
               count(*) filter (where o.id_estado <> 3) as pendientes,
               count(distinct o.id_orden_trabajo)       as ots
        from proceso p
        join orden_trabajo_proceso o on o.id_proceso = p.id
        where not exists (select 1 from rango_proceso rp where rp.id_proceso = p.id)
        group by p.id, p.nombre
    """)

    def rescate_por_maquina(nombre_proc):
        """El mismo match que hace planificar() cuando el proceso no tiene rangos."""
        n = (nombre_proc or "").strip().lower()
        for m in maquinas:
            if not list(m["rangos"]):
                continue
            nm = (m["nombre"] or "").strip().lower()
            if nm and (nm in n or n in nm):
                return m["nombre"], [rangos_nombre.get(r, r) for r in m["rangos"]]
        return None, None

    abiertos, rescatados = [], []
    for p in procesos:
        nombre = p["nombre"] or ""
        maq, rangos = rescate_por_maquina(nombre)
        fila = {
            "id": p["id"],
            "nombre": nombre,
            "pendientes": p["pendientes"],
            "ots": p["ots"],
            "tipo": _get_tipo_proceso(nombre.lower()),
            "familia": (
                familia_requerida_from_proceso(nombre.lower())
                if proceso_usa_maquina(nombre.lower()) else ""
            ),
        }
        if rangos:
            fila["rescate"] = f"máquina '{maq}' -> {rangos}"
            rescatados.append(fila)
        else:
            abiertos.append(fila)

    return abiertos, rescatados


def imprimir(abiertos, rescatados):
    print(f"\nProcesos sin rango usados en OTs: {len(abiertos) + len(rescatados)}")
    print(f"  rescatados por nombre de máquina: {len(rescatados)}")
    print(f"  ASIGNABLES A CUALQUIERA:          {len(abiertos)}"
          f"  ({sum(f['pendientes'] for f in abiertos)} líneas pendientes)\n")

    if abiertos:
        print(f"{'id':>6} {'pend':>5} {'OTs':>4}  {'tipo':<19} nombre")
        print("-" * 92)
        for f in sorted(abiertos, key=lambda x: (-x["pendientes"], x["nombre"])):
            print(f"{f['id']:>6} {f['pendientes']:>5} {f['ots']:>4}  {f['tipo']:<19} {f['nombre']}")

    if rescatados:
        print(f"\nRescatados (no están abiertos, pero dependen de que el nombre siga matcheando):")
        for f in sorted(rescatados, key=lambda x: -x["pendientes"]):
            print(f"{f['id']:>6} {f['pendientes']:>5}  {f['nombre']:<36} {f['rescate']}")

    print("\nPara cerrarlos: Recursos > Procesos, asignarle el/los rango(s) que lo hacen.")
    print("Si es un duplicado por tipeo, conviene fusionarlo con el bueno en vez de darle rango.\n")


async def main():
    conn = await asyncpg.connect(_url(), statement_cache_size=0)
    try:
        imprimir(*await auditar(conn))
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
