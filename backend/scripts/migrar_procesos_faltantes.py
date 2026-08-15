"""Migra los procesos de las OTs abiertas que quedaron sin ninguno en SPMM.

Por qué hace falta: el sync dejó de traer los procesos por OT el 6-jul (acuerdo del
cutover: SPMM es el único dueño de los procesos, porque el sync los pisaba cada 5
minutos). Desde entonces, toda OT nueva creada en el sistema viejo llega SIN procesos.

Corre en seco por defecto. Con --aplicar escribe.

    venv/bin/python -m backend.scripts.migrar_procesos_faltantes
    venv/bin/python -m backend.scripts.migrar_procesos_faltantes --aplicar
"""
import asyncio, os, re, sys
import asyncpg
from dotenv import load_dotenv

import backend.scripts.sync_db as sync_db

APLICAR = "--aplicar" in sys.argv


def _url():
    load_dotenv()
    return re.sub(r"^postgresql\+\w+://", "postgresql://", os.getenv("SUPABASE_DB_URL")).split("?")[0]


def _nombre(proceso: str) -> str:
    """'6 - TORNO CNC' -> 'TORNO CNC'.

    El legacy guarda el proceso como '<id> - <NOMBRE>'. El corte por el primer guión
    lo hace el SQL del sync (Q_PROCESOS, con CHARINDEX); acá hay que hacerlo a mano,
    y después pasar por el mismo normalizador de espacios para que el nombre coincida
    con el que quedó en el catálogo.
    """
    txt = proceso or ""
    if "-" in txt:
        txt = txt.split("-", 1)[1]
    return sync_db._nombre_proceso(txt)


def _minutos(total: str) -> int:
    """'01:23' -> 83. El legacy guarda el tiempo como texto HH:MM."""
    if not total:
        return 0
    m = re.match(r"^\s*(\d+):(\d{1,2})", str(total))
    if not m:
        return 0
    return int(m.group(1)) * 60 + int(m.group(2))


async def main():
    c = await asyncpg.connect(_url())
    try:
        objetivo = await c.fetch("""
            select ot.id, ot.id_otvieja
            from orden_trabajo ot
            where coalesce(ot.finalizadototal,0)=0 and ot.fecha_entrega is null
              and not exists (select 1 from orden_trabajo_proceso p where p.id_orden_trabajo=ot.id)
              and ot.id_otvieja is not null
        """)
        por_vieja = {f["id_otvieja"]: f["id"] for f in objetivo}
        if not por_vieja:
            print("No hay OTs abiertas sin procesos. Nada que migrar.")
            return

        lista = ",".join(str(v) for v in por_vieja)
        crudas = await sync_db._leer(f"""
            SELECT op.Idot AS idot, op.orden, op.proceso, op.total
            FROM dbo.otrabajoProceso op
            WHERE op.Idot IN ({lista})
        """)

        catalogo = {r["nombre"].strip().upper(): r["id"]
                    for r in await c.fetch("select id, nombre from proceso")}

        # Se agrupa por (OT, proceso) sumando tiempos y quedándose con el primer orden.
        # El legacy tiene el mismo proceso repetido en varias líneas (son partes del
        # laburo, no procesos distintos): insertarlas sueltas es lo que dejó 120 OTs
        # con ROSCADO dos veces en la migración de julio.
        agrupado, sin_match = {}, {}
        for r in crudas:
            nom = _nombre(r["proceso"])
            if not nom:
                continue
            pid = catalogo.get(nom.strip().upper())
            if pid is None:
                sin_match[nom] = sin_match.get(nom, 0) + 1
                continue
            clave = (por_vieja[r["idot"]], pid)
            d = agrupado.setdefault(clave, {"orden": r["orden"] or 1, "minutos": 0})
            d["orden"] = min(d["orden"], r["orden"] or 1)
            d["minutos"] += _minutos(r["total"])

        ots_tocadas = {k[0] for k in agrupado}
        print(f"OTs abiertas sin procesos      : {len(por_vieja)}")
        print(f"Líneas leídas del legacy       : {len(crudas)}")
        print(f"Filas a insertar (agrupadas)   : {len(agrupado)} en {len(ots_tocadas)} OTs")
        print(f"Minutos totales                : {sum(d['minutos'] for d in agrupado.values())}")
        if sin_match:
            print(f"\nNombres que NO están en el catálogo de SPMM ({len(sin_match)}):")
            for n, veces in sorted(sin_match.items(), key=lambda x: -x[1]):
                print(f"   {n[:50]:<50} x{veces}")
        else:
            print("\nTodos los nombres resuelven contra el catálogo de SPMM.")

        sin_tiempo = sum(1 for d in agrupado.values() if d["minutos"] == 0)
        print(f"\nFilas que quedarían con tiempo 0: {sin_tiempo}")

        if not APLICAR:
            print("\n(corrida en seco — no se escribió nada; usar --aplicar para insertar)")
            return

        insertadas = 0
        async with c.transaction():
            for (id_ot, id_proc), d in agrupado.items():
                await c.execute("""
                    insert into orden_trabajo_proceso
                        (id_orden_trabajo, id_proceso, orden, id_estado, tiempo_proceso, cant_operarios)
                    values ($1, $2, $3, 1, $4, 1)
                """, id_ot, id_proc, d["orden"], d["minutos"])
                insertadas += 1
        print(f"\nINSERTADAS {insertadas} filas en {len(ots_tocadas)} OTs.")
        print("revertir: delete from orden_trabajo_proceso where id_orden_trabajo in ("
              + ",".join(str(o) for o in sorted(ots_tocadas)) + ");")
    finally:
        await c.close()


asyncio.run(main())
