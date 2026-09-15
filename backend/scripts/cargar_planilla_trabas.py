"""Carga las respuestas de una planilla de trabas, sea cual sea la tanda.

POR QUÉ EXISTE

La planilla del 2/9 se cargó con `cargar_planilla_trabas_20260902.py`: un script con
las 45 respuestas escritas a mano adentro, una por una, con su porqué. Funcionó, pero
es media jornada de trabajo por tanda y hay que rehacerlo cada vez.

No hace falta. La planilla que genera `planilla_trabas.py` ya sale legible por máquina:

  · la hoja PREGUNTAS numera cada pregunta en la columna A y guarda la respuesta en la D;
  · la hoja «Detalle técnico» tiene ese mismo número al lado del **id** de la fila;
  · y la columna D es una lista cerrada, así que la respuesta no es texto libre:
    es una de las opciones que la planilla ofreció.

QUÉ HACE CON CADA GRUPO

  1. EN QUÉ MÁQUINA SE HACE → la respuesta nombra máquinas: se vincula el proceso a cada
     una (`proceso_maquinaria`). No todas las respuestas son máquinas:
       «A mano, sin máquina» / «depende del trabajo» → no corresponde cargar máquina.
       «Se manda a hacer afuera»                     → el proceso pasa a TERCERIZADO.
       «Eliminar el proceso»                         → NO se toca: es una decisión.

  2. LA MÁQUINA NO ACEPTA AL QUE LO HACE → la respuesta dice qué arreglar:
       «Cambiar la categoría que pide el trabajo»  → el proceso pasa a pedir la categoría
                                                     que la máquina sí acepta (--reemplazar).
       «Habilitar esa categoría en la máquina»     → `rango_maquinaria`.
       «Se hace en otra máquina» / «No sé»         → hay que hablarlo.

  3. NADIE PUEDE HACERLO → la respuesta es una categoría: `rango_proceso`.

  4. LAS ÓRDENES VIEJAS QUE SIGUEN ABIERTAS → «Ya se entregó: cerrarla» cierra la OT
     (`finalizadototal = 1`). «Falta trabajo de verdad» no toca nada, pero lo dice.

  5. MÁQUINAS QUE HOY PUEDE USAR UNA PERSONA O NINGUNA → «No: también la puede usar un
     X» habilita esa categoría EN LA MÁQUINA (`rango_maquinaria`).

  6. QUÉ HACE CADA OFICIAL → NO SE CARGA NADA. No hay dónde: en el modelo no existe la
     especialidad de un operario. Sale listado como pendiente para la reunión.

POR QUÉ ESTE SCRIPT DESCONFÍA TANTO (leer antes de tocarlo)

La primera versión tenía la lista de títulos de grupo escrita a mano con TRES entradas,
y la planilla del 11/9 trajo SEIS. Los tres grupos nuevos no se reconocían como
encabezado, `grupo` se quedaba pegado en el anterior, y las 21 preguntas de abajo se
procesaban como si fueran «NADIE PUEDE HACERLO».

Eso no era un error inofensivo. La columna del detalle se llama «id proceso» pero guarda
cuatro cosas distintas según el grupo: el id del proceso (1-20), el **id_otvieja** de la
OT (21-29), un **0** (30-35) y el **id del operario** (36-41). Con el grupo arrastrado,
la respuesta «OFICIAL PLEGADOR» de Guillermo Celiz (operario 31) se iba a escribir como
«el proceso 31 lo puede hacer un OFICIAL PLEGADOR» — y el proceso 31 es CORTE CON
AMOLADORA. Un dato inventado, en la tabla equivocada, y el log diciendo que todo bien.

De ahí las tres reglas de abajo, y ninguna es paranoia de más:
  · un encabezado que no se reconoce pone `grupo = None`, no lo deja como estaba;
  · cada fila lleva QUÉ ES su id (proceso / ot / maquina / operario) y cada rama se
    niega a escribir si el tipo no es el que espera;
  · al final se chequea que respuestas == acciones + dudas + decisiones. Si una
    respuesta contestada no aparece en ninguna lista, el script lo grita: que una
    respuesta se evapore en silencio es lo mismo que perderla.

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


# Los seis grupos, con QUÉ ES el id que la planilla pone en el «Detalle técnico» para las
# filas de ese grupo. Esta tabla es la que impide escribir en la fila equivocada: si
# mañana `planilla_trabas.py` agrega un grupo y acá no está, las respuestas de ese grupo
# caen en «no se pudo ubicar» y quedan a la vista, en vez de colarse en el grupo anterior.
GRUPOS = [
    ("EN QUÉ MÁQUINA SE HACE", "proceso"),
    ("LA MÁQUINA NO ACEPTA", "proceso"),
    ("NADIE PUEDE HACERLO", "proceso"),
    ("LAS ÓRDENES VIEJAS QUE SIGUEN ABIERTAS", "ot"),
    ("MÁQUINAS QUE HOY PUEDE USAR UNA PERSONA O NINGUNA", "maquina"),
    ("QUÉ HACE CADA OFICIAL", "operario"),
]
TIPO_DE_GRUPO = dict(GRUPOS)

# «No sé» es una respuesta válida y está en TODAS las listas: la planilla se lo dice
# explícitamente («Si no sabés, elegí No sé. Es una respuesta válida y me sirve igual»),
# porque una respuesta inventada es peor que ninguna. Acá se trata como lo que es —algo
# para conversar— y NO como un nombre de máquina o de categoría que no existe, que es el
# error que cometía este script y habría hecho parecer rota una planilla bien contestada.
NO_SE = "no sé"

NO_ES_MAQUINA = {
    "a mano, sin máquina": "a_mano",
    "se manda a hacer afuera": "afuera",
}

# Respuestas escritas a mano que significan «este trabajo no tiene una máquina fija».
# El taller las escribió porque la lista no ofrecía esa opción, y decirle «esa máquina no
# existe en el taller» —que es lo que hacía antes— es contestarle cualquier cosa.
SIN_MAQUINA_FIJA = ("no tiene maquina especifica", "no tiene máquina específica",
                    "depende del dispositivo", "depende del trabajo", "a mano sin maquina",
                    "a mano, sin maquina")

# Pedidos que NO son datos: hay que decidirlos con el taller. Se sacan en su propia lista
# para que no se disuelvan entre las dudas — el «eliminar Soldadura 2» ya se pidió el 2/9
# y se perdió una vez.
PIDE_DECISION = ("eliminar", "fusionar", "unificar", "borrar el proceso")

ARREGLOS = {
    "cambiar la categoría que pide el trabajo": "cambiar_proceso",
    "habilitar esa categoría en la máquina": "habilitar_maquina",
    "se hace en otra máquina": "hablarlo",
    "no sé": "hablarlo",
}


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def _maquinas_nombradas(texto: str, maquinas: dict) -> tuple[list[int], str]:
    """Las máquinas del catálogo que aparecen DENTRO del texto de la respuesta.

    Por qué buscar adentro y no partir por un separador: la lista desplegable ofrecía UNA
    máquina y el taller necesitaba contestar varias, así que las encadenó a mano y cada
    uno con lo que tenía a mano — P1 usó «/» («PRENSA 1/PRENSA 2/PLEGADORA») y P3 usó
    « - » («SOLDADORA MIG/MAG 450 1 - SOLDADORA MIG/MAG 450 2»). Y partir por «/» no es
    una opción: el nombre de la soldadora TIENE una barra adentro.

    De más largo a más corto y tachando lo consumido, así «SOLDADORA MIG/MAG 450 1» no se
    come el match de «SOLDADORA MIG/MAG 450 2». Devuelve (ids, lo que quedó sin explicar).
    """
    resto = _norm(texto)
    encontradas = []
    for nombre in sorted(maquinas, key=len, reverse=True):
        if nombre and nombre in resto:
            encontradas.append(maquinas[nombre])
            resto = resto.replace(nombre, " ", 1)
    # Lo que sobra son separadores y palabras sueltas; si queda algo con letras, se avisa.
    sobra = re.sub(r"[^a-záéíóúñü]+", " ", resto).strip()
    return encontradas, sobra


def leer_planilla(ruta: str):
    """[(n, id, nombre, grupo, tipo, respuesta, detalle, observaciones)] de las contestadas."""
    wb = load_workbook(ruta, data_only=True)
    if "PREGUNTAS" not in wb.sheetnames or "Detalle técnico" not in wb.sheetnames:
        sys.exit(f"{ruta} no parece una planilla de trabas: le faltan las hojas PREGUNTAS "
                 f"o «Detalle técnico». Hojas que tiene: {wb.sheetnames}")

    # El detalle técnico es el que ata el número de pregunta con el id de la fila.
    detalle = {}
    ws = wb["Detalle técnico"]
    for fila in ws.iter_rows(min_row=2, values_only=True):
        n, id_fila, nombre = fila[0], fila[1], fila[2]
        if isinstance(n, int) and isinstance(id_fila, int):
            detalle[n] = {
                "id": id_fila, "nombre": nombre,
                "categorias": fila[4], "maquinas": fila[5],
            }

    salida, grupo = [], None
    ws = wb["PREGUNTAS"]
    for fila in ws.iter_rows(min_row=4, values_only=True):
        a, b, _c, d = fila[0], fila[1], fila[2], fila[3]
        # Las filas de encabezado de grupo traen el título en A y nada más.
        if a and not isinstance(a, int):
            texto = str(a)
            # Un encabezado que no reconozco deja el grupo en None A PROPÓSITO. Si lo
            # dejara como estaba, las preguntas de abajo se procesarían con las reglas
            # del grupo anterior — que es exactamente cómo casi se escribe un dato
            # inventado en el proceso equivocado (ver la cabecera del archivo).
            grupo = next((k for k, _ in GRUPOS if k in texto), None)
            continue
        if not isinstance(a, int):
            continue
        if not str(d or "").strip():
            continue  # sin contestar: no es un error, es una pregunta que quedó abierta
        if a not in detalle:
            print(f"  ⚠ pregunta {a} contestada pero sin fila en «Detalle técnico»; se saltea")
            continue
        # Todo lo que el taller escribió después de la respuesta. La planilla salió con 5
        # columnas y volvió con 9: agregaron «Observaciones» solos, y ahí está la mitad
        # del sentido («esto es depende el trabajo, se especificará la máquina en cada OT»).
        obs = " · ".join(str(v).strip() for v in fila[4:] if str(v or "").strip())
        salida.append((a, detalle[a]["id"], detalle[a]["nombre"] or b, grupo,
                       TIPO_DE_GRUPO.get(grupo), str(d).strip(), detalle[a], obs))
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
        # id_otvieja -> id real, para el grupo de las OT viejas.
        ot_por_vieja = {v: i for i, v in (await cx.execute(sa.text(
            "SELECT id, id_otvieja FROM orden_trabajo WHERE id_otvieja IS NOT NULL"))).fetchall()}
        ot_cerrada = {v for v, in (await cx.execute(sa.text(
            "SELECT id_otvieja FROM orden_trabajo "
            "WHERE id_otvieja IS NOT NULL AND COALESCE(finalizadototal,0) = 1"))).fetchall()}

    acciones, dudas, decisiones = [], [], []

    def duda(n, nombre, resp, motivo, obs=""):
        dudas.append((n, nombre, resp, motivo + (f"  ·  anotó: «{obs}»" if obs else "")))

    for n, id_fila, nombre, grupo, tipo, resp, det, obs in respuestas:
        r = _norm(resp)

        if r == NO_SE:
            duda(n, nombre, resp, "contestó que no sabe: hay que verlo con él", obs)
            continue
        if grupo is None:
            duda(n, nombre, resp, "no se pudo ubicar en qué grupo está la pregunta "
                                  "(¿la planilla agregó un grupo nuevo?)", obs)
            continue
        if any(p in r for p in PIDE_DECISION):
            decisiones.append((n, nombre, resp, grupo, obs))
            continue

        # ── 1. En qué máquina se hace ────────────────────────────────────────────
        if grupo == "EN QUÉ MÁQUINA SE HACE":
            if tipo != "proceso":
                duda(n, nombre, resp, f"la fila no es un proceso (es {tipo}): no se toca", obs)
                continue
            if NO_ES_MAQUINA.get(r) == "afuera":
                id_terc = rangos.get("tercerizado")
                if id_terc and id_terc not in proc_rangos[id_fila]:
                    acciones.append(("rango_proceso", id_fila, id_terc,
                                     f"P{n} «{nombre}» → se manda a hacer afuera"))
                else:
                    duda(n, nombre, resp, "ya figura como tercerizado", obs)
                continue

            halladas, sobra = _maquinas_nombradas(resp, maquinas)
            nuevas = [m for m in halladas if m not in proc_maqs[id_fila]]
            a_mano = any(t in r for t in SIN_MAQUINA_FIJA) or NO_ES_MAQUINA.get(r) == "a_mano"

            # «Estas máquinas O a mano» NO se puede cargar, y no es una limitación del
            # script: es que el modelo no lo sabe decir. Cargar máquinas en
            # `proceso_maquinaria` no es una sugerencia — el planificador toma esa lista
            # como el dominio CERRADO del proceso (PlanificacionService: si hay máquinas
            # del catálogo, `candidates = del_catalogo` y ya no hay dummy), así que el
            # trabajo pasa a tener máquina obligatoria y el caso «a mano» deja de existir.
            # El propio taller lo escribió al lado: «esto es depende el trabajo, se
            # especificará la máquina en cada OT» — o sea, lo elige el que carga la OT,
            # que es la preselección por proceso y no esta tabla.
            if halladas and a_mano:
                duda(n, nombre, resp,
                     f"nombra {len(halladas)} máquina/s pero también dice que puede ir a mano. "
                     f"Cargarlas obligaría a usar máquina siempre y el «a mano» se perdería: "
                     f"si va a depender de la OT, se elige al cargar cada orden", obs)
            elif not halladas and a_mano:
                duda(n, nombre, resp, "no corresponde cargar máquina: depende del trabajo", obs)
            elif not halladas:
                duda(n, nombre, resp, "no reconocí ninguna máquina del taller en esa respuesta", obs)
            elif not nuevas:
                duda(n, nombre, resp, "ya estaba vinculado a esa/s máquina/s", obs)
            else:
                for m in nuevas:
                    acciones.append(("proceso_maquinaria", id_fila, m,
                                     f"P{n} «{nombre}» se hace en {nombre_maq[m]}"))
                # Una respuesta puede nombrar máquinas Y decir algo más («… / A MANO SIN
                # MAQUINA»). Lo que se cargó se carga, y lo que sobró se avisa: la mitad
                # del sentido de la respuesta está ahí.
                if sobra:
                    duda(n, nombre, resp,
                         f"se cargaron {len(nuevas)} máquina/s, pero la respuesta además dice "
                         f"«{sobra}» y eso hay que verlo", obs)

        # ── 2. La máquina no acepta al que lo hace ───────────────────────────────
        elif grupo == "LA MÁQUINA NO ACEPTA":
            if tipo != "proceso":
                duda(n, nombre, resp, f"la fila no es un proceso (es {tipo}): no se toca", obs)
                continue
            # Match EXACTO contra la lista cerrada, nunca por prefijo. P13/P14 contestaron
            # «Cambiar la categoría que pide el trabajo **a partir de ingresante**»: el
            # agregado cambia el sentido —dice hacia QUÉ categoría cambiar, que la opción
            # no permitía decir— y tomarlo como si fuera la opción pelada haría lo
            # contrario de lo que pidió el taller.
            que = ARREGLOS.get(r)
            if que is None and any(r.startswith(k) for k in ARREGLOS):
                duda(n, nombre, resp, "eligió una opción y le agregó algo que la opción no "
                                      "dice: hay que preguntarle qué quiso decir", obs)
                continue
            if que in (None, "hablarlo"):
                duda(n, nombre, resp, "hay que hablarlo: no dice contra qué arreglar", obs)
                continue
            sus_maqs = proc_maqs[id_fila]
            acepta = set().union(*[maq_rangos[m] for m in sus_maqs]) if sus_maqs else set()
            pide = proc_rangos[id_fila]
            if que == "cambiar_proceso":
                if not acepta:
                    duda(n, nombre, resp, "sus máquinas no aceptan ninguna categoría", obs)
                elif not args.reemplazar:
                    duda(n, nombre, resp,
                         f"pisaría {[nombre_rango[x] for x in pide]} por "
                         f"{[nombre_rango[x] for x in acepta]}: correr con --reemplazar", obs)
                else:
                    acciones.append(("reemplazar_rango_proceso", id_fila, sorted(acepta),
                                     f"P{n} «{nombre}» pasa a pedir "
                                     f"{', '.join(nombre_rango[x] for x in sorted(acepta))}"))
            else:
                # habilitar_maquina. Antes esto era un `for` sobre las máquinas del proceso
                # sin ningún `else`: si el proceso no tenía máquinas cargadas, el bucle no
                # iteraba y la respuesta se evaporaba — ni acción ni duda. Se perdieron así
                # las dos que MÁS destraban (18 y 8 OT), porque entre que se armó la
                # planilla y que se cargó, esos procesos se quedaron sin máquina.
                # De qué máquina hablamos. Normalmente son las del catálogo
                # (`proceso_maquinaria`), pero muchos procesos no tienen ninguna cargada:
                # ahí el planificador deduce la máquina del NOMBRE del proceso, y la
                # planilla hace lo mismo — por eso la pregunta ya venía nombrándola
                # («…pero SOLDADORA TIG solo acepta OFICIAL»). Esa máquina quedó escrita
                # en la columna «máquinas cargadas» del detalle, así que se usa de
                # respaldo. No es inventar: es la máquina sobre la que se preguntó.
                objetivo = sus_maqs or {
                    maquinas[_norm(x)] for x in str(det.get("maquinas") or "").split(",")
                    if _norm(x) in maquinas}
                antes = len(acciones)
                for m in sorted(objetivo):
                    for rg in sorted(pide - maq_rangos[m]):
                        acciones.append(("rango_maquinaria", m, rg,
                                         f"P{n} {nombre_maq[m]} pasa a aceptar {nombre_rango[rg]}"))
                if len(acciones) == antes:
                    duda(n, nombre, resp,
                         "no se sabe en qué máquina se hace este trabajo: no hay ninguna "
                         "cargada ni nombrada en la pregunta" if not objetivo
                         else "esas máquinas ya aceptan la categoría que pide el trabajo", obs)

        # ── 3. Nadie puede hacerlo ───────────────────────────────────────────────
        elif grupo == "NADIE PUEDE HACERLO":
            if tipo != "proceso":
                duda(n, nombre, resp, f"la fila no es un proceso (es {tipo}): no se toca", obs)
                continue
            id_rango = rangos.get(r)
            if not id_rango:
                duda(n, nombre, resp, "esa categoría no existe", obs)
            elif id_rango in proc_rangos[id_fila]:
                duda(n, nombre, resp, "esa categoría ya estaba habilitada", obs)
            else:
                acciones.append(("rango_proceso", id_fila, id_rango,
                                 f"P{n} «{nombre}» lo puede hacer {nombre_rango[id_rango]}"))

        # ── 4. Las órdenes viejas que siguen abiertas ────────────────────────────
        elif grupo == "LAS ÓRDENES VIEJAS QUE SIGUEN ABIERTAS":
            if tipo != "ot":
                duda(n, nombre, resp, f"la fila no es una OT (es {tipo}): no se toca", obs)
                continue
            id_ot = ot_por_vieja.get(id_fila)
            if id_ot is None:
                duda(n, nombre, resp, f"la OT {id_fila} no está en SPMM", obs)
            elif r.startswith("ya se entregó"):
                if id_fila in ot_cerrada:
                    duda(n, nombre, resp, "esa OT ya figura cerrada", obs)
                else:
                    acciones.append(("cerrar_ot", id_ot, id_fila,
                                     f"P{n} OT {id_fila} se da por entregada y se cierra"))
            elif r.startswith("falta trabajo"):
                # No es una traba: es la confirmación de que la OT tiene que seguir
                # abierta. Se dice igual, porque «no hice nada» sin motivo se lee como
                # que la respuesta se perdió.
                duda(n, nombre, resp, "queda abierta a propósito: el taller dice que falta "
                                      "trabajo de verdad. No se toca nada", obs)
            else:
                duda(n, nombre, resp, "hay que hablarlo antes de tocar la OT", obs)

        # ── 5. Máquinas que hoy puede usar una persona o ninguna ─────────────────
        elif grupo == "MÁQUINAS QUE HOY PUEDE USAR UNA PERSONA O NINGUNA":
            if tipo != "maquina":
                duda(n, nombre, resp, f"la fila no es una máquina (es {tipo}): no se toca", obs)
                continue
            # Ojo: acá el «id» del detalle es 0 para todas. La máquina se identifica por
            # NOMBRE, que es lo que la planilla puso en la columna «máquinas cargadas».
            id_maq = maquinas.get(_norm(det.get("maquinas") or nombre))
            if not id_maq:
                duda(n, nombre, resp, "no encontré esa máquina en el taller", obs)
                continue
            if r.startswith("sí"):
                duda(n, nombre, resp, "es a propósito: no se toca", obs)
                continue
            rg = next((rangos[k] for k in rangos if k and k in r), None)
            if rg is None:
                duda(n, nombre, resp, "no reconocí ninguna categoría en esa respuesta", obs)
            elif rg in maq_rangos[id_maq]:
                # P34/P35: contestaron la categoría que la máquina YA pide. La lista de la
                # planilla no la excluía, así que se podía elegir un no-op sin darse cuenta.
                duda(n, nombre, resp,
                     f"{nombre_maq[id_maq]} ya acepta {nombre_rango[rg]}: la respuesta no "
                     f"cambia nada. ¿Quiso decir otra categoría?", obs)
            else:
                acciones.append(("rango_maquinaria", id_maq, rg,
                                 f"P{n} {nombre_maq[id_maq]} pasa a aceptar {nombre_rango[rg]}"))

        # ── 6. Qué hace cada oficial ─────────────────────────────────────────────
        elif grupo == "QUÉ HACE CADA OFICIAL":
            # NO SE CARGA NADA, y no es una limitación temporal: en el modelo no existe
            # «especialidad de un operario». Lo más parecido es `operario_proceso_skill`,
            # que es otra cosa. Encima el taller contestó fuera de la lista (escribió
            # títulos de categoría —«OFICIAL FRESADOR»— donde se le ofrecía «es sobre todo
            # fresador»), así que ni siquiera está claro qué pidió. Va a la reunión.
            decisiones.append((n, nombre, resp, grupo, obs))

        else:
            duda(n, nombre, resp, "no se pudo ubicar en qué grupo está la pregunta", obs)

    print(f"\nPlanilla: {args.archivo}")
    print(f"Contestadas: {len(respuestas)}   ·   Cambios a aplicar: {len(acciones)}   ·   "
          f"Para mirar: {len(dudas)}   ·   Para decidir: {len(decisiones)}\n")
    for tabla, _a, _b, porque in acciones:
        print(f"  [{tabla:<26}] {porque}")
    if dudas:
        print("\nNo se tocan (no es un error: es lo que hay que conversar):")
        for n, nombre, resp, motivo in sorted(dudas):
            print(f"  P{n} «{nombre}» → «{resp}»: {motivo}")
    if decisiones:
        print("\nPedidos que NO son datos — hay que decidirlos con el taller:")
        for n, nombre, resp, grupo, obs in sorted(decisiones):
            print(f"  P{n} «{nombre}» → «{resp}»" + (f"  ·  anotó: «{obs}»" if obs else ""))

    # Ninguna respuesta contestada puede terminar sin línea en la salida. Si la cuenta no
    # cierra es que una se evaporó en el camino, que es justo el bug que ya pasó.
    # Una respuesta puede generar MÁS de una acción (varias máquinas), así que la cuenta
    # sólo puede fallar para abajo: si hay menos líneas que respuestas, alguna se perdió.
    contadas = len(acciones) + len(dudas) + len(decisiones)
    if contadas < len(respuestas):
        print(f"\n  ⚠⚠ ATENCIÓN: {len(respuestas)} respuestas contestadas pero sólo {contadas} "
              f"líneas en la salida. Alguna se perdió — revisar antes de aplicar.")

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
            elif tabla == "cerrar_ot":
                # Cerrar una OT la saca del plan. Es lo que pidió el taller, pero se hace
                # con el mínimo posible: sólo `finalizadototal`, sin inventar una fecha de
                # entrega que nadie sabe.
                await cx.execute(sa.text("UPDATE orden_trabajo SET finalizadototal = 1 "
                                         "WHERE id = :id"), {"id": a})
    print(f"\nListo: {len(acciones)} cambios aplicados.")
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
