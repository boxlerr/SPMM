"""Vuelve a copiar los procesos de una OT desde el legacy, TAL CUAL las filas.

Para qué: el legacy carga UNA FILA POR PASADA. La OT 7497 tiene TORNO CNC en 13
pasadas distintas, intercaladas con los demás procesos. En SPMM eso no entraba —la PK
de orden_trabajo_proceso era (id_orden_trabajo, id_proceso)— así que la migración de
julio se comía las repetidas al chocar contra la PK y el script de agosto
(migrar_procesos_faltantes.py) las sumaba en una sola línea. Resultado: el plan veía
un bloque gigante en un solo paso en vez de la secuencia real.

Desde la migración 2026-08-28_proceso_repetido_en_ot.sql la fila tiene id propio y el
mismo proceso puede ir varias veces. Este script trae las que faltan.

QUÉ TOCA Y QUÉ NO
  - Ajusta `orden` y `tiempo_proceso` de las pasadas que ya están, para que queden
    como el legacy (si no, la primera se queda con la SUMA vieja y el total daría de
    más al agregarle las que faltan).
  - Inserta las pasadas que faltan, en Pendiente.
  - NO borra nada. Un proceso que está en SPMM y no en el legacy es de ellos —lo
    cargaron acá después del cutover de julio— y no se toca: se lista y listo.
  - NO pisa estado, avance, observaciones, cantidad de operarios ni las
    preselecciones de máquina/persona de las filas que ya existían.

Corre en seco por defecto. Con --aplicar escribe.

    venv/bin/python -m backend.scripts.remigrar_procesos_legacy 15670
    venv/bin/python -m backend.scripts.remigrar_procesos_legacy 15670 --aplicar
    venv/bin/python -m backend.scripts.remigrar_procesos_legacy --abiertas
    venv/bin/python -m backend.scripts.remigrar_procesos_legacy --abiertas --aplicar

Los números son de OT VIEJA (id_otvieja), que es el que se ve en pantalla.
"""

# ---------------------------------------------------------------------------
# 🚫 OBSOLETO Y FRENADO EL 10/09/2026 — NO CORRER
#
# Este script nació de una lectura equivocada de la base vieja, no de un bug: se
# creyó que el legacy guardaba "una fila por PASADA" del proceso y que la migración
# de julio se las había comido. No era eso. Lo que el legacy guarda son PARTES DE
# TRABAJO —quién trabajó, qué día, de qué hora a qué hora, en qué remito se
# facturó—, y la migración de julio hacía bien en agruparlos.
#
# Ya no hace falta arreglarlo: con el criterio correcto, `migrar_procesos_faltantes`
# hace lo único que había que hacer. Este queda como registro de qué pasó.
#
# Este script lee `dbo.otrabajoProceso` entera, y esa tabla NO es la lista de
# procesos de la OT: es el PARTE DE TRABAJO (tiene `empleado`, `fecha`, `hinicio`,
# `hfinal`, `REMITO`). Mezcla dos cosas:
#   · líneas de plan  -> sin empleado ni fecha. Esos SÍ son los procesos.
#   · partes de trabajo -> con empleado y fecha. Trabajo ya hecho, casi siempre ya
#     remitado. NO son procesos a planificar.
#
# Al no distinguirlos, metió partes como si fueran pasos: la OT 13345 pasó de 12
# procesos a 20 y la 13813 de 3 a 23 sesiones de torno de 2025 ya facturadas. En
# total, 22 de las 175 OT abiertas quedaron con procesos de más y minutos inflados.
#
# Para volver atrás:  backend/scripts/limpiar_partes_de_trabajo.py
# Para ver el estado: backend/scripts/auditoria_procesos_vs_legacy.py
# ---------------------------------------------------------------------------
import sys as _sys

# Sólo frena si alguien lo EJECUTA. Al importarlo no: `auditoria_procesos_vs_legacy`
# y `limpiar_partes_de_trabajo` reusan sus helpers de parseo (_minutos, _nombre), que
# están bien — lo que estaba mal era qué filas leía, no cómo las leía.
if __name__ == "__main__" and "--sin-freno" not in _sys.argv:
    print(__doc__.split("\n")[0])
    print("\n🚫 FRENADO: este script metía los PARTES DE TRABAJO del legacy como si fueran")
    print("   procesos de la OT. Rompió 22 OT el 31/8. Ver el comentario de arriba.")
    print("\n   Para ver el estado real:  python -m backend.scripts.auditoria_procesos_vs_legacy --abiertas")
    print("   Para revertir el daño:    python -m backend.scripts.limpiar_partes_de_trabajo --abiertas")
    _sys.exit(1)


import asyncio
import os
import re
import sys
from collections import defaultdict

import asyncpg
from dotenv import load_dotenv

import backend.scripts.sync_db as sync_db
from backend.scripts.migrar_procesos_faltantes import _minutos, _nombre

APLICAR = "--aplicar" in sys.argv
ABIERTAS = "--abiertas" in sys.argv
OTS_PEDIDAS = [int(a) for a in sys.argv[1:] if a.isdigit()]


def _url():
    load_dotenv()
    return re.sub(r"^postgresql\+\w+://", "postgresql://", os.getenv("SUPABASE_DB_URL")).split("?")[0]


async def _objetivo(c):
    """OTs a tocar -> {id_otvieja: id_spmm}."""
    if OTS_PEDIDAS:
        filas = await c.fetch(
            "select id, id_otvieja from orden_trabajo where id_otvieja = any($1::int[])",
            OTS_PEDIDAS)
        encontradas = {f["id_otvieja"] for f in filas}
        for falta in sorted(set(OTS_PEDIDAS) - encontradas):
            print(f"!! la OT {falta} no está en SPMM")
        return {f["id_otvieja"]: f["id"] for f in filas}

    if ABIERTAS:
        filas = await c.fetch("""
            select id, id_otvieja from orden_trabajo
            where coalesce(finalizadototal,0)=0 and fecha_entrega is null
              and id_otvieja is not null""")
        return {f["id_otvieja"]: f["id"] for f in filas}

    return {}


async def main():
    if not OTS_PEDIDAS and not ABIERTAS:
        print(__doc__)
        return

    # Igual que los demás scripts: sin esto sólo anda por el 5432, que tiene 15 clientes
    # para todo el proyecto y le saca el lugar a la app. Ver migrar_procesos_faltantes.
    c = await asyncpg.connect(_url(), statement_cache_size=0)
    try:
        por_vieja = await _objetivo(c)
        if not por_vieja:
            print("No hay OTs para procesar.")
            return

        cat_filas = await c.fetch("select id, nombre from proceso")
        catalogo = {r["nombre"].strip().upper(): r["id"] for r in cat_filas}

        # GEMELOS DEL CATÁLOGO: el mismo nombre cargado dos veces, distinto sólo por
        # espacios de adentro ('ENSAMBLAJE, PUNTEADO  Y ESCUADRADO' vs '... PUNTEADO Y
        # ESCUADRADO'). El catálogo se cosecha de texto libre del legacy, así que
        # existen desde antes de que sync_db._nombre_proceso normalizara.
        # Importa acá porque el proceso PUEDE estar en la OT bajo el id del gemelo: si
        # no se mira, se lo cuenta como faltante y se inserta una segunda copia real.
        gemelos = defaultdict(set)
        for r in cat_filas:
            gemelos[re.sub(r"\s+", " ", r["nombre"]).strip().upper()].add(r["id"])
        gemelo_de = {r["id"]: gemelos[re.sub(r"\s+", " ", r["nombre"]).strip().upper()]
                     for r in cat_filas}

        lista = ",".join(str(v) for v in por_vieja)
        crudas = await sync_db._leer(f"""
            SELECT op.Idot AS idot, op.orden, op.proceso, op.total
            FROM dbo.otrabajoProceso op
            WHERE op.Idot IN ({lista})
        """)

        # Legacy: una entrada por línea, en orden de paso.
        legacy = defaultdict(list)
        sin_match = defaultdict(int)
        for r in crudas:
            nom = _nombre(r["proceso"])
            if not nom:
                continue
            pid = catalogo.get(nom.strip().upper())
            if pid is None:
                sin_match[nom] += 1
                continue
            legacy[por_vieja[r["idot"]]].append(
                {"id_proceso": pid, "orden": r["orden"] or 1, "minutos": _minutos(r["total"])})
        for filas in legacy.values():
            filas.sort(key=lambda f: f["orden"])

        actuales = defaultdict(list)
        for r in await c.fetch("""
            select id, id_orden_trabajo, id_proceso, orden, tiempo_proceso, id_estado
            from orden_trabajo_proceso
            where id_orden_trabajo = any($1::int[])
            order by orden, id""", list(por_vieja.values())):
            actuales[r["id_orden_trabajo"]].append(dict(r))

        a_insertar, a_ajustar, ajenas, bajo_gemelo = [], [], [], []

        for otv, ot_id in sorted(por_vieja.items()):
            lineas_legacy = legacy.get(ot_id, [])
            if not lineas_legacy:
                continue

            # Las de SPMM agrupadas por proceso, en orden: la n-ésima pasada del
            # legacy se machea con la n-ésima fila que ya está.
            libres = defaultdict(list)
            for fila in actuales.get(ot_id, []):
                libres[fila["id_proceso"]].append(fila)

            usadas = set()
            # Si en ESTA OT el proceso ya está cargado bajo un gemelo del catálogo, las
            # pasadas que falten se insertan con ESE id y no con el del legacy: mezclar
            # los dos ids dentro de la misma OT deja media OT con un rango y media con
            # otro (los gemelos no comparten rangos).
            equivalente = {}
            for linea in lineas_legacy:
                pid = equivalente.get(linea["id_proceso"], linea["id_proceso"])
                cola = libres.get(pid, [])
                if not cola and pid == linea["id_proceso"]:
                    # No está con ESE id, pero puede estar bajo un gemelo del catálogo.
                    for otro in gemelo_de.get(linea["id_proceso"], set()):
                        if otro != linea["id_proceso"] and libres.get(otro):
                            cola = libres[otro]
                            equivalente[linea["id_proceso"]] = otro
                            pid = otro
                            bajo_gemelo.append({
                                "otv": otv, "esperado": linea["id_proceso"], "encontrado": otro,
                            })
                            break
                if cola:
                    fila = cola.pop(0)
                    usadas.add(fila["id"])
                    if fila["id_proceso"] != linea["id_proceso"]:
                        pass  # gemelo del catálogo: se respeta lo que está cargado
                    elif (fila["orden"], fila["tiempo_proceso"] or 0) != (linea["orden"], linea["minutos"]):
                        a_ajustar.append({
                            "id": fila["id"], "otv": otv, "id_proceso": linea["id_proceso"],
                            "de": (fila["orden"], fila["tiempo_proceso"] or 0),
                            "a": (linea["orden"], linea["minutos"]),
                        })
                else:
                    a_insertar.append({
                        "id_ot": ot_id, "otv": otv, "id_proceso": pid,
                        "orden": linea["orden"], "minutos": linea["minutos"],
                    })

            for fila in actuales.get(ot_id, []):
                if fila["id"] not in usadas:
                    ajenas.append({"otv": otv, **fila})

        nombres = {v: k for k, v in catalogo.items()}
        ots_insert = {f["otv"] for f in a_insertar}

        # Desglose: no es lo mismo una pasada que se sumó adentro de otra fila que un
        # proceso que directamente no está. Ojo con leer los minutos de las que faltan
        # como "minutos nuevos": donde la migración vieja SUMÓ, esos minutos ya están
        # contados dentro de la fila que queda, y el ajuste la baja a su valor real.
        procesos_en_spmm = {(ot, f["id_proceso"]) for ot, fs in actuales.items() for f in fs}
        repetidas = sum(1 for f in a_insertar
                        if (f["id_ot"], f["id_proceso"]) in procesos_en_spmm)
        ausentes = len(a_insertar) - repetidas

        minutos_antes = sum((f["tiempo_proceso"] or 0)
                            for fs in actuales.values() for f in fs)
        minutos_despues = minutos_antes
        for f in a_ajustar:
            minutos_despues += f["a"][1] - f["de"][1]
        minutos_despues += sum(f["minutos"] for f in a_insertar)

        print(f"OTs miradas                        : {len(por_vieja)}")
        print(f"Líneas leídas del legacy           : {len(crudas)}")
        print(f"Pasadas que FALTAN en SPMM         : {len(a_insertar)} en {len(ots_insert)} OTs")
        print(f"   pasadas extra de un proceso que ya está : {repetidas}")
        print(f"   procesos que no están en la OT          : {ausentes}")
        print(f"Filas a ajustar (paso/minutos)     : {len(a_ajustar)}")
        print(f"Minutos en esas OTs: {minutos_antes} -> {minutos_despues} "
              f"({minutos_despues - minutos_antes:+})")
        print("   (donde la migración vieja sumó las pasadas en una fila, el total no "
              "cambia: se reparte)")

        if sin_match:
            print(f"\nNombres del legacy que NO están en el catálogo ({len(sin_match)}):")
            for n, veces in sorted(sin_match.items(), key=lambda x: -x[1])[:15]:
                print(f"   {n[:50]:<50} x{veces}")

        if bajo_gemelo:
            print(f"\nProcesos que están en la OT bajo un GEMELO del catálogo ({len(bajo_gemelo)}) —")
            print("no se insertan (ya están); el catálogo tiene el nombre cargado dos veces:")
            for g in bajo_gemelo[:10]:
                print(f"   OT {g['otv']}  {nombres.get(g['esperado'])!r} (#{g['esperado']}) "
                      f"está como #{g['encontrado']}")

        if ajenas:
            print(f"\nFilas que están en SPMM y NO en el legacy ({len(ajenas)}) — NO se tocan,")
            print("son procesos cargados en SPMM después del cutover de julio:")
            for f in ajenas[:15]:
                print(f"   OT {f['otv']}  paso {f['orden']}  {nombres.get(f['id_proceso'], f['id_proceso'])}")
            if len(ajenas) > 15:
                print(f"   ... y {len(ajenas) - 15} más")

        if a_insertar:
            print("\nPasadas a insertar (primeras 25):")
            for f in a_insertar[:25]:
                print(f"   OT {f['otv']}  paso {f['orden']:>3}  {f['minutos']:>5}m  "
                      f"{nombres.get(f['id_proceso'], f['id_proceso'])}")
            if len(a_insertar) > 25:
                print(f"   ... y {len(a_insertar) - 25} más")

        if not APLICAR:
            print("\n(corrida en seco — no se escribió nada; usar --aplicar para escribir)")
            return

        if not a_insertar and not a_ajustar:
            print("\nNada para escribir.")
            return

        async with c.transaction():
            for f in a_ajustar:
                await c.execute(
                    "update orden_trabajo_proceso set orden=$2, tiempo_proceso=$3 where id=$1",
                    f["id"], f["a"][0], f["a"][1])
            for f in a_insertar:
                await c.execute("""
                    insert into orden_trabajo_proceso
                        (id_orden_trabajo, id_proceso, orden, id_estado, tiempo_proceso, cant_operarios)
                    values ($1, $2, $3, 1, $4, 1)
                """, f["id_ot"], f["id_proceso"], f["orden"], f["minutos"])

        print(f"\nAJUSTADAS {len(a_ajustar)} filas, INSERTADAS {len(a_insertar)} pasadas.")
        print("\nOJO: el plan guardado de estas OTs quedó viejo (le faltan las pasadas "
              "nuevas). Hay que replanificarlas.")
        print("revertir lo insertado: delete from orden_trabajo_proceso where id > "
              "<el id más alto de antes de correr esto> and id_orden_trabajo in ("
              + ",".join(str(por_vieja[o]) for o in sorted(ots_insert)) + ");")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
