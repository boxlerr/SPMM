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
    _norm,
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
    """Cargarle rangos a UNA máquina. Con varias candidatas no se ofrece botón:
    aplicar el cambio a un parque entero de un click es justo lo que no se quiere."""
    if len(maquinas) != 1:
        return None
    m = maquinas[0]
    return {
        "tipo": "maquinaria",
        "id": m,
        "nombre": maq_nombre[m],
        "rangos": sorted(set(maq_rangos.get(m, set())) | set(rangos_a_sumar)),
    }


def _cuenta_personas(rangos_ids, ops_por_rango, nombre_operario):
    """"3 personas (GUILLERMO C., PABLO Z. y 1 más)" — a cuánta gente alcanza un rango.

    Sin este número, "agregale OPERARIO CALIFICADO a la máquina" suena inofensivo
    y puede estar abriendo una máquina restringida a media planta.
    """
    ops = set()
    for r in rangos_ids or ():
        ops |= ops_por_rango.get(r, set())
    ops = {o for o in ops if not _es_vacante(nombre_operario.get(o))}
    if not ops:
        return "nadie"
    nombres = sorted(_primer_nombre(nombre_operario.get(o, f"#{o}")) for o in ops)
    if len(ops) == 1:
        return f"1 persona ({nombres[0]})"
    return f"{len(ops)} personas ({_listar(nombres, 2)})"


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
            rangos_txt = _listar([nombre_rango.get(r, f"#{r}") for r in sorted(d["rangos"])], 2)
            soluciones.append({
                "texto": f"Si **{_listar([maq_nombre[m] for m in sin_habilitar], 2)}** también puede hacer este "
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
        titulo = (
            f"{nombres_hab[0]} es la única máquina para {_corto(d['minutos'])} de trabajo"
            if len(habilitadas) == 1
            else f"{_corto(d['minutos'])} de trabajo para {len(habilitadas)} máquinas"
        )
        base_txt = (
            f"**{_listar(sorted(d['procesos']), 3)}** solo se puede(n) hacer en "
            f"**{_listar(nombres_hab, 3)}**"
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
                f"{base_txt}. Entra todo, pero **por turnos**: mientras una pieza está en la máquina, "
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
        nombre = (nombre or f"#{proc_id}").strip()

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
        if usables and hay_par:
            continue  # había con qué y con quién: es cuello de capacidad, no de datos

        # Un proceso de producción sin familia tiene TODO el parque como candidato:
        # nombrar 31 máquinas y sugerir cargarles el rango a todas sería peor que
        # no decir nada. Ese caso tiene su propia causa y su propio texto.
        generico = not familia and _get_tipo_proceso(nombre) != "SETUP"
        if not candidatas:
            causa = "sin_maquina"
        elif not usables:
            causa = "rangos_sin_maquina" if generico else "rango_maquina"
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

        elif d["causa"] == "rangos_sin_maquina":
            # Típicamente un proceso manual mal clasificado (ENGOMADO, DECAPADO,
            # PEGADO DE CHAPA: rangos AYUDANTE/INGRESANTE que ninguna máquina tiene).
            # Aviso, no traba: lo más probable es que efectivamente vaya sin máquina.
            severidad = ADVERTENCIA
            detalle = (
                f"**{nombre_proc}** está cargado con **{_listar(rangos_proc, 2) or 'ningún rango'}**, "
                f"y ninguna de las {d['total_maquinas']} máquinas del taller tiene ese rango. "
                "Se planifica igual, sin reservar máquina."
            )
            soluciones = [{
                "texto": f"Si este trabajo usa una máquina en particular, agregale "
                         f"**{_listar(rangos_proc, 2)}** a esa máquina.",
                "donde": "Recursos › Maquinarias",
            }, {
                "texto": "Si va a mano y sin máquina, está bien así: no hay nada que corregir.",
                "donde": "",
            }]

        elif d["causa"] == "rango_maquina":
            severidad = BLOQUEANTE
            maqs = [maq_nombre[m] for m in d["candidatas"]]
            rangos_maq_ids = {r for m in d["candidatas"] for r in maq_rangos.get(m, set())}
            rangos_maq = sorted(nombre_rango.get(r, f"#{r}") for r in rangos_maq_ids)
            detalle = (
                f"La máquina **{_listar(maqs, 2)}** solo la puede usar quien tenga "
                f"**{_listar(rangos_maq, 2) or 'ningún rango'}**, pero **{nombre_proc}** está cargado con "
                f"**{_listar(rangos_proc, 2) or 'ningún rango'}**. Como no coinciden, el sistema no reserva la máquina: "
                "el trabajo se hace igual, pero la máquina figura libre y otra OT puede pisarla."
            )
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
            if rangos_maq:
                soluciones.append({
                    "texto": f"Ponele **{_listar(rangos_maq, 2)}** al proceso **{nombre_proc}**: "
                             f"es el rango de la máquina, así que no cambia quién puede usarla"
                             + (f" — hoy lo tiene {_cuenta_personas(rangos_maq_ids, ops_por_rango, nombre_operario)}." if rangos_maq_ids else "."),
                    "donde": "Recursos › Procesos",
                    "accion": _accion_proceso(d["proc_id"], nombre_proc, d["crudos"] | rangos_maq_ids),
                })
            abre_a = _cuenta_personas(d["rangos"], ops_por_rango, nombre_operario)
            soluciones.append({
                "texto": f"O al revés: agregale **{_listar(rangos_proc, 2)}** a la máquina "
                         f"**{_listar(maqs, 2)}** — ojo, eso la habilita para {abre_a}.",
                "donde": "Recursos › Maquinarias",
                "accion": _accion_maquina(d["candidatas"], maq_nombre, maq_rangos, d["rangos"]),
            })

        else:  # rango_persona
            severidad = BLOQUEANTE
            maqs = [maq_nombre[m] for m in d["usables"]]
            quienes = sorted(_primer_nombre(nombre_operario.get(op, f"#{op}")) for op in d["personas"])
            rangos_maq = sorted({
                nombre_rango.get(r, f"#{r}") for m in d["usables"] for r in maq_rangos.get(m, set())
            })
            if quienes:
                detalle = (
                    f"**{_listar(quienes, 2)}** puede(n) hacer **{nombre_proc}**, pero para usar "
                    f"**{_listar(maqs, 2)}** hace falta **{_listar(rangos_maq, 2)}** y no lo tienen. "
                    "El trabajo se hace igual, pero la máquina no queda reservada."
                )
            else:
                detalle = (
                    f"Nadie disponible puede hacer **{nombre_proc}**, así que tampoco se reserva "
                    f"**{_listar(maqs, 2)}**."
                )
            soluciones = [{
                "texto": f"Agregale **{_listar(rangos_maq, 2)}** a {('**' + _listar(quienes, 2) + '**') if quienes else 'quien haga este trabajo'}.",
                "donde": "Recursos › Operarios",
            }]
            if rangos_proc:
                soluciones.append({
                    "texto": f"O agregale **{_listar(rangos_proc, 2)}** a la máquina **{_listar(maqs, 2)}**.",
                    "donde": "Recursos › Maquinarias",
                    "accion": _accion_maquina(d["usables"], maq_nombre, maq_rangos, d["rangos"]),
                })

        salida.append({
            "id": f"maquina-incompatible-{proc_id}",
            "tipo": "maquina_incompatible",
            "severidad": severidad,
            "titulo": f"«{nombre_proc}» se hace sin reservar la máquina",
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
