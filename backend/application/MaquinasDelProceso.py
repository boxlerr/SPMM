"""
En qué máquinas se hace cada proceso, tal como las va a usar el planificador.

Pedido de Julián (29/9/2026, en plena reunión con Lucas): en Recursos › Procesos la fila
de «FRESADORA F6» decía quién puede hacerla (OFICIAL, 6 personas) pero no en qué
máquina, y «no sabemos para qué máquina está asignado».

No era un descuido de la pantalla: el dato casi no existe. De los 415 procesos del
catálogo, 8 tienen las máquinas cargadas en Recursos. Los otros 407 el planificador los
resuelve DEDUCIENDO del nombre —«FRESADORA F6» → familia FRESADORA → las fresadoras del
taller que aceptan el rango que pide el proceso—, y esa deducción no se veía en ningún
lado. Ni siquiera había cómo enterarse de que «F6» no es el nombre de ninguna máquina
(las del taller se llaman FRESADORA 1, FRESADORA 2, FRESADORA VAN NORMAN...).

Este módulo hace visible esa resolución, con las mismas reglas que el planificador
(`_crear_variables_y_dominios`, rama de máquinas): las mismas funciones de familia y de
tipo, el mismo cruce de rangos. No las reimplementa a ojo: las importa. Lo único que se
copia es la ARMAZÓN de decisiones, y `test_maquinas_del_proceso` la compara contra el
dominio que arma el solver de verdad para que no se separen.

DIFERENCIAS CONOCIDAS con el solver, todas a propósito y todas del lado de mostrar
de más y no de menos:

  · Es a nivel CATÁLOGO, sin OT. En una OT real una preparación hereda la familia y los
    rangos del trabajo que prepara, y comparte con él la máquina. Acá no hay OT: se
    muestra lo que dice el proceso por sí mismo.
  · Un proceso SIN rangos: el solver, antes de armar el dominio, le presta los rangos de
    la primera máquina cuyo nombre se parezca al suyo (PlanificacionService, «Detectar
    máquina por coincidencia de nombre»). Acá no: sin rangos se listan todas las de la
    familia. Puede sobrar alguna; nunca falta.
  · Un SETUP con máquinas cargadas: el solver hoy no mira el catálogo en esa rama (la
    preparación queda atada a la máquina del trabajo que prepara, que sí lo mira). Acá
    la cargada gana, porque es lo que el taller respondió.
"""
from backend.application.PlanificacionService import (
    _get_tipo_proceso,
    _norm,
    familia_from_maquina,
    familia_requerida_from_proceso,
    proceso_usa_maquina,
)
from backend.commons.loggers.logger import logger

# De dónde sale la lista que se muestra.
ORIGEN_CARGADA = "cargada"   # alguien la eligió en Recursos: es un dato
ORIGEN_NOMBRE = "nombre"     # nadie la cargó: se deduce del nombre, como hace el planificador
ORIGEN_A_MANO = "a_mano"     # el proceso no usa máquina (a mano, administrativo o tercerizado)
ORIGEN_NINGUNA = "ninguna"   # usa máquina y no hay ninguna que le sirva: sale «sin máquina»

# Por qué no hay ninguna (sólo con ORIGEN_NINGUNA).
MOTIVO_SIN_FAMILIA = "sin_familia"   # el nombre no dice en qué máquina se hace
MOTIVO_SIN_MAQUINA = "sin_maquina"   # la dice, pero el taller no tiene ninguna de ese tipo
MOTIVO_RANGO = "rango"               # las hay, pero ninguna acepta el rango que pide el proceso

# Los rangos que significan «esto se manda afuera». El mismo criterio que el planificador
# (por nombre y no por id: el id no está fijo).
_RANGOS_AFUERA = ("TERCERIZADO", "EXTERNO")


def _ref(m: dict) -> dict:
    # `.strip()`: en el catálogo hay nombres con un espacio de sobra al final
    # («FRESADORA VAN NORMAN »), y en pantalla se ve como una separación rara.
    return {"id": m["id"], "nombre": (m["nombre"] or "").strip()}


def _acepta(pide: set, maquina: dict) -> bool:
    """¿El rango del proceso habilita a esta máquina?

    Igual que el solver: un proceso sin rangos no filtra nada, y con rangos la máquina
    tiene que compartir alguno."""
    if not pide:
        return True
    return bool(pide & {r["id"] for r in (maquina.get("rangos") or [])})


def _base_del_setup(nombre: str) -> str:
    """«PREPARACION DE SOLDADORA TIG» → «SOLDADORA TIG». Lo que busca el solver, por
    coincidencia de nombre, cuando un SETUP no tiene familia (o ninguna máquina de su
    familia le sirve)."""
    return (
        _norm(nombre)
        .replace("PROGRAMACION DE", "").replace("PROGRAMACION", "")
        .replace("PREPARACION DE", "").replace("PREPARACION", "")
        .replace("CAMBIO DE", "")
        .strip()
    )


def maquinas_del_proceso(nombre: str, rangos: list[dict], cargadas: list[dict],
                         maquinas: list[dict]) -> dict:
    """Qué máquinas va a considerar el planificador para un proceso del catálogo.

    nombre    nombre del proceso.
    rangos    los que lo habilitan: [{id, nombre}].
    cargadas  las máquinas que alguien eligió en Recursos para este proceso: [{id, nombre}].
              Vacío = «todavía no lo cargaron», que NO es lo mismo que «va a mano».
    maquinas  todo el taller: [{id, nombre, cod_maquina, rangos: [{id, nombre}]}].

    Devuelve {origen, efectivas, sin_rango, motivo}:
      efectivas  las que el planificador va a poder reservar.
      sin_rango  las cargadas que el rango del proceso NO acepta (el solver las descarta
                 sin decir nada: «enderezar bases» se cargó en plegadora y prensa, y la
                 plegadora no cruza con MEDIO OFICIAL ni OPERARIO CALIFICADO).
      motivo     por qué no hay ninguna, si origen == «ninguna».
    """
    pide = {r["id"] for r in rangos}
    tercerizado = any(_norm(r["nombre"]) in _RANGOS_AFUERA for r in rangos)

    if not proceso_usa_maquina(nombre, tercerizado):
        return {"origen": ORIGEN_A_MANO, "efectivas": [], "sin_rango": [], "motivo": None}

    por_id = {m["id"]: m for m in maquinas}

    # 1. Lo que el taller cargó le gana a la deducción. Se cruza con las máquinas que
    #    existen, por si alguna se dio de baja después de haberla elegido.
    elegidas = [por_id[c["id"]] for c in cargadas if c["id"] in por_id]
    if elegidas:
        return {
            "origen": ORIGEN_CARGADA,
            "efectivas": [_ref(m) for m in elegidas if _acepta(pide, m)],
            "sin_rango": [_ref(m) for m in elegidas if not _acepta(pide, m)],
            "motivo": None,
        }

    # 2. Sin dato cargado: la familia que dice el nombre.
    familia = familia_requerida_from_proceso(nombre)
    de_la_familia = [
        m for m in maquinas
        if familia and familia_from_maquina(m["nombre"], m.get("cod_maquina") or "") == familia
    ]
    usables = [m for m in de_la_familia if _acepta(pide, m)]

    # Una preparación sin máquina de su familia que le sirva busca por parecido de
    # nombre («preparación de soldadora tig» → la SOLDADORA TIG), sin mirar rangos.
    if not usables and _get_tipo_proceso(nombre) == "SETUP":
        base = _base_del_setup(nombre)
        if base:
            usables = [m for m in maquinas if base in (_norm(m["nombre"]) or "")]

    if usables:
        return {"origen": ORIGEN_NOMBRE, "efectivas": [_ref(m) for m in usables],
                "sin_rango": [], "motivo": None}

    if not familia:
        motivo = MOTIVO_SIN_FAMILIA
    elif not de_la_familia:
        motivo = MOTIVO_SIN_MAQUINA
    else:
        motivo = MOTIVO_RANGO
    return {"origen": ORIGEN_NINGUNA, "efectivas": [], "sin_rango": [], "motivo": motivo}


def con_maquinas_de_cada_proceso(cobertura: dict) -> dict:
    """Le suma a cada proceso de la cobertura las máquinas con las que va a planificar.

    Agrega `maquinas_origen`, `maquinas_efectivas`, `maquinas_sin_rango` y
    `maquinas_motivo`; `maquinas` (las cargadas) queda como estaba, porque es lo que
    edita EditorMaquinasDe.

    Un fallo en UN proceso no tumba la cobertura entera: esa pantalla también avisa
    qué rango no tiene gente y qué máquina no tiene rango, y perder eso por un adorno
    sería un mal cambio. El proceso queda sin los campos nuevos y la pantalla lo
    muestra como antes.
    """
    maquinas = cobertura.get("maquinas") or []
    for p in cobertura.get("procesos") or []:
        try:
            r = maquinas_del_proceso(
                p.get("nombre") or "", p.get("rangos") or [], p.get("maquinas") or [], maquinas)
        except Exception as e:  # noqa: BLE001 — ver la docstring
            logger.warning(f"Cobertura - no se pudo resolver la máquina del proceso {p.get('id')}: {e}")
            continue
        p["maquinas_origen"] = r["origen"]
        p["maquinas_efectivas"] = r["efectivas"]
        p["maquinas_sin_rango"] = r["sin_rango"]
        p["maquinas_motivo"] = r["motivo"]
    return cobertura
