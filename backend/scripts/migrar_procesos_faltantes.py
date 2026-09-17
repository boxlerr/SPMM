"""Migra los procesos de las OTs abiertas que quedaron sin ninguno en SPMM.

Por qué hace falta: el sync dejó de traer los procesos por OT el 6-jul (acuerdo del
cutover: SPMM es el único dueño de los procesos, porque el sync los pisaba cada 5
minutos). Desde entonces, toda OT nueva creada en el sistema viejo llega SIN procesos.

QUÉ FILA ES UN PROCESO Y CUÁL NO (arreglado el 10/09/2026)

`dbo.otrabajoProceso` no es la lista de procesos de la OT: es el PARTE DE TRABAJO.
Cada fila tiene `empleado`, `fecha`, `hinicio`, `hfinal` y `REMITO`. Conviven las
LÍNEAS DE PLAN —sin empleado ni fecha, sólo el estimado, que son los procesos— con
los PARTES —con empleado y fecha: trabajo ya hecho, casi siempre ya remitado—.

Este script las leía todas. Por eso una OT terminaba con los pasos duplicados: cada
sesión de trabajo entraba como un proceso más. Ahora se queda con las líneas de
plan, y si la OT no tiene ninguna, agrupa los partes por proceso sumando los
tiempos — que es la única lectura posible cuando el trabajo se hizo sin plan
cargado.

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
    # `statement_cache_size=0`, como el resto de los scripts que hablan con Supabase.
    #
    # Sin esto el script sólo anda por el puerto 5432 (session pooler), que admite 15
    # clientes para TODO el proyecto: un script corriendo ahí le come el lugar a la app
    # y producción empieza a tirar 500. Los scripts van por el 6543 (transaction), y ahí
    # los prepared statements con nombre no sobreviven de una transacción a la otra:
    # «prepared statement __asyncpg_stmt_1__ already exists». La corrida en seco no se
    # daba cuenta —lee poco y no repite— y explotaba recién al escribir, el 17/09/2026.
    c = await asyncpg.connect(_url(), statement_cache_size=0)
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
            SELECT op.Idot AS idot, op.orden, op.proceso, op.total,
                   op.empleado, op.fecha
            FROM dbo.otrabajoProceso op
            WHERE op.Idot IN ({lista})
        """)

        # Mismo normalizador que usa la comparación (_clave): colapsa los espacios de
        # adentro. Sin eso, un proceso del catálogo escrito con doble espacio
        # —'ENSAMBLAJE, PUNTEADO  Y ESCUADRADO', que existe— no machearía nunca y se
        # contaría como "nombre que no está en el catálogo".
        from backend.scripts.auditoria_procesos_vs_legacy import _clave
        catalogo = {_clave(r["nombre"]): r["id"]
                    for r in await c.fetch("select id, nombre from proceso")}

        # Sólo las LÍNEAS DE PLAN, y si no hay ninguna, los partes agrupados.
        # `_procesos_del_legacy` es el mismo criterio que usa la auditoría: una sola
        # lectura del legacy para los dos, así no se pueden ir separando.
        from backend.scripts.auditoria_procesos_vs_legacy import _por_ot, _procesos_del_legacy

        filas, sin_match = [], {}
        for idot, crudas_ot in _por_ot(crudas).items():
            for orden, nom, minutos in _procesos_del_legacy(crudas_ot):
                pid = catalogo.get(nom)
                if pid is None:
                    sin_match[nom] = sin_match.get(nom, 0) + 1
                    continue
                filas.append({
                    "id_ot": por_vieja[idot],
                    "id_proceso": pid,
                    "orden": orden,
                    "minutos": minutos,
                })

        filas.sort(key=lambda f: (f["id_ot"], f["orden"]))
        ots_tocadas = {f["id_ot"] for f in filas}
        repetidas = len(filas) - len({(f["id_ot"], f["id_proceso"]) for f in filas})
        print(f"OTs abiertas sin procesos      : {len(por_vieja)}")
        print(f"Líneas leídas del legacy       : {len(crudas)}")
        print(f"Filas a insertar (tal cual)    : {len(filas)} en {len(ots_tocadas)} OTs")
        print(f"   de esas, pasadas repetidas  : {repetidas}")
        print(f"Minutos totales                : {sum(f['minutos'] for f in filas)}")
        if sin_match:
            print(f"\nNombres que NO están en el catálogo de SPMM ({len(sin_match)}):")
            for n, veces in sorted(sin_match.items(), key=lambda x: -x[1]):
                print(f"   {n[:50]:<50} x{veces}")
        else:
            print("\nTodos los nombres resuelven contra el catálogo de SPMM.")

        sin_tiempo = sum(1 for f in filas if f["minutos"] == 0)
        print(f"\nFilas que quedarían con tiempo 0: {sin_tiempo}")

        if not APLICAR:
            print("\n(corrida en seco — no se escribió nada; usar --aplicar para insertar)")
            return

        insertadas = 0
        async with c.transaction():
            for f in filas:
                await c.execute("""
                    insert into orden_trabajo_proceso
                        (id_orden_trabajo, id_proceso, orden, id_estado, tiempo_proceso, cant_operarios)
                    values ($1, $2, $3, 1, $4, 1)
                """, f["id_ot"], f["id_proceso"], f["orden"], f["minutos"])
                insertadas += 1
        print(f"\nINSERTADAS {insertadas} filas en {len(ots_tocadas)} OTs.")
        print("revertir: delete from orden_trabajo_proceso where id_orden_trabajo in ("
              + ",".join(str(o) for o in sorted(ots_tocadas)) + ");")
    finally:
        await c.close()


# Sólo al ejecutarlo. Sin este guard, importar los helpers (_nombre/_minutos) desde
# otro script disparaba la corrida entera contra producción.
if __name__ == "__main__":
    asyncio.run(main())
