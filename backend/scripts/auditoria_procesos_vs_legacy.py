"""Compara los procesos de una OT contra el legacy, línea por línea.

Para qué: cuando en el taller dicen "se duplicaron los procesos", hay que poder
contestar con la base vieja en la mano y no de memoria. Este script pone las dos
listas una al lado de la otra —el legacy manda— y dicta un veredicto por OT:

    IDENTICA   las dos listas coinciden paso a paso: proceso, posición y minutos.
    FALTAN     el legacy tiene pasadas que en SPMM no están.
    SOBRAN     SPMM tiene filas que el legacy no tiene.
    DIFIEREN   están las mismas pasadas pero cambió la posición o los minutos.

OJO CON "SOBRAN": una fila de más NO es necesariamente basura. Desde el cutover de
julio, SPMM es el dueño de los procesos y el taller carga acá; todo lo cargado
después no existe en el legacy y aparece como sobrante. Por eso el script las
lista una por una en vez de contarlas: hay que mirarlas.

Y ojo con el revés: que una OT tenga el MISMO proceso varias veces es dato válido
—el legacy guarda una fila por pasada, la OT 13813 tiene TORNO CNC 13 veces— y no
es una duplicación. La duplicación de verdad es una fila de más SIN respaldo en el
legacy, que es justo lo que este script separa.

Es de sólo lectura: no escribe nunca. Para arreglar lo que encuentre:
    - FALTAN o DIFIEREN  -> backend.scripts.remigrar_procesos_legacy <ot> --aplicar
    - SOBRAN             -> a mano, después de confirmar con el taller cuáles cargaron ellos.

    venv/bin/python -m backend.scripts.auditoria_procesos_vs_legacy 13345 13813
    venv/bin/python -m backend.scripts.auditoria_procesos_vs_legacy --abiertas
    venv/bin/python -m backend.scripts.auditoria_procesos_vs_legacy --planificadas 2026-09-10
    venv/bin/python -m backend.scripts.auditoria_procesos_vs_legacy 13345 --detalle

Los números son de OT VIEJA (id_otvieja), que es el que se ve en pantalla.
"""
import asyncio
import os
import re
import sys
from collections import defaultdict

import asyncpg
from dotenv import load_dotenv

import backend.scripts.sync_db as sync_db
from backend.scripts.migrar_procesos_faltantes import _minutos, _nombre

DETALLE = "--detalle" in sys.argv
ABIERTAS = "--abiertas" in sys.argv
OTS_PEDIDAS = [int(a) for a in sys.argv[1:] if a.isdigit() and len(a) <= 6]
_pl = sys.argv.index("--planificadas") if "--planificadas" in sys.argv else None
DESDE = sys.argv[_pl + 1] if _pl is not None and _pl + 1 < len(sys.argv) else None


def _url():
    load_dotenv()
    u = re.sub(r"^postgresql\+\w+://", "postgresql://", os.getenv("SUPABASE_DB_URL")).split("?")[0]
    # Puerto 6543 (pooler en modo transaction): el 5432 tiene 15 clientes para TODO
    # el proyecto y un script no puede dejar sin lugar al backend de producción.
    return u.replace(":5432/", ":6543/")


def _clave(nombre: str) -> str:
    """Normaliza el nombre para comparar. El catálogo se cosechó de texto libre del
    legacy y tiene gemelos que difieren sólo por espacios de adentro."""
    return re.sub(r"\s+", " ", (nombre or "")).strip().upper()


async def _objetivo(c):
    """OTs a auditar -> {id_otvieja: id_spmm}."""
    if OTS_PEDIDAS:
        filas = await c.fetch(
            "select id, id_otvieja from orden_trabajo where id_otvieja = any($1::int[])",
            OTS_PEDIDAS)
        for falta in sorted(set(OTS_PEDIDAS) - {f["id_otvieja"] for f in filas}):
            print(f"!! la OT {falta} no está en SPMM")
        return {f["id_otvieja"]: f["id"] for f in filas}

    if DESDE:
        # Las que se mandaron a planificar desde esa fecha. Sirve para contestar
        # "¿qué pasó con las OT de la planificación de ayer?" sin tener que
        # acordarse de los números.
        filas = await c.fetch("""
            select distinct ot.id, ot.id_otvieja
            from planificacion_intento i
            cross join lateral unnest(string_to_array(i.ordenes_ids, ',')) as x(sid)
            join orden_trabajo ot on ot.id = x.sid::int
            where i.creado_en >= $1::date and ot.id_otvieja is not null
        """, DESDE)
        return {f["id_otvieja"]: f["id"] for f in filas}

    if ABIERTAS:
        filas = await c.fetch("""
            select id, id_otvieja from orden_trabajo
            where coalesce(finalizadototal,0)=0 and fecha_entrega is null
              and id_otvieja is not null""")
        return {f["id_otvieja"]: f["id"] for f in filas}

    return {}


async def main():
    if not OTS_PEDIDAS and not ABIERTAS and not DESDE:
        print(__doc__)
        return

    c = await asyncpg.connect(_url(), statement_cache_size=0)
    try:
        por_vieja = await _objetivo(c)
        if not por_vieja:
            print("No hay OTs para auditar.")
            return
        print(f"Auditando {len(por_vieja)} OT contra el legacy…\n")

        # --- Lo que dice el legacy: una fila por pasada, en orden de paso ---
        lista = ",".join(str(v) for v in por_vieja)
        crudas = await sync_db._leer(
            f"SELECT op.Idot AS idot, op.orden, op.proceso, op.total "
            f"FROM dbo.otrabajoProceso op WHERE op.Idot IN ({lista})")

        legacy = defaultdict(list)
        for r in crudas:
            nom = _clave(_nombre(r["proceso"]))
            if nom:
                legacy[r["idot"]].append((r["orden"] or 1, nom, _minutos(r["total"])))
        for filas in legacy.values():
            filas.sort(key=lambda f: f[0])

        # --- Lo que hay en SPMM ---
        spmm = defaultdict(list)
        for r in await c.fetch("""
            select ot.id_otvieja as otv, p.id as row_id, p.orden, pr.nombre,
                   coalesce(p.tiempo_proceso,0) as minutos, p.id_estado
            from orden_trabajo_proceso p
            join orden_trabajo ot on ot.id = p.id_orden_trabajo
            join proceso pr on pr.id = p.id_proceso
            where p.id_orden_trabajo = any($1::int[])
            order by ot.id_otvieja, p.orden, p.id""", list(por_vieja.values())):
            spmm[r["otv"]].append(
                (r["orden"], _clave(r["nombre"]), r["minutos"], r["row_id"], r["id_estado"]))

        veredictos = defaultdict(list)
        sin_legacy = []

        for otv in sorted(por_vieja):
            L, S = legacy.get(otv, []), spmm.get(otv, [])
            if not L:
                # Sin respaldo en el legacy no hay contra qué comparar: puede ser una
                # OT nacida en SPMM, y decir "sobra todo" sería mentir.
                sin_legacy.append(otv)
                continue

            # Se machean por proceso, la n-ésima pasada del legacy con la n-ésima de
            # SPMM: es el mismo criterio con el que se migraron.
            libres = defaultdict(list)
            for fila in S:
                libres[fila[1]].append(fila)

            faltan, difieren, usadas = [], [], set()
            for orden_l, nom_l, min_l in L:
                cola = libres.get(nom_l, [])
                if not cola:
                    faltan.append((orden_l, nom_l, min_l))
                    continue
                fila = cola.pop(0)
                usadas.add(fila[3])
                if (fila[0], fila[2]) != (orden_l, min_l):
                    difieren.append((nom_l, (fila[0], fila[2]), (orden_l, min_l), fila[3]))
            sobran = [f for f in S if f[3] not in usadas]

            if not faltan and not sobran and not difieren:
                estado = "IDENTICA"
            elif sobran and not faltan and not difieren:
                estado = "SOBRAN"
            elif faltan and not sobran and not difieren:
                estado = "FALTAN"
            else:
                estado = "DIFIEREN"
            veredictos[estado].append(otv)

            marca = "OK " if estado == "IDENTICA" else "!! "
            print(f"{marca}OT {otv:<6} {estado:<9} legacy {len(L):>3} líneas / {sum(x[2] for x in L):>5} min"
                  f"   SPMM {len(S):>3} filas / {sum(x[2] for x in S):>5} min")

            for orden_l, nom_l, min_l in faltan:
                print(f"      FALTA   paso {orden_l:>3}  {min_l:>5}m  {nom_l}")
            for fila in sobran:
                print(f"      SOBRA   paso {fila[0]:>3}  {fila[2]:>5}m  {fila[1]}"
                      f"   (fila #{fila[3]}, estado {fila[4]})")
            for nom, hay, deberia, row_id in difieren:
                print(f"      DIFIERE {nom}: SPMM paso {hay[0]}/{hay[1]}m,"
                      f" legacy paso {deberia[0]}/{deberia[1]}m (fila #{row_id})")

            if DETALLE:
                print(f"\n      {'paso':>4} | {'LEGACY':<42} {'min':>5} || {'SPMM':<42} {'min':>5}")
                for i in range(max(len(L), len(S))):
                    l = L[i] if i < len(L) else ("", "", "")
                    s = S[i] if i < len(S) else ("", "", "", "")
                    igual = i < len(L) and i < len(S) and (l[0], l[1], l[2]) == (s[0], s[1], s[2])
                    print(f"      {str(l[0]):>4} | {str(l[1])[:42]:<42} {str(l[2]):>5} || "
                          f"{str(s[1])[:42]:<42} {str(s[2]):>5}{'' if igual else '   <<<'}")
                print()

        print("\n" + "=" * 78)
        for estado in ("IDENTICA", "FALTAN", "DIFIEREN", "SOBRAN"):
            if veredictos[estado]:
                ots = veredictos[estado]
                print(f"{estado:<9} {len(ots):>4} OT   {', '.join(str(o) for o in ots[:20])}"
                      + (f" … y {len(ots)-20} más" if len(ots) > 20 else ""))
        if sin_legacy:
            print(f"{'SIN BASE':<9} {len(sin_legacy):>4} OT   sin líneas en el legacy — nacidas en "
                  f"SPMM o no migradas: {', '.join(str(o) for o in sin_legacy[:20])}")

        arreglables = veredictos["FALTAN"] + veredictos["DIFIEREN"]
        if arreglables:
            print("\nPara devolverlas a como está el legacy:")
            print("  venv/bin/python -m backend.scripts.remigrar_procesos_legacy "
                  + " ".join(str(o) for o in sorted(arreglables)[:30]) + " --aplicar")
        if veredictos["SOBRAN"]:
            print("\nLas de SOBRAN no se tocan solas: confirmá con el taller si esas filas "
                  "las cargaron ellos en SPMM después del cutover de julio.")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
