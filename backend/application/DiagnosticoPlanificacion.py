"""Diagnóstico de lo que traba una planificación, contado para quien planifica.

El planificador siempre devolvió un resultado: lo que no podía asignar salía como
"sin asignar" o "sin máquina" y listo. El motivo quedaba en los logs del servidor,
así que desde la pantalla era imposible saber si faltaba cargar un rango, si sobraba
trabajo para una sola máquina o si el proceso directamente no lo podía hacer nadie.

Acá se arma esa explicación: qué traba, a cuánto trabajo afecta y —lo que importa—
qué hay que tocar para destrabarlo, con la pantalla y el dato concreto. Las
sugerencias se calculan contra los datos reales (quién tiene qué rango, qué máquinas
hay de esa familia), no son texto genérico.

Las sugerencias se ofrecen como opciones, no como órdenes: el sistema puede decir
"hay otras 3 fresadoras sin habilitar", pero si esas fresadoras pueden hacer ese
trabajo lo sabe el taller, no el planificador.
"""
from backend.application.PlanificacionService import (
    MIN_LABORAL_DIA,
    familia_requerida_from_proceso,
    familia_from_maquina,
)

BLOQUEANTE = "bloqueante"
ADVERTENCIA = "advertencia"


def _jornadas(minutos: int) -> str:
    """Minutos en lenguaje de taller. 'jornadas' comunica mejor que 4.320 minutos."""
    j = minutos / MIN_LABORAL_DIA
    if j < 1:
        return f"{minutos} min"
    if j < 2:
        return f"{minutos} min (poco más de una jornada)"
    return f"{minutos} min (unas {j:.0f} jornadas)"


def _listar(nombres, tope=4):
    """Enumera en castellano, cortando si son muchos."""
    nombres = list(nombres)
    if not nombres:
        return ""
    if len(nombres) > tope:
        return ", ".join(nombres[:tope]) + f" y {len(nombres) - tope} más"
    if len(nombres) == 1:
        return nombres[0]
    return ", ".join(nombres[:-1]) + " y " + nombres[-1]


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
    nombre_rango  : {id: nombre}
    nombre_operario: {id: "NOMBRE APELLIDO"}
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
    diagnosticos += _procesos_sin_rango(procesos)
    diagnosticos += _trabajo_en_puestos_vacantes(resultados, nombre_operario)

    orden = {BLOQUEANTE: 0, ADVERTENCIA: 1}
    diagnosticos.sort(key=lambda d: (orden.get(d["severidad"], 9), -d["impacto"]["minutos"]))
    return diagnosticos


def _es_vacante(nombre: str) -> bool:
    """Los puestos "VACANTE ... A CUBRIR" no son personas.

    Importa acá porque tener el rango cargado los hace pasar por candidatos válidos:
    para los tornos CNC, los únicos con OFICIAL ESPECIALIZADO y TÉCNICO son vacantes,
    así que el hueco quedaba tapado —el sistema creía que había quien los usara—.
    """
    return (nombre or "").upper().startswith("VACANTE")


def _procesos_que_nadie_puede_hacer(
    procesos, ops_por_rango, rangos_por_op, skills_manuales, nativas_off,
    maq_familia, maq_nombre, maq_rangos, nombre_rango, nombre_operario,
):
    """El caso de los tornos CNC: el proceso pide rangos que no tiene ninguna persona.

    Es el más caro de descubrir a ojo, porque el rango existe, la máquina existe y
    la gente existe: lo que no existe es el cruce.
    """
    por_proceso = {}
    for (orden_id, proc_id, _sec, _fp, _prio, dur, rangos, nombre, usa_maq, familia, _sk) in procesos:
        if not rangos:
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

        # Los puestos vacantes no cuentan como gente. Si son los únicos candidatos, el
        # proceso está igual de trabado que si no hubiera ninguno, pero se ve peor:
        # el plan sale "asignado" a alguien que no existe.
        vacantes = {op for op in elegibles if _es_vacante(nombre_operario.get(op))}
        personas = elegibles - vacantes
        if personas:
            continue

        solo_vacantes = bool(vacantes)
        pedidos = [nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])]

        # Máquinas de la familia que el proceso necesita: el arreglo tiene que
        # servirle también a la máquina, no solo al proceso.
        familia = d["familia"] or (familia_requerida_from_proceso(d["nombre"]) if d["usa_maquina"] else "")
        maquinas_familia = [m for m, f in maq_familia.items() if familia and f == familia]
        rangos_de_esas_maquinas = set()
        for m in maquinas_familia:
            rangos_de_esas_maquinas |= maq_rangos.get(m, set())

        # Rangos que la gente SÍ tiene, ordenados por cuánta gente los tiene. Sin contar
        # los vacantes: sugerir un rango que solo tienen ellos sería mover el problema.
        candidatos = sorted(
            (
                (r, len([o for o in ops if not _es_vacante(nombre_operario.get(o))]))
                for r, ops in ops_por_rango.items()
            ),
            key=lambda x: -x[1],
        )
        candidatos = [(r, n) for r, n in candidatos if n > 0]
        # Preferimos el que además ya está habilitado en la máquina: ese arreglo es
        # de un solo paso.
        directo = [(r, n) for r, n in candidatos if r in rangos_de_esas_maquinas]

        soluciones = []
        if directo:
            r, n = directo[0]
            soluciones.append({
                "texto": (
                    f"Agregá {nombre_rango.get(r, f'#{r}')} a los rangos del proceso: "
                    f"lo tienen {n} operario(s) y ya está habilitado en "
                    f"{_listar([maq_nombre[m] for m in maquinas_familia if r in maq_rangos.get(m, set())])}."
                ),
                "donde": "Recursos › Procesos",
            })
        elif candidatos and maquinas_familia:
            r, n = candidatos[0]
            soluciones.append({
                "texto": (
                    f"Agregá {nombre_rango.get(r, f'#{r}')} —lo tienen {n} operario(s)— al proceso "
                    f"Y TAMBIÉN a {_listar([maq_nombre[m] for m in maquinas_familia])}. "
                    f"Si lo cargás solo en el proceso, la máquina lo sigue rechazando."
                ),
                "donde": "Recursos › Procesos y Recursos › Rangos",
            })

        soluciones.append({
            "texto": (
                f"O asignale {_listar(pedidos)} a quien ya hace este trabajo. "
                f"Es el camino si el rango describe bien la tarea y lo que falta es reconocérselo a la persona."
            ),
            "donde": "Recursos › Operarios",
        })
        soluciones.append({
            "texto": (
                "O cargale la habilidad a mano en el perfil del operario: suma solo a esa persona, "
                "sin cambiarle el rango ni tocar lo que puede hacer el resto."
            ),
            "donde": "Recursos › Operarios › Habilidades",
        })

        if solo_vacantes:
            detalle = (
                f"El proceso lo habilita {_listar(pedidos)}. Nadie del taller tiene ese rango: "
                f"los únicos que lo tienen son puestos vacantes "
                f"({_listar(sorted(nombre_operario.get(v, f'#{v}') for v in vacantes))}), "
                f"que son registros de prueba y no personas. El plan se lo va a asignar igual, "
                f"y ese trabajo no lo va a hacer nadie."
            )
        else:
            detalle = (
                f"El proceso lo habilita {_listar(pedidos)}, y ningún operario disponible tiene "
                f"ese rango. Los procesos quedan en el plan como «sin asignar»: nadie los va a hacer."
            )

        salida.append({
            "id": f"nadie-puede-{proc_id}",
            "tipo": "proceso_sin_operarios",
            "severidad": BLOQUEANTE,
            "titulo": (
                f"«{d['nombre']}»: el único que tiene el rango es un puesto vacante"
                if solo_vacantes else f"Nadie puede hacer «{d['nombre']}»"
            ),
            "detalle": detalle,
            "impacto": {
                "procesos": d["procesos"],
                "ots": sorted(d["ots"]),
                "minutos": d["minutos"],
                "resumen": f"{d['procesos']} proceso(s) en {len(d['ots'])} OT(s) — {_jornadas(d['minutos'])}",
            },
            "soluciones": soluciones,
        })
    return salida


def _gente_sin_habilitacion_en_la_maquina(
    procesos, ops_por_rango, rangos_por_op, skills_manuales, nativas_off,
    maq_familia, maq_nombre, maq_rangos, nombre_rango, nombre_operario,
):
    """Hay quien sabe hacerlo, pero su rango no lo habilita en la máquina.

    Es el caso de los tornos CNC. El proceso lo pueden hacer Iván y Pablo —tienen la
    habilidad cargada a mano—, pero las máquinas TORNO CNC piden OFICIAL ESPECIALIZADO
    o TÉCNICO y ellos son OFICIAL y OFICIAL CNC. Como no hay par operario-máquina
    compatible, el proceso se planifica SIN máquina, y una máquina sin asignar no se
    reserva: dos OTs pueden terminar en el mismo torno a la misma hora.

    Se ve distinto de "no lo puede hacer nadie" y se arregla distinto, por eso va aparte.
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

    salida = []
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

        compatible_por_rango = any(
            rangos_por_op.get(op, set()) & maq_rangos.get(m, set())
            for op in personas for m in dominio
        )
        if compatible_por_rango:
            continue

        # Si llega hasta acá pero alguien tiene la habilidad cargada a mano, el plan
        # SÍ sale con máquina: la manual habilita también la máquina. No es un
        # bloqueo, pero tampoco está bien: el rango de la máquina sigue sin coincidir
        # con el de quienes la manejan, así que todo depende de que esa habilidad
        # manual siga cargada. Vale avisarlo, no callarlo.
        con_manual = {op for op in personas if op in set(skills_manuales.get(proc_id, ()))}

        quienes = sorted(nombre_operario.get(op, f"#{op}") for op in personas)
        rangos_gente_ids = {r for op in personas for r in rangos_por_op.get(op, set())}
        rangos_gente = sorted(nombre_rango.get(r, f"#{r}") for r in rangos_gente_ids)

        # Para sugerir, el rango MÁS ESPECÍFICO de los que tienen: el que menos gente
        # tiene. Proponer OFICIAL para un torno CNC habilitaría a los 9 oficiales;
        # OFICIAL CNC habilita exactamente a los 4 que lo manejan.
        rango_sugerido = min(
            rangos_gente_ids,
            key=lambda r: (len([o for o in ops_por_rango.get(r, set())
                                if not _es_vacante(nombre_operario.get(o))]), r),
        )
        nombre_sugerido = nombre_rango.get(rango_sugerido, f"#{rango_sugerido}")
        cuantos_sugerido = len([o for o in ops_por_rango.get(rango_sugerido, set())
                                if not _es_vacante(nombre_operario.get(o))])
        rangos_maquina = sorted({
            nombre_rango.get(r, f"#{r}") for m in dominio for r in maq_rangos.get(m, set())
        })
        nombres_maq = [maq_nombre[m] for m in sorted(dominio)]

        if con_manual:
            quienes_manual = sorted(nombre_operario.get(op, f"#{op}") for op in con_manual)
            titulo = f"«{d['nombre']}» funciona por habilidad manual, no por rango"
            detalle = (
                f"{_listar(quienes_manual)} tiene(n) este proceso cargado a mano, así que el plan "
                f"sale bien y con máquina. Pero {_listar(nombres_maq)} pide(n) {_listar(rangos_maquina)} "
                f"y ellos son {_listar(rangos_gente)}: si esa habilidad manual se borra, o si mañana "
                f"lo tiene que hacer otro, el trabajo vuelve a salir sin máquina. Conviene que el "
                f"rango diga lo que realmente pasa en el taller."
            )
        else:
            titulo = f"«{d['nombre']}» se planifica sin máquina"
            detalle = (
                f"{_listar(quienes)} puede(n) hacerlo, pero {_listar(nombres_maq)} pide(n) "
                f"{_listar(rangos_maquina)} y ellos son {_listar(rangos_gente)}. "
                f"Sin un par operario-máquina compatible el proceso sale sin máquina asignada, "
                f"y una máquina que no se asigna tampoco se reserva: dos OTs pueden quedar "
                f"en la misma a la misma hora."
            )

        salida.append({
            "id": f"sin-maquina-compatible-{proc_id}",
            "tipo": "sin_maquina_compatible",
            "severidad": ADVERTENCIA if con_manual else BLOQUEANTE,
            "titulo": titulo,
            "detalle": detalle,
            "impacto": {
                "procesos": d["procesos"],
                "ots": sorted(d["ots"]),
                "minutos": d["minutos"],
                "resumen": f"{d['procesos']} proceso(s) en {len(d['ots'])} OT(s) — {_jornadas(d['minutos'])}",
            },
            "soluciones": [{
                "texto": (
                    f"Agregá {nombre_sugerido} a {_listar(nombres_maq)}: es el rango de los "
                    f"{cuantos_sugerido} que efectivamente la(s) manejan, y es el arreglo de un solo paso. "
                    f"Es el más acotado de los que tienen, así que no le abre la máquina a todo el taller."
                ),
                "donde": "Recursos › Rangos",
            }, {
                "texto": (
                    f"O asignale {_listar(rangos_maquina)} a {_listar(quienes)}, si ese rango "
                    f"describe bien lo que hacen."
                ),
                "donde": "Recursos › Operarios",
            }],
        })
    return salida


def _cuellos_de_maquina(procesos, maq_familia, maq_nombre, maq_rangos, nombre_rango, resultados):
    """El caso de la fresadora CNC: hay una sola máquina para mucho más trabajo.

    Antes esto no se notaba porque NINGÚN proceso recibía máquina y por lo tanto no
    había competencia por ninguna. Ahora que se reserva de verdad, el trabajo que no
    entra sale sin asignar y conviene decir por qué.
    """
    # Se agrupa por el CONJUNTO de máquinas que el proceso puede usar, no por familia.
    # Agrupar por familia mezclaba peras con manzanas: "fresadora cnc" (rango OFICIAL
    # CNC) solo puede ir a la FRESADORA CNC, mientras que "fresadora f6" (rango OFICIAL)
    # puede ir a otras tres. Sumadas parecían cuatro máquinas para todo el trabajo, y en
    # realidad el cuello es que hay UNA sola para la parte CNC.
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
            continue  # ese caso lo cubre el diagnóstico de máquinas sin rango

        clave = frozenset(habilitadas)
        g = grupos.setdefault(clave, {
            "minutos": 0, "ots": set(), "rangos": set(), "procesos": set(),
            "familia": familia, "de_la_familia": set(de_la_familia),
        })
        g["minutos"] += dur
        g["ots"].add(orden_id)
        g["rangos"] |= rangos
        g["procesos"].add((nombre or "").strip())
        g["de_la_familia"] |= set(de_la_familia)

    sin_maquina_por_ot = {r["orden_id"] for r in resultados if r.get("sin_maquinaria") and not r.get("excedente")}

    salida = []
    for clave, d in grupos.items():
        habilitadas = sorted(clave)
        sin_habilitar = [m for m in sorted(d["de_la_familia"]) if m not in clave]
        familia = d["familia"]

        jornadas_por_maquina = d["minutos"] / max(1, len(habilitadas)) / MIN_LABORAL_DIA
        if jornadas_por_maquina < 3:
            continue  # entra sin drama, no hace falta avisar nada

        soluciones = []
        if sin_habilitar:
            faltantes = _listar([maq_nombre[m] for m in sin_habilitar])
            rangos_txt = _listar([nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])])
            soluciones.append({
                "texto": (
                    f"Hay {len(sin_habilitar)} máquina(s) más de la misma familia sin habilitar para este "
                    f"trabajo: {faltantes}. Si alguna puede hacerlo, cargale {rangos_txt} y el trabajo se reparte."
                ),
                "donde": "Recursos › Rangos",
            })
        soluciones.append({
            "texto": (
                "Planificá menos OTs juntas o ampliá el rango de fechas: el trabajo existe igual, "
                "lo que no alcanza es la máquina dentro del período elegido."
            ),
            "donde": "En esta misma pantalla, al elegir las OTs",
        })
        soluciones.append({
            "texto": "O sacá del lote las OTs que puedan esperar, y planificalas en la próxima tanda.",
            "donde": "En esta misma pantalla",
        })

        # Si además quedaron OTs de esta familia sin máquina en el resultado, el cuello
        # no es teórico: ya está mordiendo.
        afecta_ots = sorted(sin_maquina_por_ot & d["ots"])
        nombres_hab = [maq_nombre[m] for m in habilitadas]
        titulo = (
            f"Una sola máquina ({nombres_hab[0]}) para {_jornadas(d['minutos'])} de trabajo"
            if len(habilitadas) == 1
            else f"{len(habilitadas)} máquinas para {_jornadas(d['minutos'])} de trabajo"
        )
        salida.append({
            "id": "cuello-" + "-".join(str(m) for m in habilitadas),
            "tipo": "cuello_de_maquina",
            "severidad": BLOQUEANTE if afecta_ots else ADVERTENCIA,
            "titulo": titulo,
            "detalle": (
                f"{_listar(sorted(d['procesos']))} solo puede(n) ir a {_listar(nombres_hab)}. "
                f"A una jornada por día son unas {jornadas_por_maquina:.0f} jornadas por máquina, "
                f"así que no entra todo junto y lo que sobra queda sin máquina asignada."
            ),
            "impacto": {
                "procesos": len(d["procesos"]),
                "ots": sorted(d["ots"]),
                "minutos": d["minutos"],
                "resumen": (
                    f"{_listar(sorted(d['procesos']))} — {len(d['ots'])} OT(s), {_jornadas(d['minutos'])}"
                ),
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
        "titulo": f"«{d['nombre']}» no tiene rango cargado, así que se lo puede llevar cualquiera",
        "detalle": (
            "Sin rango, el planificador no lo restringe a nadie: puede caer en alguien que no sabe hacerlo. "
            "No se nota en el resultado, porque el plan sale igual."
        ),
        "impacto": {
            "procesos": d["procesos"],
            "ots": sorted(d["ots"]),
            "minutos": d["minutos"],
            "resumen": f"{d['procesos']} proceso(s) en {len(d['ots'])} OT(s) — {_jornadas(d['minutos'])}",
        },
        "soluciones": [{
            "texto": f"Cargale a «{d['nombre']}» los rangos que lo habilitan.",
            "donde": "Recursos › Procesos",
        }],
    } for proc_id, d in sin_rango.items()]


def _trabajo_en_puestos_vacantes(resultados, nombre_operario):
    """Trabajo que el plan le carga a un puesto que no tiene a nadie.

    Los "VACANTE ... A CUBRIR" son 12 registros de prueba (sector PRUEBAS, uno por
    rango, sin ninguna habilidad cargada). Figuran como disponibles, así que el
    planificador los toma como personas y les asigna trabajo que después nadie hace.
    Se detectan por el nombre porque es la única marca que tienen.
    """
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
    detalle = "; ".join(f"{d['nombre']}: {_jornadas(d['minutos'])}" for d in por_op.values())

    return [{
        "id": "trabajo-en-vacantes",
        "tipo": "puestos_vacantes",
        "severidad": ADVERTENCIA,
        "titulo": "Hay trabajo asignado a puestos vacantes",
        "detalle": (
            f"El plan le carga trabajo a puestos que no tienen a nadie ({detalle}). "
            "Son registros de prueba, uno por rango y sin habilidades cargadas, pero figuran como "
            "disponibles y por eso el planificador los toma como si fueran personas."
        ),
        "impacto": {
            "procesos": sum(d["procesos"] for d in por_op.values()),
            "ots": ots,
            "minutos": total,
            "resumen": f"{sum(d['procesos'] for d in por_op.values())} proceso(s) — {_jornadas(total)}",
        },
        "soluciones": [{
            "texto": (
                "Marcalos como NO disponibles y salen del plan. No conviene borrarlos: "
                "hay planificaciones viejas que los referencian."
            ),
            "donde": "Recursos › Operarios",
        }, {
            "texto": (
                "Si el puesto hace falta de verdad, el aviso te está diciendo qué rango "
                "necesitás cubrir para que ese trabajo tenga quién lo haga."
            ),
            "donde": "Recursos › Operarios",
        }],
    }]
