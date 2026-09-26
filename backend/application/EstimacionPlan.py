"""
Cuántos días hábiles lleva un conjunto de OT, SIN resolver el plan (Paso 1 del planificador).

POR QUÉ EXISTE

Lucas, 23/09/2026: tildaba OT en «Planificar órdenes» y el cartel decía «≈ 4,9 días con 12
operarios» y no se movía; después el plan real dio del 24/9 al 6/10. Julián: «se quedaba
trabada en 4,9 cuando en realidad son más, arreglalo que diga los días reales».

La cuenta vieja la hacía la pantalla: max(OT más larga, carga / 12) / jornada. Suponía que
cualquiera de los 12 hace cualquier cosa, y no es así: el 73% de la carga de ese lote sólo
la pueden hacer 6 oficiales, y Guillermo tiene ~6,9 jornadas que nadie más puede hacer
(plegadora y TIG). Con eso, la carga repartida entre 12 nunca pasaba a la OT más larga y el
número quedaba clavado.

QUÉ HACE

Usa la MISMA preparación que el solver —los mismos trabajos partidos, los mismos pares
(persona, máquina) permitidos, los mismos horarios, feriados y tramos del día— y en vez de
resolver con CP-SAT (minutos) hace dos cuentas rápidas:

  · una COTA: ni con el reparto perfecto baja de esto. Es el máximo entre la cadena más
    larga de una OT (sus pasos van en fila) y un LP que reparte la carga de cada trabajo
    entre quienes lo pueden hacer, sin pasar la jornada de cada uno ni de cada máquina;
  · una ESTIMACIÓN: un reparto de verdad, rápido y determinístico (list scheduling), que
    respeta el orden de los pasos, que una persona y una máquina hacen una cosa a la vez,
    que cada paso entra entero en un tramo del día y el horario de cada uno.

El plan del solver suele caer entre las dos (con el lote de Lucas: cota 7,0 jornadas, plan
8,3). Nada de esto escribe en la base ni toca el horizonte global del solver.
"""
import heapq
import math
import time
from bisect import bisect_right
from collections import defaultdict
from datetime import date, datetime, timedelta

from backend.commons.loggers.logger import logger


def _dias_de_trabajo(calendarios_reales: dict) -> set[int]:
    """Días de la semana en que trabaja al menos una persona del plan (0 = lunes)."""
    dias = set()
    for c in calendarios_reales.values():
        dias |= set(c.get("dias") or ())
    return dias or {0, 1, 2, 3, 4}


def _contar_dias_habiles(desde: date, hasta: date, dias_trabajo: set[int], feriados: set[str]) -> int:
    """Días de calendario entre `desde` y `hasta` (inclusive) en que alguien trabaja.

    Es la misma cuenta que hace la vista previa (frontend/src/lib/diasHabiles.ts): sin
    sábados si nadie los trabaja y sin feriados. Así el Paso 1 y la vista previa hablan
    de los mismos días.
    """
    if hasta < desde:
        return 0
    n, d = 0, desde
    while d <= hasta:
        if d.weekday() in dias_trabajo and d.strftime("%Y-%m-%d") not in feriados:
            n += 1
        d += timedelta(days=1)
    return n


class _Agenda:
    """Lo ocupado de una persona o una máquina: intervalos [ini, fin) sin solaparse."""

    __slots__ = ("inis", "fines")

    def __init__(self):
        self.inis: list[int] = []
        self.fines: list[int] = []

    def choque(self, ini: int, fin: int) -> int | None:
        """Si [ini, fin) pisa algo, devuelve cuándo se libera (el fin más tardío de lo
        que pisa); si no, None. Como los intervalos no se solapan entre sí, basta con
        mirar hacia atrás desde el último que empieza antes de `fin`."""
        i = bisect_right(self.inis, fin - 1) - 1
        libre = None
        while i >= 0 and self.fines[i] > ini:
            libre = max(libre or 0, self.fines[i])
            i -= 1
        return libre

    def ocupar(self, ini: int, fin: int):
        i = bisect_right(self.inis, ini)
        self.inis.insert(i, ini)
        self.fines.insert(i, fin)


def estimar_plan(
    procesos, operarios, maquinarias, fecha_desde=None, fecha_hasta=None,
    nativas_off=None, cant_op_map=None, preseleccion_maq=None, op_planos=None,
    ots_con_plano=None, skills_manuales=None, calendarios=None, blocked_dates=None,
    preseleccion_op=None, maquinas_por_proceso=None, inicio_base: datetime | None = None,
    *, nombres_operario: dict | None = None, numero_ot: dict | None = None,
    detalle: bool = False,
) -> dict:
    """Recibe EXACTAMENTE lo mismo que `_resolver_planificacion` y devuelve la estimación
    (ver el contrato de POST /planificacion/estimar)."""
    from ortools.linear_solver import pywraplp
    from ortools.sat.python import cp_model

    from backend.application import PlanificacionService as PS

    t0 = time.monotonic()
    feriados = set(blocked_dates or ())
    nombres_operario = nombres_operario or {}
    numero_ot = numero_ot or {}
    cant_op_map = cant_op_map or {}
    if inicio_base is None:
        inicio_base = PS.inicio_del_plan(PS._ahora_ar(), fecha_desde, list(feriados))
    start_date = inicio_base.date()

    carga_min = sum(max(0, int(p[5] or 0)) * max(1, int(cant_op_map.get((p[0], p[2]), 1) or 1))
                    for p in procesos)
    procesos_sin_tiempo = sum(1 for p in procesos if not p[5] or int(p[5]) <= 0)
    base = {
        "carga_min": int(carga_min),
        "procesos_sin_tiempo": procesos_sin_tiempo,
        "inicio": inicio_base.replace(tzinfo=None).isoformat(timespec="seconds"),
    }
    if not procesos:
        return {**base, "jornadas_minimas": 0.0, "jornadas_estimadas": 0.0,
                "dias_habiles_minimos": 0, "dias_habiles_estimados": 0, "fin_estimado": None,
                "cuellos": [], "sin_asignar_min": 0, "rango": None,
                "calculado_en_ms": int((time.monotonic() - t0) * 1000)}

    # ---- La MISMA preparación que el solver ----
    pn, _h = PS._normalizar_procesos(procesos, PS.PRIORIDAD_PESOS)
    pn, cant2, presel_maq2, presel_op2, partes = PS._partir_y_heredar(
        pn, cant_op_map, preseleccion_maq, preseleccion_op)
    # Los dominios salen de la misma función del solver, sobre un modelo descartable. Los
    # dos conjuntos de rangos que pide sólo pesan en la penalización del solver, no en
    # quién puede hacer qué (ver _resolver_planificacion).
    (_, _, _, _, _, dur_map, op_to_rango, REAL_OP, DOP, _REAL_MAQ, DMAQ, maq_to_rangos,
     maq_to_familia, op_dom, maq_dom, _, _) = PS._crear_variables_y_dominios(
        cp_model.CpModel(), pn, operarios, maquinarias, {1, 11}, {8, 14}, nativas_off, cant2,
        presel_maq2, op_planos, ots_con_plano, skills_manuales, presel_op2, maquinas_por_proceso)
    # Los acompañantes (pasos de a 2 o más) salen del MISMO conjunto que usa el solver:
    # el del principal ANTES de la persona elegida a mano (`operarios_para_acompanantes`
    # en _crear_variables_y_dominios). Con la persona elegida, el dominio del principal es
    # esa sola persona y de ahí no sale ningún acompañante. Se lo obtiene armando los
    # dominios otra vez sin la elección —no leyendo las variables del modelo: sus protos
    # quedan apuntando a memoria del modelo y al liberarse revientan (segfault)—.
    acompanantes_de = {}
    if presel_op2 and any(int(cant2.get(k, 1) or 1) > 1 for k in presel_op2):
        (_, _, _, _, _, _, _, _, _, _, _, _, _, op_dom_libre, _, _, _) = PS._crear_variables_y_dominios(
            cp_model.CpModel(), pn, operarios, maquinarias, {1, 11}, {8, 14}, nativas_off, cant2,
            presel_maq2, op_planos, ots_con_plano, skills_manuales, None, maquinas_por_proceso)
        acompanantes_de = {k: set(v) for k, v in op_dom_libre.items()}
    op_to_rangos = {}
    for o, r in operarios:
        op_to_rangos.setdefault(o, set()).add(r)
    pares = PS._pares_permitidos(pn, op_dom, maq_dom, op_to_rango, maq_to_rangos,
                                 maq_to_familia, DOP, DMAQ, op_to_rangos, skills_manuales)

    reales = set(REAL_OP)
    cal = {o: c for o, c in (calendarios or {}).items() if o in reales}
    hay_sabado = any(5 in c["dias"] for c in cal.values()) if cal else True
    dias_trabajo = _dias_de_trabajo(cal)

    def cap_dia(o) -> int:
        c = cal.get(o)
        return max(1, (c["hasta"] - c["desde"])) if c else PS.MIN_LABORAL_DIA

    # ---- Trabajos atados: partes de un mismo paso y preparación + producción ----
    # Van con la MISMA persona y la MISMA máquina (_agregar_continuidad_partes y
    # _agregar_coordinacion_maq_setup del solver).
    padre = {(p[0], p[2]): (p[0], p[2]) for p in pn}

    def raiz(k):
        while padre[k] != k:
            padre[k] = padre[padre[k]]
            k = padre[k]
        return k

    def unir(a, b):
        ra, rb = raiz(a), raiz(b)
        if ra != rb:
            padre[rb] = ra

    for info in partes.values():
        cl = [k for k in info["claves"] if k in padre]
        for k in cl[1:]:
            unir(cl[0], k)
    for cs, cp in PS._pares_setup_produccion(pn, partes):
        for k in cs + cp:
            if k in padre:
                unir(cs[0], k)

    por_clave = {(p[0], p[2]): p for p in pn}
    # Pares con gente de verdad. Si hay alguna máquina real posible, afuera los pares
    # «sin máquina» (la máquina ficticia): el solver los castiga más que cualquier atraso
    # (PENAL_DUMMY_MAQ) y sólo caen ahí si no queda otra. Si los dejáramos, el reparto
    # rápido los elegiría siempre —una máquina ficticia nunca está ocupada— y ninguna
    # máquina real haría cola.
    def _con_gente(k):
        con_op = [(o, m) for o, m in pares[k] if o != DOP]
        con_maq = [(o, m) for o, m in con_op if m != DMAQ]
        return con_maq or con_op
    reales_de = {k: _con_gente(k) for k in pares}

    # ---- COTA: cadena más larga y LP por recursos ----
    cadena = defaultdict(int)
    for p in pn:
        cadena[p[0]] += p[5]
    cadena_max = max(cadena.values()) if cadena else 0

    grupos = defaultdict(list)
    for k in por_clave:
        grupos[raiz(k)].append(k)
    trabajos = []   # (minutos × gente, operarios posibles, pares posibles)
    sin_asignar_min = 0
    # Los pares (persona, máquina) que sirven para TODO el grupo: la preparación y su
    # producción, o las partes de un paso largo, van con la misma persona y la misma
    # máquina. Sin esto el reparto elegía el par de cada paso por separado y, si el que
    # tomó la preparación no podía hacer la producción, la producción se iba con otro: la
    # preparación de TIG a una persona y las 40 h de soldadura TIG de la OT 13348 a Nahuel,
    # que el solver nunca acepta (Lucas, 25/9/2026). Ese reparto no servía de punto de
    # partida y además estimaba de menos.
    pares_grupo: dict = {}
    for g_raiz, miembros in grupos.items():
        dur = sum(dur_map[k] * max(1, int(cant2.get(k, 1) or 1)) for k in miembros)
        pr = None
        comunes = None
        for k in miembros:
            s_k = set(reales_de[k])
            pr = s_k if pr is None else (pr & s_k if (pr & s_k) else pr)
            comunes = s_k if comunes is None else comunes & s_k
        if comunes:
            pares_grupo[g_raiz] = comunes
        pr = pr or set()
        ops = {o for o, _m in pr}
        if not ops:
            sin_asignar_min += dur
            continue
        trabajos.append((dur, ops, pr, g_raiz))

    cota_lp = 0.0
    guia_lp: dict = {}    # {grupo: {(persona, máquina): minutos en el reparto ideal}}
    try:
        lp = pywraplp.Solver.CreateSolver("GLOP")
        T = lp.NumVar(0, lp.infinity(), "T")
        por_op, por_maq = defaultdict(list), defaultdict(list)
        vars_de = {}
        for i, (dur, _ops, pr, g_raiz) in enumerate(trabajos):
            vs = []
            for n, (o, m) in enumerate(sorted(pr, key=lambda x: (x[0], x[1] if x[1] is not None else -1))):
                v = lp.NumVar(0, dur, f"x{i}_{n}")
                vs.append(v)
                vars_de[(g_raiz, (o, m))] = v
                por_op[o].append(v)
                if m is not None and m != DMAQ:
                    por_maq[m].append(v)
            lp.Add(sum(vs) == dur)
        for o, vs in por_op.items():
            lp.Add(sum(vs) <= T * cap_dia(o))
        for m, vs in por_maq.items():
            lp.Add(sum(vs) <= T * PS.MIN_LABORAL_DIA)
        lp.Minimize(T)
        if lp.Solve() == pywraplp.Solver.OPTIMAL:
            cota_lp = T.solution_value()
            # El reparto ideal (fraccionado) ya balancea la carga entre quienes pueden
            # hacer cada trabajo. Se lo usa de guía para el reparto rápido: sin ella, cada
            # paso se va con el primero que queda libre y los que son únicos en algo
            # terminan con trabajo ajeno encima.
            for (g_raiz, par), v in vars_de.items():
                x = v.solution_value()
                if x > 1e-6:
                    guia_lp.setdefault(g_raiz, {})[par] = x
    except Exception as e:   # la cota es un plus: sin ella queda la cadena
        logger.warning(f"ESTIMACION: no se pudo calcular la cota por recursos: {e}")
    jornadas_minimas = max(cota_lp, cadena_max / PS.MIN_LABORAL_DIA)

    # ---- ESTIMACIÓN: reparto rápido sobre el mismo calendario del solver ----
    min_semana = 5 * PS.MIN_LABORAL_DIA + (PS.MIN_LABORAL_SABADO if hay_sabado else 0)
    total = sum(dur_map.values())
    semanas = math.ceil(total / min_semana) + 3   # tope holgado: todo en fila por una persona

    por_ot = defaultdict(list)
    for p in pn:
        por_ot[p[0]].append((p[0], p[2]))
    for lista in por_ot.values():
        lista.sort(key=lambda k: k[1])
    resto = {}
    for lista in por_ot.values():
        acum = 0
        for k in reversed(lista):
            acum += dur_map[k]
            resto[k] = acum

    # Qué trabajo sólo puede hacer UNA persona. Sirve para no gastarle las horas en cosas
    # que otro puede hacer: si Guillermo es el único que pliega, darle también un
    # agujereado que podía hacer otro es lo que después atrasa todo el plan.
    unico_de = {}
    for k in por_clave:
        ops_k = {o for o, _m in reales_de[k]}
        if len(ops_k) == 1:
            unico_de[k] = next(iter(ops_k))

    def repartir(n_semanas, regla: str, cuidar_unicos: bool, guia: str = "libre"):
        ventanas = PS.construir_ventanas_semanales(n_semanas, start_date, list(feriados),
                                                   fecha_hasta=None, incluir_sabado=hay_sabado)
        v_ini = [v.ini for v in ventanas]
        agenda = defaultdict(_Agenda)
        ocupado = defaultdict(int)
        fin_de = {}
        # Quién, con qué máquina y cuándo arranca cada paso. Además de contar días, este
        # reparto es un plan de verdad: el solver lo usa de punto de partida (ver
        # _resolver_planificacion), así no arranca de cero.
        asignado = {}
        par_del_grupo = {}
        listo = {}
        sin_lugar = [0]

        def prohibida(o, w):
            c = cal.get(o)
            return c is not None and PS._ventana_prohibida_para(c, ventanas[w])

        def primer_hueco(desde, dur, recursos, ops_con_horario):
            t = desde
            while True:
                w = max(0, bisect_right(v_ini, t) - 1)
                avanzo = False
                while w < len(ventanas):
                    v = ventanas[w]
                    if v.fin <= t or v.fin - v.ini < dur:
                        w += 1
                        continue
                    # La MISMA regla que _agregar_ventanas_horarias: el paso tiene que
                    # ARRANCAR dentro de un tramo donde entraría entero; el fin no se
                    # restringe. Exigir que termine adentro partía cada torneado en dos
                    # tardes distintas y duplicaba lo que tarda una OT.
                    ini = max(t, v.ini)
                    # Antes de un hueco (sábado sin gente) lo que arranca tiene que
                    # terminar ese día, igual que en el solver (ver `tope` en
                    # construir_ventanas_semanales).
                    limite = v.fin if v.tope is None else min(v.fin, v.tope - dur + 1)
                    if ini >= limite or any(prohibida(o, w) for o in ops_con_horario):
                        w += 1
                        continue
                    libre = None
                    for r in recursos:
                        c = agenda[r].choque(ini, ini + dur)
                        if c is not None:
                            libre = max(libre or 0, c)
                    if libre is None:
                        return ini
                    t = libre
                    avanzo = True
                    break
                if not avanzo:
                    return None   # no entra en el horizonte armado

        exclusivas_pendientes = defaultdict(int)
        for k, o in unico_de.items():
            exclusivas_pendientes[o] += dur_map[k]

        def prioridad(k):
            p = por_clave[k]
            if regla == "urgencia":          # como el solver: prioridad y fecha prometida
                return (p[4], str(p[3]), -resto[k], k[0], k[1])
            if regla == "llegada":           # el que primero está listo (reparto «en paralelo»)
                return (listo[k], -resto[k], k[0], k[1])
            return (-resto[k], p[4], str(p[3]), k[0], k[1])   # "cadena": lo que más falta primero

        cola = []
        for ot, lista in por_ot.items():
            k = lista[0]
            listo[k] = 0
            heapq.heappush(cola, (prioridad(k), k))
        while cola:
            _prio, k = heapq.heappop(cola)
            dur = dur_map[k]
            gente = max(1, int(cant2.get(k, 1) or 1))
            desde = listo[k]
            g = raiz(k)
            candidatos = reales_de[k]
            if g in pares_grupo:
                # Sólo pares que sirven para todo el grupo (ver pares_grupo). Si no queda
                # ninguno —una persona elegida a mano para uno solo de los pasos, que el
                # solver tampoco ata—, cada paso con los suyos.
                candidatos = [c for c in candidatos if tuple(c) in pares_grupo[g]] or candidatos
            if g in par_del_grupo and par_del_grupo[g] in candidatos:
                candidatos = [par_del_grupo[g]]
            elif guia != "libre" and g in guia_lp:
                sugeridos = guia_lp[g]
                if guia == "lp_fijo":
                    elegido = max(sugeridos.items(), key=lambda it: (it[1], -it[0][0]))[0]
                    filtrados = [c for c in candidatos if tuple(c) == elegido]
                else:
                    filtrados = [c for c in candidatos if tuple(c) in sugeridos]
                candidatos = filtrados or candidatos
            mejor = None
            if not candidatos:
                ini = primer_hueco(desde, dur, [], [])
                if ini is None:
                    return None
                mejor = (ini + dur, ini, None, None, [])
            else:
                # El par que lo termina antes; a igualdad, el menos cargado.
                vistos, mejor_clave = set(), None
                for o, m in candidatos:
                    maq = m if (m is not None and m != DMAQ) else None
                    if (o, maq) in vistos:
                        continue
                    vistos.add((o, maq))
                    extra = []
                    if gente > 1:
                        otros = [x for x in (acompanantes_de.get(k) or op_dom.get(k, []))
                                 if x != DOP and x != o and x in reales]
                        otros.sort(key=lambda x: (ocupado[("op", x)], x))
                        extra = otros[:gente - 1]
                    recursos = [("op", o)] + [("op", x) for x in extra] + ([("maq", maq)] if maq is not None else [])
                    # El horario que se mira es el del principal: el solver no le aplica
                    # el turno a los acompañantes.
                    ini = primer_hueco(desde, dur, recursos, [o])
                    if ini is None:
                        continue
                    # Al único que sabe algo se le cobra lo que todavía le queda de eso:
                    # sólo toma trabajo ajeno si igual termina antes que los demás.
                    cargo = (exclusivas_pendientes[o] if (cuidar_unicos and unico_de.get(k) != o) else 0)
                    clave = (ini + dur + cargo, ocupado[("op", o)], o, maq if maq is not None else -1)
                    if mejor_clave is None or clave < mejor_clave:
                        mejor_clave, mejor = clave, (ini + dur, ini, o, maq, extra)
                if mejor is None:
                    # Nadie de los que pueden tiene lugar en su horario (alguien que
                    # sale a las 15:00 y un paso que sólo entra de 12:30 a 16:00). El
                    # solver lo deja como excedente; acá se cuenta sin gente y va a
                    # «nadie del taller puede», en vez de perder la cuenta entera.
                    ini = primer_hueco(desde, dur, [], [])
                    if ini is None:
                        return None
                    mejor = (ini + dur, ini, None, None, [])
                    sin_lugar[0] += dur * gente
            fin, ini, o, maq, extra = mejor
            if o is not None:
                par_del_grupo.setdefault(g, (o, maq if maq is not None else DMAQ))
                for x in [o] + extra:
                    agenda[("op", x)].ocupar(ini, fin)
                    ocupado[("op", x)] += dur
                if maq is not None:
                    agenda[("maq", maq)].ocupar(ini, fin)
                    ocupado[("maq", maq)] += dur
            fin_de[k] = fin
            asignado[k] = (ini, o, maq, list(extra))
            if k in unico_de:
                exclusivas_pendientes[unico_de[k]] -= dur
            lista = por_ot[k[0]]
            i = lista.index(k)
            if i + 1 < len(lista):
                sig = lista[i + 1]
                listo[sig] = fin
                heapq.heappush(cola, (prioridad(sig), sig))
        return ventanas, fin_de, agenda, ocupado, sin_lugar[0], asignado

    # Varias reglas de reparto y se queda con la que termina antes. Cada una es un plan
    # posible de verdad (respeta todo lo que respeta el solver), así que quedarse con la
    # mejor no es hacer trampa: es acercarse a lo que el solver va a encontrar.
    salida, mejor_fin = None, None
    # Medido con el lote de Lucas del 23/9 (39 OT, 276 pasos): «cadena» cuidando a los
    # únicos dio 4675 min contra 4725 del solver; las demás, entre 4897 y 7840. Se dejan
    # varias porque con otro lote puede ganar otra, y cada una tarda ~25 ms. Con lotes
    # muy grandes se corren sólo las dos mejores, para que el Paso 1 no se haga lento.
    variantes = [("cadena", True, "libre"), ("cadena", False, "lp"), ("cadena", False, "libre"),
                 ("cadena", False, "lp_fijo"), ("llegada", True, "libre")]
    if len(pn) > 600:
        variantes = variantes[:2]
    for regla, cuidar, guia in variantes:
        if True:
            n = semanas
            for _intento in range(4):
                r_ = repartir(n, regla, cuidar, guia)
                if r_ is not None:
                    break
                n *= 2
            if r_ is None:
                continue
            fin_r = max(r_[1].values()) if r_[1] else 0
            if mejor_fin is None or fin_r < mejor_fin:
                salida, mejor_fin, semanas_ok = r_, fin_r, n
    if salida is None:
        raise RuntimeError("no entró en el horizonte ni duplicándolo")
    semanas = semanas_ok
    ventanas, fin_de, agenda, ocupado, sin_lugar_min, asignado = salida
    sin_asignar_min += sin_lugar_min
    fin_min = max(fin_de.values()) if fin_de else 0

    # ---- De minutos del reparto a días hábiles y a una fecha ----
    # Sobre los MISMOS días que usa el reparto: los que tienen ventanas (sin sábados si
    # nadie los trabaja, sin feriados). No se usa _convertir_minutos_a_fecha: esa le da
    # 300 minutos a todo sábado, y cada fin de semana le comía ~0,6 días a la cuenta
    # («entre 7 y 9» cuando era «entre 8 y 9», y un fin que caía en sábado).
    def dias_habiles_desde(desde: date):
        d_ = desde
        while True:
            if d_.strftime("%Y-%m-%d") not in feriados:
                if d_.weekday() < 5:
                    yield d_, PS.MIN_LABORAL_DIA
                elif d_.weekday() == 5 and hay_sabado:
                    yield d_, PS.MIN_LABORAL_SABADO
            d_ += timedelta(days=1)

    gen = dias_habiles_desde(start_date)
    dias_reparto = [(next(gen), v.ini) for v in ventanas if v.ini_dia == 0]   # ((fecha, largo), minuto de arranque)
    inis = [ini for _dl, ini in dias_reparto]

    def posicion(minuto: int) -> tuple[int, int]:
        """(índice de día hábil, minutos adentro de ese día) donde termina algo que
        termina en `minuto`. Si se pasó del cierre (el solver deja que un paso que
        arrancó en horario termine después), sigue al día hábil siguiente."""
        if minuto <= 0 or not inis:
            return 0, 0
        idx = max(0, bisect_right(inis, minuto - 1) - 1)
        resto_ = minuto - inis[idx]
        while idx < len(dias_reparto) - 1 and resto_ > dias_reparto[idx][0][1]:
            resto_ -= dias_reparto[idx][0][1]
            idx += 1
        return idx, resto_

    def hora_del_dia(fecha: date, minutos: int) -> datetime:
        """Minutos trabajados del día -> hora de reloj (07:00-09:00 · 09:15-12:00 ·
        12:30-16:00; el sábado 07:00-12:00 de corrido)."""
        base = datetime.combine(fecha, PS.HORA_APERTURA)
        if fecha.weekday() == 5:
            return base + timedelta(minutes=minutos)
        pausa = 0
        if minutos > PS.TRAMOS_LV_LAB[0][1]:
            pausa += PS.MIN_DESAYUNO
        if minutos > PS.TRAMOS_LV_LAB[1][1]:
            pausa += PS.MIN_ALMUERZO
        return base + timedelta(minutes=minutos + pausa)

    idx_fin, resto_fin = posicion(fin_min)
    if fin_min <= 0 or not dias_reparto:
        jornadas_estimadas, dias_est, fin_est = 0.0, 0, None
    else:
        (fecha_f, largo_f), _ = dias_reparto[idx_fin]
        jornadas_estimadas = idx_fin + resto_fin / largo_f
        dias_est = idx_fin + 1
        fin_est = hora_del_dia(fecha_f, resto_fin)
    jornadas_estimadas = max(jornadas_estimadas, jornadas_minimas)

    # El mínimo en días: jornadas enteras de cada día hábil hasta cubrir la cota.
    falta, dias_min = jornadas_minimas * PS.MIN_LABORAL_DIA, 0
    gen_min = dias_habiles_desde(start_date)
    while falta > 1e-6:
        _f, largo = next(gen_min)
        falta -= largo
        dias_min += 1
    if dias_est < dias_min:   # el reparto nunca termina antes que la cota
        dias_est = dias_min

    # ---- Quién marca el ritmo: el que termina último en el reparto ----
    exclusivo_op, exclusivo_maq = defaultdict(int), defaultdict(int)
    for dur, ops, pr, _g in trabajos:
        if len(ops) == 1:
            exclusivo_op[next(iter(ops))] += dur
        maqs = {m for _o, m in pr if m is not None and m != DMAQ}
        if len(maqs) == 1 and all(m is not None and m != DMAQ for _o, m in pr):
            exclusivo_maq[next(iter(maqs))] += dur
    nombre_maq = {m[0]: m[2] for m in maquinarias}
    recursos = []
    for (tipo, rid), ag in agenda.items():
        if not ag.fines:
            continue
        cap = cap_dia(rid) if tipo == "op" else PS.MIN_LABORAL_DIA
        excl = exclusivo_op.get(rid, 0) if tipo == "op" else exclusivo_maq.get(rid, 0)
        recursos.append({
            "tipo": "persona" if tipo == "op" else "maquina",
            "nombre": (nombres_operario.get(rid) if tipo == "op" else nombre_maq.get(rid)) or f"#{rid}",
            "jornadas": round(ocupado[(tipo, rid)] / cap, 2),
            "exclusivas": round(excl / cap, 2),
            "_termina": max(ag.fines),
        })
    # El que marca el ritmo: el que tiene más trabajo que SÓLO él puede hacer (eso no se
    # reparte con nadie), y después el más cargado. Ordenar por quién termina último
    # ponía primero a un pasante que embala al final de todo: termina último porque
    # espera, no porque frene.
    recursos.sort(key=lambda r: (-r["exclusivas"], -r["jornadas"]))
    todos_los_recursos = [dict(r) for r in recursos]
    pesados = [r for r in recursos if r["jornadas"] >= 0.5 * jornadas_minimas] or recursos
    cuellos = [{k: v for k, v in r.items() if k != "_termina"} for r in pesados[:3]]

    # ---- ¿Qué entra en el rango elegido? ----
    # Con otro reparto: el que termina todo antes entremezcla las OT, y a mitad de camino
    # puede no haber ninguna terminada. Para «qué entra hasta el viernes» se reparte como
    # el solver cuando hay fecha tope: primero lo más urgente (prioridad y fecha
    # prometida), terminando OT enteras. Se informan las OT completas y además el
    # trabajo que entra, porque el solver también deja OT a medias adentro del rango.
    rango = None
    if fecha_hasta is not None:
        v_rango = PS.construir_ventanas_semanales(semanas, start_date, list(feriados),
                                                  fecha_hasta=fecha_hasta, incluir_sabado=hay_sabado)
        limite = max((v.fin for v in v_rango), default=0)
        # Si el rango termina antes del arranque real del plan (se eligió «hoy» con la
        # jornada ya empezada), no hay ningún día: construir_ventanas_semanales arma igual
        # un día (el del arranque) y se decía «entran 3 OT» con 0 días hábiles.
        if fecha_hasta < start_date:
            limite = 0
        r_urg = repartir(semanas, "urgencia", True, "libre") or salida
        fin_de_r = r_urg[1]
        fin_ot = defaultdict(int)
        for k, f in fin_de_r.items():
            fin_ot[k[0]] = max(fin_ot[k[0]], f)
        entran = [ot for ot in fin_ot if fin_ot[ot] <= limite]
        no_entran = sorted((ot for ot in fin_ot if fin_ot[ot] > limite), key=lambda ot: fin_ot[ot])
        carga_entra = sum(dur_map[k] * max(1, int(cant2.get(k, 1) or 1))
                          for k, f in fin_de_r.items() if f <= limite)
        rango = {
            "hasta": fecha_hasta.isoformat() if hasattr(fecha_hasta, "isoformat") else str(fecha_hasta),
            "dias_habiles": _contar_dias_habiles(start_date, fecha_hasta, dias_trabajo, feriados),
            "ots_total": len(fin_ot),
            "ots_entran": len(entran),
            "carga_entra_min": int(carga_entra),
            "no_entran": [int(numero_ot.get(ot, ot)) for ot in no_entran],
            # Desde cuándo puede arrancar el plan de verdad (para decir «el rango no tiene
            # días hábiles: el plan arranca el lun 28/9»).
            "arranca": start_date.isoformat(),
        }

    resultado = {
        **base,
        "jornadas_minimas": round(jornadas_minimas, 2),
        "jornadas_estimadas": round(jornadas_estimadas, 2),
        "dias_habiles_minimos": dias_min,
        "dias_habiles_estimados": dias_est,
        "fin_estimado": fin_est.isoformat(timespec="seconds") if fin_est else None,
        "cuellos": cuellos,
        "sin_asignar_min": int(sin_asignar_min),
        "rango": rango,
        "calculado_en_ms": int((time.monotonic() - t0) * 1000),
    }
    if detalle:   # para los tests y para mirar un caso raro; la API no lo pide
        resultado["_recursos"] = todos_los_recursos
        resultado["_fin_min"] = fin_min
        resultado["_fin_de"] = dict(fin_de)
        resultado["_asignacion"] = dict(asignado)
    logger.info(
        f"ESTIMACION: {len(por_ot)} OT, {len(pn)} tramos, carga {carga_min} min -> "
        f"cota {resultado['jornadas_minimas']} / reparto {resultado['jornadas_estimadas']} jornadas, "
        f"{resultado['dias_habiles_minimos']}-{resultado['dias_habiles_estimados']} días hábiles, "
        f"{resultado['calculado_en_ms']} ms")
    return resultado
