"""Carga las respuestas de una planilla de trabas, sea cual sea la tanda.

POR QUÉ EXISTE

La planilla del 2/9 se cargó con `cargar_planilla_trabas_20260902.py`: un script con
las 45 respuestas escritas a mano adentro, una por una, con su porqué. Funcionó, pero
es media jornada de trabajo por tanda y hay que rehacerlo cada vez.

No hace falta. La planilla que genera `planilla_trabas.py` ya sale legible por máquina:

  · la hoja PREGUNTAS numera cada pregunta en la columna A y guarda la respuesta en la D;
  · la hoja «Detalle técnico» tiene ese mismo número al lado del **id del proceso**;
  · y la columna D es una lista cerrada, así que la respuesta no es texto libre:
    es una de las opciones que la planilla ofreció.

Con esas tres cosas, qué hacer con cada respuesta es una cuenta, no una interpretación.

QUÉ HACE CON CADA GRUPO

  1. EN QUÉ MÁQUINA SE HACE → la respuesta es el nombre de una máquina: se vincula el
     proceso a esa máquina (`proceso_maquinaria`). Dos respuestas no son máquinas y se
     tratan aparte:
       «A mano, sin máquina»      → el proceso no usa máquina, no hay nada que cargar.
       «Se manda a hacer afuera»  → el proceso pasa a ser TERCERIZADO (`rango_proceso`).

  2. LA MÁQUINA NO ACEPTA AL QUE LO HACE → la respuesta dice qué arreglar, y contra QUÉ
     se arregla sale del propio diagnóstico, que la planilla dejó escrito en el detalle:
       «Cambiar la categoría que pide el trabajo»  → el proceso pasa a pedir la categoría
                                                     que la máquina sí acepta.
       «Habilitar esa categoría en la máquina»     → se agrega la categoría del proceso a
                                                     la máquina (`rango_maquinaria`).
       «Se hace en otra máquina» / «No sé»         → no se toca nada: hace falta hablarlo.

  3. NADIE PUEDE HACERLO → la respuesta es una categoría: se habilita esa categoría para
     el proceso (`rango_proceso`).

CÓMO SE CORRE

    .venv/bin/python -m backend.scripts.cargar_planilla_trabas --archivo <planilla.xlsx>
    .venv/bin/python -m backend.scripts.cargar_planilla_trabas --archivo <planilla.xlsx> --aplicar

Sin `--aplicar` no escribe nada: muestra qué haría y de qué respuesta sale cada cosa.
Conviene mirarlo así la primera vez, siempre.

LO QUE NO HACE, A PROPÓSITO

No borra nada. Agregar una categoría a un proceso es reversible y el planificador vuelve
a correr; sacarle la única que tenía lo deja sin nadie. Si una respuesta implica QUITAR
algo —el caso de «cambiar la categoría que pide el trabajo»— se avisa qué queda afuera y
se pide confirmarlo con `--reemplazar`, que es la única bandera que pisa datos.
"""
import argparse
import asyncio
import os
import re
import sys
from collections import defaultdict

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

try:
    from openpyxl import load_workbook
except ImportError:
    sys.exit("Falta openpyxl: .venv/bin/pip install openpyxl")


def _url() -> str:
    u = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or ""
    if not u:
        sys.exit("No hay SUPABASE_DB_URL en el .env")
    u = re.sub(r"\?.*$", "", u)
    if u.startswith("postgresql://"):
        u = u.replace("postgresql://", "postgresql+asyncpg://", 1)
    # El 5432 admite 15 conexiones en TODO el proyecto y tumba la app: los scripts van
    # por el 6543, que es pgbouncer en modo transacción y por eso no banca el caché de
    # sentencias preparadas.
    return u.replace(":5432/", ":6543/")


# «No sé» es una respuesta válida y está en las TRES listas: la planilla se lo dice
# explícitamente («Si no sabés, elegí No sé. Es una respuesta válida y me sirve igual»),
# porque una respuesta inventada es peor que ninguna. Acá se trata como lo que es —algo
# para conversar— y NO como un nombre de máquina o de categoría que no existe, que es el
# error que cometía este script y habría hecho parecer rota una planilla bien contestada.
NO_SE = "no sé"

NO_ES_MAQUINA = {
    "a mano, sin máquina": "a_mano",
    "se manda a hacer afuera": "afuera",
}
ARREGLOS = {
    "cambiar la categoría que pide el trabajo": "cambiar_proceso",
    "habilitar esa categoría en la máquina": "habilitar_maquina",
    "se hace en otra máquina": "hablarlo",
    "no sé": "hablarlo",
}


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def leer_planilla(ruta: str):
    """Devuelve [(n, id_proceso, nombre, grupo, respuesta, detalle)] de las contestadas."""
    wb = load_workbook(ruta, data_only=True)
    if "PREGUNTAS" not in wb.sheetnames or "Detalle técnico" not in wb.sheetnames:
        sys.exit(f"{ruta} no parece una planilla de trabas: le faltan las hojas PREGUNTAS "
                 f"o «Detalle técnico». Hojas que tiene: {wb.sheetnames}")

    # El detalle técnico es el que ata el número de pregunta con el id del proceso.
    detalle = {}
    ws = wb["Detalle técnico"]
    for fila in ws.iter_rows(min_row=2, values_only=True):
        n, id_proceso, nombre = fila[0], fila[1], fila[2]
        if isinstance(n, int) and isinstance(id_proceso, int):
            detalle[n] = {
                "id": id_proceso, "nombre": nombre,
                "categorias": fila[4], "maquinas": fila[5],
            }

    salida, grupo = [], None
    ws = wb["PREGUNTAS"]
    for fila in ws.iter_rows(min_row=4, values_only=True):
        a, b, c, d = fila[0], fila[1], fila[2], fila[3]
        # Las filas de encabezado de grupo traen el título en A y nada más.
        if a and not isinstance(a, int):
            texto = str(a)
            for clave in ("EN QUÉ MÁQUINA SE HACE", "LA MÁQUINA NO ACEPTA", "NADIE PUEDE HACERLO"):
                if clave in texto:
                    grupo = clave
            continue
        if not isinstance(a, int):
            continue
        if not str(d or "").strip():
            continue  # sin contestar: no es un error, es una pregunta que quedó abierta
        if a not in detalle:
            print(f"  ⚠ pregunta {a} contestada pero sin fila en «Detalle técnico»; se saltea")
            continue
        salida.append((a, detalle[a]["id"], detalle[a]["nombre"] or b, grupo, str(d).strip(), detalle[a]))
    return salida


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", required=True, help="La planilla que contestó el taller (.xlsx)")
    ap.add_argument("--aplicar", action="store_true", help="Escribir de verdad. Sin esto no toca nada.")
    ap.add_argument("--reemplazar", action="store_true",
                    help="Permite PISAR las categorías de un proceso cuando la respuesta lo pide.")
    args = ap.parse_args()

    respuestas = leer_planilla(args.archivo)
    if not respuestas:
        print("La planilla no tiene ninguna respuesta cargada. Nada que hacer.")
        return

    eng = create_async_engine(_url(), connect_args={
        "statement_cache_size": 0, "prepared_statement_cache_size": 0})

    async with eng.begin() as cx:
        maquinas = {_norm(n): i for i, n in (await cx.execute(sa.text(
            "SELECT id, nombre FROM maquinaria"))).fetchall()}
        rangos = {_norm(n): i for i, n in (await cx.execute(sa.text(
            "SELECT id, nombre FROM rango"))).fetchall()}
        nombre_rango = {i: n for i, n in (await cx.execute(sa.text(
            "SELECT id, nombre FROM rango"))).fetchall()}
        nombre_maq = {i: n for i, n in (await cx.execute(sa.text(
            "SELECT id, nombre FROM maquinaria"))).fetchall()}
        proc_rangos = defaultdict(set)
        for p, r in (await cx.execute(sa.text("SELECT id_proceso, id_rango FROM rango_proceso"))).fetchall():
            proc_rangos[p].add(r)
        proc_maqs = defaultdict(set)
        for p, m in (await cx.execute(sa.text("SELECT id_proceso, id_maquinaria FROM proceso_maquinaria"))).fetchall():
            proc_maqs[p].add(m)
        maq_rangos = defaultdict(set)
        for m, r in (await cx.execute(sa.text("SELECT id_maquinaria, id_rango FROM rango_maquinaria"))).fetchall():
            maq_rangos[m].add(r)

    acciones, dudas = [], []

    for n, id_proc, nombre, grupo, resp, det in respuestas:
        r = _norm(resp)

        if r == NO_SE:
            dudas.append((n, nombre, resp, "contestó que no sabe: hay que verlo con él"))
            continue

        if grupo == "EN QUÉ MÁQUINA SE HACE":
            if r in NO_ES_MAQUINA:
                if NO_ES_MAQUINA[r] == "a_mano":
                    dudas.append((n, nombre, resp, "se hace a mano: no hay máquina que cargar"))
                else:
                    id_terc = rangos.get("tercerizado")
                    if id_terc and id_terc not in proc_rangos[id_proc]:
                        acciones.append(("rango_proceso", id_proc, id_terc,
                                         f"P{n} «{nombre}» → se manda a hacer afuera"))
                    else:
                        dudas.append((n, nombre, resp, "ya figura como tercerizado"))
                continue
            id_maq = maquinas.get(r)
            if not id_maq:
                dudas.append((n, nombre, resp, "esa máquina no existe en el taller"))
            elif id_maq in proc_maqs[id_proc]:
                dudas.append((n, nombre, resp, "ya estaba vinculado a esa máquina"))
            else:
                acciones.append(("proceso_maquinaria", id_proc, id_maq,
                                 f"P{n} «{nombre}» se hace en {nombre_maq[id_maq]}"))

        elif grupo and "NO ACEPTA" in grupo:
            que = ARREGLOS.get(r)
            if que in (None, "hablarlo"):
                dudas.append((n, nombre, resp, "hay que hablarlo: no dice contra qué arreglar"))
                continue
            # Las máquinas del proceso y qué categorías aceptan.
            sus_maqs = proc_maqs[id_proc]
            acepta = set().union(*[maq_rangos[m] for m in sus_maqs]) if sus_maqs else set()
            pide = proc_rangos[id_proc]
            if que == "cambiar_proceso":
                if not acepta:
                    dudas.append((n, nombre, resp, "sus máquinas no aceptan ninguna categoría"))
                elif not args.reemplazar:
                    dudas.append((n, nombre, resp,
                                  f"pisaría {[nombre_rango[x] for x in pide]} por "
                                  f"{[nombre_rango[x] for x in acepta]}: correr con --reemplazar"))
                else:
                    acciones.append(("reemplazar_rango_proceso", id_proc, sorted(acepta),
                                     f"P{n} «{nombre}» pasa a pedir "
                                     f"{', '.join(nombre_rango[x] for x in sorted(acepta))}"))
            else:
                for m in sus_maqs:
                    for rg in pide - maq_rangos[m]:
                        acciones.append(("rango_maquinaria", m, rg,
                                         f"P{n} {nombre_maq[m]} pasa a aceptar {nombre_rango[rg]}"))

        elif grupo and "NADIE PUEDE" in grupo:
            id_rango = rangos.get(r)
            if not id_rango:
                dudas.append((n, nombre, resp, "esa categoría no existe"))
            elif id_rango in proc_rangos[id_proc]:
                dudas.append((n, nombre, resp, "esa categoría ya estaba habilitada"))
            else:
                acciones.append(("rango_proceso", id_proc, id_rango,
                                 f"P{n} «{nombre}» lo puede hacer {nombre_rango[id_rango]}"))
        else:
            dudas.append((n, nombre, resp, "no se pudo ubicar en qué grupo está la pregunta"))

    print(f"\nPlanilla: {args.archivo}")
    print(f"Contestadas: {len(respuestas)}   ·   Cambios a aplicar: {len(acciones)}   ·   Para mirar: {len(dudas)}\n")
    for tabla, a, b, porque in acciones:
        print(f"  [{tabla:<26}] {porque}")
    if dudas:
        print("\nNo se tocan (no es un error: es lo que hay que conversar):")
        for n, nombre, resp, motivo in dudas:
            print(f"  P{n} «{nombre}» → «{resp}»: {motivo}")

    if not args.aplicar:
        print("\nEsto fue una prueba en seco. Para escribir de verdad: --aplicar")
        await eng.dispose()
        return

    async with eng.begin() as cx:
        for tabla, a, b, _porque in acciones:
            if tabla == "rango_proceso":
                await cx.execute(sa.text("INSERT INTO rango_proceso (id_rango, id_proceso) "
                                         "VALUES (:r, :p) ON CONFLICT DO NOTHING"), {"r": b, "p": a})
            elif tabla == "proceso_maquinaria":
                await cx.execute(sa.text("INSERT INTO proceso_maquinaria (id_proceso, id_maquinaria) "
                                         "VALUES (:p, :m) ON CONFLICT DO NOTHING"), {"p": a, "m": b})
            elif tabla == "rango_maquinaria":
                await cx.execute(sa.text("INSERT INTO rango_maquinaria (id_maquinaria, id_rango) "
                                         "VALUES (:m, :r) ON CONFLICT DO NOTHING"), {"m": a, "r": b})
            elif tabla == "reemplazar_rango_proceso":
                await cx.execute(sa.text("DELETE FROM rango_proceso WHERE id_proceso = :p"), {"p": a})
                for rg in b:
                    await cx.execute(sa.text("INSERT INTO rango_proceso (id_rango, id_proceso) "
                                             "VALUES (:r, :p) ON CONFLICT DO NOTHING"), {"r": rg, "p": a})
    print(f"\nListo: {len(acciones)} cambios aplicados.")
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
