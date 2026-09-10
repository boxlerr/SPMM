"""Compara los procesos de una OT contra el legacy, línea por línea.

Para qué: cuando en el taller dicen "se duplicaron los procesos", hay que poder
contestar con la base vieja en la mano y no de memoria. Este script pone las dos
listas una al lado de la otra —el legacy manda— y dicta un veredicto por OT.

⚠️ LO QUE HAY QUE SABER ANTES DE LEER `dbo.otrabajoProceso`

Esa tabla NO es la lista de procesos de la OT: es el PARTE DE TRABAJO. Cada fila
tiene `empleado`, `fecha`, `hinicio`, `hfinal` y `REMITO`, o sea quién trabajó, qué
día, de qué hora a qué hora y en qué remito se facturó. Conviven dos cosas:

  · LÍNEAS DE PLAN  — sin empleado y sin fecha, sólo el tiempo estimado. Esos SÍ son
    los procesos de la OT, lo que hay que planificar.
  · PARTES DE TRABAJO — con empleado y fecha. Es historia: trabajo ya hecho, muchas
    veces ya remitado. NO son procesos a planificar.

Confundirlos fue lo que rompió los datos: la OT 13345 tiene 12 líneas de plan y 8
partes, y quedó con 20 procesos en SPMM; la 13813 tiene 0 líneas de plan y 23
partes —23 sesiones de torno de agosto y septiembre de 2025, ya remitadas— y quedó
con 23 procesos. Cuando la OT no tiene líneas de plan, el proceso sale de AGRUPAR
los partes por nombre y sumar los tiempos, que es lo que hizo la migración de julio
y por eso la 13813 tenía 3 y estaba bien.

Veredicto por OT:

    IDENTICA   las dos listas coinciden paso a paso: proceso, posición y minutos.
    FALTAN     el legacy tiene pasadas que en SPMM no están.
    SOBRAN     SPMM tiene filas que el legacy no tiene.
    DIFIEREN   están las mismas pasadas pero cambió la posición o los minutos.

OJO CON "SOBRAN": una fila de más NO es necesariamente basura. Desde el cutover de
julio, SPMM es el dueño de los procesos y el taller carga acá; todo lo cargado
después no existe en el legacy y aparece como sobrante. Por eso el script las
lista una por una en vez de contarlas: hay que mirarlas.

Que una OT repita un proceso en las LÍNEAS DE PLAN sigue siendo dato válido: si el
taller escribió dos veces el mismo paso, van los dos. Lo que no es dato válido es
que se repita porque se copió un parte de trabajo.

Es de sólo lectura: no escribe nunca.

🚫 NO arreglar con `remigrar_procesos_legacy`: ese script es el que metió los partes
como procesos. Está frenado hasta que se le agregue este filtro.

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


def _es_linea_de_plan(fila) -> bool:
    """Sin empleado y sin fecha = línea de plan. Con cualquiera de los dos, alguien
    ya trabajó y la fila es el parte de ese trabajo."""
    return not (fila["empleado"] or "").strip() and not (fila["fecha"] or "").strip()


def _por_ot(crudas):
    d = defaultdict(list)
    for r in crudas:
        d[r["idot"]].append(r)
    return d


def _procesos_del_legacy(filas):
    """Los procesos que la OT tiene que tener, leídos como los lee el sistema viejo.

    Con líneas de plan cargadas, son esas y nada más. Sin ellas, se agrupan los
    partes por proceso sumando los tiempos: es la única lectura posible —el trabajo
    se hizo, pero nadie dejó escrito el plan— y es la que usó la migración de julio.
    """
    plan = [r for r in filas if _es_linea_de_plan(r)]
    if plan:
        salida = []
        for r in sorted(plan, key=lambda x: (x["orden"] or 0)):
            nom = _clave(_nombre(r["proceso"]))
            if nom:
                salida.append((r["orden"] or 1, nom, _minutos(r["total"])))
        return salida

    # Agrupado: se conserva el orden de la primera aparición, que es el orden en que
    # se trabajó, y los minutos se suman.
    acumulado, primer_orden = {}, {}
    for r in sorted(filas, key=lambda x: (x["orden"] or 0)):
        nom = _clave(_nombre(r["proceso"]))
        if not nom:
            continue
        acumulado[nom] = acumulado.get(nom, 0) + _minutos(r["total"])
        primer_orden.setdefault(nom, r["orden"] or 1)
    return [(i + 1, nom, acumulado[nom])
            for i, nom in enumerate(sorted(acumulado, key=lambda n: primer_orden[n]))]


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
            f"SELECT op.Idot AS idot, op.orden, op.proceso, op.total, "
            f"       op.empleado, op.fecha "
            f"FROM dbo.otrabajoProceso op WHERE op.Idot IN ({lista})")

        legacy = {otv: _procesos_del_legacy(filas)
                  for otv, filas in _por_ot(crudas).items()}
        partes_por_ot = {otv: sum(1 for r in filas if not _es_linea_de_plan(r))
                         for otv, filas in _por_ot(crudas).items()}

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
            partes = partes_por_ot.get(otv, 0)
            # Los partes se nombran aunque la OT esté bien: son el número que explica
            # de dónde salió el sobrante cuando hay sobrante.
            nota_partes = f"   [{partes} partes de trabajo, no van al plan]" if partes else ""
            print(f"{marca}OT {otv:<6} {estado:<9} legacy {len(L):>3} líneas / {sum(x[2] for x in L):>5} min"
                  f"   SPMM {len(S):>3} filas / {sum(x[2] for x in S):>5} min{nota_partes}")

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

        rotas = veredictos["SOBRAN"] + veredictos["DIFIEREN"] + veredictos["FALTAN"]
        if rotas:
            print("\nNinguna se toca sola. Para ver qué habría que sacar, en seco:")
            print("  venv/bin/python -m backend.scripts.limpiar_partes_de_trabajo "
                  + " ".join(str(o) for o in sorted(rotas)[:30]))
            print("\nY ojo: una fila de más puede ser un proceso que el taller cargó en "
                  "SPMM después del cutover de julio. Esas son de ellos y quedan.")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
