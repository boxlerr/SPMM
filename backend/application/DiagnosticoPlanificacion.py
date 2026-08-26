"""Diagnóstico de lo que traba una planificación, contado para quien planifica.

El planificador siempre devolvió un resultado: lo que no podía asignar salía como
"sin asignar" o "sin máquina" y el motivo quedaba en los logs del servidor. Acá se
arma la explicación: qué traba, a cuánto trabajo afecta y qué tocar para
destrabarlo. Las sugerencias se calculan contra los datos reales, no son texto
genérico — pero se ofrecen como opciones: si una fresadora puede o no hacer un
trabajo lo sabe el taller, no el planificador.

Los textos son deliberadamente CORTOS. La primera versión explicaba cada aviso en
un párrafo y Lucas lo dijo sin vueltas: marea tanto texto. El título dice el
problema, el detalle una o dos frases, cada solución una línea. El que quiere el
porqué largo lo tiene en los comentarios de este archivo, que para eso están.

Dos reglas de forma, de la revisión del 21/08 ("me marea tanta negrita, y cada
traba tiene otro orden de palabras" — Julián):

  1. TODOS los títulos empiezan por el SUJETO y siguen con lo que le pasa:
     «plegado» se hace sin reservar la máquina, FRESADORA CNC es la única máquina
     para 10 jornadas, VACANTE MEDIO OFICIAL tiene trabajo asignado. Antes cada
     familia de aviso arrancaba a su manera —"Nadie puede hacer X", "10 jornadas
     de trabajo para 3 máquinas", "Hay trabajo asignado a…"— y la lista se leía
     como seis avisos de seis sistemas distintos: no había una columna donde
     apoyar la vista para comparar uno con el de abajo.

  2. La negrita marca NOMBRES del taller (máquina, proceso, rango, persona) y
     CIFRAS. Nunca una frase, y nunca el nombre que ya está en el título. Un
     renglón con siete negritas no resalta nada: solo grita.
"""
import re

from backend.application.PlanificacionService import (
    MIN_LABORAL_DIA,
    familia_requerida_from_proceso,
    familia_from_maquina,
    _get_tipo_proceso,
    _norm,
)

BLOQUEANTE = "bloqueante"
ADVERTENCIA = "advertencia"

# Siglas del taller que NO son palabras: si se las escribe como palabra el proceso
# deja de reconocerse («soldadura con mig» no lo lee nadie como MIG).
_SIGLAS = {"MIG", "MAG", "TIG", "CNC", "CNCC", "ELEC", "PU", "OT"}

# El catálogo viene del legacy, tipeado en mayúscula y sin tildes. En mayúscula no
# se notaba; escrito como frase, «Preparacion de soldadora» sí. Solo van las
# palabras que están de verdad en el catálogo: no es un corrector ortográfico.
_CON_TILDE = {
    "PREPARACION": "preparación", "PROGRAMACION": "programación",
    "REPARACION": "reparación", "TERMINACION": "terminación",
    "FABRICACION": "fabricación", "REVISION": "revisión",
    "REGULACION": "regulación", "MAQUINA": "máquina",
    "HIDRAULICA": "hidráulica", "MECANIZACION": "mecanización",
}


def _bonito(nombre: str) -> str:
    """El nombre del proceso, escrito como se escribe una frase.

    El catálogo lo guarda TODO EN MAYÚSCULA y el planificador lo bajaba entero a
    minúscula, así que los avisos decían «soldadura con mig» y «torno t1»: Lucas no
    reconocía sus propios procesos. Se escribe con mayúscula inicial y minúsculas,
    pero las siglas (MIG, TIG, CNC) y los códigos de máquina (T1, F7CC) quedan como
    están — son el dato que distingue un proceso de otro.

    Se aplica al ENTRAR, una sola vez por proceso, y no en cada texto: todo lo que
    clasifica por nombre pasa por _norm, que normaliza mayúsculas y acentos, así que
    embellecer acá no cambia ninguna decisión del diagnóstico.
    """
    palabras = []
    for palabra in (nombre or "").split():
        trozos = []
        for t in re.split(r"([/\-])", palabra):
            if t in ("/", "-"):
                trozos.append(t)
            elif t.upper() in _SIGLAS or (any(c.isdigit() for c in t) and any(c.isalpha() for c in t)):
                trozos.append(t.upper())
            else:
                trozos.append(_CON_TILDE.get(t.upper(), t.lower()))
        palabras.append("".join(trozos))
    texto = " ".join(palabras)
    for i, ch in enumerate(texto):
        if ch.isalpha():
            return texto[:i] + ch.upper() + texto[i + 1:]
    return texto


def _corto(minutos: int) -> str:
    """Tiempo en lenguaje de taller, lo más corto posible."""
    if minutos < 60:
        return f"{minutos} min"
    if minutos < MIN_LABORAL_DIA:
        h, m = divmod(minutos, 60)
        return f"{h}h {m:02d}m" if m else f"{h}h"
    j = minutos / MIN_LABORAL_DIA
    return f"{j:.0f} jornada{'s' if j >= 1.5 else ''}"


def _listar(nombres, conector=" y "):
    """Enumera todos. Un "y 2 más" obliga a adivinar a quién le falta el rango, y
    esto se lee justamente para ir a arreglarlo: van los nombres completos."""
    nombres = list(nombres)
    if not nombres:
        return ""
    if len(nombres) == 1:
        return nombres[0]
    return ", ".join(nombres[:-1]) + conector + nombres[-1]


def _listar_corto(nombres, tope=2):
    """Como `_listar`, pero para TÍTULOS: corta en `tope` y cuenta el resto.

    En el detalle van todos los nombres a propósito (hay que saber a quién le falta
    el rango). En el título no: un renglón con nueve procesos deja de ser un título
    y no se puede comparar de un vistazo con el de al lado, que es justamente para
    lo que sirve. La lista completa está una línea más abajo.
    """
    nombres = list(nombres)
    if len(nombres) <= tope:
        return _listar(nombres)
    resto = len(nombres) - tope
    return f"{_listar(nombres[:tope])} y {resto} más"


def _listar_rangos(nombres):
    """Los rangos se cumplen con CUALQUIERA de la lista —el solver cruza conjuntos y
    le alcanza la intersección—, así que van con "o". Con "y" el aviso pedía cargar
    los dos cuando con uno alcanzaba."""
    return _listar(nombres, conector=" o ")


def _resumen(procesos: int, ots, minutos: int) -> str:
    n_ots = len(ots)
    return f"{procesos} proc · {n_ots} OT · {_corto(minutos)}"


def construir_diagnosticos(
    procesos,
    operarios,
    maquinarias,
    resultados,
    nombre_rango,
    nombre_operario,
    skills_manuales=None,
    nativas_off=None,
    ots_con_plano=None,
    op_planos=None,
    rangos_efectivos=None,
):
    """
    procesos      : tuplas que se le pasan al solver
    operarios     : [(id_operario, id_rango)] — solo los disponibles
    maquinarias   : [(id, {rangos}, nombre, cod_maquina)]
    resultados    : lista de dicts que devolvió el solver
    """
    skills_manuales = skills_manuales or {}
    nativas_off = nativas_off or {}
    ots_con_plano = set(ots_con_plano or ())
    op_planos = op_planos or {}

    # El SETUP hereda del proceso de producción que le sigue los rangos y la
    # familia con los que el solver realmente filtró máquinas. Se aplican acá,
    # una vez, para que todos los diagnósticos cuenten la misma verdad.
    rangos_crudos = {(p[0], p[1]): set(p[6] or ()) for p in procesos}
    if rangos_efectivos:
        procesos = [
            (p[:6] + (rangos_efectivos[(p[0], p[1])][0],) + (p[7], p[8])
             + (rangos_efectivos[(p[0], p[1])][1],) + p[10:])
            if (p[0], p[1]) in rangos_efectivos else p
            for p in procesos
        ]

    ops_por_rango = {}
    for op_id, r_id in operarios:
        ops_por_rango.setdefault(r_id, set()).add(op_id)
    rangos_por_op = {}
    for op_id, r_id in operarios:
        rangos_por_op.setdefault(op_id, set()).add(r_id)

    maq_familia = {m[0]: familia_from_maquina(m[2], m[3]) for m in maquinarias}
    maq_nombre = {m[0]: (m[2] or f"#{m[0]}").strip() for m in maquinarias}
    maq_rangos = {m[0]: set(m[1] or ()) for m in maquinarias}

    diagnosticos = []
    diagnosticos += _procesos_que_nadie_puede_hacer(
        procesos, ops_por_rango, rangos_por_op, skills_manuales, nativas_off,
        maq_familia, maq_nombre, maq_rangos, nombre_rango, nombre_operario,
    )
    diagnosticos += _cuellos_de_maquina(
        procesos, maq_familia, maq_nombre, maq_rangos, nombre_rango, resultados,
    )
    # Único responsable de "pidió máquina y no la tuvo", en sus tres causas.
    # Absorbió a _gente_sin_habilitacion_en_la_maquina, que contaba una de ellas
    # por separado y solo para procesos con familia de máquina.
    diagnosticos += _procesos_sin_maquina_compatible(
        procesos, maq_familia, maq_nombre, maq_rangos, nombre_rango, resultados,
        ops_por_rango, rangos_por_op, skills_manuales, nativas_off, nombre_operario,
        ots_con_plano, op_planos, rangos_crudos,
    )
    diagnosticos += _procesos_sin_rango(procesos)
    diagnosticos += _trabajo_tercerizado(procesos)
    diagnosticos += _trabajo_en_puestos_vacantes(resultados, nombre_operario)

    _avisar_nombres_repetidos(diagnosticos)

    # El desempate por `id` no es cosmético: sin él, dos líneas con los mismos minutos
    # se intercambian entre recálculos —el orden de entrada sale de dicts armados
    # sobre sets— y parece que el plan cambió cuando no cambió nada.
    orden = {BLOQUEANTE: 0, ADVERTENCIA: 1}
    diagnosticos.sort(
        key=lambda d: (orden.get(d["severidad"], 9), -d["impacto"]["minutos"], d["id"])
    )
    return diagnosticos


def _avisar_nombres_repetidos(diagnosticos):
    """Dos procesos DISTINTOS pueden tener el mismo nombre visible: el catálogo trae
    pares duplicados por un espacio de más —«ENSAMBLAJE, PUNTEADO␣␣Y ESCUADRADO»
    (#256) y «ENSAMBLAJE, PUNTEADO Y ESCUADRADO» (#6224)—, residuo de la migración de
    julio. Salían como dos líneas idénticas, sin forma de saber cuál era cuál ni por
    qué había dos.

    No se fusionan a propósito: son ids distintos, cada uno con su carga de rangos, y
    arreglar uno deja el otro igual. Lo que faltaba era decirlo."""
    # La clave se normaliza porque el problema es justamente el espacio de más: el
    # navegador colapsa los espacios en blanco, así que los dos títulos llegan
    # distintos al HTML y se ven idénticos en pantalla. Agrupar por el string crudo
    # no detectaría nada.
    por_titulo = {}
    for d in diagnosticos:
        por_titulo.setdefault(_norm(d["titulo"]), []).append(d)

    for iguales in por_titulo.values():
        if len(iguales) < 2:
            continue
        for d in iguales:
            d["detalle"] += (
                f" Ojo: en el catálogo hay {len(iguales)} procesos distintos con este mismo "
                "nombre —se diferencian por espacios de más, que no se ven en pantalla—. "
                "Por eso el aviso aparece repetido, y cada uno se arregla por su lado."
            )


def _es_vacante(nombre: str) -> bool:
    """Los puestos "VACANTE ... A CUBRIR" no son personas. Tener el rango cargado
    los hacía pasar por candidatos válidos y tapaban el hueco real."""
    return (nombre or "").upper().startswith("VACANTE")


def _concuerda(cuantos, singular: str, plural: str) -> str:
    """Concordancia de verbo según cuántos son. Los textos decían «puede(n)» para
    esquivarla, y acá el número se sabe: no hay por qué hacérselo leer al taller."""
    n = cuantos if isinstance(cuantos, int) else len(cuantos)
    return singular if n == 1 else plural


def _como_alternativa(soluciones):
    """Prefija «O …» de la segunda opción en adelante.

    Antes el «O» iba escrito a mano dentro del texto de las dos últimas opciones y
    la primera se agregaba bajo condición. En todo proceso manual esa condición no
    se cumple nunca —depende de que el proceso tenga familia de máquina, y un
    manual no la tiene—, así que las alternativas quedaban huérfanas y el arreglo
    empezaba con «O dale…» sin que hubiera un «dale…» antes. Con el prefijo puesto
    por posición, la primera siempre se lee como la principal.
    """
    for s in soluciones[1:]:
        t = s.get("texto") or ""
        if t and not t.startswith("O "):
            s["texto"] = "O " + t[0].lower() + t[1:]
    return soluciones


def _primer_nombre(completo: str) -> str:
    """'IVAN BALMACEDA' -> 'IVAN B.' — alcanza para reconocerlo y ocupa la mitad.

    Solo se abrevia lo que parece un apellido. En la base hay legajos cuyo apellido
    es un número ('Pasante 1', 'Pasante 2') y salían como 'Pasante 1.', con un punto
    que los hacía leer como una abreviatura de algo."""
    partes = (completo or "").split()
    if len(partes) < 2 or not partes[1][0].isalpha():
        return " ".join(partes) if partes else ""
    return f"{partes[0]} {partes[1][0]}."


def _cerrar(texto: str) -> str:
    """Cierra la oración sin duplicar el punto: un apellido abreviado ya trae el
    suyo y la frase terminaba en «… y Leonel s..»."""
    return texto if texto.rstrip("*").endswith(".") else texto + "."






def _accion_proceso(proc_id, nombre_proc, rangos_finales):
    """Cargarle rangos a un proceso, listo para que el botón lo aplique solo.

    El endpoint es un REEMPLAZO, así que va el conjunto FINAL —los que ya tenía
    más los nuevos—, calculado sobre los rangos guardados en la base y no sobre
    los efectivos (un SETUP hereda los de su producción y escribir eso pisaría
    la carga real con algo que nunca nadie cargó)."""
    return {
        "tipo": "proceso",
        "id": proc_id,
        "nombre": nombre_proc,
        "rangos": sorted(rangos_finales),
    }


def _accion_maquina(maquinas, maq_nombre, maq_rangos, rangos_a_sumar):
    """Cargarle rangos a las máquinas candidatas.

    Antes, con más de una máquina no se ofrecía botón: tocar un parque entero de un
    click era justo lo que no se quería. Pero el efecto real era peor — la mitad de
    los avisos no tenía forma rápida de resolverse y había que ir a Recursos a hacer
    a mano exactamente el mismo cambio, una máquina por vez. El resguardo ahora es
    otro: el texto dice a cuánta gente se le abre la máquina ANTES de tocar, y el
    botón pide confirmación. `objetivos` lleva una entrada por máquina, cada una con
    su conjunto final de rangos, porque no todas tienen los mismos.
    """
    if not maquinas:
        return None
    return {
        "tipo": "maquinaria",
        # `id` y `rangos` quedan por compatibilidad con lo ya desplegado: un
        # frontend viejo sigue aplicando la primera máquina en vez de romperse.
        "id": maquinas[0],
        "nombre": maq_nombre[maquinas[0]],
        "rangos": sorted(set(maq_rangos.get(maquinas[0], set())) | set(rangos_a_sumar)),
        "objetivos": [
            {
                "id": m,
                "nombre": maq_nombre[m],
                "rangos": sorted(set(maq_rangos.get(m, set())) | set(rangos_a_sumar)),
            }
            for m in maquinas
        ],
    }


def _accion_encender_skill(proc_id, nombre_proc, operarios, nombre_operario):
    """Volver a encender una habilidad apagada a mano.

    Es el arreglo más seguro de todos —no le da permisos nuevos a nadie, devuelve
    los que el rango ya daba— y era el único que no tenía botón."""
    if not operarios:
        return None
    return {
        "tipo": "skill_nativa",
        "id": proc_id,
        "nombre": nombre_proc,
        "habilitado": True,
        "objetivos": [
            {"id": op, "nombre": (nombre_operario.get(op) or f"#{op}").strip()}
            for op in sorted(operarios)
        ],
    }


def _personas_con_rangos(rangos_ids, ops_por_rango, nombre_operario) -> set:
    """Quiénes tienen alguno de esos rangos, sin contar los puestos VACANTE.

    Se usa para dos cosas distintas y las dos importan: decir a cuánta gente se le
    abre una máquina, y detectar el caso en que un rango existe en el catálogo pero
    no lo tiene ninguna persona real."""
    ops = set()
    for r in rangos_ids or ():
        ops |= ops_por_rango.get(r, set())
    return {o for o in ops if not _es_vacante(nombre_operario.get(o))}


def _cuenta_personas(rangos_ids, ops_por_rango, nombre_operario):
    """"3 personas (GUILLERMO C., PABLO Z. y MATIAS V.)" — a cuánta gente alcanza un rango.

    Sin este número, "agregale OPERARIO CALIFICADO a la máquina" suena inofensivo
    y puede estar abriendo una máquina restringida a media planta.
    """
    ops = _personas_con_rangos(rangos_ids, ops_por_rango, nombre_operario)
    if not ops:
        return "nadie"
    nombres = sorted(_primer_nombre(nombre_operario.get(o, f"#{o}")) for o in ops)
    if len(ops) == 1:
        return f"1 persona ({nombres[0]})"
    return f"{len(ops)} personas ({_listar(nombres)})"


def _fecha_corta(iso: str) -> str:
    """'2026-09-02T15:30:00' -> '2 de septiembre'. Vacío si no se puede leer."""
    if not iso or len(iso) < 10:
        return ""
    MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
             "agosto", "septiembre", "octubre", "noviembre", "diciembre")
    try:
        _a, m, dia = iso[:10].split("-")
        return f"{int(dia)} de {MESES[int(m) - 1]}"
    except (ValueError, IndexError):
        return ""


def _maquinas_por_nombre(nombre_proceso, maq_nombre):
    """Máquinas candidatas de un SETUP sin familia, por coincidencia de nombre.

    Mismo criterio que usa el solver para los SETUP («preparacion de soldadora tig»
    → la máquina SOLDADORA TIG). Se replica acá para poder explicar por qué un
    proceso se quedó sin máquina; si el criterio del solver cambia, hay que tocar
    los dos lugares — es el precio de contar el porqué sin arrastrar el modelo entero.
    """
    base = (
        _norm(nombre_proceso or "")
        .replace("PROGRAMACION DE", "").replace("PROGRAMACION", "")
        .replace("PREPARACION DE", "").replace("PREPARACION", "")
        .replace("CAMBIO DE", "")
        .strip()
    )
    if not base:
        return []
    return [m for m, n in maq_nombre.items() if base in (_norm(n) or "")]


def _detalle_nadie_puede(pedidos, quienes_off, vacantes, nombre_operario, nombre_proc):
    """Por qué nadie puede hacerlo. Son tres motivos distintos y hasta ahora los
    tres se contaban con la misma frase ("ningún operario disponible lo tiene"),
    que en el caso de la habilidad apagada era directamente falsa."""
    if quienes_off:
        return (
            f"**{_listar(quienes_off)}** {_concuerda(quienes_off, 'tiene', 'tienen')} "
            f"{_listar(pedidos)}, así que {_concuerda(quienes_off, 'podría', 'podrían')} "
            f"hacerlo, pero **{nombre_proc}** está apagado en su ficha. "
            "Va a salir «sin asignar»."
        )
    if vacantes:
        nombres = _listar(sorted(
            (nombre_operario.get(op) or f"#{op}").strip() for op in vacantes
        ))
        return (
            f"Pide {_listar(pedidos)} y solo lo tiene {nombres}, que es un puesto a "
            "cubrir y no una persona. Va a salir «sin asignar»."
        )
    return (
        f"Pide {_listar(pedidos)} y ningún operario disponible lo tiene. "
        "Va a salir «sin asignar»."
    )


def _procesos_que_nadie_puede_hacer(
    procesos, ops_por_rango, rangos_por_op, skills_manuales, nativas_off,
    maq_familia, maq_nombre, maq_rangos, nombre_rango, nombre_operario,
):
    """El proceso pide rangos que no tiene ninguna persona disponible. Es el más
    caro de descubrir a ojo: el rango existe, la máquina existe, la gente existe —
    lo que no existe es el cruce."""
    por_proceso = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, rangos, nombre, usa_maq, familia, _sk) in procesos:
        if not rangos:
            continue
        # Los tercerizados salen sin nadie a propósito: los cuenta _trabajo_tercerizado.
        if _get_tipo_proceso(nombre or "") == "ADMIN":
            continue
        d = por_proceso.setdefault(proc_id, {
            "nombre": _bonito(nombre) or f"#{proc_id}",
            "rangos": set(rangos), "ots": set(), "minutos": 0, "procesos": 0,
            "familia": familia, "usa_maquina": usa_maq,
        })
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    salida = []
    for proc_id, d in por_proceso.items():
        elegibles = set()
        for r in d["rangos"]:
            elegibles |= ops_por_rango.get(r, set())
        elegibles |= set(skills_manuales.get(proc_id, set()))

        # Los que SÍ lo tendrían, pero están apagados a mano en su ficha. Antes esto
        # se restaba y se olvidaba, y el aviso terminaba diciendo "ningún operario
        # disponible lo tiene" cuando el rango lo tenían: CONTROL DE MEDIDAS pide
        # AYUDANTE + INGRESANTE y los dos pasantes tienen los dos, solo que con el
        # proceso deshabilitado. Mandaba a cargar un rango que ya estaba y el plan
        # seguía igual. Son dos problemas distintos y se arreglan en lugares
        # distintos: este es un click en la ficha.
        apagados = {
            op for op in elegibles & set(nativas_off.get(proc_id, set()))
            if not _es_vacante(nombre_operario.get(op))
        }
        elegibles -= set(nativas_off.get(proc_id, set()))

        vacantes = {op for op in elegibles if _es_vacante(nombre_operario.get(op))}
        personas = elegibles - vacantes
        if personas:
            continue

        quienes_off = sorted(
            _primer_nombre(nombre_operario.get(op, f"#{op}")) for op in apagados
        )

        pedidos = [nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])]

        # El arreglo tiene que servirle también a la máquina, no solo al proceso.
        familia = d["familia"] or (familia_requerida_from_proceso(d["nombre"]) if d["usa_maquina"] else "")
        maquinas_familia = [m for m, f in maq_familia.items() if familia and f == familia]
        rangos_de_esas_maquinas = set()
        for m in maquinas_familia:
            rangos_de_esas_maquinas |= maq_rangos.get(m, set())

        # Rangos que la gente SÍ tiene (sin vacantes), por cuánta gente los tiene.
        candidatos = sorted(
            ((r, len([o for o in ops if not _es_vacante(nombre_operario.get(o))]))
             for r, ops in ops_por_rango.items()),
            key=lambda x: -x[1],
        )
        candidatos = [(r, n) for r, n in candidatos if n > 0]
        directo = [(r, n) for r, n in candidatos if r in rangos_de_esas_maquinas]

        soluciones = []
        # Si el rango ya lo tienen y lo que falta es encenderles el proceso, ese es
        # el arreglo más chico y va primero: no toca permisos de nadie más.
        if quienes_off:
            soluciones.append({
                "texto": f"Volvé a encenderle **{d['nombre']}** a **{_listar(quienes_off)}**: "
                         f"ya {_concuerda(quienes_off, 'tiene', 'tienen')} el rango, "
                         "solo está apagado en su ficha.",
                "donde": "Recursos › Operarios",
                "accion": _accion_encender_skill(proc_id, d["nombre"], apagados, nombre_operario),
            })
        if directo:
            r, n = directo[0]
            soluciones.append({
                "texto": f"Sumale {nombre_rango.get(r, f'#{r}')} al proceso: "
                         f"lo {_concuerda(n, 'tiene', 'tienen')} {n} "
                         f"{_concuerda(n, 'persona', 'personas')} y ya está en la máquina.",
                "donde": "Recursos › Procesos",
            })
        elif candidatos and maquinas_familia:
            r, n = candidatos[0]
            soluciones.append({
                "texto": f"Sumale {nombre_rango.get(r, f'#{r}')} al proceso y también a {_listar([maq_nombre[m] for m in maquinas_familia])}.",
                "donde": "Recursos › Procesos y Rangos",
            })
        soluciones.append({
            "texto": f"Dale {_listar(pedidos)} a quien hace este trabajo.",
            "donde": "Recursos › Operarios",
        })
        soluciones.append({
            "texto": "Cargale la skill a mano en su ficha (habilita solo a esa persona).",
            "donde": "Recursos › Operarios",
        })
        _como_alternativa(soluciones)

        salida.append({
            "id": f"nadie-puede-{proc_id}",
            "tipo": "proceso_sin_operarios",
            "severidad": BLOQUEANTE,
            # Todos los títulos arrancan por el SUJETO —el proceso, la máquina, la
            # persona— y siguen con lo que le pasa. Antes cada uno empezaba distinto
            # ("Nadie puede hacer X", "10 jornadas para 3 máquinas", "Hay trabajo
            # asignado a...") y la lista se leía como seis avisos de seis sistemas
            # distintos: no había una columna donde apoyar la vista.
            "titulo": f"{d['nombre']}: hoy no lo puede hacer nadie",
            "detalle": _detalle_nadie_puede(
                pedidos, quienes_off, vacantes, nombre_operario, d["nombre"]
            ),
            "impacto": {
                "procesos": d["procesos"],
                "ots": sorted(d["ots"]),
                "minutos": d["minutos"],
                "resumen": _resumen(d["procesos"], d["ots"], d["minutos"]),
            },
            "soluciones": soluciones,
        })
    return salida


def _cuellos_de_maquina(procesos, maq_familia, maq_nombre, maq_rangos, nombre_rango, resultados):
    """Más trabajo del que entra en las máquinas habilitadas dentro del período.

    Se agrupa por el CONJUNTO de máquinas que el proceso puede usar, no por familia:
    "fresadora cnc" (OFICIAL CNC) solo puede ir a la FRESADORA CNC; "fresadora f6"
    (OFICIAL) puede ir a otras tres. Por familia parecían cuatro máquinas para todo,
    cuando el cuello real es que hay UNA para la parte CNC.
    """
    grupos = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, rangos, nombre, usa_maq, familia, _sk) in procesos:
        if not usa_maq or not familia:
            continue
        de_la_familia = [m for m, f in maq_familia.items() if f == familia]
        if not de_la_familia:
            continue
        rangos = set(rangos or ())
        habilitadas = [m for m in de_la_familia if not rangos or (rangos & maq_rangos.get(m, set()))]
        if not habilitadas:
            continue  # lo cubre el diagnóstico de máquinas sin rango

        clave = frozenset(habilitadas)
        g = grupos.setdefault(clave, {
            "minutos": 0, "ots": set(), "rangos": set(), "procesos": set(),
            "familia": familia, "de_la_familia": set(de_la_familia),
            "pares": set(),
        })
        g["minutos"] += dur
        g["ots"].add(orden_id)
        g["rangos"] |= rangos
        g["procesos"].add(_bonito(nombre))
        g["de_la_familia"] |= set(de_la_familia)
        # (orden, secuencia) y no (orden, proceso): una OT puede traer el mismo
        # proceso dos veces y son instancias distintas — con la clave por proceso,
        # que una consiga máquina taparía a la otra.
        g["pares"].add((orden_id, _sec))

    # Qué instancia salió DE VERDAD sin máquina. El flag `sin_maquinaria` a
    # secas no sirve para esto: los procesos manuales (soldadura, embalado,
    # pintura...) salen sin máquina a propósito, así que mirar el flag por OT
    # pintaba TODO cuello como traba roja aunque el plan hubiera entrado completo
    # — Julián lo vio el 15/08: "2 trabas" con 73/73 procesos planificados.
    # Un proceso de estos grupos sí pide máquina; si ninguna fila suya la tiene,
    # el cuello mordió en serio.
    pares_con_maquina = {
        (r["orden_id"], r["secuencia"]) for r in resultados if r.get("id_maquinaria")
    }
    pares_excedentes = {
        (r["orden_id"], r["secuencia"]) for r in resultados if r.get("excedente")
    }
    fin_por_par = {
        (r["orden_id"], r["secuencia"]): r.get("fecha_fin_estimada") for r in resultados
    }

    salida = []
    for clave, d in grupos.items():
        habilitadas = sorted(clave)
        sin_habilitar = [m for m in sorted(d["de_la_familia"]) if m not in clave]

        jornadas_por_maquina = d["minutos"] / max(1, len(habilitadas)) / MIN_LABORAL_DIA
        if jornadas_por_maquina < 3:
            continue  # entra sin drama

        nombres_hab = [maq_nombre[m] for m in habilitadas]
        soluciones = []
        if sin_habilitar:
            rangos_txt = _listar([nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])])
            soluciones.append({
                "texto": f"Si **{_listar([maq_nombre[m] for m in sin_habilitar])}** también puede hacer este "
                         f"trabajo, agregale **{rangos_txt}** y el trabajo se reparte entre más máquinas.",
                "donde": "Recursos › Maquinarias",
                "accion": _accion_maquina(sin_habilitar, maq_nombre, maq_rangos, d["rangos"]),
            })
        soluciones.append({
            "texto": "O planificá menos OTs juntas: con menos trabajo en la misma máquina, las fechas se acercan.",
            "donde": "Al elegir las OTs",
        })

        # Solo es traba si a este grupo se le quedó trabajo sin máquina o afuera.
        pares_mordidos = [
            p for p in d["pares"]
            if p not in pares_con_maquina and p not in pares_excedentes
        ]
        pares_sin_lugar = [p for p in d["pares"] if p in pares_excedentes]
        afecta_ots = sorted({o for o, _ in pares_mordidos} | {o for o, _ in pares_sin_lugar})

        # Hasta cuándo llega el trabajo de ESTE grupo. Es la consecuencia concreta
        # del cuello — "10 jornadas para 3 máquinas" no le dice nada a nadie hasta
        # que ve que la última pieza termina el 2 de septiembre.
        ultima = max((fin_por_par.get(p) or "" for p in d["pares"]), default="")
        hasta_txt = f" El último de estos procesos termina el **{_fecha_corta(ultima)}**." if ultima else ""

        n_proc = len(d["procesos"])
        # Sujeto primero, como todos los demás: acá el sujeto es la máquina.
        titulo = (
            f"{nombres_hab[0]} es la única máquina para {_corto(d['minutos'])} de trabajo"
            if len(habilitadas) == 1
            else f"{_listar_corto(nombres_hab)} se reparten {_corto(d['minutos'])} de trabajo"
        )
        base_txt = (
            f"{_listar(sorted(d['procesos']))} solo "
            f"{_concuerda(d['procesos'], 'se puede hacer', 'se pueden hacer')} en "
            f"**{_listar(nombres_hab)}**"
        )
        if afecta_ots:
            partes = []
            if pares_mordidos:
                n = len(pares_mordidos)
                partes.append(f"**{n} proceso{'s' if n != 1 else ''}** quedó sin reservar máquina")
            if pares_sin_lugar:
                n = len(pares_sin_lugar)
                partes.append(f"**{n}** no entró en el período elegido")
            detalle = f"{base_txt}, y no alcanzó: {' y '.join(partes)}.{hasta_txt}"
        else:
            detalle = (
                f"{base_txt}. Entra todo, pero por turnos: mientras una pieza está en la máquina, "
                f"las otras esperan.{hasta_txt} No hay nada roto — es la capacidad real del taller."
            )
        salida.append({
            "id": "cuello-" + "-".join(str(m) for m in habilitadas),
            "tipo": "cuello_de_maquina",
            "severidad": BLOQUEANTE if afecta_ots else ADVERTENCIA,
            "titulo": titulo,
            "detalle": detalle,
            "impacto": {
                "procesos": len(d["procesos"]),
                "ots": sorted(d["ots"]),
                "minutos": d["minutos"],
                "resumen": _resumen(len(d["procesos"]), d["ots"], d["minutos"]),
            },
            "soluciones": soluciones,
        })
    return salida


def _procesos_sin_maquina_compatible(
    procesos, maq_familia, maq_nombre, maq_rangos, nombre_rango, resultados,
    ops_por_rango, rangos_por_op, skills_manuales, nativas_off, nombre_operario,
    ots_con_plano=None, op_planos=None, rangos_crudos=None,
):
    """El proceso pidió máquina y no la consiguió. Acá se explica por qué.

    Se arma MIRANDO EL RESULTADO, no prediciendo el dominio del solver. La versión
    anterior replicaba el filtro por familia y se le escapaba todo lo que el solver
    resuelve por nombre: «preparacion de soldadora tig» no tiene familia (soldadura
    no está modelada como familia de máquina), así que ni lo miraba y esos procesos
    salían "Sin asignar" sin que nada lo explicara — justo la confusión que Julián
    marcó el 18/08. Partiendo del resultado eso no puede volver a pasar.

    Absorbió al viejo `_gente_sin_habilitacion_en_la_maquina`, que contaba una de
    estas tres causas por su cuenta y solo para procesos con familia. Son la misma
    historia ("salió sin máquina") con distinto culpable:

      a) no hay ninguna máquina que corresponda      → nada que corregir, es aviso
      b) la máquina pide rangos que el proceso no tiene → se arregla en Maquinarias
      c) los rangos cierran, pero nadie de los que pueden hacerlo está habilitado
         en esa máquina                                → se arregla en Operarios

    Los manuales y tercerizados no entran (usa_maquina=False: van sin máquina a
    propósito), y tampoco los que sí tienen máquina compatible y libre — si a esos
    no les alcanzó el lugar es un cuello, y lo cuenta _cuellos_de_maquina.
    """
    ots_con_plano = set(ots_con_plano or ())
    op_planos = op_planos or {}
    rangos_crudos = rangos_crudos or {}

    # Las filas de operarios ADICIONALES comparten (orden, secuencia) con la
    # principal y van siempre sin máquina —la reserva la principal—, así que
    # metían en este set procesos que SÍ tenían máquina y el aviso contradecía
    # al propio plan. Se descartan por la marca que pone _extraer_resultados.
    sin_maquina = {
        (r["orden_id"], r["secuencia"])
        for r in resultados
        if r.get("usa_maquina") and not r.get("id_maquinaria")
        and not r.get("excedente") and not r.get("slot_extra")
    }
    if not sin_maquina:
        return []

    por_proceso = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, rangos, nombre, usa_maq, familia, _sk) in procesos:
        if not usa_maq or (orden_id, _sec) not in sin_maquina:
            continue
        rangos = set(rangos or ())
        nombre = _bonito(nombre) or f"#{proc_id}"

        # Candidatas con el MISMO criterio que el solver, que ramifica por tipo:
        #   SETUP              → por familia, y si no hay, por nombre de máquina.
        #   PRODUCCION_MAQUINA → por familia si la tiene; si no, TODAS las máquinas
        #                        (después las filtra por rango).
        # Aplicar el camino "por nombre" a todo proceso sin familia era un error:
        # ENGOMADO, DECAPADO y PEGADO DE CHAPA (producción, sin familia, con rangos
        # AYUDANTE/INGRESANTE que ninguna máquina acepta) daban candidatas=[] y el
        # aviso culpaba a una máquina faltante cuando el motivo real es el rango.
        if familia:
            candidatas = [m for m, f in maq_familia.items() if f == familia]
        elif _get_tipo_proceso(nombre) == "SETUP":
            candidatas = _maquinas_por_nombre(nombre, maq_nombre)
        else:
            candidatas = list(maq_nombre.keys())

        # De esas, las que el PROCESO habilita por rango.
        usables = [m for m in candidatas if not rangos or (rangos & maq_rangos.get(m, set()))]

        # Quiénes pueden hacer el proceso (rango nativo + skill manual − skill apagada).
        elegibles = set()
        for r in rangos:
            elegibles |= ops_por_rango.get(r, set())
        elegibles |= set(skills_manuales.get(proc_id, set()))
        elegibles -= set(nativas_off.get(proc_id, set()))
        # Plano adjunto ⇒ solo quien sabe interpretarlo. En el solver es filtro
        # duro; sin replicarlo acá, el diagnóstico creía que había gente y se
        # comía el caso: el proceso salía "Sin asignar" sin ninguna explicación.
        if orden_id in ots_con_plano:
            elegibles = {op for op in elegibles if op_planos.get(op, False)}
        personas = {op for op in elegibles if not _es_vacante(nombre_operario.get(op))}

        # ¿Alguno de ellos está habilitado en alguna de esas máquinas?
        con_manual = set(skills_manuales.get(proc_id, ()))
        hay_par = any(
            (rangos_por_op.get(op, set()) & maq_rangos.get(m, set())) or op in con_manual
            for op in personas for m in usables
        )
        # Un proceso de producción sin familia no tiene candidatas: el solver no le
        # ofrece ninguna máquina. Se decide antes que todo lo demás porque no es un
        # problema de rangos —con los rangos perfectos pasaría igual— y contarlo como
        # tal mandaba a arreglar lo que no era. Tampoco se puede cortar por
        # `usables and hay_par`: había con qué y con quién, pero nada de eso llegó a
        # estar disponible, así que salía sin máquina y sin una sola línea de aviso.
        generico = not familia and _get_tipo_proceso(nombre) != "SETUP"
        if generico:
            causa = "sin_familia"
        elif usables and hay_par:
            continue  # había con qué y con quién: es cuello de capacidad, no de datos
        elif not candidatas:
            causa = "sin_maquina"
        elif not usables:
            causa = "rango_maquina"
        else:
            causa = "rango_persona"
        d = por_proceso.setdefault(proc_id, {
            "nombre": nombre, "rangos": rangos, "candidatas": candidatas,
            "usables": usables, "personas": personas, "causa": causa,
            "total_maquinas": len(maq_nombre), "ots": set(), "minutos": 0, "procesos": 0,
            "proc_id": proc_id, "crudos": set(rangos_crudos.get((orden_id, proc_id), rangos)),
        })
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    salida = []
    for proc_id, d in por_proceso.items():
        rangos_proc = [nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])]
        nombre_proc = d["nombre"]

        if d["causa"] == "sin_maquina":
            severidad = ADVERTENCIA
            detalle = (
                f"No hay ninguna máquina cargada que corresponda a **{nombre_proc}**. "
                "El trabajo se planifica igual, solo que sin reservar máquina."
            )
            soluciones = [{
                "texto": "Si este trabajo usa una máquina, cargala con los mismos rangos que el proceso. "
                         "Si va sin máquina, dejalo así: no molesta.",
                "donde": "Recursos › Maquinarias",
            }]

        elif d["causa"] == "sin_familia":
            # Típicamente trabajo de banco (PULIDO, AFILADO, ENGOMADO). El nombre del
            # proceso no dice qué máquina usa, y esa correspondencia vive en el código,
            # no en Recursos: no hay nada que Lucas pueda cargar para resolverlo. Es
            # aviso, no traba, porque lo más probable es que efectivamente vaya a mano.
            severidad = ADVERTENCIA
            detalle = (
                f"Por el nombre no se sabe en qué máquina se hace **{nombre_proc}**, así que "
                "se planifica sin reservar ninguna. El trabajo sale igual y a horario; lo único "
                "que no pasa es que quede una máquina tomada para esta OT."
            )
            soluciones = [{
                "texto": "Si va a mano, o en un banco que no se comparte, está bien así: "
                         "no hay nada que corregir.",
                "donde": "",
            }, {
                "texto": "Si en realidad se hace siempre en una máquina determinada, pedile al "
                         "equipo que la vincule: esto no se carga desde Recursos.",
                "donde": "",
            }]

        elif d["causa"] == "rango_maquina":
            severidad = BLOQUEANTE
            maqs = [maq_nombre[m] for m in d["candidatas"]]
            rangos_maq_ids = {r for m in d["candidatas"] for r in maq_rangos.get(m, set())}
            rangos_maq = sorted(nombre_rango.get(r, f"#{r}") for r in rangos_maq_ids)
            # Para que alguien tome la máquina hacen falta DOS cruces, y el solver
            # los pide juntos (_agregar_compatibilidad_op_maq):
            #   1) el rango del OPERARIO tiene que estar en la máquina;
            #   2) el rango del PROCESO tiene que estar en la máquina.
            # Ponerle el rango de la máquina al proceso arregla el (2). Si el rango
            # de la máquina no lo tiene NINGUNA persona real, el (1) sigue fallando
            # para todos y la máquina queda igual de inservible: era un consejo que
            # no cambiaba nada. Pasa de verdad — las SOLDADORAS MIG piden MEDIO
            # OFICIAL y ese rango hoy solo lo tiene un puesto VACANTE.
            gente_de_la_maquina = _personas_con_rangos(rangos_maq_ids, ops_por_rango, nombre_operario)

            # Un SETUP hereda los rangos de la producción que prepara: son los que el
            # solver usó para filtrar máquinas, pero NO los que figuran en la ficha del
            # proceso. Decir "está cargado con" mandaba a buscar en Recursos algo que
            # ahí no está — PREPARACION PLEGADORA tiene OFICIAL, y MEDIO OFICIAL y
            # OPERARIO CALIFICADO los hereda de PLEGADO.
            # La frase larga —"X solo la puede usar quien tenga A, pero P está cargado
            # con B, como no coinciden el sistema no reserva la máquina: el trabajo se
            # hace igual pero…"— es una sola oración con tres subordinadas. Lucas la
            # leyó y escribió "redacción del texto se hace confuso". Va cortada: qué
            # pide la máquina, qué pide el proceso, y recién después qué pasa por eso.
            heredados = set(d["rangos"]) != set(d["crudos"])
            pide_maq = _listar_rangos(rangos_maq) or "ningún rango"
            pide_proc = _listar_rangos(rangos_proc) or "ningún rango"
            cabecera = (
                f"Para tomar {_concuerda(maqs, 'la máquina', 'las máquinas')} "
                f"**{_listar(maqs)}** hace falta **{pide_maq}**. "
                f"Este trabajo pide **{pide_proc}**, que no está en esa lista"
            )
            # De dónde salió el rango, cuando no es el que figura en la ficha: un SETUP
            # usa los de la producción que prepara, y sin decirlo mandaba a buscar en
            # Recursos un rango que ahí no está cargado.
            trae = " — lo hereda del trabajo de producción que prepara" if heredados else ""
            # Lo de la skill va entre paréntesis y al final: no es lo que hay que
            # hacer, es lo que NO va a funcionar. Lucas lo preguntó mirando este mismo
            # aviso ("¿acá ninguno tiene una skill para hacer eso?") y la respuesta es
            # que no destraba: el solver pide DOS cruces y la skill solo cubre el de
            # la persona, el del proceso contra la máquina sigue fallando.
            cierre = (
                "El trabajo se hace igual, pero la máquina queda figurando libre y otra OT "
                "puede tomarla al mismo tiempo. (La skill a mano no lo destraba: habilita "
                "a la persona, no a la máquina.)"
            )
            if rangos_maq_ids and not gente_de_la_maquina:
                detalle = (
                    f"{cabecera}{trae}. Y **{pide_maq}** hoy no lo tiene ninguna persona: "
                    f"solo figura en un puesto a cubrir, así que "
                    f"{_concuerda(maqs, 'esa máquina', 'esas máquinas')} no "
                    f"{_concuerda(maqs, 'la', 'las')} puede tomar nadie, ni para este trabajo ni "
                    f"para ningún otro. {cierre}"
                )
            else:
                detalle = f"{cabecera}{trae}. {cierre}"
            # El orden de las opciones importa y no es cosmético. Ampliar los rangos
            # DE LA MÁQUINA la abre a todo el que tenga ese rango, y eso puede ser
            # exactamente lo que el taller NO quiere: la PLEGADORA tiene OFICIAL
            # PLEGADOR y lo tiene una sola persona, con 7 operarios explícitamente
            # deshabilitados en su proceso de preparación — está restringida a
            # propósito. Este aviso llegó a recomendar "agregale MEDIO OFICIAL y
            # OPERARIO CALIFICADO a la PLEGADORA", que la habría abierto de 1
            # persona a 10. Primero va la opción que NO cambia quién puede tocar la
            # máquina, y la otra dice a cuánta gente se la abre.
            soluciones = []
            if rangos_maq_ids and not gente_de_la_maquina:
                # Tocar el proceso acá NO alcanza (falta el cruce operario↔máquina),
                # así que ni se ofrece: sería mandar a hacer un cambio que deja todo
                # igual y hace pensar que el problema se resolvió.
                soluciones.append({
                    "texto": f"Dale **{_listar_rangos(rangos_maq)}** a quien maneja "
                             f"**{_listar(maqs)}**: es lo único que "
                             f"{_concuerda(maqs, 'la', 'las')} vuelve a poner en juego.",
                    "donde": "Recursos › Operarios",
                })
                # La otra salida —cambiarle el rango a la máquina por uno que la gente
                # sí tenga— ya la ofrece el "Al revés: …" de más abajo, que además
                # avisa a cuánta gente se la abre. No hace falta decirlo dos veces.
            elif rangos_maq:
                soluciones.append({
                    "texto": f"Ponele **{_listar_rangos(rangos_maq)}** al proceso **{nombre_proc}**: "
                             f"es el rango de la máquina, así que no cambia quién puede usarla"
                             + (f" — hoy {_concuerda(len(gente_de_la_maquina), 'lo tiene', 'lo tienen')} "
                                f"{_cuenta_personas(rangos_maq_ids, ops_por_rango, nombre_operario)}."
                                if rangos_maq_ids else "."),
                    "donde": "Recursos › Procesos",
                    "accion": _accion_proceso(d["proc_id"], nombre_proc, d["crudos"] | rangos_maq_ids),
                })
            abre_a = _cuenta_personas(d["rangos"], ops_por_rango, nombre_operario)
            soluciones.append({
                "texto": f"Al revés: agregale **{_listar_rangos(rangos_proc)}** a "
                         f"{_concuerda(maqs, 'la máquina', 'las máquinas')} "
                         f"**{_listar(maqs)}** — ojo, eso {_concuerda(maqs, 'la', 'las')} "
                         f"habilita para {abre_a}.",
                "donde": "Recursos › Maquinarias",
                "accion": _accion_maquina(d["candidatas"], maq_nombre, maq_rangos, d["rangos"]),
            })
            _como_alternativa(soluciones)

        else:  # rango_persona
            severidad = BLOQUEANTE
            maqs = [maq_nombre[m] for m in d["usables"]]
            quienes = sorted(_primer_nombre(nombre_operario.get(op, f"#{op}")) for op in d["personas"])
            rangos_maq = sorted({
                nombre_rango.get(r, f"#{r}") for m in d["usables"] for r in maq_rangos.get(m, set())
            })
            if quienes:
                detalle = (
                    f"**{_listar(quienes)}** {_concuerda(quienes, 'puede', 'pueden')} hacer "
                    f"{nombre_proc}, pero para usar **{_listar(maqs)}** hace falta "
                    f"**{_listar_rangos(rangos_maq)}** y no "
                    f"{_concuerda(quienes, 'lo tiene', 'lo tienen')}. "
                    "El trabajo se hace igual, pero la máquina no queda reservada."
                )
            else:
                detalle = (
                    f"Nadie disponible puede hacer **{nombre_proc}**, así que tampoco se reserva "
                    f"**{_listar(maqs)}**."
                )
            destino = f"**{_listar(quienes)}**" if quienes else "quien haga este trabajo"
            soluciones = [{
                "texto": _cerrar(f"Agregale **{_listar_rangos(rangos_maq)}** a {destino}"),
                "donde": "Recursos › Operarios",
            }]
            if rangos_proc:
                soluciones.append({
                    "texto": f"Agregale **{_listar_rangos(rangos_proc)}** a "
                             f"{_concuerda(maqs, 'la máquina', 'las máquinas')} **{_listar(maqs)}**.",
                    "donde": "Recursos › Maquinarias",
                    "accion": _accion_maquina(d["usables"], maq_nombre, maq_rangos, d["rangos"]),
                })
            # Acá la skill a mano SÍ destraba —el solver la toma como habilitación en la
            # máquina, ver _agregar_compatibilidad_op_maq— y es el cambio más chico de
            # los tres: no le toca el rango a nadie más. En el caso de arriba
            # (rango_maquina) no sirve y por eso ahí se dice que no alcanza.
            soluciones.append({
                "texto": "Cargale la skill a mano en la ficha de esa persona: "
                         "la habilita solo a ella, sin tocarle el rango a nadie.",
                "donde": "Recursos › Operarios",
            })
            _como_alternativa(soluciones)

        # El título viejo era el mismo para las cuatro causas —"«X» se hace sin
        # reservar la máquina"— y Lucas lo dijo derecho: "no entiendo el título". No
        # es lo mismo que no haya máquina cargada, que el trabajo vaya a mano, o que
        # la máquina exista y quede libre para que otra OT la pise. Cada causa dice
        # lo suyo, y las dos que son traba dicen la consecuencia, que es lo que él
        # necesita saber para decidir si le importa.
        titulo = {
            "sin_maquina": f"{nombre_proc}: no hay ninguna máquina cargada para este trabajo",
            "sin_familia": f"{nombre_proc}: no toma ninguna máquina",
        }.get(
            d["causa"],
            f"{nombre_proc}: la máquina queda libre y otra OT puede tomarla",
        )

        salida.append({
            "id": f"maquina-incompatible-{proc_id}",
            "tipo": "maquina_incompatible",
            "severidad": severidad,
            "titulo": titulo,
            "detalle": detalle,
            "impacto": {
                "procesos": d["procesos"],
                "ots": sorted(d["ots"]),
                "minutos": d["minutos"],
                "resumen": _resumen(d["procesos"], d["ots"], d["minutos"]),
            },
            "soluciones": soluciones,
        })
    return salida

def _procesos_sin_rango(procesos):
    """Un proceso sin rango no significa 'no lo hace nadie' sino lo contrario."""
    sin_rango = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, rangos, nombre, _um, _fam, _sk) in procesos:
        if rangos:
            continue
        d = sin_rango.setdefault(proc_id, {"nombre": _bonito(nombre) or f"#{proc_id}",
                                           "ots": set(), "minutos": 0, "procesos": 0})
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    return [{
        "id": f"sin-rango-{proc_id}",
        "tipo": "proceso_sin_rango",
        "severidad": ADVERTENCIA,
        "titulo": f"{d['nombre']}: sin rango, se lo puede llevar cualquiera",
        "detalle": "Se lo puede llevar cualquiera, sepa hacerlo o no. El plan sale igual.",
        "impacto": {
            "procesos": d["procesos"],
            "ots": sorted(d["ots"]),
            "minutos": d["minutos"],
            "resumen": _resumen(d["procesos"], d["ots"], d["minutos"]),
        },
        "soluciones": [{
            "texto": "Cargale sus rangos.",
            "donde": "Recursos › Procesos",
        }],
    } for proc_id, d in sin_rango.items()]


def _trabajo_tercerizado(procesos):
    """Trabajo de un tercero: va sin operario ni máquina A PROPÓSITO. Se avisa para
    que no se confunda con un hueco de rangos."""
    tercerizados = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, _rangos, nombre, _um, _fam, _sk) in procesos:
        if _get_tipo_proceso(nombre or "") != "ADMIN":
            continue
        d = tercerizados.setdefault(proc_id, {"nombre": _bonito(nombre) or f"#{proc_id}",
                                              "ots": set(), "minutos": 0, "procesos": 0})
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    if not tercerizados:
        return []

    ots = sorted({o for d in tercerizados.values() for o in d["ots"]})
    total = sum(d["minutos"] for d in tercerizados.values())
    cuantos = sum(d["procesos"] for d in tercerizados.values())
    _nombres_terc = sorted(d["nombre"] for d in tercerizados.values())

    return [{
        "id": "trabajo-tercerizado",
        "tipo": "trabajo_tercerizado",
        "severidad": ADVERTENCIA,
        "titulo": f"{_listar_corto(_nombres_terc)} "
                  f"{_concuerda(_nombres_terc, 'lo hace', 'los hace')} un tercero",
        "detalle": (
            f"{_listar(_nombres_terc)}: van sin operario ni máquina a propósito. "
            "Nada que corregir."
        ),
        "impacto": {
            "procesos": cuantos,
            "ots": ots,
            "minutos": total,
            "resumen": _resumen(cuantos, ots, total),
        },
        "soluciones": [{
            "texto": "Si querés que figuren a nombre de quien los gestiona, dale el rango TERCERIZADO.",
            "donde": "Recursos › Operarios",
        }],
    }]


def _trabajo_en_puestos_vacantes(resultados, nombre_operario):
    """Trabajo que el plan le carga a un puesto sin persona. Los "VACANTE" figuran
    como disponibles y el planificador los toma como gente."""
    por_op = {}
    for r in resultados:
        op = r.get("id_operario")
        if not op or r.get("excedente"):
            continue
        nombre = (nombre_operario.get(op) or "").upper()
        if not nombre.startswith("VACANTE"):
            continue
        d = por_op.setdefault(op, {"nombre": nombre_operario.get(op, f"#{op}"),
                                   "minutos": 0, "ots": set(), "procesos": 0})
        d["minutos"] += r.get("duracion_min", 0)
        d["ots"].add(r["orden_id"])
        d["procesos"] += 1

    if not por_op:
        return []

    total = sum(d["minutos"] for d in por_op.values())
    ots = sorted({o for d in por_op.values() for o in d["ots"]})
    cuantos = sum(d["procesos"] for d in por_op.values())
    _nombres_vac = sorted(d["nombre"] for d in por_op.values())

    return [{
        "id": "trabajo-en-vacantes",
        "tipo": "puestos_vacantes",
        "severidad": ADVERTENCIA,
        "titulo": f"{_listar_corto(_nombres_vac)} "
                  f"{_concuerda(_nombres_vac, 'tiene', 'tienen')} trabajo asignado",
        "detalle": (
            f"{_listar(_nombres_vac)} {_concuerda(_nombres_vac, 'no es una persona', 'no son personas')}: "
            "ese trabajo no lo va a hacer nadie."
        ),
        "impacto": {
            "procesos": cuantos,
            "ots": ots,
            "minutos": total,
            "resumen": _resumen(cuantos, ots, total),
        },
        "soluciones": [{
            "texto": "Marcalos como no disponibles y salen del plan.",
            "donde": "Recursos › Operarios",
        }],
    }]
