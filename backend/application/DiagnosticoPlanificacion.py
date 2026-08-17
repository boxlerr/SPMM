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
"""
from backend.application.PlanificacionService import (
    MIN_LABORAL_DIA,
    familia_requerida_from_proceso,
    familia_from_maquina,
    _get_tipo_proceso,
)

BLOQUEANTE = "bloqueante"
ADVERTENCIA = "advertencia"


def _corto(minutos: int) -> str:
    """Tiempo en lenguaje de taller, lo más corto posible."""
    if minutos < 60:
        return f"{minutos} min"
    if minutos < MIN_LABORAL_DIA:
        h, m = divmod(minutos, 60)
        return f"{h}h {m:02d}m" if m else f"{h}h"
    j = minutos / MIN_LABORAL_DIA
    return f"{j:.0f} jornada{'s' if j >= 1.5 else ''}"


def _listar(nombres, tope=3):
    nombres = list(nombres)
    if not nombres:
        return ""
    if len(nombres) > tope:
        return ", ".join(nombres[:tope]) + f" y {len(nombres) - tope} más"
    if len(nombres) == 1:
        return nombres[0]
    return ", ".join(nombres[:-1]) + " y " + nombres[-1]


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
):
    """
    procesos      : tuplas que se le pasan al solver
    operarios     : [(id_operario, id_rango)] — solo los disponibles
    maquinarias   : [(id, {rangos}, nombre, cod_maquina)]
    resultados    : lista de dicts que devolvió el solver
    """
    skills_manuales = skills_manuales or {}
    nativas_off = nativas_off or {}

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
    diagnosticos += _gente_sin_habilitacion_en_la_maquina(
        procesos, ops_por_rango, rangos_por_op, skills_manuales, nativas_off,
        maq_familia, maq_nombre, maq_rangos, nombre_rango, nombre_operario,
    )
    diagnosticos += _cuellos_de_maquina(
        procesos, maq_familia, maq_nombre, maq_rangos, nombre_rango, resultados,
    )
    diagnosticos += _procesos_sin_maquina_compatible(
        procesos, maq_familia, maq_nombre, maq_rangos, nombre_rango, resultados,
    )
    diagnosticos += _procesos_sin_rango(procesos)
    diagnosticos += _trabajo_tercerizado(procesos)
    diagnosticos += _trabajo_en_puestos_vacantes(resultados, nombre_operario)

    orden = {BLOQUEANTE: 0, ADVERTENCIA: 1}
    diagnosticos.sort(key=lambda d: (orden.get(d["severidad"], 9), -d["impacto"]["minutos"]))
    return diagnosticos


def _es_vacante(nombre: str) -> bool:
    """Los puestos "VACANTE ... A CUBRIR" no son personas. Tener el rango cargado
    los hacía pasar por candidatos válidos y tapaban el hueco real."""
    return (nombre or "").upper().startswith("VACANTE")


def _primer_nombre(completo: str) -> str:
    """'IVAN BALMACEDA' -> 'IVAN B.' — alcanza para reconocerlo y ocupa la mitad."""
    partes = (completo or "").split()
    if len(partes) < 2:
        return completo or ""
    return f"{partes[0]} {partes[1][0]}."


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
            "nombre": (nombre or f"#{proc_id}").strip(),
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
        elegibles -= set(nativas_off.get(proc_id, set()))

        vacantes = {op for op in elegibles if _es_vacante(nombre_operario.get(op))}
        personas = elegibles - vacantes
        if personas:
            continue

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
        if directo:
            r, n = directo[0]
            soluciones.append({
                "texto": f"Sumale {nombre_rango.get(r, f'#{r}')} al proceso: lo tienen {n} y ya está en la máquina.",
                "donde": "Recursos › Procesos",
            })
        elif candidatos and maquinas_familia:
            r, n = candidatos[0]
            soluciones.append({
                "texto": f"Sumale {nombre_rango.get(r, f'#{r}')} al proceso y también a {_listar([maq_nombre[m] for m in maquinas_familia], 2)}.",
                "donde": "Recursos › Procesos y Rangos",
            })
        soluciones.append({
            "texto": f"O dale {_listar(pedidos, 2)} a quien hace este trabajo.",
            "donde": "Recursos › Operarios",
        })
        soluciones.append({
            "texto": "O cargale la skill en su ficha (habilita solo a esa persona).",
            "donde": "Recursos › Operarios",
        })

        salida.append({
            "id": f"nadie-puede-{proc_id}",
            "tipo": "proceso_sin_operarios",
            "severidad": BLOQUEANTE,
            "titulo": f"Nadie puede hacer «{d['nombre']}»",
            "detalle": (
                f"Pide {_listar(pedidos, 2)} y "
                + ("solo lo tiene un puesto vacante, que no es una persona. "
                   if vacantes else "ningún operario disponible lo tiene. ")
                + "Va a salir «sin asignar»."
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


def _gente_sin_habilitacion_en_la_maquina(
    procesos, ops_por_rango, rangos_por_op, skills_manuales, nativas_off,
    maq_familia, maq_nombre, maq_rangos, nombre_rango, nombre_operario,
):
    """Hay quien sabe hacer el proceso, pero su rango no lo habilita en la máquina.

    Se agrupa por (máquinas, personas): «torno cnc» y «programacion torno cnc»
    comparten los tres tornos y la misma gente, y salían como dos tarjetas casi
    idénticas — Lucas lo marcó: "estaría ver bien en conjunto eso". El problema es
    UNO (el rango de esas máquinas no coincide con el de quienes las manejan); los
    procesos afectados son el detalle, no un aviso cada uno.
    """
    por_proceso = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, rangos, nombre, usa_maq, familia, _sk) in procesos:
        if not usa_maq or not familia:
            continue
        d = por_proceso.setdefault(proc_id, {
            "nombre": (nombre or f"#{proc_id}").strip(), "rangos": set(rangos or ()),
            "ots": set(), "minutos": 0, "procesos": 0, "familia": familia,
        })
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    grupos = {}
    for proc_id, d in por_proceso.items():
        elegibles = set()
        for r in d["rangos"]:
            elegibles |= ops_por_rango.get(r, set())
        elegibles |= set(skills_manuales.get(proc_id, set()))
        elegibles -= set(nativas_off.get(proc_id, set()))
        personas = {op for op in elegibles if not _es_vacante(nombre_operario.get(op))}
        if not personas:
            continue  # eso ya lo cuenta el otro diagnóstico

        dominio = [
            m for m, f in maq_familia.items()
            if f == d["familia"] and (not d["rangos"] or (d["rangos"] & maq_rangos.get(m, set())))
        ]
        if not dominio:
            continue

        if any(rangos_por_op.get(op, set()) & maq_rangos.get(m, set())
               for op in personas for m in dominio):
            continue  # hay al menos un par operario-máquina válido: no hay aviso

        # Con habilidad manual el plan sale bien y CON máquina: las skills están
        # justamente para habilitar cosas puntuales por persona, además del rango.
        # Acá hubo un aviso ("funciona por habilidad manual, no por rango") y se
        # SACÓ a pedido de Julián: si el mecanismo pensado para eso está funcionando,
        # no es un problema para reportar — era ruido.
        if any(op in set(skills_manuales.get(proc_id, ())) for op in personas):
            continue

        clave = (frozenset(dominio), frozenset(personas))
        g = grupos.setdefault(clave, {
            "procesos_nombres": [], "ots": set(), "minutos": 0, "cuantos": 0,
            "personas": personas, "dominio": sorted(dominio),
        })
        g["procesos_nombres"].append(d["nombre"])
        g["ots"] |= d["ots"]
        g["minutos"] += d["minutos"]
        g["cuantos"] += d["procesos"]

    salida = []
    for (_dom, _pers), g in grupos.items():
        personas, dominio = g["personas"], g["dominio"]
        nombres_maq = [maq_nombre[m] for m in dominio]
        quienes = sorted(_primer_nombre(nombre_operario.get(op, f"#{op}")) for op in personas)

        rangos_gente_ids = {r for op in personas for r in rangos_por_op.get(op, set())}
        rangos_maquina = sorted({
            nombre_rango.get(r, f"#{r}") for m in dominio for r in maq_rangos.get(m, set())
        })
        # El rango MÁS ACOTADO de los que tiene la gente: proponer OFICIAL para un
        # torno CNC habilitaría a los 9 oficiales; OFICIAL CNC, solo a quienes lo manejan.
        rango_sugerido = min(
            rangos_gente_ids,
            key=lambda r: (len([o for o in ops_por_rango.get(r, set())
                                if not _es_vacante(nombre_operario.get(o))]), r),
        )
        nombre_sugerido = nombre_rango.get(rango_sugerido, f"#{rango_sugerido}")

        procesos_txt = _listar([f"«{p}»" for p in sorted(g["procesos_nombres"])], 2)
        maqs_txt = _listar(nombres_maq, 3)

        salida.append({
            # Las personas van en el id: dos grupos pueden compartir máquinas con
            # gente distinta, y un id repetido rompe el desplegado en el front.
            "id": ("maquina-rango-" + "-".join(str(m) for m in dominio)
                   + "-p" + "-".join(str(p) for p in sorted(personas)[:4])),
            "tipo": "sin_maquina_compatible",
            "severidad": BLOQUEANTE,
            "titulo": f"{procesos_txt} sale sin máquina",
            "detalle": (
                f"{_listar(quienes, 2)} pueden hacerlo, pero {maqs_txt} pide(n) "
                f"{_listar(rangos_maquina, 2)}. Sin máquina asignada, la máquina no se reserva."
            ),
            "impacto": {
                "procesos": g["cuantos"],
                "ots": sorted(g["ots"]),
                "minutos": g["minutos"],
                "resumen": _resumen(g["cuantos"], g["ots"], g["minutos"]),
            },
            "soluciones": [{
                "texto": f"Sumá {nombre_sugerido} a {maqs_txt}: es el rango de quienes las manejan.",
                "donde": "Recursos › Maquinarias",
            }, {
                "texto": f"O dales {_listar(rangos_maquina, 2)} a {_listar(quienes, 2)}.",
                "donde": "Recursos › Operarios",
            }],
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
        g["procesos"].add((nombre or "").strip())
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
            rangos_txt = _listar([nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])], 2)
            soluciones.append({
                "texto": f"Habilitá {_listar([maq_nombre[m] for m in sin_habilitar], 2)} (cargale {rangos_txt}) y el trabajo se reparte.",
                "donde": "Recursos › Maquinarias",
            })
        soluciones.append({
            "texto": "O planificá menos OTs juntas, o ampliá el rango de fechas.",
            "donde": "Al elegir las OTs",
        })

        # Solo es traba si a este grupo se le quedó trabajo sin máquina o afuera.
        pares_mordidos = [
            p for p in d["pares"]
            if p not in pares_con_maquina and p not in pares_excedentes
        ]
        pares_sin_lugar = [p for p in d["pares"] if p in pares_excedentes]
        afecta_ots = sorted({o for o, _ in pares_mordidos} | {o for o, _ in pares_sin_lugar})
        titulo = (
            f"{nombres_hab[0]} es la única para {_corto(d['minutos'])} de trabajo"
            if len(habilitadas) == 1
            else f"{_corto(d['minutos'])} de trabajo entre {len(habilitadas)} máquinas"
        )
        base_txt = f"{_listar(sorted(d['procesos']), 3)} solo puede(n) ir a {_listar(nombres_hab, 3)}"
        if afecta_ots:
            partes = []
            if pares_mordidos:
                n = len(pares_mordidos)
                partes.append(f"{n} proceso{'s' if n != 1 else ''} sin máquina reservada")
            if pares_sin_lugar:
                n = len(pares_sin_lugar)
                partes.append(f"{n} afuera del período")
            detalle = f"{base_txt}, y no alcanzó: {' y '.join(partes)}."
        else:
            detalle = f"{base_txt}. Entró todo, pero en fila: por eso las fechas se corren hacia adelante."
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
):
    """El proceso pide máquina pero su rango no coincide con NINGUNA de la familia.

    Era el hueco mudo del diagnóstico: «PLEGADO» trae MEDIO OFICIAL y OPERARIO
    CALIFICADO, la PLEGADORA pide OFICIAL PLEGADOR → el solver se queda sin
    máquina válida, asigna la dummy y el proceso aparece "Sin asignar" en la
    columna de maquinaria sin que nadie diga por qué. (El diagnóstico de
    operarios lo salteaba porque su dominio de máquinas quedaba vacío, y el de
    cuellos también — Julián lo preguntó el 15/08 mirando la vista previa.)

    Solo se reporta si el proceso efectivamente salió sin máquina en el
    resultado: los SETUP tienen un fallback por nombre que a veces la consigue
    igual, y avisar por algo que salió bien es ruido.
    """
    pares_con_maquina = {
        (r["orden_id"], r["secuencia"]) for r in resultados if r.get("id_maquinaria")
    }

    por_proceso = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, rangos, nombre, usa_maq, familia, _sk) in procesos:
        if not usa_maq or not familia:
            continue
        rangos = set(rangos or ())
        de_la_familia = [m for m, f in maq_familia.items() if f == familia]
        if de_la_familia and (not rangos or any(rangos & maq_rangos.get(m, set()) for m in de_la_familia)):
            continue  # hay al menos una máquina válida: esto lo cubren los otros diagnósticos
        if (orden_id, _sec) in pares_con_maquina:
            continue  # la consiguió igual (fallback de SETUP): nada que avisar
        d = por_proceso.setdefault(proc_id, {
            "nombre": (nombre or f"#{proc_id}").strip(), "rangos": rangos,
            "familia": familia, "maquinas": de_la_familia,
            "ots": set(), "minutos": 0, "procesos": 0,
        })
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    salida = []
    for proc_id, d in por_proceso.items():
        rangos_proc = [nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])]
        if not d["maquinas"]:
            familia_txt = d["familia"].replace("_", " ").title()
            detalle = f"No hay ninguna máquina de tipo {familia_txt} cargada, así que sale sin máquina."
            soluciones = [{
                "texto": "Cargá la máquina con su rango. Si este trabajo va sin máquina, no hay nada que hacer.",
                "donde": "Recursos › Maquinarias",
            }]
        else:
            maqs = [maq_nombre[m] for m in d["maquinas"]]
            rangos_maq = sorted({
                nombre_rango.get(r, f"#{r}") for m in d["maquinas"] for r in maq_rangos.get(m, set())
            })
            detalle = (
                f"{_listar(maqs, 2)} pide(n) {_listar(rangos_maq, 2) or 'ningún rango'} y el proceso "
                f"trae {_listar(rangos_proc, 2) or 'ninguno'}. No coinciden, así que la máquina no se reserva."
            )
            soluciones = [{
                "texto": f"Sumale {_listar(rangos_proc, 2)} a {_listar(maqs, 2)}.",
                "donde": "Recursos › Maquinarias",
            }]
            if rangos_maq:
                soluciones.append({
                    "texto": f"O sumale {_listar(rangos_maq, 2)} al proceso.",
                    "donde": "Recursos › Procesos",
                })
        salida.append({
            "id": f"maquina-incompatible-{proc_id}",
            "tipo": "maquina_incompatible",
            "severidad": BLOQUEANTE,
            "titulo": f"«{d['nombre']}» sale sin máquina",
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
        d = sin_rango.setdefault(proc_id, {"nombre": (nombre or f"#{proc_id}").strip(),
                                           "ots": set(), "minutos": 0, "procesos": 0})
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    return [{
        "id": f"sin-rango-{proc_id}",
        "tipo": "proceso_sin_rango",
        "severidad": ADVERTENCIA,
        "titulo": f"«{d['nombre']}» no tiene rango",
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
        d = tercerizados.setdefault(proc_id, {"nombre": (nombre or f"#{proc_id}").strip(),
                                              "ots": set(), "minutos": 0, "procesos": 0})
        d["ots"].add(orden_id)
        d["minutos"] += dur
        d["procesos"] += 1

    if not tercerizados:
        return []

    ots = sorted({o for d in tercerizados.values() for o in d["ots"]})
    total = sum(d["minutos"] for d in tercerizados.values())
    cuantos = sum(d["procesos"] for d in tercerizados.values())

    return [{
        "id": "trabajo-tercerizado",
        "tipo": "trabajo_tercerizado",
        "severidad": ADVERTENCIA,
        "titulo": f"{cuantos} proceso{'s' if cuantos != 1 else ''} del plan son tercerizados",
        "detalle": (
            f"{_listar(sorted(d['nombre'] for d in tercerizados.values()), 3)}. "
            "Van sin operario ni máquina a propósito: los hace un tercero. Nada que corregir."
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

    return [{
        "id": "trabajo-en-vacantes",
        "tipo": "puestos_vacantes",
        "severidad": ADVERTENCIA,
        "titulo": "Hay trabajo asignado a puestos vacantes",
        "detalle": (
            f"{_listar(sorted(d['nombre'] for d in por_op.values()), 2)} no son personas: "
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
