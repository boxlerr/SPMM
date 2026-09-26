# backend/application/PlanificacionService.py
import asyncio
import os
from ortools.sat.python import cp_model
from datetime import datetime, time, date, timezone

from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.infrastructure.PlanificacionRepository import PlanificacionRepository
from backend.infrastructure.ConfigRepository import ConfigRepository
from backend.infrastructure.OperarioProcesoSkillRepository import OperarioProcesoSkillRepository
from backend.infrastructure.PlanoRepository import PlanoRepository
from backend.infrastructure.RangoRepository import RangoRepository
from backend.infrastructure.DiaBloqueadoRepository import DiaBloqueadoRepository
from backend.infrastructure.PausaRepository import PausaRepository
from datetime import timedelta

from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.PlanificacionException import PlanificacionException

from backend.commons.loggers.logger import logger

from sqlalchemy import text

import math

import re
import unicodedata
from collections import namedtuple

##Variables:
# Jornada real del taller: 07:00 a 16:00 con 15' de desayuno y 30' de almuerzo, o sea
# 495 minutos de trabajo efectivo. Antes acá decía 555, que no es ni la jornada neta ni
# la bruta (07:00–16:00 son 540 de reloj): el modelo se creía casi una hora más de
# trabajo por día del que hay. Como _convertir_minutos_a_fecha le suma encima los
# minutos muertos, un día completo terminaba dando las 18:00 y las fechas prometidas
# salían sistemáticamente optimistas.
MIN_DESAYUNO = 15
MIN_ALMUERZO = 30

# (inicio, fin) en minutos trabajados del día. Los cortes son las pausas:
#   07:00–09:00 (120) · desayuno · 09:15–12:00 (165) · almuerzo · 12:30–16:00 (210)
TRAMOS_LV_LAB = [
    (0, 120),
    (120, 285),
    (285, 495),
]

# Sábado: 07:00 a 12:00 de corrido.
TRAMOS_SAB_LAB = [
    (0, 300),
]

MIN_LABORAL_DIA = TRAMOS_LV_LAB[-1][1]          # 495
MIN_LABORAL_SABADO = TRAMOS_SAB_LAB[-1][1]      # 300
MIN_LABORAL_SEMANA = 5 * MIN_LABORAL_DIA + MIN_LABORAL_SABADO

# Horizonte del modelo. Lo fija `_resolver_planificacion` (global H) antes de armar las
# variables; este valor sólo existe para que armar los dominios SIN resolver —la
# estimación de días del Paso 1, ver EstimacionPlan.py— no dependa de que alguna vez se
# haya corrido el solver. La estimación nunca lo escribe: pisarlo mientras otra
# planificación arma su modelo en otro hilo le achicaría el horizonte.
H = MIN_LABORAL_DIA

# Peso de cada prioridad para el solver (1 = la más urgente). Compartido con la
# estimación de días, que ordena el trabajo igual.
PRIORIDAD_PESOS = {"urgente": 1, "urgente 1": 1, "urgente 2": 2, "normal": 3, "baja": 4}

# ---- LA JERARQUÍA DEL OBJETIVO ----
# De lo peor a lo menos malo. Cada escalón tiene que costar más que cualquier cantidad
# razonable del de abajo; si alguna vez se tocan los pesos, mantener este orden
# (test_planificador_dias.py lo controla):
#
#   1. dejar un paso AFUERA del plan (excedente) ......... W_FUERA × PESO_EXCED_POR_PRIO
#   2. dejar un paso SIN PERSONA o SIN MÁQUINA ............ penal_sin_recurso(H)
#   3. ATRASO contra la fecha prometida, por minuto:
#        - de cada paso ................................... ATRASO_MULT_POR_PRIORIDAD
#        - de la OT MÁS atrasada .......................... ATRASO_MAX_EQUIV × el suyo
#   4. cada minuto que el plan o una OT terminan más tarde,
#      aunque no sea atraso .............................. W_FIN_PLAN, W_FIN_OT
#
# El escalón 4 no existía (sólo 1 punto por minuto de arranque de cada paso): si nada
# estaba atrasado, nada empujaba a terminar antes (Lucas, 25/9/2026).
ATRASO_MULT_POR_PRIORIDAD = {1: 1000, 2: 800, 3: 500, 4: 300, 5: 200}
# Pesos de prioridad para excedentes (más agresivo: prio 1 vale 100x prio 5)
PESO_EXCED_POR_PRIO = {1: 10000, 2: 5000, 3: 1000, 4: 300, 5: 100}
W_FUERA = 100_000_000
# EL ATRASO DE LA OT MÁS ATRASADA. Con las OT ya vencidas —el caso de todos los días—,
# la suma de los atrasos de cada paso da casi lo mismo para un plan parejo que termina
# todo en 10 días que para uno que termina 47 OT en 9 y deja la última colgada hasta el
# día 15: pasarle a Guillermo trabajo que otro podía hacer adelanta varias OT chicas y
# atrasa una sola, la de la TIG de 40 h. Medido con las 48 OT del piloto (25/9/2026):
# los planes de 10 y de 15 días diferían menos de un 3% en esa suma, así que el solver
# caía en uno u otro según la corrida. Contar además el atraso de la OT más atrasada,
# como si fueran ATRASO_MAX_EQUIV pasos, es lo que hace preferir el plan parejo: el que
# no deja a nadie esperando. Pesa según la prioridad de esa OT, como el resto del atraso.
ATRASO_MAX_EQUIV = 30
# Por minuto. El fin del plan pesa más que el de cada OT porque es el que empareja la
# carga (lo marca el más cargado); los dos quedan debajo del atraso más barato (200).
W_FIN_PLAN = 100
W_FIN_OT = 20
# Sembrar el reparto rápido como punto de partida del solver (ver _sembrar_reparto).
SEMBRAR_REPARTO = True


def penal_sin_recurso(H: int) -> int:
    """Lo que cuesta dejar un paso sin persona o sin máquina, con horizonte H.

    Tiene que ser más caro que el PEOR atraso posible de ese paso (el atraso no pasa de
    H minutos) más lo que se ganaría terminando antes: si no, cuando el plan se aprieta
    al solver le conviene soltar a la persona o la máquina —que nunca están ocupadas— y
    correr todo en paralelo. Pasaba con la máquina (planificador-dummy-maquina, 18/8) y
    seguía pasando con la persona: el «sin persona» costaba un millón fijo, lo mismo que
    atrasar un paso cuatro jornadas, y el plan «cerraba» dejando horas sin nadie.
    Escalado con el horizonte, ningún atraso lo alcanza: ni el de los pasos (con margen
    ×10 por los que vienen detrás), ni el de la OT más atrasada, ni terminar antes. Y
    queda por debajo de dejarlo afuera: un paso que nadie del taller puede hacer tiene
    que figurar en el plan (sin persona, para que se vea) y no llevarse puesta el resto
    de la OT.
    """
    peor = max(ATRASO_MULT_POR_PRIORIDAD.values())
    por_minuto = 10 * peor + ATRASO_MAX_EQUIV * peor + W_FIN_PLAN + W_FIN_OT
    return max(1_000_000, H * por_minuto + 1)


HORA_APERTURA = time(7, 0)

# Hora local de Argentina, sin zona, como TODAS las fechas de esta base.
#
# NO ES COSMÉTICO ACÁ. Cloud Run corre en UTC y el Dockerfile no fija TZ, así que
# `datetime.now()` pelado devuelve tres horas de más: a las 16:27 de Argentina el
# servidor cree que son las 19:27. Con eso se decide desde cuándo arranca el plan, y
# tres horas corren la decisión un día entero — planificar a las 5 de la mañana, antes
# de que el taller abra, daba «la jornada ya empezó, es para mañana» y se perdía el día.
#
# Mismo helper que AuditoriaRepository, PlanificacionRepository y OrdenTrabajoRepository.
_TZ_AR = timezone(timedelta(hours=-3))


def _ahora_ar() -> datetime:
    return datetime.now(_TZ_AR).replace(tzinfo=None)

# Una ventana del horizonte. `ini`/`fin` son minutos del timeline comprimido; el resto
# ubica la ventana en el calendario para poder cruzarla con el horario de cada persona.
#
# `fecha` es el día de calendario de la ventana: con eso la fecha prometida de una OT se
# traduce a minutos del plan (ver minuto_de_entrega). `tope`, si viene, es el minuto en
# que tiene que haber TERMINADO lo que arranque en esta ventana: el cierre del último día
# antes de un hueco (un sábado sin gente) o del último día del rango pedido. Ver
# construir_ventanas_semanales. Los dos tienen default para que armar una ventana a
# mano (tests, estimación) siga funcionando con los cinco campos de siempre.
Ventana = namedtuple("Ventana", "ini fin weekday ini_dia fin_dia fecha tope",
                     defaults=(None, None))

# Nombres de día como los guarda operario.dias_trabajo ("MON,TUE,...").
_DIAS = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}


def minutos_modelo_desde_hora(hora, es_sabado: bool = False) -> int:
    """Pasa una hora de reloj al minuto de TRABAJO del día que le corresponde.

    El solver cuenta minutos trabajados, no minutos de reloj: las 09:00 de un día de
    semana son el minuto 120, y las 12:30 el 285 (porque entre medio hubo pausas).
    Hace falta para poder comparar el horario de un operario contra los tramos.
    """
    tramos = TRAMOS_SAB_LAB if es_sabado else TRAMOS_LV_LAB
    reloj = (hora.hour * 60 + hora.minute) - (HORA_APERTURA.hour * 60 + HORA_APERTURA.minute)
    if reloj <= 0:
        return 0
    for ini, fin in tramos:
        ancho = fin - ini
        muertos = minutos_muertos_del_dia(ini + 1, es_sabado)
        # Minutos de reloj consumidos hasta el final de este tramo (trabajo + pausas).
        if reloj <= fin + muertos:
            return min(fin, max(ini, reloj - muertos))
    return tramos[-1][1]


def minutos_muertos_del_dia(minutos_trabajados: int, es_sabado: bool = False) -> int:
    """Pausas acumuladas antes de llegar a ese minuto de trabajo del día.

    Sirve para pasar de "minuto de trabajo" a hora de reloj. Se deriva de los tramos
    para que no haya dos versiones de la misma jornada dando vueltas: cambiar
    TRAMOS_LV_LAB alcanza para que la conversión a fecha siga en sincronía.
    """
    if es_sabado:
        return 0
    muertos = 0
    if minutos_trabajados > TRAMOS_LV_LAB[0][1]:
        muertos += MIN_DESAYUNO
    if minutos_trabajados > TRAMOS_LV_LAB[1][1]:
        muertos += MIN_ALMUERZO
    return muertos

# Tramo laboral más largo de un día de semana. Es el techo real de lo que puede durar
# un proceso: _agregar_ventanas_horarias solo le ofrece a un proceso las ventanas
# donde entra entero, así que uno más largo que esto no entra en NINGUNA y queda
# forzado a excedente —arrastrando, por la cadena de presencia, a todo lo que sigue
# en su OT—. Los procesos que lo superan se parten en tramos (ver _partir_procesos_largos).
MAX_MIN_TRAMO = max(fin - ini for ini, fin in TRAMOS_LV_LAB)

# Tamaño de cada parte de un proceso partido: el tramo MÁS CORTO (07:00-09:00, 120).
#
# Antes las partes eran lo más grandes posible (hasta 210) y sólo entraban en el tramo
# de la tarde: la soldadura TIG de 40 h de la OT 13348 quedaba en 12 partes de 200 que
# avanzaban de a una o dos por tarde, ~400 minutos por día en vez de 495, y esa OT sola
# se estiraba más de dos semanas (Lucas, «Cómo planifica SPMM», 25/9/2026). Con partes
# que entran en cualquier tramo, un trabajo largo corre de corrido todo el día, como en
# el taller. Sólo cambia el tamaño de las partes: qué se parte lo sigue decidiendo
# MAX_MIN_TRAMO, así que un proceso que entra en un tramo sigue yendo entero.
TAMANO_PARTE = min(fin - ini for ini, fin in TRAMOS_LV_LAB)

# Separación de claves al partir: la secuencia pasa a ser `orden * ESCALA_SECUENCIA + parte`,
# que mantiene el orden relativo entre procesos y entre partes de un mismo proceso.
ESCALA_SECUENCIA = 1000
# ------------------------------------------------------------------
#Funcion para ventanas semanales en tiempo.
def calendarios_de_operarios(operarios_orm):
    """Traduce el horario cargado de cada operario a algo que el solver pueda usar.

    Devuelve {id_operario: {"dias": {0..6}, "desde": min_trabajo, "hasta": min_trabajo}}.

    Los horarios existían en la ficha del operario desde siempre, pero el planificador
    usaba un único calendario para todos: Argañaraz entra 09:00 y el plan le podía
    poner trabajo a las 07:00, y nadie trabaja los sábados aunque el modelo los
    planificaba igual —300 minutos por persona por semana de capacidad que no existe—.
    """
    calendarios = {}
    for o in operarios_orm:
        dias = {
            _DIAS[d.strip().upper()]
            for d in (o.dias_trabajo or "").split(",")
            if d.strip().upper() in _DIAS
        }
        calendarios[o.id] = {
            "dias": dias or {0, 1, 2, 3, 4},
            "desde": minutos_modelo_desde_hora(o.hora_inicio) if o.hora_inicio else 0,
            "hasta": minutos_modelo_desde_hora(o.hora_fin) if o.hora_fin else MIN_LABORAL_DIA,
            "desde_sab": minutos_modelo_desde_hora(o.hora_inicio, True) if o.hora_inicio else 0,
            "hasta_sab": minutos_modelo_desde_hora(o.hora_fin, True) if o.hora_fin else MIN_LABORAL_SABADO,
        }
    return calendarios


def construir_ventanas_semanales(num_semanas: int, start_date: date, blocked_dates: list[str], fecha_hasta: date | None = None, incluir_sabado: bool = True):
    """Las ventanas (tramos de trabajo) del horizonte, en minutos del plan.

    LA LÍNEA DE TIEMPO DEL PLAN. El solver no cuenta minutos de reloj sino minutos de
    trabajo corridos, y el minuto que elige se traduce después a fecha con
    `_convertir_minutos_a_fecha` (acá) y `fechaDesdeMinutos` (frontend/src/lib/plan-fechas.ts),
    que cuentan así:

        lunes a viernes 495 · sábado 300 · domingo y días bloqueados 0

    Estas ventanas TIENEN que contar igual, porque son las que ubican al solver:
      - el domingo y los días bloqueados no existen: no suman nada;
      - el sábado ocupa sus 300 minutos SIEMPRE. Si alguien lo trabaja son ventanas;
        si nadie lo trabaja son un hueco sin ventanas, donde no arranca nada.

    EL BUG QUE HABÍA (25/9/2026). El avance de cada día era «495 si es de semana, si no
    300»: el DOMINGO sumaba 300 minutos que la vuelta a fecha no cuenta, y el sábado sin
    gente no sumaba nada. Sin gente los sábados se compensaban de casualidad (el hueco
    quedaba en el domingo en vez del sábado, con el mismo número), pero con un sábado
    trabajado —o un sábado feriado— cada fin de semana corría 300 minutos todas las
    fechas que venían detrás: lo que el solver ponía el lunes 07:00 se mostraba el lunes
    a las 12:15.

    EL HUECO DEL SÁBADO Y LO QUE NO TERMINA EL VIERNES. Un paso sólo tiene que ARRANCAR
    en un tramo donde entra entero; el fin puede pasarse (ver _agregar_ventanas_horarias).
    De noche eso está bien: la noche no existe en la línea de tiempo y el paso sigue a la
    mañana siguiente. Pero el hueco del sábado sin gente SÍ ocupa minutos: un paso que
    arrancaba el viernes a las 15:00 «terminaba» adentro del hueco, se mostraba
    terminando el sábado y regalaba horas que nadie trabaja. Por eso las ventanas del
    día anterior a un hueco llevan `tope` (el cierre de ese día): lo que arranca ahí
    tiene que terminar ese mismo día. Lo mismo el último día de un rango pedido con
    `fecha_hasta`: «hasta el viernes» es terminado el viernes, no el lunes a media mañana.

    Con `fecha_hasta`, el horizonte va de `start_date` a `fecha_hasta` inclusive; si no,
    `num_semanas * 7` días de calendario.
    """
    bloqueados = set(blocked_dates or ())
    if fecha_hasta is not None:
        total_dias = max(1, (fecha_hasta - start_date).days + 1)
    else:
        total_dias = num_semanas * 7

    ventanas = []
    base = 0
    # Ventanas del último día trabajado, por si hay que ponerles tope.
    del_ultimo_dia: list[int] = []

    def _cerrar_ultimo_dia():
        for i in del_ultimo_dia:
            ventanas[i] = ventanas[i]._replace(tope=base)

    for n in range(total_dias):
        dia = start_date + timedelta(days=n)
        weekday = dia.weekday()
        if dia.strftime("%Y-%m-%d") in bloqueados:
            logger.info(f"DIA BLOQUEADO: {dia} (sin ventanas)")
            continue
        if weekday == 6:
            continue
        if weekday == 5 and not incluir_sabado:
            # Nadie trabaja los sábados: el día no aporta capacidad, pero ocupa sus 300
            # minutos en la línea de tiempo (así lo cuenta la vuelta a fecha).
            _cerrar_ultimo_dia()
            del_ultimo_dia = []
            base += MIN_LABORAL_SABADO
            continue

        # Se guarda además el día de la semana y el tramo dentro del día: hace falta
        # para poder decir «este operario no trabaja los sábados» o «no entra antes de
        # las 9».
        tramos = TRAMOS_SAB_LAB if weekday == 5 else TRAMOS_LV_LAB
        del_ultimo_dia = []
        for ini, fin in tramos:
            del_ultimo_dia.append(len(ventanas))
            ventanas.append(Ventana(
                ini=base + ini,
                fin=base + fin,
                weekday=weekday,
                ini_dia=ini,
                fin_dia=fin,
                fecha=dia,
            ))
        base += tramos[-1][1]

    if fecha_hasta is not None:
        _cerrar_ultimo_dia()
    return ventanas


def minuto_de_entrega(fecha_prometida, ventanas) -> int | None:
    """La fecha prometida de una OT, en minutos del plan: el CIERRE de la jornada de ese día.

    Antes se contaban minutos de RELOJ desde ahora hasta la medianoche de la fecha
    prometida y el solver los leía como minutos de TRABAJO. Planificando el viernes 25/9
    a las 11 con las OT prometidas para el viernes 2/10 daban 9.410 minutos —noches y
    fin de semana incluidos—, o sea 19 jornadas: para el solver esas OT vencían el 21/10
    y un plan que terminaba el 26/10 le parecía casi a tiempo. En la realidad había
    cuatro jornadas (Lucas, «Cómo planifica SPMM», 25/9/2026).

    Ahora sale de las MISMAS ventanas del plan: el fin de la última ventana del día
    prometido (o del último día trabajado antes, si el prometido es sábado sin gente,
    domingo o feriado). Terminar ese día a las 15:59 no es atraso.

    Devuelve 0 si la fecha ya pasó (todo lo que falta llega tarde) y None si no hay fecha,
    es una fecha de relleno (antes de 1970) o cae después del horizonte: ahí nada de lo
    que entra en el plan puede llegar tarde.
    """
    if not fecha_prometida:
        return None
    try:
        if isinstance(fecha_prometida, str):
            dia = datetime.fromisoformat(fecha_prometida[:19]).date()
        elif isinstance(fecha_prometida, datetime):
            dia = fecha_prometida.date()
        elif isinstance(fecha_prometida, date):
            dia = fecha_prometida
        else:
            return None
    except (TypeError, ValueError) as e:
        logger.warning(f"Fecha prometida ilegible ({fecha_prometida!r}): {e}. Sin atraso.")
        return None
    if dia < date(1970, 1, 1):
        return None
    con_fecha = [v for v in ventanas if v.fecha is not None]
    if not con_fecha or dia > con_fecha[-1].fecha:
        return None
    cierre = 0
    for v in con_fecha:
        if v.fecha > dia:
            break
        cierre = max(cierre, v.fin)
    return cierre

# ------------------------------------------------------------
# Helpers del solver
# ------------------------------------------------------------

def _normalizar_procesos(procesos, prioridad_pesos):
    """
    Normaliza la lista de procesos de entrada:
    - Asegura duración mínima de 1
    - Convierte prioridad a peso numérico
    - Devuelve (procesos_norm, H)
      donde H es el horizonte máximo en minutos.
    """
    procesos_norm = []
    for (orden_id,
        proc_id,
        secuencia,
        fecha_prometida,
        prioridad_desc,
        dur_min,
        rangos_validos,
        nombre_proceso,usa_maquina,familia_req,
        op_skill_levels) in procesos:

        dur = int(dur_min) if dur_min is not None else 1
        if dur <= 0:
            dur = 1

        peso_prioridad = prioridad_pesos.get((prioridad_desc or "").strip().lower(), 5)
        rangos_proc = list(rangos_validos or [])
        procesos_norm.append(
            (orden_id, proc_id, secuencia, fecha_prometida,
            peso_prioridad, dur, rangos_proc, nombre_proceso,usa_maquina,familia_req,
            op_skill_levels)
        )

    # Horizonte en minutos laborales:
    # suma total de trabajo + margen (1 día laboral)
    total_trabajo = sum(p[5] for p in procesos_norm)
    H = total_trabajo + MIN_LABORAL_DIA

    return procesos_norm, H


def _partir_procesos_largos(procesos_norm, cant_op_map=None, preseleccion_maq=None,
                            preseleccion_op=None):
    """Parte los procesos que no entran en ningún tramo laboral.

    Un proceso de 12 horas no cabe en ninguna ventana, así que el modelo lo dejaba
    afuera y —por la cadena de presencia— se llevaba puesto todo el resto de la OT.
    En la corrida de prueba eso dejaba fuera 103 de 241 procesos con la fábrica a
    menos de la mitad de su capacidad.

    Acá el proceso se corta en partes que sí entran en el horario disponible. Las
    partes quedan encadenadas (una detrás de la otra) y, en el modelo, atadas al
    MISMO operario y la MISMA máquina, así que sigue siendo un solo trabajo hecho
    por una sola persona: lo único que cambia es que ocupa varios tramos.

    El corte es parejo (750 min -> 7 partes de 107, no 6 de 120 y una de 30) para que
    no quede una última parte mínima colgando y para repartir mejor entre días. Cada
    parte mide a lo sumo TAMANO_PARTE, que entra en cualquier tramo del día: así un
    trabajo largo avanza de corrido (ver TAMANO_PARTE).

    Devuelve (procesos_norm, cant_op_map, preseleccion_maq, preseleccion_op, partes),
    donde `partes`
    mapea la clave original a las claves nuevas:
        {(orden_id, secuencia_orig): {"orig": tupla, "claves": [(orden_id, sec_new), ...]}}
    """
    cant_op_map = cant_op_map or {}
    preseleccion_maq = preseleccion_maq or {}
    preseleccion_op = preseleccion_op or {}

    nuevos, partes = [], {}
    nuevo_cant_op, nueva_presel, nueva_presel_op = {}, {}, {}

    for proc in procesos_norm:
        (orden_id, proc_id, secuencia, fecha_prometida, peso, dur,
         rangos, nombre, usa_maquina, familia, skills) = proc

        n_partes = 1 if dur <= MAX_MIN_TRAMO else math.ceil(dur / TAMANO_PARTE)
        base = dur // n_partes
        resto = dur % n_partes
        duraciones = [base + (1 if i < resto else 0) for i in range(n_partes)]
        # Con duraciones enteras y reparto parejo ninguna parte puede quedar en 0.
        duraciones = [d for d in duraciones if d > 0] or [dur]

        clave_orig = (orden_id, secuencia)
        claves = []
        for i, d in enumerate(duraciones):
            sec_nueva = secuencia * ESCALA_SECUENCIA + i
            nuevos.append((orden_id, proc_id, sec_nueva, fecha_prometida, peso, d,
                           rangos, nombre, usa_maquina, familia, skills))
            claves.append((orden_id, sec_nueva))

            if clave_orig in cant_op_map:
                nuevo_cant_op[(orden_id, sec_nueva)] = cant_op_map[clave_orig]
            if clave_orig in preseleccion_maq:
                nueva_presel[(orden_id, sec_nueva)] = preseleccion_maq[clave_orig]
            if clave_orig in preseleccion_op:
                nueva_presel_op[(orden_id, sec_nueva)] = preseleccion_op[clave_orig]

        partes[clave_orig] = {"orig": proc, "claves": claves}

        if len(duraciones) > 1:
            logger.info(
                f"PLANIFICADOR: '{nombre}' de la OT {orden_id} dura {dur} min y no entra "
                f"en un tramo (máx {MAX_MIN_TRAMO}); se parte en {len(duraciones)} tramos "
                f"de {duraciones} min, mismo operario y misma máquina."
            )

    return nuevos, nuevo_cant_op, nueva_presel, nueva_presel_op, partes


def _agregar_continuidad_partes(model, partes, operario_vars, maq_vars, op_extra_vars=None):
    """Las partes de un proceso partido van al mismo operario y a la misma máquina.

    El encadenamiento temporal y la cadena de presencia ya salen de las restricciones
    de secuencia, porque las partes son consecutivas en el orden. Lo que falta es que
    no se repartan entre personas o máquinas distintas: media pieza torneada por uno
    y media por otro, en dos tornos distintos, no es un plan.
    """
    for datos in partes.values():
        claves = datos["claves"]
        if len(claves) < 2:
            continue
        primera = claves[0]
        for clave in claves[1:]:
            model.Add(operario_vars[clave] == operario_vars[primera])
            model.Add(maq_vars[clave] == maq_vars[primera])
            for ev_a, ev_b in zip((op_extra_vars or {}).get(primera, []),
                                  (op_extra_vars or {}).get(clave, [])):
                model.Add(ev_b == ev_a)


def _crear_variables_y_dominios(
    model,
    procesos_norm,
    operarios,
    maquinarias,
    RANGOS_BÁSICOS,
    RANGOS_ESPECIALIZADOS,
    nativas_off=None,
    cant_op_map=None,
    preseleccion_maq=None,
    op_planos=None,
    ots_con_plano=None,
    skills_manuales=None,
    preseleccion_op=None,
    maquinas_por_proceso=None,
):
    """
    Crea variables de inicio/fin/intervalos, dominios de operarios/maquinarias
    y devuelve todos los dicts necesarios para el resto del modelo.

    `cant_op_map`: dict {(orden_id, secuencia): cantidad_operarios}. Para procesos
    que requieren más de 1 operario se crean variables de operario adicionales
    ("slots") en `op_extra_vars`, con el mismo dominio que el operario principal.

    `op_planos`: dict {id_operario: bool} — quién sabe interpretar planos.
    `ots_con_plano`: set de orden_id con plano adjunto. Sus procesos solo se asignan
    a operarios de `op_planos`.

    `skills_manuales`: dict {proceso_id: {operario_id}} — habilidades cargadas a mano.
    Suman elegibilidad sobre lo que da el rango (ver más abajo).
    """

    inicio_vars, fin_vars, intervalo_vars = {}, {}, {}
    operario_vars, maq_vars = {}, {}
    op_extra_vars = {}  # (orden_id, secuencia) -> [IntVar, ...] operarios adicionales
    presente_vars = {}
    dur_map = {}
    cant_op_map = cant_op_map or {}

    nativas_off = nativas_off or {}
    # {proceso_id: [maquinaria_id]} cargado en Recursos. Vacío = deducir por nombre.
    maquinas_por_proceso = maquinas_por_proceso or {}
    op_planos = op_planos or {}
    ots_con_plano = ots_con_plano or set()
    skills_manuales = skills_manuales or {}

    op_to_rango = {op_id: r_id for (op_id, r_id) in operarios}
    # `operarios` es una lista de PARES (operario, rango): quien tiene tres rangos
    # aparece tres veces. Sin deduplicar, _agregar_no_solape_operarios —el bloque
    # más caro del modelo— construía el juego completo de booleanos e intervalos
    # opcionales una vez por rango en lugar de una vez por persona (21 pasadas para
    # 12 operarios). Mismo patrón de dedup que ya se usa para `operarios_validos`.
    REAL_OP_IDS = list(dict.fromkeys(op_id for (op_id, _) in operarios))
    DUMMY_OP_ID = 999999

    #REAL_MAQ_IDS = [m_id for (m_id, _rs, _n) in maquinarias]
    #DUMMY_MAQ_ID = 999998

    #maq_to_rangos = {m_id: set(rs) for (m_id, rs, _n) in maquinarias}
    REAL_MAQ_IDS = [m_id for (m_id, _rs, _n, _cod) in maquinarias]
    DUMMY_MAQ_ID = 999998

    maq_to_rangos = {m_id: set(rs) for (m_id, rs, _n, _cod) in maquinarias}

    # Familia/tipo de cada máquina. Sale del nombre (el código es una abreviatura
    # que no matchea ninguna familia) — ver familia_from_maquina.
    maq_to_familia = {m_id: familia_from_maquina(_n, _cod) for (m_id, _rs, _n, _cod) in maquinarias}

    op_domain_vals = {}
    maq_domain_vals = {}

    for (orden_id, proc_id, secuencia, _fp,
        _peso_prioridad, dur, rangos_proc, nombre_proc, usa_maquina,familia_req,
        op_skill_levels) in procesos_norm:

        # Intervalo base
        start = model.NewIntVar(0, H, f"start_{orden_id}_{secuencia}")
        end   = model.NewIntVar(0, H, f"end_{orden_id}_{secuencia}")
        itv   = model.NewIntervalVar(start, dur, end, f"int_{orden_id}_{secuencia}")
        dur_map[(orden_id, secuencia)] = dur

        # Booleano de presencia: 1 = el proceso entra en el plan, 0 = excedente
        presente_vars[(orden_id, secuencia)] = model.NewBoolVar(f"pres_{orden_id}_{secuencia}")

        # ----------------- Operarios válidos -----------------
        # ELEGIBILIDAD = SKILLS NATIVAS + MANUALES. Una nativa es la intersección entre
        # el rango del operario y los rangos que habilitan el proceso: si el rango se lo
        # da, el operario sabe hacerlo. Una manual es una habilidad cargada a mano en su
        # perfil, para lo que el rango no contempla; suma solo a ESE operario.
        #
        # SKILLS 1 y 2 NO participan acá: son prioridad dentro de lo elegible, no un
        # permiso aparte (ver _agregar_objetivo). Antes había un "modo skill-map" que
        # restringía el proceso a quienes tuvieran nivel 1/2 cargado, dejando fuera a
        # nativas perfectamente capaces; eso invertía el modelo y se eliminó.
        #
        # Para que alguien NO haga un proceso que su rango le da, se desactiva esa
        # nativa en su perfil (nativas_off).
        es_proceso_maquina = usa_maquina and _get_tipo_proceso(nombre_proc) == "PRODUCCION_MAQUINA"

        # La elegibilidad es la INTERSECCIÓN: rango del operario ∈ rangos del proceso.
        #
        # Antes había dos atajos sobre esa regla y los dos mentían:
        #   - Si el proceso admitía un rango "básico", `operarios_validos` pasaba a ser
        #     REAL_OP_IDS —o sea, TODOS—. Con 25 procesos que admiten AYUDANTE y 25 que
        #     admiten INGRESANTE, eso hacía que EMBALADO, PINTURA o REBARBADO se los
        #     pudiera llevar cualquiera, y en la práctica caían en oficiales.
        #   - Si admitía un rango "especializado", se quedaba SOLO con ese y descartaba
        #     los demás rangos que el proceso sí habilita.
        # Además las constantes estaban desfasadas del catálogo (PEON_ID = 1 es hoy
        # AYUDANTE, y AYUDANTE_ID = 11 es INGRESANTE), así que el atajo se disparaba
        # para rangos distintos de los que decía el nombre.
        #
        # Para que un rango alto no termine haciendo tareas básicas está la penalización
        # por sobre-cualificación en la función objetivo: eso ordena preferencias sin
        # inventar permisos.
        if not rangos_proc:
            operarios_validos = REAL_OP_IDS[:]
        else:
            operarios_validos = [op_id for (op_id, rango) in operarios if rango in rangos_proc]

        # Sumar a quienes tienen el proceso cargado a mano. Se filtra contra REAL_OP_IDS
        # porque `operarios` sale de operario_rango: un operario sin ningún rango no
        # existe para el resto del modelo (no tiene calendario ni no-overlap), y meterlo
        # en el dominio lo dejaría asignable sin ninguna de esas restricciones.
        manuales = skills_manuales.get(proc_id)
        if manuales:
            reales = set(REAL_OP_IDS)
            operarios_validos += [op_id for op_id in manuales if op_id in reales]
            sin_rango = [op_id for op_id in manuales if op_id not in reales]
            if sin_rango:
                logger.warning(
                    f"Proceso {proc_id} ({nombre_proc}): operarios {sin_rango} tienen la "
                    f"habilidad cargada a mano pero no tienen rango asignado -> se ignoran. "
                    f"Asignales al menos un rango para que entren en la planificación."
                )

        # Un operario con varios rangos aparece repetido en `operarios`: deduplicar
        # preservando el orden para que el dominio del solver no tenga valores dobles.
        operarios_validos = list(dict.fromkeys(operarios_validos))

        # Restar las habilidades desactivadas explícitamente para este proceso (vale
        # tanto para nativas como para manuales: apagada es apagada).
        excluidos = nativas_off.get(proc_id)
        if excluidos:
            operarios_validos = [op_id for op_id in operarios_validos if op_id not in excluidos]

        # Interpretación de planos: si la OT trae plano adjunto, sus procesos exigen
        # saber leerlo. Es un filtro DURO — quien no sabe, no puede hacer la tarea,
        # por más que el rango se la habilite.
        if orden_id in ots_con_plano:
            antes = len(operarios_validos)
            operarios_validos = [op_id for op_id in operarios_validos if op_planos.get(op_id, False)]
            if antes and not operarios_validos:
                logger.warning(
                    f"Proceso {proc_id} ({nombre_proc}) de la OT {orden_id} requiere interpretar "
                    f"planos y ninguno de los {antes} operarios habilitados sabe hacerlo -> SIN ASIGNAR."
                )

        if not operarios_validos:
            if es_proceso_maquina:
                logger.warning(
                    f"Proceso máquina {proc_id} ({nombre_proc}) sin ningún operario con la nativa "
                    f"habilitada -> queda SIN ASIGNAR. Revisar rangos del proceso / de los operarios."
                )
            else:
                logger.warning(f"Proceso {proc_id} sin operarios válidos; usando dummy")
            operarios_validos = [DUMMY_OP_ID]

        if DUMMY_OP_ID not in operarios_validos:
            operarios_validos.append(DUMMY_OP_ID)

        # Preselección de operario: si al cargar la OT se eligió quién hace este
        # proceso, se FUERZA — dominio = solo esa persona, sin fallback al dummy—,
        # igual que la máquina preseleccionada de más abajo.
        #
        # Va DESPUÉS de todos los filtros (rango, nativa apagada, planos) y los pisa a
        # propósito: es una decisión de quien carga la OT, que sabe cosas que los rangos
        # no dicen. Si la persona no llega a entrar por horario, el proceso queda sin
        # asignar y el diagnóstico lo muestra: preferimos eso a que lo agarre otro sin
        # que nadie se entere de que la elección se ignoró.
        _presel_op = (preseleccion_op or {}).get((orden_id, secuencia))
        # Los acompañantes se eligen del conjunto SIN forzar: la elección de la carga es
        # sobre quién hace el trabajo, no sobre con quién. Si los slots extra heredaran
        # el dominio de un solo valor, los dos serían la misma persona y
        # `_agregar_distintos_operarios` exige que sean reales y distintos —
        # `AddBoolOr([eq.Not(), a_dummy])` queda insatisfacible— y el modelo COMPLETO
        # sale INFEASIBLE: no es que esa OT queda sin asignar, es que no sale ningún
        # plan y el diagnóstico tampoco puede explicar por qué. Basta una sola fila con
        # persona elegida y cantidad de recurso humano 2.
        operarios_para_acompanantes = operarios_validos[:]
        if _presel_op and _presel_op in REAL_OP_IDS:
            operarios_validos = [_presel_op]
            logger.info(
                f"PRESELECCIÓN: forzando operario {_presel_op} en proceso {orden_id}/{secuencia}"
            )

        # Variable de operario
        op_var = model.NewIntVarFromDomain(
            cp_model.Domain.FromValues(operarios_validos),
            f"op_{orden_id}_{secuencia}"
        )

        # ✔ REGISTRAR OPERARIOS ANTES DE ABANDONAR LA ITERACIÓN
        op_domain_vals[(orden_id, secuencia)] = operarios_validos[:]
        operario_vars[(orden_id, secuencia)] = op_var

        # Slots extra de operario si el proceso requiere más de 1 persona.
        # Mismo dominio que el principal ANTES de la preselección (incluye DUMMY para
        # casos sin gente suficiente): ver el comentario de arriba.
        k_ops = int(cant_op_map.get((orden_id, secuencia), 1) or 1)
        if k_ops > 1:
            extras = []
            for j in range(1, k_ops):
                ev = model.NewIntVarFromDomain(
                    cp_model.Domain.FromValues(operarios_para_acompanantes),
                    f"op_{orden_id}_{secuencia}_x{j}"
                )
                extras.append(ev)
            op_extra_vars[(orden_id, secuencia)] = extras

        inicio_vars[(orden_id, secuencia)] = start
        fin_vars[(orden_id, secuencia)] = end
        intervalo_vars[(orden_id, secuencia)] = itv

        # ----------------- Caso especial: proceso sin maquinaria -----------------
        if not usa_maquina:
            maqs_validas = [DUMMY_MAQ_ID]

            # Preselección de máquina (feature Metlo): forzar la máquina elegida
            # también en el camino skill.
            _presel_sk = (preseleccion_maq or {}).get((orden_id, secuencia))
            if _presel_sk and _presel_sk in REAL_MAQ_IDS:
                maqs_validas = [_presel_sk]

            maq_var = model.NewIntVarFromDomain(
                cp_model.Domain.FromValues(maqs_validas),
                f"maq_{orden_id}_{secuencia}"
            )

            maq_domain_vals[(orden_id, secuencia)] = maqs_validas[:]
            maq_vars[(orden_id, secuencia)] = maq_var

            continue   # ← AHORA ES CORRECTO, operarios ya están guardados

        # ----------------- Maquinarias válidas -----------------
        nombre_upper = (nombre_proc or "").upper()
        tipo_proc = _get_tipo_proceso(nombre_proc)
        if tipo_proc == "SETUP":
            # Lógica SETUP: Intentar heredar dominio por familia si existe (por coordinación)
            # o fallback a nombre de máquina directo.
            candidates = []
            
            if familia_req:
                candidates = [m for m in REAL_MAQ_IDS if maq_to_familia.get(m) == familia_req]
                if rangos_proc:
                     req = set(rangos_proc)
                     candidates = [m for m in candidates if (req & maq_to_rangos.get(m, set()))]

            if not candidates:
                # Fallback al comportamiento original por nombre
                nombre_upper = _norm(nombre_proc)
                base = (
                    nombre_upper
                    .replace("PROGRAMACION DE", "")
                    .replace("PROGRAMACION", "")
                    .replace("PREPARACION DE", "")
                    .replace("PREPARACION", "")
                    .replace("CAMBIO DE", "")
                    .strip()
                )

                candidates = [
                    m_id for (m_id, _rs, nombre_m, _cod) in maquinarias
                    if base and base in (_norm(nombre_m) or "")
                ]

            if candidates:
                maqs_validas = candidates
            else:
                logger.warning(f"SETUP {proc_id} ({nombre_proc}) no encontró máquina; asignando DUMMY.")
                maqs_validas = [DUMMY_MAQ_ID]

        elif tipo_proc == "PRODUCCION_MAQUINA":
            # Lógica PRODUCCION
            # 1. Las máquinas del catálogo, si alguien las cargó.
            #
            # Es el dato que Lucas contesta en Recursos › Procesos («en qué máquina se
            # hace esto»), y le gana a la deducción por nombre: la deducción es lo que
            # hacíamos cuando no teníamos el dato. Vacío = no cargado, y ahí sigue todo
            # como antes. Se cruza con las máquinas reales por si alguna se dio de baja
            # después de haberla elegido.
            del_catalogo = [m for m in (maquinas_por_proceso.get(proc_id) or []) if m in REAL_MAQ_IDS]
            if del_catalogo:
                candidates = del_catalogo
            elif familia_req:
                candidates = [m for m in REAL_MAQ_IDS if maq_to_familia.get(m) == familia_req]
            else:
                # Sin familia no se sabe QUÉ máquina pide el proceso. Antes el dominio
                # arrancaba con las 31 y solo lo achicaba el filtro por rango, así que
                # cualquier máquina que cruzara un rango entraba como candidata: PULIDO
                # (OFICIAL) se reservaba la SOLDADORA TIG (OFICIAL) porque la
                # penalización del dummy hace más barato agarrar una máquina real que
                # ninguna. Reservar la máquina equivocada es peor que no reservar: la
                # bloquea para la OT que sí la necesita. Sin familia va al dummy, y el
                # diagnóstico lo explica ("no dice en qué máquina se hace").
                candidates = []

            # 2. Filtrar por rangos si existen
            if rangos_proc:
                req = set(rangos_proc)
                candidates = [m for m in candidates if (req & maq_to_rangos.get(m, set()))]

            # 3. Resultado
            if candidates:
                maqs_validas = candidates
            else:
                # ❌ ANTES: Fallback abierto si no habia rangos
                # ✅ AHORA: Dummy si no hay candidatos válidos (familia incorrecta o sin rangos compatibles)
                # logger.warning(f"PROCESO {proc_id} ({nombre_proc}) familia={familia_req} sin máquinas compatibles; asignando DUMMY.")
                maqs_validas = [DUMMY_MAQ_ID]
        
        else:
            # MANUAL o ADMIN -> Siempre dummy
            maqs_validas = [DUMMY_MAQ_ID]


        if not maqs_validas:
             # Safety net
             maqs_validas = [DUMMY_MAQ_ID]
             
        if DUMMY_MAQ_ID not in maqs_validas:
             maqs_validas.append(DUMMY_MAQ_ID)

        # Preselección de máquina (feature Metlo): si el usuario eligió una máquina
        # para este proceso, se FUERZA (dominio = solo esa máquina), sin fallback DUMMY.
        _presel = (preseleccion_maq or {}).get((orden_id, secuencia))
        if _presel and _presel in REAL_MAQ_IDS:
            maqs_validas = [_presel]
            logger.info(f"PRESELECCIÓN: forzando máquina {_presel} en proceso {orden_id}/{secuencia}")

        maq_var = model.NewIntVarFromDomain(
            cp_model.Domain.FromValues(maqs_validas),
            f"maq_{orden_id}_{secuencia}"
        )

        maq_domain_vals[(orden_id, secuencia)] = maqs_validas[:]
        maq_vars[(orden_id, secuencia)] = maq_var

    return (
        inicio_vars,
        fin_vars,
        intervalo_vars,
        operario_vars,
        maq_vars,
        dur_map,
        op_to_rango,
        REAL_OP_IDS,
        DUMMY_OP_ID,
        REAL_MAQ_IDS,
        DUMMY_MAQ_ID,
        maq_to_rangos,
        maq_to_familia,
        op_domain_vals,
        maq_domain_vals,
        presente_vars,
        op_extra_vars,
    )


def _agregar_distintos_operarios(model, operario_vars, op_extra_vars, DUMMY_OP_ID):
    """
    Para procesos que requieren N operarios: los slots (principal + extras) deben ser
    operarios REALES distintos. Se permite que varios queden en DUMMY si no alcanza la
    gente (esos slots quedan sin asignar y se penalizan en la función objetivo).
    """
    for key, extras in (op_extra_vars or {}).items():
        slots = [operario_vars[key]] + list(extras)
        for i in range(len(slots)):
            for j in range(i + 1, len(slots)):
                a, b = slots[i], slots[j]
                eq = model.NewBoolVar(f"eqop_{key[0]}_{key[1]}_{i}_{j}")
                model.Add(a == b).OnlyEnforceIf(eq)
                model.Add(a != b).OnlyEnforceIf(eq.Not())
                a_dummy = model.NewBoolVar(f"adum_{key[0]}_{key[1]}_{i}_{j}")
                model.Add(a == DUMMY_OP_ID).OnlyEnforceIf(a_dummy)
                model.Add(a != DUMMY_OP_ID).OnlyEnforceIf(a_dummy.Not())
                # Si son iguales, solo se permite cuando ambos son DUMMY (a==b==DUMMY).
                model.AddBoolOr([eq.Not(), a_dummy])


def _agregar_restricciones_secuencia(model, procesos_norm, inicio_vars, fin_vars, presente_vars=None):
    """
    Asegura que, dentro de una misma orden de trabajo,
    los procesos respeten su secuencia. Si se pasan presente_vars,
    la restricción solo se enforza cuando ambos procesos están presentes.
    """
    for orden_id in set(p[0] for p in procesos_norm):
        procs = [p for p in procesos_norm if p[0] == orden_id]
        procs.sort(key=lambda x: x[2])  # por secuencia
        for i in range(len(procs) - 1):
            act = procs[i]
            sig = procs[i + 1]
            key_a = (orden_id, act[2])
            key_b = (orden_id, sig[2])
            if presente_vars is not None:
                model.Add(inicio_vars[key_b] >= fin_vars[key_a]).OnlyEnforceIf(
                    [presente_vars[key_a], presente_vars[key_b]]
                )
            else:
                model.Add(inicio_vars[key_b] >= fin_vars[key_a])


def _agregar_cadena_presencia(model, procesos_norm, presente_vars):
    """
    Si un proceso N de una orden no está presente, los procesos N+1, N+2... tampoco.
    presente_{n+1} <= presente_n
    """
    for orden_id in set(p[0] for p in procesos_norm):
        procs = sorted([p for p in procesos_norm if p[0] == orden_id], key=lambda x: x[2])
        for i in range(len(procs) - 1):
            key_a = (orden_id, procs[i][2])
            key_b = (orden_id, procs[i + 1][2])
            model.Add(presente_vars[key_b] <= presente_vars[key_a])


def _agregar_no_solape_operarios(
    model,
    REAL_OP_IDS,
    inicio_vars,
    fin_vars,
    dur_map,
    operario_vars,
    presente_vars=None,
    op_extra_vars=None,
):
    """
    Añade restricciones de no solapamiento por operario
    usando intervalos opcionales. Si presente_vars está, el intervalo
    solo participa si el proceso está presente.

    Considera tanto el operario principal de cada proceso como los slots extra
    (procesos que requieren N operarios), de modo que un operario asignado a
    cualquier slot queda ocupado durante ese proceso.
    """
    # Lista combinada de slots: (clave_proceso, var, indice_slot).
    slots = [((o, s), v, 0) for (o, s), v in operario_vars.items()]
    for (o, s), extras in (op_extra_vars or {}).items():
        for idx, v in enumerate(extras, start=1):
            slots.append(((o, s), v, idx))

    for op_id in REAL_OP_IDS:
        pres_intervals = []
        for (orden_id, secuencia), op_var, slot_idx in slots:
            es_op = model.NewBoolVar(f"esop_{orden_id}_{secuencia}_{slot_idx}_op{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(es_op)
            model.Add(op_var != op_id).OnlyEnforceIf(es_op.Not())

            if presente_vars is not None:
                # pres = es_op AND presente
                pres = model.NewBoolVar(f"usaop_{orden_id}_{secuencia}_{slot_idx}_op{op_id}")
                presente = presente_vars[(orden_id, secuencia)]
                model.AddBoolAnd([es_op, presente]).OnlyEnforceIf(pres)
                model.AddBoolOr([es_op.Not(), presente.Not()]).OnlyEnforceIf(pres.Not())
            else:
                pres = es_op

            start = inicio_vars[(orden_id, secuencia)]
            end   = fin_vars[(orden_id, secuencia)]
            dur   = dur_map[(orden_id, secuencia)]

            opt_interval = model.NewOptionalIntervalVar(
                start, dur, end, pres,
                f"i_op_{orden_id}_{secuencia}_{slot_idx}_{op_id}"
            )
            pres_intervals.append(opt_interval)

        model.AddNoOverlap(pres_intervals)


def _agregar_no_solape_maquinas(
    model,
    REAL_MAQ_IDS,
    procesos_norm,
    inicio_vars,
    fin_vars,
    dur_map,
    maq_vars,
    presente_vars=None,
):
    """
    Añade restricciones de no solapamiento por maquinaria
    usando intervalos opcionales. Si presente_vars está, el intervalo
    solo participa si el proceso está presente.
    """
    for m_id in REAL_MAQ_IDS:
        pres_intervals = []
        for (orden_id, proc_id, secuencia, _fp, _pp, _dur, _rangos, _nombre, usa_maquina,_familia_req, _skills) in procesos_norm:

            # ❌ Proceso manual → no genera intervalos de maquinaria
            if not usa_maquina:
                continue

            maq_var = maq_vars[(orden_id, secuencia)]

            es_m = model.NewBoolVar(f"esm_{orden_id}_{secuencia}_m{m_id}")
            model.Add(maq_var == m_id).OnlyEnforceIf(es_m)
            model.Add(maq_var != m_id).OnlyEnforceIf(es_m.Not())

            if presente_vars is not None:
                pres = model.NewBoolVar(f"usam_{orden_id}_{secuencia}_m{m_id}")
                presente = presente_vars[(orden_id, secuencia)]
                model.AddBoolAnd([es_m, presente]).OnlyEnforceIf(pres)
                model.AddBoolOr([es_m.Not(), presente.Not()]).OnlyEnforceIf(pres.Not())
            else:
                pres = es_m

            start = inicio_vars[(orden_id, secuencia)]
            end   = fin_vars[(orden_id, secuencia)]
            dur   = dur_map[(orden_id, secuencia)]

            opt_interval = model.NewOptionalIntervalVar(
                start, dur, end, pres,
                f"i_maq_{orden_id}_{secuencia}_{m_id}"
            )
            pres_intervals.append(opt_interval)

        model.AddNoOverlap(pres_intervals)


def _setup_de_esta_produccion(proc_setup, proc_prod) -> bool:
    """True si `proc_setup` es la preparación de `proc_prod`.

    No alcanza con que uno sea SETUP y el que le sigue PRODUCCION_MAQUINA: en la
    secuencia de una OT puede haber una preparación seguida de un proceso que no
    tiene nada que ver. Se exige además que compartan familia de máquina, que es
    lo que hace que "preparar la fresadora" y "fresar" sean efectivamente la misma
    máquina y la misma persona.

    La familia se deriva del NOMBRE de cada proceso y no del campo ya calculado de
    la tupla: el paso de herencia le pisa la familia al setup con la de la
    producción, así que mirar el campo haría que después todo par pareciera
    relacionado. Con el nombre, los dos lugares deciden igual.

    Tupla: (orden_id, proc_id, secuencia, fecha_prometida, peso, dur, rangos,
            nombre, usa_maquina, familia_req, skills)
    """
    if _get_tipo_proceso(proc_setup[7]) != "SETUP":
        return False
    if _get_tipo_proceso(proc_prod[7]) != "PRODUCCION_MAQUINA":
        return False
    fam_setup = familia_requerida_from_proceso(proc_setup[7] or "")
    fam_prod = familia_requerida_from_proceso(proc_prod[7] or "")
    return bool(fam_setup) and fam_setup == fam_prod


def _pares_setup_produccion(procesos_norm, partes=None):
    """Qué preparación va con qué producción, en cada OT. UN solo lugar que lo decide.

    Devuelve [(claves_setup, claves_produccion)], donde cada elemento es la lista de
    claves (orden_id, secuencia) de los TRAMOS de esa línea: un proceso de más de 210
    minutos se parte, y los tramos son de la misma línea aunque tengan secuencias
    distintas. Emparejar por tramo hacía que el segundo tramo de la primera preparación
    se llevara la segunda producción, y por la continuidad de partes eso terminaba
    pasándole la persona y la máquina del torno equivocado.

    Se recorre la OT en orden guardando las preparaciones sin pareja por familia, y cada
    producción se lleva la más vieja. Uno a uno: una OT puede repetir la misma familia
    (la 7497 tiene torno CNC 13 veces) y aparear todas contra todas ataría trabajos que
    no tienen nada que ver.

    Existe porque hasta el 2/9 esto se decidía en DOS lugares —acá y en el paso de
    herencia de rangos— y quedaron emparejando distinto: la coordinación juntaba pares
    no vecinos y la herencia seguía mirando solo al de al lado. El resultado era peor que
    el bug original: en la OT 15708 la preparación se quedaba con sus rangos, los
    dominios no se cruzaban y los DOS salían sin nadie.
    """
    por_clave = {(p[0], p[2]): p for p in procesos_norm}

    if partes:
        lineas = []
        for info in partes.values():
            claves = [k for k in info["claves"] if k in por_clave]
            if claves:
                lineas.append(claves)
    else:
        lineas = [[(p[0], p[2])] for p in procesos_norm]

    por_ot = {}
    for claves in lineas:
        por_ot.setdefault(claves[0][0], []).append(claves)

    pares = []
    for lineas_ot in por_ot.values():
        lineas_ot.sort(key=lambda cl: por_clave[cl[0]][2])
        pendientes = {}
        for claves in lineas_ot:
            rep = por_clave[claves[0]]
            if not rep[8]:            # no usa máquina: ni preparación ni producción
                continue
            familia = familia_requerida_from_proceso(rep[7] or "")
            if not familia:
                continue
            tipo = _get_tipo_proceso(rep[7])
            if tipo == "SETUP":
                pendientes.setdefault(familia, []).append(claves)
            elif tipo == "PRODUCCION_MAQUINA" and pendientes.get(familia):
                claves_setup = pendientes[familia].pop(0)
                # Se confirma con la misma función de siempre: que haya UN lugar que
                # decida si dos procesos están relacionados.
                if _setup_de_esta_produccion(por_clave[claves_setup[0]], rep):
                    pares.append((claves_setup, claves))
    return pares


def _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars=None,
                                    op_domain_vals=None, *, dummy_op_id,
                                    partes=None, maq_domain_vals=None):
    """
    Fuerza a que procesos coordinados (ej: Programacion + Produccion)
    usen la misma máquina y, si se pasa `operario_vars`, el MISMO operario
    (el que prepara la máquina es el que la usa). Ver A2 (feedback 06/07).

    Solo para pares realmente relacionados: ver _setup_de_esta_produccion.

    LA EXCEPCIÓN (Lucas, 28/08): si al cargar el proceso en la OT se eligió a alguien
    a mano, esa persona manda y el par NO se ata. El caso que dio es real: el torno CNC
    lo puede preparar uno y ejecutarlo un operario calificado. Sin esta guarda las dos
    reglas se pelean —la preselección deja el dominio en una sola persona y la igualdad
    pide que las dos variables valgan lo mismo—, así que o el modelo sale INFEASIBLE o,
    peor, la igualdad arrastra la elección de quien cargó la OT a un proceso donde nadie
    la pidió. La máquina se sigue igualando: esa parte no la discutió nadie y es la que
    evita que la preparación reserve una soldadora y la soldadura use otra.
    """
    op_domain_vals = op_domain_vals or {}

    def _persona_elegida_a_mano(clave):
        """¿El dominio de operario de esta línea quedó fijado en UNA PERSONA REAL?

        Se mira el DOMINIO y no el diccionario de preselección a propósito: si la
        preselección apunta a alguien que no está entre los operarios reales,
        `_crear_variables_y_dominios` la ignora y la línea sigue libre. Mirar el
        diccionario nos haría saltear la igualdad por una elección que el solver
        nunca aplicó.

        Y por eso hace falta descartar el DUMMY: el dominio también queda en un solo
        valor cuando NADIE puede hacer el proceso, y ahí ese valor es el dummy. Ese
        caso tiene que seguir arrastrando a la producción a "sin asignar", que es el
        comportamiento buscado desde el A2 — si no, la preparación queda sin nadie y
        la producción sale con una persona, que es justo el dibujo que Lucas marcó
        como error en la OT 15708.
        """
        dominio = op_domain_vals.get(clave, ())
        return len(dominio) == 1 and dominio[0] != dummy_op_id
    por_clave = {(p[0], p[2]): p for p in procesos_norm}
    maq_domain_vals = maq_domain_vals or {}

    for claves_setup, claves_prod in _pares_setup_produccion(procesos_norm, partes):
        # Representantes: el ÚLTIMO tramo de la preparación y el PRIMERO de la
        # producción, que son los que se tocan en el tiempo. Al resto de los tramos los
        # arrastra _agregar_continuidad_partes.
        clave_a, clave_s = claves_setup[-1], claves_prod[0]
        act, sig = por_clave[clave_a], por_clave[clave_s]
        oid, seq_a, name_a = act[0], act[2], act[7]
        seq_s, name_s = sig[2], sig[7]

        # La misma máquina: es lo que evita que la preparación reserve una soldadora y
        # la soldadura use otra.
        #
        # Salvo que las dos tengan máquina elegida a mano y sean distintas. Ahí los
        # dominios quedan en un valor cada uno y sin dummy, así que la igualdad es
        # insatisfacible y se lleva puesto el modelo COMPLETO: no sale ningún plan y el
        # diagnóstico tampoco puede explicar por qué. Es un dato deliberado de quien
        # cargó la OT — se avisa y se sigue, no se rompe todo.
        dom_a = set(maq_domain_vals.get(clave_a, ()) or ())
        dom_s = set(maq_domain_vals.get(clave_s, ()) or ())
        if dom_a and dom_s and not (dom_a & dom_s):
            logger.warning(
                f"COORDINACIÓN: Seq {seq_a} ({name_a}) y Seq {seq_s} ({name_s}) de la OT "
                f"{oid} tienen máquinas elegidas a mano que no se cruzan: no se atan."
            )
        else:
            model.Add(maq_vars[clave_a] == maq_vars[clave_s])
            logger.info(
                f"COORDINACIÓN: Vinculando máquinas de Seq {seq_a} ({name_a}) y "
                f"Seq {seq_s} ({name_s}) en OT {oid}"
            )

        # A2 (feedback 06/07): preparación y producción deben ser el MISMO operario.
        # La preparación va antes en la secuencia (fin_setup <= inicio_prod), así que no
        # hay solape temporal y la igualdad es factible aunque tengan procesos en el
        # medio. OJO: si el setup no tiene operario apto y cae en DUMMY, arrastra la
        # producción a DUMMY también (queda visible como "sin asignar", que es el
        # comportamiento esperado).
        if operario_vars is None:
            continue
        if _persona_elegida_a_mano(clave_a) or _persona_elegida_a_mano(clave_s):
            logger.info(
                f"COORDINACIÓN: Seq {seq_a} y Seq {seq_s} de la OT {oid} NO se atan al "
                f"mismo operario: hay una persona elegida a mano en la carga de la OT"
            )
            continue
        model.Add(operario_vars[clave_a] == operario_vars[clave_s])
        logger.info(f"COORDINACIÓN: Vinculando operario de Seq {seq_a} y Seq {seq_s} en OT {oid}")


def _agregar_compatibilidad_op_maq(
    model,
    procesos_norm,
    operario_vars,
    maq_vars,
    op_domain_vals,
    maq_domain_vals,
    op_to_rango,
    maq_to_rangos,
    maq_to_familia,
    DUMMY_OP_ID,
    DUMMY_MAQ_ID,
    op_to_rangos=None,
    skills_manuales=None,
):
    """
    Añade restricciones de compatibilidad Operario–Maquinaria
    mediante AddAllowedAssignments.

    `skills_manuales` ({proceso: {operarios}}) también habilita máquina, no solo
    proceso. Antes acá se miraba únicamente el rango, así que cargarle a alguien la
    habilidad a mano lo dejaba a mitad de camino: podía tomar el proceso pero ninguna
    máquina le resultaba compatible, y el trabajo salía "sin máquina" —que es peor que
    sin asignar, porque una máquina que no se asigna tampoco se reserva—. Era el caso
    de los tornos CNC: Iván y Pablo tienen el proceso cargado a mano, pero su rango no
    está en la máquina. Decir "esta persona hace este proceso" y a la vez "no puede
    tocar la máquina en la que ese proceso se hace" no es una regla, es una grieta.
    Las máquinas candidatas ya vienen filtradas por los rangos del proceso, así que
    esto no abre nada que el proceso no habilitara.

    `op_to_rangos` es {id_operario: {rangos}}. Hace falta aparte de `op_to_rango`
    porque ese es un dict armado sobre una lista de pares (operario, rango): a un
    operario con varios rangos le sobrevive UNO SOLO, el último que aparece. Con
    eso, Iván —OFICIAL y OFICIAL CNC— podía quedar registrado solo como OFICIAL y
    entonces ninguna máquina CNC le resultaba compatible, así que el proceso se iba
    a la máquina dummy. Para la compatibilidad hay que mirar TODOS sus rangos.
    """
    pares = _pares_permitidos(procesos_norm, op_domain_vals, maq_domain_vals, op_to_rango,
                              maq_to_rangos, maq_to_familia, DUMMY_OP_ID, DUMMY_MAQ_ID,
                              op_to_rangos, skills_manuales)
    for clave, allowed_pairs in pares.items():
        model.AddAllowedAssignments([operario_vars[clave], maq_vars[clave]], allowed_pairs)


def _pares_permitidos(procesos_norm, op_domain_vals, maq_domain_vals, op_to_rango,
                      maq_to_rangos, maq_to_familia, DUMMY_OP_ID, DUMMY_MAQ_ID,
                      op_to_rangos=None, skills_manuales=None):
    """{(orden_id, secuencia): [[operario, máquina], ...]} que el solver permite.

    Es la regla de `_agregar_compatibilidad_op_maq` (ver su docstring), sacada a una
    función pura para que la estimación de días del Paso 1 use la MISMA: quién puede
    hacer qué no puede decidirse en dos lugares.
    """
    op_to_rangos = op_to_rangos or {}
    skills_manuales = skills_manuales or {}
    resultado = {}
    for (orden_id, proc_id, secuencia, _fp,
        _pp, _dur, rangos_proc, _nombre_proc, usa_maquina,familia_req, _skills) in procesos_norm:

        ops_dom  = op_domain_vals[(orden_id, secuencia)]
        maqs_dom = maq_domain_vals[(orden_id, secuencia)]

        # ❌ Proceso manual → no usa máquina real
        if not usa_maquina:
            resultado[(orden_id, secuencia)] = [
                [op_id, DUMMY_MAQ_ID] for op_id in ops_dom
            ]
            continue

        needs = set(rangos_proc)
        con_manual = set(skills_manuales.get(proc_id, ()))
        allowed_pairs = []

        for op_id in ops_dom:
            # dummy-op → solo dummy-machinery
            if op_id == DUMMY_OP_ID:
                if DUMMY_MAQ_ID in maqs_dom:
                    allowed_pairs.append([DUMMY_OP_ID, DUMMY_MAQ_ID])
                continue

            rangos_op = op_to_rangos.get(op_id) or {op_to_rango.get(op_id)}

            for m_id in maqs_dom:
                # dummy-maq → permitido para cualquier operario
                if m_id == DUMMY_MAQ_ID:
                    allowed_pairs.append([op_id, DUMMY_MAQ_ID])
                    continue

                if familia_req:
                    if maq_to_familia.get(m_id) != familia_req:
                        continue

                mrangos = maq_to_rangos.get(m_id, set())
                # La habilidad cargada a mano vale como habilitación en la máquina:
                # es una afirmación explícita de que esa persona hace ese proceso.
                habilitado = bool(rangos_op & mrangos) or (op_id in con_manual)
                if habilitado and (not needs or (needs & mrangos)):
                    allowed_pairs.append([op_id, m_id])

        # Evitar conjunto vacío
        if not allowed_pairs:
            if (DUMMY_OP_ID in ops_dom) and (DUMMY_MAQ_ID in maqs_dom):
                allowed_pairs.append([DUMMY_OP_ID, DUMMY_MAQ_ID])
            else:
                for op_id in ops_dom:
                    for m_id in maqs_dom:
                        allowed_pairs.append([op_id, m_id])

        resultado[(orden_id, secuencia)] = allowed_pairs
    return resultado



def _agregar_funcion_objetivo(
    model,
    procesos_norm,
    inicio_vars,
    fin_vars,
    operario_vars,
    maq_vars,
    op_to_rango,
    maq_to_rangos,
    atraso_mult_por_prioridad,
    RANGOS_BÁSICOS,
    _AYUDANTE_ID,      # se conservan por compatibilidad de firma; la penalización
    _INGRESANTE_ID,    # de sobre-cualificación ahora mira el rango del operario
    PENAL_OVERQUAL,
    PENAL_DUMMY,
    PENAL_DUMMY_MAQ,
    H,
    presente_vars=None,
    op_extra_vars=None,
    op_to_rangos=None,
    ventanas=None,
):
    """
    Construye la lista total_obj con todos los términos de la función objetivo
    y la añade al modelo. La jerarquía de los pesos está explicada arriba, junto a
    W_FUERA; los de excedente (PESO_EXCED_POR_PRIO) viven ahí también.

    `ventanas` son las del plan: con ellas la fecha prometida se pasa a minutos de
    TRABAJO (minuto_de_entrega). Sin ventanas no hay contra qué medir el atraso y no se
    cobra: es sólo una guarda, el solver siempre las pasa.
    """
    total_obj = []
    ultimo_de_ot = {}
    for p in procesos_norm:
        ultimo_de_ot[p[0]] = max(ultimo_de_ot.get(p[0], p[2]), p[2])
    # {orden_id: (fin del último paso, entrega en minutos, multiplicador)}, para el atraso
    # de la OT más atrasada (ver ATRASO_MAX_EQUIV). Sólo las OT con fecha prometida.
    atraso_de_ot = {}

    # Prioridad DENTRO de las nativas. Todos los candidatos que llegan acá ya son
    # elegibles (tienen la nativa habilitada); esto solo ordena a quién preferir:
    #
    #   SKILL 1  <  SKILL 2  <  nativa sin marcar
    #
    # Antes la nativa sin marcar costaba 0 —ni siquiera entraba al término—, así que
    # era la opción MÁS barata y marcar a alguien como SKILL 1 lo volvía menos
    # probable. Invertido: ahora marcar mejora la preferencia.
    #
    # Las magnitudes son deliberadamente chicas frente al atraso (mult ≈ 200/min) y
    # al dummy (1_000_000): la prioridad desempata entre operarios capaces, no
    # justifica llegar tarde ni dejar el proceso sin asignar.
    PENAL_SKILL1 = 0       # preferido
    PENAL_SKILL2 = 2_000   # ~10 min de atraso
    PENAL_NATIVA = 4_000   # ~20 min de atraso — sabe hacerlo, pero no está priorizado

    # Desempate FINO por posición dentro de la lista (0 = primero = más preferido).
    # El tope es menor que el salto entre niveles a propósito: un SKILL 1 al fondo de
    # una lista larga tiene que seguir ganándole a un SKILL 2 al tope. Sin el tope,
    # una lista de 74 skills haría que la posición pesara más que el nivel.
    PENAL_POR_POSICION = 30
    TOPE_PENAL_POSICION = 1_500  # < PENAL_SKILL2 - PENAL_SKILL1

    def _penal_prioridad(entrada):
        """
        entrada = (nivel, orden) del mapa de skills, o None si no está priorizado.

        Acepta también un nivel pelado (int): el mapa pasó a emitir tuplas cuando se
        agregó `orden`, y desempaquetar a ciegas rompe con cualquier llamador viejo.
        """
        if not entrada:
            return PENAL_NATIVA
        if isinstance(entrada, int):
            entrada = (entrada, None)
        nivel, orden = entrada
        base = PENAL_SKILL1 if nivel == 1 else PENAL_SKILL2 if nivel == 2 else PENAL_NATIVA
        if orden is None:
            # Sin posición asignada: va al final de su lista.
            return base + TOPE_PENAL_POSICION
        return base + min(orden * PENAL_POR_POSICION, TOPE_PENAL_POSICION)

    for (orden_id, proc_id, secuencia, fecha_prometida,
        peso_prioridad, dur, rangos_proc, nombre_proceso,usa_maquina,_familia_req,
        op_skill_levels) in procesos_norm:

        op_var  = operario_vars[(orden_id, secuencia)]
        maq_var = maq_vars[(orden_id, secuencia)]

        # --- Exactly-one operario (reales + dummy) ---
        pres_list = []
        # (bool_pick, penalización) — se gatean por `presente` más abajo, una vez que
        # existe el helper. Sin gatear, un proceso excedente pagaba prioridad igual.
        penal_prioridad = []
        # Tarea que admite rangos básicos: preferimos que la haga alguien de rango
        # básico y no un oficial (ver PENAL_OVERQUAL más abajo).
        tarea_basica = bool(rangos_proc) and any(rid in RANGOS_BÁSICOS for rid in rangos_proc)
        for op_id in op_to_rango.keys():
            if op_id == 999999:  # dummy, lo tratamos aparte
                continue
            pres = model.NewBoolVar(f"pick_op_{orden_id}_{secuencia}_{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())
            pres_list.append(pres)

            # Penalización por prioridad de skill. Los operarios no elegibles quedan
            # fuera del dominio de op_var, así que su `pres` es siempre 0 y el término
            # no aporta nada: es seguro recorrer todos.
            penal = _penal_prioridad((op_skill_levels or {}).get(op_id))
            if penal:
                penal_prioridad.append((pres, penal))

            # Sobre-cualificación: la tarea admite rango básico y esta persona no tiene
            # ninguno. Se mira el RANGO del operario; antes se comparaba `op_var` (que
            # lleva ids de operario) contra PEON_ID/AYUDANTE_ID (que son ids de RANGO),
            # así que la condición no significaba nada y la penalización caía siempre
            # igual sobre todos los candidatos.
            if tarea_basica:
                rangos_op = (op_to_rangos or {}).get(op_id) or {op_to_rango.get(op_id)}
                if not (rangos_op & RANGOS_BÁSICOS):
                    penal_prioridad.append((pres, PENAL_OVERQUAL))

        pick_dummy = model.NewBoolVar(f"pick_op_{orden_id}_{secuencia}_dummy")
        model.Add(op_var == 999999).OnlyEnforceIf(pick_dummy)
        model.Add(op_var != 999999).OnlyEnforceIf(pick_dummy.Not())
        model.Add(sum(pres_list) + pick_dummy == 1)

        # --- Exactly-one maquinaria (reales + dummy) ---
        #REAL_MAQ_IDS = [m_id for m_id in set(
        #    v for (k, v) in [(mid, mid) for (mid, _rs) in [(m_id, rs) for (m_id, rs, _n) in maq_to_rangos.items()]]
        #) if m_id != 999998]
        REAL_MAQ_IDS = [m_id for m_id in maq_to_rangos.keys() if m_id != 999998]

        mpres_list = []
        for m_id in REAL_MAQ_IDS:
            mp = model.NewBoolVar(f"pick_maq_{orden_id}_{secuencia}_{m_id}")
            model.Add(maq_var == m_id).OnlyEnforceIf(mp)
            model.Add(maq_var != m_id).OnlyEnforceIf(mp.Not())
            mpres_list.append(mp)

        pick_dummy_maq = model.NewBoolVar(f"pick_maq_{orden_id}_{secuencia}_dummy")
        model.Add(maq_var == 999998).OnlyEnforceIf(pick_dummy_maq)
        model.Add(maq_var != 999998).OnlyEnforceIf(pick_dummy_maq.Not())
        model.Add(sum(mpres_list) + pick_dummy_maq == 1)

        # --- Lateness / prioridad ---
        # La fecha prometida en minutos de TRABAJO del plan, no de reloj desde ahora:
        # ver minuto_de_entrega. None = no hay contra qué llegar tarde.
        end = fin_vars[(orden_id, secuencia)]
        entrega = minuto_de_entrega(fecha_prometida, ventanas) if ventanas else None
        deadline_rel = H * 10 if entrega is None else min(entrega, H * 10)

        diff = model.NewIntVar(-H * 10, H * 10, f"diff_{orden_id}_{secuencia}")
        model.Add(diff == end - deadline_rel)

        lateness = model.NewIntVar(0, H * 10, f"late_{orden_id}_{secuencia}")
        model.AddMaxEquality(lateness, [diff, 0])

        mult = atraso_mult_por_prioridad.get(peso_prioridad, 200)
        if secuencia == ultimo_de_ot.get(orden_id) and entrega is not None:
            # El último paso de la OT: su atraso es el de la OT (ver ATRASO_MAX_EQUIV).
            atraso_de_ot[orden_id] = (end, deadline_rel, mult)

        presente = presente_vars[(orden_id, secuencia)] if presente_vars is not None else None

        # Helpers para gatear términos por presente
        def _gate_int(var, ub, name):
            if presente is None:
                return var
            eff = model.NewIntVar(0, ub, name)
            model.Add(eff == var).OnlyEnforceIf(presente)
            model.Add(eff == 0).OnlyEnforceIf(presente.Not())
            return eff

        def _gate_bool(b, name):
            if presente is None:
                return b
            eff = model.NewBoolVar(name)
            model.AddBoolAnd([b, presente]).OnlyEnforceIf(eff)
            model.AddBoolOr([b.Not(), presente.Not()]).OnlyEnforceIf(eff.Not())
            return eff

        late_eff = _gate_int(lateness, H * 10, f"late_eff_{orden_id}_{secuencia}")
        total_obj.append((late_eff, mult))

        # Prioridad de skill (SKILL 1 < SKILL 2 < nativa), solo si el proceso entra
        # al plan: un excedente no debe pagar preferencia de operario.
        for _i, (pres_b, penal) in enumerate(penal_prioridad):
            pres_eff = _gate_bool(pres_b, f"skillp_eff_{orden_id}_{secuencia}_{_i}")
            total_obj.append((pres_eff, penal))

        base_prior = model.NewIntVar(0, 10000, f"base_{orden_id}_{secuencia}")
        model.Add(base_prior == (6 - min(peso_prioridad, 5)) * 100)
        base_eff = _gate_int(base_prior, 10000, f"base_eff_{orden_id}_{secuencia}")
        total_obj.append((base_eff, 1))

        ini_eff = _gate_int(inicio_vars[(orden_id, secuencia)], H, f"ini_eff_{orden_id}_{secuencia}")
        total_obj.append((ini_eff, 1))

        # Penalizaciones por dummy (solo si presente)
        pd_eff = _gate_bool(pick_dummy, f"pd_eff_{orden_id}_{secuencia}")
        total_obj.append((pd_eff, PENAL_DUMMY))
        if usa_maquina:
            pdm_eff = _gate_bool(pick_dummy_maq, f"pdm_eff_{orden_id}_{secuencia}")
            total_obj.append((pdm_eff, PENAL_DUMMY_MAQ))

        # Slots extra de operario (procesos que requieren N personas): penalizar
        # que queden en DUMMY, para que el solver trate de cubrir las N posiciones.
        for ex_idx, ev in enumerate((op_extra_vars or {}).get((orden_id, secuencia), [])):
            ev_dummy = model.NewBoolVar(f"xdum_{orden_id}_{secuencia}_{ex_idx}")
            model.Add(ev == 999999).OnlyEnforceIf(ev_dummy)
            model.Add(ev != 999999).OnlyEnforceIf(ev_dummy.Not())
            ev_eff = _gate_bool(ev_dummy, f"xdumeff_{orden_id}_{secuencia}_{ex_idx}")
            total_obj.append((ev_eff, PENAL_DUMMY))


        # (la penalización por sobre-cualificación se arma arriba, junto a los picks
        #  de operario, porque necesita el rango de cada candidato)

        # --- Término dominante: excedente ---
        if presente is not None:
            peso_exced = PESO_EXCED_POR_PRIO.get(peso_prioridad, 100)
            ausente = model.NewBoolVar(f"ausente_{orden_id}_{secuencia}")
            model.Add(ausente == 1 - presente)
            total_obj.append((ausente, W_FUERA * peso_exced))

    # --- Terminar antes, aunque no haya atraso ---
    # Sin esto, lo único que empujaba a terminar temprano era el atraso: con la fecha mal
    # leída casi nada estaba atrasado y el plan se estiraba sin costo (1 punto por minuto
    # de arranque). El FIN DEL PLAN empareja la carga —lo marca el más cargado, así que
    # bajarlo es pasarle trabajo a quien tiene lugar— y el FIN DE CADA OT evita dejar OT a
    # medio hacer esperando. Los dos van por debajo del atraso (ver W_FIN_PLAN): primero
    # llegar a tiempo, después terminar antes.
    # Con `>=` en vez de un máximo exacto: al minimizar dan lo mismo y el modelo es más
    # liviano. Lo que quedó afuera del plan no tiene fin que cuidar: su `fin` queda libre y
    # el solver lo baja solo.
    fines_por_ot = {}
    for (orden_id, _p, secuencia, *_r) in procesos_norm:
        fines_por_ot.setdefault(orden_id, []).append(fin_vars[(orden_id, secuencia)])
    if fines_por_ot:
        fin_plan = model.NewIntVar(0, H, "fin_plan")
        for orden_id, fines in fines_por_ot.items():
            fin_ot = model.NewIntVar(0, H, f"fin_ot_{orden_id}")
            for f in fines:
                model.Add(fin_ot >= f)
            model.Add(fin_plan >= fin_ot)
            total_obj.append((fin_ot, W_FIN_OT))
        total_obj.append((fin_plan, W_FIN_PLAN))

    # --- El atraso de la OT más atrasada (ver ATRASO_MAX_EQUIV) ---
    # En minutos ponderados por la prioridad de cada OT: una urgente atrasada un día pesa
    # como una normal atrasada dos. Con `>=`: al minimizar, el solver lo baja hasta el
    # máximo. Si la OT quedó afuera, su último paso no está: su fin no cuenta (el
    # excedente ya se cobra muy por encima).
    if ATRASO_MAX_EQUIV and atraso_de_ot:
        peor = max(atraso_mult_por_prioridad.values())
        atraso_max = model.NewIntVar(0, H * peor, "atraso_max_ot")
        for orden_id, (fin, entrega_ot, mult_ot) in atraso_de_ot.items():
            ultimo = presente_vars.get((orden_id, ultimo_de_ot[orden_id])) if presente_vars is not None else None
            restriccion = model.Add(atraso_max * 1 >= (fin - entrega_ot) * mult_ot)
            if ultimo is not None:
                restriccion.OnlyEnforceIf(ultimo)
        total_obj.append((atraso_max, ATRASO_MAX_EQUIV))

    model.Minimize(sum(v * c for (v, c) in total_obj))


def _convertir_minutos_a_fecha(minutos_acumulados: int, ahora_ref=None, blocked_dates=None, es_fin: bool = False):
    """
    Convierte minutos de trabajo lógicos a una fecha real del calendario físico.

    La jornada sale de TRAMOS_LV_LAB / TRAMOS_SAB_LAB, no de números sueltos: es la
    misma que usa el solver para armar las ventanas. Antes acá había una copia con
    555 y 105 escritos a mano, así que un día entero de trabajo caía a las 18:00
    —dos horas después de que el taller cierra— y la fecha prometida al cliente
    heredaba ese error.

    `es_fin` cambia qué pasa en el borde exacto de la jornada. El minuto 495 es, al
    mismo tiempo, el CIERRE del primer día y la APERTURA del segundo: para un inicio
    corresponde la apertura del día siguiente (un proceso que arranca ahí se hace al
    otro día), pero para un fin corresponde el cierre (un proceso que termina ahí
    terminó hoy a las 16:00, no mañana a las 07:00). Sin la distinción, un proceso que
    cierra la jornada figuraba terminando al día siguiente y se colaba un día de más en
    la vista Diaria.
    """
    from datetime import timedelta

    # Los días bloqueados llegan de afuera (los lee el servicio, que sí tiene sesión de
    # base). Antes esta función abría el archivo de configuración cada vez que la
    # llamaban: dos lecturas de disco POR FILA del resultado.
    blocked_dates = set(blocked_dates or ())

    ahora = ahora_ref if ahora_ref else _ahora_ar()
    inicio_base = ahora.replace(hour=7, minute=0, second=0, microsecond=0)
    
    def avanzar_a_dia_valido(fecha):
        while True:
            wd = fecha.weekday()
            is_blocked = fecha.strftime("%Y-%m-%d") in blocked_dates
            if wd == 6 or is_blocked: 
                fecha += timedelta(days=1)
            else:
                break
        return fecha

    tiempo_actual = avanzar_a_dia_valido(inicio_base)
    minutos_restantes = minutos_acumulados

    while minutos_restantes > 0:
        wd = tiempo_actual.weekday()
        
        if wd < 5:
            capacidad_hoy = MIN_LABORAL_DIA
        elif wd == 5:
            capacidad_hoy = MIN_LABORAL_SABADO
        else:
            capacidad_hoy = 0

        if capacidad_hoy == 0:
            tiempo_actual += timedelta(days=1)
            tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
            continue

        # En el borde exacto, un FIN se queda en el cierre de este día; un inicio pasa
        # a la apertura del siguiente. Ver `es_fin` arriba.
        pasa_al_dia_siguiente = (minutos_restantes > capacidad_hoy if es_fin
                                 else minutos_restantes >= capacidad_hoy)
        if pasa_al_dia_siguiente:
            minutos_restantes -= capacidad_hoy
            tiempo_actual += timedelta(days=1)
            tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
        else:
            tiempo_actual += timedelta(
                minutes=minutos_restantes + minutos_muertos_del_dia(minutos_restantes, es_sabado=(wd == 5))
            )
            minutos_restantes = 0

    return tiempo_actual.isoformat()


def _extraer_resultados(solver,status,procesos_norm,inicio_vars,fin_vars,operario_vars,maq_vars,op_to_rango, DUMMY_OP_ID,DUMMY_MAQ_ID, start_time_ref, presente_vars=None, op_extra_vars=None, partes=None, blocked_dates=None):
    """
    Transforma la solución CP-SAT en la lista de dicts que tu servicio guarda en BD.
    Cada resultado incluye `excedente`: True si el proceso no entra en el horizonte (presente=0).

    Procesos que requieren N operarios: emiten una fila por operario asignado. La fila
    principal conserva la máquina; las filas de los operarios adicionales van sin máquina
    (comparten la del proceso) para no marcar la misma máquina como ocupada N veces.

    `partes` mapea cada proceso original a las claves de sus tramos (ver
    _partir_procesos_largos). Un proceso partido vuelve a salir como UNA fila: arranca
    cuando arranca el primer tramo y termina cuando termina el último. Que por dentro
    hayan sido tres tirones de 250 minutos es cosa del modelo, no del plan que se lee.
    """
    resultados = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if partes is None:
            partes = {
                (p[0], p[2]): {"orig": p, "claves": [(p[0], p[2])]}
                for p in procesos_norm
            }

        for clave_orig, datos in partes.items():
            (orden_id, proc_id, _sec_modelo, fecha_prometida,
             peso_prioridad, dur, rangos_proc, nombre_proceso, usa_maquinaria,
             _familia_req, _skills) = datos["orig"]
            secuencia = clave_orig[1]
            claves = datos["claves"]
            primera = claves[0]

            op_id  = solver.Value(operario_vars[primera])
            maq_id = solver.Value(maq_vars[primera])

            inicio_m = min(solver.Value(inicio_vars[k]) for k in claves)
            fin_m = max(solver.Value(fin_vars[k]) for k in claves)

            if presente_vars is not None:
                # Si algún tramo no entra, el proceso no se puede completar: va entero
                # a excedentes. Dejarlo como planificado a medias sería mentir.
                excedente = any(solver.Value(presente_vars[k]) == 0 for k in claves)
            else:
                excedente = False

            fecha_prom_str = (
                fecha_prometida.strftime("%Y-%m-%d")
                if isinstance(fecha_prometida, (date, datetime))
                else (fecha_prometida if isinstance(fecha_prometida, str) else None)
            )
            fecha_ini_est = _convertir_minutos_a_fecha(inicio_m, start_time_ref, blocked_dates)
            fecha_fin_est = _convertir_minutos_a_fecha(fin_m, start_time_ref, blocked_dates, es_fin=True)

            resultados.append({
                "orden_id": orden_id,
                "proceso_id": proc_id,
                "secuencia": secuencia,
                "nombre_proceso": nombre_proceso,
                "inicio_min": inicio_m,
                "fin_min": fin_m,
                "duracion_min": dur,
                "prioridad_peso": peso_prioridad,
                "id_operario": op_id if op_id != DUMMY_OP_ID else None,
                "id_rango_operario": op_to_rango.get(op_id) if op_id != DUMMY_OP_ID else None,
                "id_maquinaria": maq_id if maq_id != DUMMY_MAQ_ID else None,
                "rangos_permitidos_proceso": rangos_proc,
                "fecha_prometida": fecha_prom_str,
                "sin_asignar": (op_id == DUMMY_OP_ID),
                "sin_maquinaria": (maq_id == DUMMY_MAQ_ID),
                # Manual/tercerizado (False) vs. proceso que sí pide máquina (True).
                # El front lo usa para mostrar "No necesita" en vez de "Sin asignar":
                # sin esto, embalado o pintura parecían un hueco a resolver.
                "usa_maquina": bool(usa_maquinaria),
                "excedente": excedente,
                "fecha_inicio_estimada": fecha_ini_est,
                "fecha_fin_estimada": fecha_fin_est,
                # En cuántos tramos se tuvo que repartir (1 = entró de una).
                "cantidad_tramos": len(claves),
                # Trabajo que hace un tercero. Se planifica igual —ocupa lugar en la
                # secuencia de la OT y hay que esperarlo— pero no lo hace nadie del
                # taller, así que salir "sin asignar" no es un problema a resolver:
                # es lo que corresponde. Sin esta marca se confunde con un hueco.
                "tercerizado": _get_tipo_proceso(nombre_proceso) == "ADMIN",
            })

            # Operarios adicionales del proceso (slots extra). Una fila por cada operario
            # real asignado; los slots que quedaron en DUMMY (sin gente) se omiten.
            for ev in (op_extra_vars or {}).get(primera, []):
                ev_id = solver.Value(ev)
                if ev_id == DUMMY_OP_ID:
                    continue
                resultados.append({
                    "orden_id": orden_id,
                    "proceso_id": proc_id,
                    "secuencia": secuencia,
                    "nombre_proceso": nombre_proceso,
                    "inicio_min": inicio_m,
                    "fin_min": fin_m,
                    "duracion_min": dur,
                    "prioridad_peso": peso_prioridad,
                    "id_operario": ev_id,
                    "id_rango_operario": op_to_rango.get(ev_id),
                    "id_maquinaria": None,
                    "rangos_permitidos_proceso": rangos_proc,
                    "fecha_prometida": fecha_prom_str,
                    "sin_asignar": False,
                    "sin_maquinaria": True,
                    "usa_maquina": bool(usa_maquinaria),
                    # Fila de un operario ADICIONAL del mismo proceso: comparte
                    # (orden, secuencia) con la principal y va siempre sin máquina
                    # (la máquina la reserva la fila principal). Sin esta marca, el
                    # diagnóstico la leía como "el proceso no consiguió máquina" y
                    # contradecía a la máquina que el propio plan había reservado.
                    "slot_extra": True,
                    "excedente": excedente,
                    "fecha_inicio_estimada": fecha_ini_est,
                    "fecha_fin_estimada": fecha_fin_est,
                })

        resultados.sort(key=lambda x: (x["orden_id"], x["secuencia"]))
    else:
        logger.warning(f"No se encontró solución. status={status}")
        raise PlanificacionException("No se pudo generar una planificación viable con las restricciones actuales.")

    return resultados

def _split_resultados(resultados: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Separa la lista cruda del solver en (planificados, excedentes).
    Los excedentes son procesos que el solver marcó con presente=0 (no entran en el horizonte).
    """
    planificados, excedentes = [], []
    for r in resultados:
        if r.get("excedente"):
            excedentes.append(r)
        else:
            planificados.append(r)
    return planificados, excedentes


def _ventana_prohibida_para(cal, v: "Ventana") -> bool:
    """True si el calendario de ese operario no le permite trabajar en esa ventana."""
    if v.weekday not in cal["dias"]:
        return True
    if v.weekday == 5:
        desde, hasta = cal["desde_sab"], cal["hasta_sab"]
    else:
        desde, hasta = cal["desde"], cal["hasta"]
    # La ventana tiene que caer entera dentro del horario de la persona.
    return v.ini_dia < desde or v.fin_dia > hasta


def _agregar_ventanas_horarias(model,procesos_norm,inicio_vars,dur_map,ventanas, presente_vars=None,
                               operario_vars=None, calendarios=None):
    """
    Obliga a que cada proceso:
    - empiece dentro de una ventana laboral
    - termine antes de que esa ventana cierre
    Si presente_vars está, solo aplica cuando el proceso está presente.
    Si un proceso NO entra en ninguna ventana del horizonte → presente = 0.

    Con `calendarios` ({id_operario: horario}) se agrega además el horario de cada
    persona: si una ventana cae fuera de su turno o en un día que no trabaja, ese
    operario no puede quedar asignado a un proceso que caiga ahí. Solo se generan
    restricciones para quienes tienen un horario distinto del general —hoy es uno
    solo— así que el modelo casi no crece.
    """
    calendarios = calendarios or {}

    for (orden_id, proc_id, secuencia, *_resto) in procesos_norm:
        key = (orden_id, secuencia)
        start = inicio_vars[key]
        dur = dur_map[key]
        op_var = (operario_vars or {}).get(key)

        # Un booleano por ventana donde el proceso podría caber
        en_ventana = []

        for idx, v in enumerate(ventanas):
            v_ini, v_fin = v.ini, v.fin
            if dur > (v_fin - v_ini):
                continue  # No cabe en esta ventana → no la considero
            # Antes de un hueco (sábado sin gente) o al final del rango pedido, lo que
            # arranca acá tiene que terminar ese día: ver construir_ventanas_semanales.
            if v.tope is not None:
                v_fin = min(v_fin, v.tope - dur + 1)
                if v_fin <= v_ini:
                    continue

            b = model.NewBoolVar(f"vent_{orden_id}_{secuencia}_{idx}")
            # Si b == 1 → el proceso está dentro de esta ventana
            model.Add(start >= v_ini).OnlyEnforceIf(b)
            model.Add(start < v_fin).OnlyEnforceIf(b)
            en_ventana.append(b)

            # Nadie que no trabaje en ese horario puede quedarse con este proceso.
            if op_var is not None:
                for op_id, cal in calendarios.items():
                    if _ventana_prohibida_para(cal, v):
                        model.Add(op_var != op_id).OnlyEnforceIf(b)

        if presente_vars is not None:
            presente = presente_vars[key]
            if en_ventana:
                # Si presente=1 → cae en exactamente una ventana
                # Si presente=0 → no cae en ninguna
                model.Add(sum(en_ventana) == 1).OnlyEnforceIf(presente)
                model.Add(sum(en_ventana) == 0).OnlyEnforceIf(presente.Not())
            else:
                # Ningún tramo lo aloja → forzosamente excedente
                model.Add(presente == 0)
        else:
            # Modo legacy: requiere caber en exactamente una ventana
            if en_ventana:
                model.Add(sum(en_ventana) == 1)

# ------------------------------------------------------------
# Presupuesto de tiempo del solver
# ------------------------------------------------------------

# Piso y pendiente del presupuesto. Salen de dos anclas medidas sobre
# planificacion_intento (la tabla que guarda cada corrida real con su duración):
#
#   - 73 procesos (la tanda de 6 OT que se cita más abajo, la del 15/08) tardó
#     entre 30 y 61 s según el día. Es el caso que HOY se come el minuto entero,
#     así que se le deja un techo de 80 s: un poco de aire, no cuatro minutos.
#   - 364 procesos ≈ 50 OT. Una tanda de 60 OT (~436 procesos, ver la razón de
#     abajo) necesita ~244 s, así que de ahí para arriba se le da todo el techo.
#
# La recta que une (73 → 80 s) con (364 → 240 s) tiene pendiente
# (240-80)/(364-73) = 0,55 s por proceso y ordenada 80 - 0,55*73 ≈ 40 s.
# Para recalcular con datos nuevos: elegir dos tandas de las que hay en
# planificacion_intento, y PENDIENTE = (seg_grande - seg_chica) / (proc_grande -
# proc_chico); PISO = seg_chica - PENDIENTE * proc_chico.
SOLVER_PISO_SEG = 40
SOLVER_SEG_POR_PROCESO = 0.55

# Y abajo de todo, un piso duro: NADIE recibe menos presupuesto del que tenía.
#
# La recta calibrada arriba pasa por debajo de los 60 s de hoy en todo lote de 35
# procesos o menos —o sea 1 a 5 OT, que es el caso más frecuente del taller—: con
# la recta pelada, una tanda de 27 procesos pasaba de 60 s a 55. Bajarle el
# presupuesto a la corrida de todos los días para arreglar la de 60 OT es cambiar
# un problema por otro, y el que se rompe es peor: si un lote chico y difícil no
# llega a la primera solución, el taller no ve un plan peor, ve «no se pudo generar
# una planificación viable».
#
# Va como piso y no sumándole 20 a la ordenada para no mover las dos anclas
# medidas: con `max(60, recta)` el lote de 73 procesos sigue recibiendo sus 80 s.
SOLVER_MINIMO_SEG = 60

# Techo por defecto. Antes era el presupuesto PLANO de todas las corridas (60 s) y
# ahora es sólo el tope de la recta: por eso sube a 240 sin castigar a las tandas
# chicas. Va como default del código y no como variable de Cloud Run a propósito —
# el backend se deploya a mano y la idea es que esto salga con el deploy, sin tocar
# configuración. Los 240 s entran cómodos en el timeoutSeconds=600 del servicio,
# contando la lectura de datos, el diagnóstico y el guardado que van alrededor.
SOLVER_TECHO_SEG_DEFAULT = 240

# El corte por estancamiento vale 1/6 del presupuesto: la misma proporción que rige
# hoy (10 s sobre 60), para que una tanda chica se comporte igual que antes.
#
# Escala con el presupuesto porque mide PACIENCIA, no tiempo absoluto: cuanto más
# grande el modelo, más tarda el solver entre una mejora y la siguiente, y un corte
# fijo de 10 s sobre un presupuesto de 240 s cortaría a un solver que todavía está
# mejorando.
#
# HONESTIDAD SOBRE EL 1/6: es continuidad, no medición. Para medirlo de verdad hace
# falta el hueco entre mejoras sucesivas DENTRO de una corrida, y eso hoy no se
# guarda en ningún lado — `planificacion_intento` sólo tiene la duración total. Lo
# que se sabe es que la misma tanda de 73 procesos terminó en 30, 32, 33, 33, 39,
# 42 y 61 s en siete corridas distintas, o sea que el solver sigue encontrando
# mejoras tarde; eso justifica que el corte NO sea fijo, no el 1/6 exacto. Si
# alguna vez se loguea el instante de cada mejora, recalibrar acá.
SOLVER_CORTE_FRACCION = 6
SOLVER_CORTE_MIN_SEG = 10


def presupuesto_solver(cant_procesos: int, techo_seg: int | None = None) -> tuple[int, int]:
    """Segundos de presupuesto y de corte por estancamiento para un lote.

    Se mide por PROCESOS y no por órdenes porque una OT de 3 pasos no le cuesta al
    solver lo mismo que una de 20, y los logs lo muestran sin lugar a dudas: dos
    tandas de 5 OT tardaron 4,1 s y 62 s (27 vs 60 procesos), y una de 10 OT salió
    en 7,2 s mientras una de 6 OT se comía 61 s (97 vs 73 procesos). Sobre las 33
    corridas guardadas, la correlación de la duración con la cantidad de procesos es
    0,80 (Spearman 0,70) contra 0,72 (Spearman 0,52) con la cantidad de órdenes.
    Contar OTs haría exactamente lo contrario de lo que se busca: le daría cuatro
    minutos a una tanda de 60 OT flacas y un minuto a una de 6 OT pesadas.

    Se cuenta la lista que ENTRA al solver, no `procesos_norm`: la normalización
    parte los procesos en tramos y multiplica por operario, y ese factor no está en
    los logs contra los que se calibraron el piso y la pendiente. Si algún día se
    quiere afinar con el tamaño real del modelo, hay que recalibrar las dos anclas.

    Para pasar de OTs a procesos: en las tandas reales de planificación dan 7,27
    procesos por OT (el promedio sobre TODAS las OT de la base es 4,42, pero al
    planificador se le mandan las grandes).
    """
    cant = max(0, int(cant_procesos or 0))
    # La variable cambió de significado: antes era el presupuesto PLANO de todas las
    # corridas, ahora es sólo el techo de la recta. Por eso el nombre nuevo es
    # SOLVER_TECHO_SEG. Se sigue leyendo SOLVER_MAX_SEG como alternativa porque es
    # el nombre que quedó escrito en la documentación vieja y en esta conversación:
    # si alguien la setea creyendo que hace lo de antes, que al menos siga fijando
    # el tope y no quede ignorada en silencio. Hoy en Cloud Run no está ninguna de
    # las dos, así que manda el default del código.
    del_entorno = os.getenv("SOLVER_TECHO_SEG") or os.getenv("SOLVER_MAX_SEG")
    techo = int(techo_seg if techo_seg is not None else (del_entorno or SOLVER_TECHO_SEG_DEFAULT))
    recta = SOLVER_PISO_SEG + SOLVER_SEG_POR_PROCESO * cant
    # El techo gana por encima de todo (incluso del mínimo): si alguien lo baja a
    # mano a 30 s, es porque quiere 30 s.
    max_seg = min(techo, max(SOLVER_MINIMO_SEG, int(round(recta))))
    # Nunca menos de un segundo: con el techo puesto a mano en 0 o en negativo el
    # solver devolvería UNKNOWN y el taller se quedaría sin plan y sin explicación.
    max_seg = max(1, max_seg)

    # Si alguien fijó el corte a mano, gana: es la válvula para una corrida puntual.
    # Sin eso, sale de la proporción y nunca por debajo de los 10 s de siempre.
    corte_fijo = os.getenv("SOLVER_CORTE_SIN_MEJORA_SEG")
    if corte_fijo:
        corte_seg = max(1, int(corte_fijo))
    else:
        corte_seg = max(SOLVER_CORTE_MIN_SEG, int(round(max_seg / SOLVER_CORTE_FRACCION)))
    return max_seg, corte_seg


# ------------------------------------------------------------
# Solver principal (refactorizado)
# ------------------------------------------------------------

def inicio_del_plan(ahora: datetime, fecha_desde: date | None = None,
                    blocked_dates=()) -> datetime:
    """Desde cuándo arranca un plan: el T=0 del modelo.

    EL PLAN NUNCA EMPIEZA EN EL PASADO.

    El modelo cuenta minutos desde acá, así que esta fecha es la que decide TODAS las
    fechas del plan. La regla es la del taller: si la jornada ya arrancó, el plan es
    para mañana; sólo se planifica para hoy si todavía no abrieron. Después salta fines
    de semana y feriados.

    Julián lo reportó el 11/9: «planificamos ayer jueves a las 16hs y el planificador
    puso horarios de jueves a las 10am del mismo día, no tiene sentido; tiene que ser
    para el otro día teniendo en cuenta las horas en las que trabajan ellos».

    ESTÁ ACÁ AFUERA A PROPÓSITO. La usan dos lados que tienen que coincidir: el solver,
    al armar el plan, y la vuelta de minutos a fecha, al mostrarlo. Cuando la regla
    vivía adentro del solver, el que mostraba el plan la calculaba por su cuenta desde
    `ahora` — así que un plan guardado el viernes se leía el lunes con fechas de lunes.
    Las fechas del plan se movían solas todos los días.
    """
    if fecha_desde is None or fecha_desde <= ahora.date():
        inicio = ahora.replace(hour=HORA_APERTURA.hour, minute=HORA_APERTURA.minute,
                               second=0, microsecond=0)
        if ahora.time() >= HORA_APERTURA:
            inicio += timedelta(days=1)
    else:
        # Una fecha pedida a futuro manda: arranca a la apertura de ese día.
        inicio = datetime.combine(fecha_desde, HORA_APERTURA)

    bloqueados = set(blocked_dates or ())
    while inicio.weekday() >= 5 or inicio.strftime("%Y-%m-%d") in bloqueados:
        inicio += timedelta(days=1)
        inicio = inicio.replace(hour=HORA_APERTURA.hour, minute=HORA_APERTURA.minute,
                                second=0, microsecond=0)
    return inicio


def base_confiable(inicio_base: datetime | None, ahora: datetime,
                   fecha_desde: date | None = None, blocked_dates=()) -> datetime:
    """El arranque que mandó la pantalla, pero nunca de un día que ya pasó.

    EL PLAN NUNCA EMPIEZA EN EL PASADO, y eso no puede depender de lo que mande el
    cliente. `inicio_base` viaja a la vista previa y vuelve al confirmar —es lo que ata
    las fechas que se miran a las que se guardan— pero un borrador de hace tres días,
    una pestaña vieja o un request armado a mano traen un arranque viejo, y guardarlo
    tal cual deja un plan que arranca el martes pasado.

    El piso es por DÍA y no por instante a propósito: lo que se cuida acá es que no sea
    de ayer. Que sea de HOY más temprano es justamente lo que hay que respetar —una
    previa armada a las 06:59 y confirmada a las 07:01 tiene que guardarse con el
    arranque de las 06:59, que es el que vio la persona.
    """
    if inicio_base is not None and inicio_base.date() >= ahora.date():
        return inicio_base
    return inicio_del_plan(ahora, fecha_desde, blocked_dates)


def _partir_y_heredar(procesos_norm, cant_op_map=None, preseleccion_maq=None, preseleccion_op=None):
    """Parte los procesos largos y hace que cada SETUP herede familia y rangos de su
    PRODUCCIÓN. Lo usan el solver y la estimación de días: si cada uno lo hiciera a su
    manera, el Paso 1 diría una cosa y el plan otra.

    Devuelve (procesos_norm, cant_op_map, preseleccion_maq, preseleccion_op, partes).
    """
    procesos_norm, cant_op_map, preseleccion_maq, preseleccion_op, partes = _partir_procesos_largos(
        procesos_norm, cant_op_map, preseleccion_maq, preseleccion_op
    )

    # ---- Coordinación de dominios: SETUP hereda de PRODUCCIÓN ----
    # Si un SETUP precede a una PRODUCCIÓN de la MISMA familia de máquina, comparten
    # dominio: preparar la fresadora y fresar son la misma máquina y la misma persona.
    #
    # La condición de familia no estaba y alcanzaba con que fueran consecutivos en la
    # secuencia. Eso emparejaba cosas que no tienen nada que ver: en la OT 7541,
    # "PREPARACION DE SOLDADORA MIG" (rangos MEDIO OFICIAL / OPERARIO CALIFICADO) estaba
    # seguida de "TORNO T2", así que heredaba el rango OFICIAL del torno y la preparación
    # de la soldadora se la terminaba llevando el tornero.
    #
    # Usa el MISMO emparejamiento que la coordinación de más abajo. Antes acá había un
    # bucle propio que solo miraba vecinos, así que los dos lugares decidían distinto: la
    # coordinación ataba la preparación con su producción aunque hubiera un proceso
    # manual en el medio, pero la herencia no llegaba y la preparación se quedaba con sus
    # propios rangos. En la OT 15708 los dominios dejaban de cruzarse y los dos salían
    # SIN NADIE — peor que el bug que veníamos a arreglar.
    procesos_norm_list = [list(p) for p in procesos_norm]
    idx_por_clave = {(p[0], p[2]): i for i, p in enumerate(procesos_norm)}
    for claves_setup, claves_prod in _pares_setup_produccion(procesos_norm, partes):
        prod = procesos_norm[idx_por_clave[claves_prod[0]]]
        # A TODOS los tramos de la preparación, no solo al que toca la producción: si se
        # hereda en uno solo, `_agregar_continuidad_partes` termina intersectando dos
        # dominios distintos y la línea entera se queda sin candidatos.
        for clave in claves_setup:
            i = idx_por_clave[clave]
            procesos_norm_list[i][9] = prod[9]   # familia
            procesos_norm_list[i][6] = prod[6]   # rangos
    procesos_norm = [tuple(p) for p in procesos_norm_list]
    return procesos_norm, cant_op_map, preseleccion_maq, preseleccion_op, partes


# Cuánto más largo que el reparto rápido del Paso 1 se arma el calendario del solver
# cuando no hay fecha tope. Ver horizonte_sin_tope.
HORIZONTE_FACTOR = 1.5


def reparto_rapido(procesos, operarios, maquinarias, fecha_desde=None, nativas_off=None,
                   cant_op_map=None, preseleccion_maq=None, op_planos=None,
                   ots_con_plano=None, skills_manuales=None, calendarios=None,
                   blocked_dates=None, preseleccion_op=None, maquinas_por_proceso=None,
                   inicio_base: datetime | None = None) -> dict | None:
    """La cuenta rápida del Paso 1 (EstimacionPlan.estimar_plan) con el detalle del reparto.

    Usa la MISMA preparación que el solver y arma un reparto de verdad —respeta el orden
    de los pasos, que una persona y una máquina hacen una cosa a la vez, los tramos y los
    horarios— en milisegundos. El solver lo usa dos veces: para saber hasta dónde armar
    el calendario (horizonte_sin_tope) y como punto de partida (_sembrar_reparto).

    None si la cuenta no se pudo hacer: el que llama sigue como antes.
    """
    if not procesos:
        return None
    try:
        from backend.application.EstimacionPlan import estimar_plan
        return estimar_plan(
            procesos, operarios, maquinarias, fecha_desde, None, nativas_off, cant_op_map,
            preseleccion_maq, op_planos, ots_con_plano, skills_manuales, calendarios,
            blocked_dates, preseleccion_op, maquinas_por_proceso, inicio_base, detalle=True)
    except Exception as e:   # la estimación es una ayuda: sin ella, el horizonte de siempre
        logger.warning(f"PLANIFICADOR: no se pudo hacer el reparto rápido ({e}); va el peor caso.")
        return None


def horizonte_sin_tope(reparto: dict | None) -> int | None:
    """Hasta qué minuto del plan se arma el calendario cuando no hay fecha tope.

    POR QUÉ. Sin fecha tope el calendario se armaba para el PEOR caso: todo el trabajo en
    fila, como si lo hiciera una sola persona. Con las 48 OT del piloto (581 h) eso son
    ~71 jornadas, hasta fin de año: 240 franjas posibles para cada paso. Son demasiadas
    combinaciones para los cuatro minutos que tiene el solver, que se cortaba por tiempo y
    entregaba lo mejor que tenía: 21 días hábiles para algo que entra en ~10. Con una
    fecha tope de dos semanas quedaban 30 franjas y el plan salía parejo (Lucas, «Cómo
    planifica SPMM», 25/9/2026).

    CÓMO. Si el reparto rápido termina en el minuto F, hay un plan con TODO adentro antes
    de F; el solver recibe F × HORIZONTE_FACTOR más una jornada, para tener lugar donde
    mejorar sin perderse en combinaciones que nunca van a servir.

    None si no hay reparto: el que llama vuelve al peor caso.
    """
    fin = int((reparto or {}).get("_fin_min") or 0)
    if fin <= 0:
        return None
    return int(math.ceil(fin * HORIZONTE_FACTOR)) + MIN_LABORAL_DIA


# Parte del presupuesto que se lleva el primer intento cuando hay otro de respaldo.
FRACCION_INTENTO_CORTO = 2 / 3


def _presupuesto_del_intento(max_seg: int, corte_seg: int, intento: int, cant_intentos: int) -> tuple[int, int]:
    """Segundos y corte por estancamiento de cada intento (ver `intentos` en el solver).

    Un solo intento: el presupuesto entero, como siempre. Con respaldo: el primero 2/3 y
    el segundo la mitad, con el piso de siempre (SOLVER_MINIMO_SEG).
    """
    if cant_intentos <= 1:
        return max_seg, corte_seg
    if intento == 0:
        seg = max(1, int(round(max_seg * FRACCION_INTENTO_CORTO)))
    else:
        seg = max(SOLVER_MINIMO_SEG, max_seg // 2)
    corte_fijo = os.getenv("SOLVER_CORTE_SIN_MEJORA_SEG")
    if corte_fijo:
        return seg, max(1, int(corte_fijo))
    return seg, max(SOLVER_CORTE_MIN_SEG, int(round(seg / SOLVER_CORTE_FRACCION)))


def dia_del_minimo(reparto: dict | None, start_date: date, blocked_dates, incluir_sabado: bool) -> date | None:
    """El día en que se cumple el MÍNIMO del Paso 1 (`jornadas_minimas` de la estimación).

    Es el piso de lo que puede durar el plan: la cadena más larga de una OT y lo que le toca
    al más cargado con el reparto ideal. Se cuenta sobre el MISMO calendario del plan (sin
    domingos, sin feriados, sin sábados si nadie los trabaja). None si no hay estimación.
    """
    minimas = float((reparto or {}).get("jornadas_minimas") or 0)
    if minimas <= 0:
        return None
    objetivo = minimas * MIN_LABORAL_DIA - 1e-6
    semanas = math.ceil(objetivo / (5 * MIN_LABORAL_DIA)) + 2
    ventanas = construir_ventanas_semanales(semanas, start_date, list(blocked_dates or ()),
                                            incluir_sabado=incluir_sabado)
    por_dia: dict = {}
    for v in ventanas:
        por_dia[v.fecha] = por_dia.get(v.fecha, 0) + (v.fin - v.ini)
    capacidad = 0
    for dia in sorted(por_dia):
        capacidad += por_dia[dia]
        if capacidad >= objetivo:
            return dia
    return None


def _minutos_sin_recurso(procesos_norm, dur_map, presente, operario, maquina,
                         DUMMY_OP_ID, DUMMY_MAQ_ID) -> int:
    """Minutos de pasos que están en el plan sin persona, o sin máquina cuando la usan.

    `presente`, `operario` y `maquina` son funciones clave -> valor: sirven igual para una
    solución del solver que para el reparto rápido.
    """
    total = 0
    for p in procesos_norm:
        k = (p[0], p[2])
        if not presente(k):
            continue
        if operario(k) == DUMMY_OP_ID or (p[8] and maquina(k) == DUMMY_MAQ_ID):
            total += dur_map.get(k, p[5])
    return total


def _minutos_sin_recurso_del_reparto(procesos_norm, dur_map, reparto) -> int | None:
    """Lo mismo que _minutos_sin_recurso, medido sobre el reparto rápido. None si no hay."""
    asignacion = (reparto or {}).get("_asignacion")
    if not asignacion:
        return None
    return _minutos_sin_recurso(
        procesos_norm, dur_map, lambda k: k in asignacion,
        lambda k: asignacion[k][1] if asignacion[k][1] is not None else "sin",
        lambda k: asignacion[k][2] if asignacion[k][2] is not None else "sin",
        "sin", "sin")


def _sembrar_reparto(model, reparto, inicio_vars, operario_vars, maq_vars, presente_vars,
                     op_domain_vals, maq_domain_vals, DUMMY_OP_ID, DUMMY_MAQ_ID,
                     limite: int | None = None) -> int:
    """Le da al solver el reparto rápido como punto de partida (hint de CP-SAT).

    Sin esto el solver arranca de cero y con lotes grandes se le va el tiempo buscando un
    plan razonable: con las 48 OT del piloto se comía los cuatro minutos y entregaba 19
    días hábiles, cuando el reparto rápido ya tenía uno de 12 en 0,1 s. Con la semilla
    arranca con TODO adentro y usa el tiempo en mejorar. Es sólo una sugerencia: si algo
    no cierra con el modelo, el solver la corrige; nunca empeora lo que encuentra.

    `limite` (con fecha tope): el minuto en que tiene que haber terminado todo. Lo que el
    reparto termina después se siembra AFUERA del plan; como los pasos de una OT van en
    fila, lo que queda afuera es siempre la cola de la OT, igual que en el modelo.

    Devuelve cuántos pasos se sembraron.
    """
    asignacion = (reparto or {}).get("_asignacion") or {}
    fin_de = (reparto or {}).get("_fin_de") or {}
    sembrados = 0
    for clave, (ini, op, maq, _extra) in asignacion.items():
        if clave not in inicio_vars:
            continue
        if limite is not None and fin_de.get(clave, limite + 1) > limite:
            model.AddHint(presente_vars[clave], 0)
            sembrados += 1
            continue
        op = DUMMY_OP_ID if op is None else op
        maq = DUMMY_MAQ_ID if maq is None else maq
        model.AddHint(inicio_vars[clave], int(ini))
        model.AddHint(presente_vars[clave], 1)
        if op in (op_domain_vals.get(clave) or ()):
            model.AddHint(operario_vars[clave], op)
        if maq in (maq_domain_vals.get(clave) or ()):
            model.AddHint(maq_vars[clave], maq)
        sembrados += 1
    return sembrados


def _completar_semilla(model, max_seg: float = 15.0) -> bool:
    """Pasa la semilla de _sembrar_reparto a una solución COMPLETA del modelo.

    La semilla sólo dice cuándo arranca cada paso, con quién y con qué máquina. CP-SAT
    usa una semilla así como sugerencia para decidir, pero con cientos de pasos no la
    termina de armar: con las 48 OT del piloto su primer plan era «todo afuera» y recién
    a los ~200 s tenía todo adentro, así que el presupuesto se iba en eso y no en mejorar.
    Una semilla con TODAS las variables (los fines, los atrasos, en qué tramo cae cada
    paso) la toma entera como primer plan.

    Para completarla se resuelve el mismo modelo con lo sembrado FIJO: todo lo demás sale
    de ahí, y tarda menos de un segundo. Si no cierra (el reparto no respeta alguna regla
    del modelo), la semilla queda como estaba —orienta, nada más— y el solver sigue igual.
    """
    previo = cp_model.CpSolver()
    previo.parameters.fix_variables_to_their_hinted_value = True
    previo.parameters.max_time_in_seconds = max_seg
    previo.parameters.num_search_workers = 1
    try:
        estado = previo.Solve(model)
    except Exception as e:   # es una ayuda: si falla, el solver arranca como antes
        logger.warning(f"PLANIFICADOR: no se pudo completar la semilla ({e})")
        return False
    if estado not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return False
    variables = [model.GetIntVarFromProtoIndex(i) for i in range(len(model.Proto().variables))]
    valores = [previo.Value(v) for v in variables]
    model.ClearHints()
    for v, valor in zip(variables, valores):
        model.AddHint(v, valor)
    return True


def _resolver_planificacion(procesos, operarios, maquinarias, fecha_desde: date | None = None, fecha_hasta: date | None = None, nativas_off=None, cant_op_map=None, preseleccion_maq=None, op_planos=None, ots_con_plano=None, skills_manuales=None, calendarios=None, blocked_dates=None, preseleccion_op=None, maquinas_por_proceso=None, cant_ordenes: int | None = None, inicio_base: datetime | None = None):
    # Los días bloqueados los trae el servicio desde la base (ver DiaBloqueadoRepository).
    blocked_dates = list(blocked_dates or ())
    logger.info(f"PLANIFICADOR: Fechas bloqueadas cargadas: {blocked_dates}")

    # El arranque puede venir de afuera: quien llama lo calcula UNA vez y lo usa
    # también para responder y para guardar. Si cada uno lo calcula por su cuenta,
    # dos llamadas a `_ahora_ar()` separadas por un segundo pueden caer a distinto
    # lado de las 07:00 y dar planes con un día de diferencia.
    if inicio_base is None:
        inicio_base = inicio_del_plan(_ahora_ar(), fecha_desde, blocked_dates)

    start_date = inicio_base.date()
    logger.info(f"PLANIFICADOR: start_date efectivo = {start_date} (fecha_desde solicitada = {fecha_desde})")


    # ---- Parámetros ----
    prioridad_pesos = PRIORIDAD_PESOS
    atraso_mult_por_prioridad = ATRASO_MULT_POR_PRIORIDAD

    # IDs de rangos (los que ya usabas)
    # IDs de rangos según el catálogo actual (tabla `rango`). Los nombres viejos
    # (PEON_ID = 1, AYUDANTE_ID = 11) quedaron de un catálogo anterior y no
    # coincidían con lo que hay: 1 es AYUDANTE y 11 es INGRESANTE.
    AYUDANTE_ID = 1
    INGRESANTE_ID = 11
    OFICIAL_ESP_ID = 8
    TECNICO_ID = 14

    # Solo se usan para la penalización por sobre-cualificación: la elegibilidad es
    # siempre la intersección rango operario × rangos del proceso.
    RANGOS_BÁSICOS = {AYUDANTE_ID, INGRESANTE_ID}
    RANGOS_ESPECIALIZADOS = {OFICIAL_ESP_ID, TECNICO_ID}

    PENAL_OVERQUAL = 50

    # ---- Horizonte ----
    # Sin fecha tope, el calendario sale de la cuenta rápida del Paso 1 y no del peor caso
    # (ver horizonte_sin_tope). Se calcula con la entrada CRUDA, antes de normalizar: la
    # estimación hace su propia preparación, la misma que se hace acá abajo.
    # Con fecha tope el reparto también se hace: no decide el calendario, pero lo que
    # entra en el rango sirve de punto de partida (ver _sembrar_reparto).
    corto = None
    reparto = reparto_rapido(
        procesos, operarios, maquinarias, fecha_desde, nativas_off, cant_op_map,
        preseleccion_maq, op_planos, ots_con_plano, skills_manuales, calendarios,
        blocked_dates, preseleccion_op, maquinas_por_proceso, inicio_base)
    if fecha_hasta is None:
        corto = horizonte_sin_tope(reparto)

    # ---- Normalizar procesos ----
    # H_peor es el horizonte de antes: todo el trabajo en fila más una jornada. Queda de
    # respaldo (sin estimación) y de techo.
    procesos_norm, H_peor = _normalizar_procesos(procesos, prioridad_pesos)

    # ---- Partir los que no entran en un tramo laboral + SETUP hereda de PRODUCCIÓN ----
    # En una función aparte porque la estimación de días (EstimacionPlan.py) tiene que
    # ver EXACTAMENTE los mismos trabajos que el solver.
    procesos_norm, cant_op_map, preseleccion_maq, preseleccion_op, partes = _partir_y_heredar(
        procesos_norm, cant_op_map, preseleccion_maq, preseleccion_op
    )

    # ¿Trabaja alguien los sábados? Si no, el día no aporta capacidad y hay que contar
    # más semanas para el mismo trabajo; si lo dejáramos como antes, el horizonte se
    # quedaría corto y sobrarían procesos por una razón inventada.
    # Solo los que entran al plan: `calendarios` viene de todos los operarios, y los
    # que no están disponibles no tienen ni dominio ni no-solape, así que restringirles
    # ventanas sería agregar restricciones sobre alguien que no existe para el modelo.
    reales = {op_id for (op_id, _r) in operarios}
    calendarios = {op: c for op, c in (calendarios or {}).items() if op in reales}
    hay_sabado = any(5 in c["dias"] for c in calendarios.values()) if calendarios else True
    min_semana = 5 * MIN_LABORAL_DIA + (MIN_LABORAL_SABADO if hay_sabado else 0)

    # Qué calendarios se prueban, cada uno un intento: (fecha tope, horizonte en minutos,
    # de dónde sale). Con fecha tope, el rango pedido y listo. Sin fecha tope:
    #
    #   1. hasta el día del MÍNIMO del Paso 1 (dia_del_minimo): como si se hubiera
    #      pedido esa fecha tope. Es lo que Lucas hacía a mano («hasta el 9/10») y lo que
    #      de verdad aprieta el plan: dejar algo afuera cuesta más que todo lo demás, así
    #      que el solver hace entrar todo en esos días repartiendo la carga. Con un
    #      calendario holgado, en cambio, un plan de 10 días y uno de 15 le cuestan casi lo
    #      mismo y entrega cualquiera de los dos (25/9/2026: con las 48 OT del piloto, sin
    #      tope daba 11 a 15 días según la corrida; con tope al 9/10, 10 días y las 48).
    #   2. si en el 1 algo quedó afuera o sin persona/máquina por falta de lugar, el
    #      horizonte del reparto rápido con margen (horizonte_sin_tope), donde el reparto
    #      entra entero: ahí entra todo seguro. Dejar una OT afuera NO puede ser
    #      consecuencia de haber probado un calendario corto.
    #
    # Sin reparto rápido (falló la cuenta), el de antes: todo en fila, lento pero seguro.
    if fecha_hasta is not None:
        intentos = [(fecha_hasta, None, "rango pedido")]
    else:
        intentos = []
        tope_minimo = dia_del_minimo(reparto, start_date, blocked_dates, hay_sabado)
        if tope_minimo is not None:
            intentos.append((tope_minimo, None, "hasta el mínimo del Paso 1"))
        if corto and corto < H_peor:
            intentos.append((None, corto, "estimado por el Paso 1, con margen"))
        else:
            intentos.append((None, H_peor, "todo en fila"))

    # ---- Presupuesto del solver ----
    # Presupuesto de tiempo y de hilos ajustados a la máquina REAL, no a la de
    # desarrollo. Esto estaba fijo en 8 workers, pensado para una laptop: en Cloud
    # Run el servicio tiene 1-2 vCPU, así que 8 hilos peleándose la misma CPU hacían
    # al solver MÁS lento (el intento de Lucas del 15/08 se comió los 60s enteros
    # para 6 OTs que localmente salen en 10s) y multiplicaban la memoria — cada
    # worker mantiene su propia copia del modelo, y el contenedor murió por OOM con
    # 1115 MiB. Con workers = cpus, en Cloud Run son 2 y en la laptop los que haya.
    #
    # El presupuesto ya no es plano: se calcula con el tamaño del lote (ver
    # presupuesto_solver). Con el tope fijo en 60 s, DIEZ de las últimas 30
    # planificaciones reales terminaron entre 60,9 y 62,5 s — se comieron el
    # presupuesto entero y el corte por estancamiento no las salvó — y una tanda de
    # 60 OT que necesita ~244 s salía con un plan peor de lo que podía. Subir el
    # tope a 240 s para todas habría castigado al tercio de corridas que hoy
    # resuelve en un minuto.
    #
    # Sin fecha tope hay dos intentos (ver `intentos` arriba): el calendario corto recibe
    # 2/3 del presupuesto y el de respaldo, si hace falta, la mitad con el piso de
    # siempre. Los dos juntos no pasan de 7/6 del presupuesto: con el techo de 240 s son
    # ~280 s, lejos de los 420 s a los que corta el navegador y de los 600 de Cloud Run.
    # El corto no se lleva todo a propósito: con pocos procesadores (Cloud Run) a veces
    # no llega a acomodar todo, y ahí conviene que quede tiempo para el de respaldo.
    cant_procesos = len(procesos or ())
    max_seg, corte_seg = presupuesto_solver(cant_procesos)
    logger.info(
        f"PLANIFICADOR: presupuesto {max_seg}s (corte por estancamiento {corte_seg}s) "
        f"para {cant_procesos} procesos"
        + (f" de {cant_ordenes} OT" if cant_ordenes is not None else "")
    )

    ahora_ref = inicio_base
    global H
    for intento, (hasta_intento, horizonte, origen) in enumerate(intentos):
        ultimo_intento = intento == len(intentos) - 1
        seg_intento, corte_intento = _presupuesto_del_intento(
            max_seg, corte_seg, intento, len(intentos))
        model = cp_model.CpModel()

        # ---- Crear ventanas semanales ----
        # Se arman semanas de sobra y se corta en el horizonte: la cantidad de semanas
        # se cuenta con lo que se trabaja por semana, pero los feriados pueden comerse
        # días. `ventanas[-1].fin` es el cierre del último tramo que quedó.
        num_semanas = math.ceil((horizonte or H_peor) / min_semana) + 1
        ventanas = construir_ventanas_semanales(
            num_semanas, start_date, blocked_dates, fecha_hasta=hasta_intento, incluir_sabado=hay_sabado
        )
        if horizonte is not None:
            ventanas = [v for v in ventanas if v.ini < horizonte]

        # H es el techo de los inicios y fines del modelo (y lo leen los helpers como
        # global). Sale de las ventanas: nada puede arrancar después del último tramo, y
        # una jornada más de aire para lo que arranca al final y termina pasado el cierre.
        # Antes era la suma de todo el trabajo aunque el calendario fuera mucho más corto.
        H = (ventanas[-1].fin if ventanas else (horizonte or H_peor)) + MIN_LABORAL_DIA

        # Sin persona y sin máquina cuestan lo mismo: los dos tienen que ser peores que
        # cualquier atraso y mejores que dejar el paso afuera. Ver penal_sin_recurso.
        PENAL_DUMMY = PENAL_DUMMY_MAQ = penal_sin_recurso(H)

        # ---- Crear variables y dominios ----
        (
            inicio_vars,
            fin_vars,
            intervalo_vars,
            operario_vars,
            maq_vars,
            dur_map,
            op_to_rango,
            REAL_OP_IDS,
            DUMMY_OP_ID,
            REAL_MAQ_IDS,
            DUMMY_MAQ_ID,
            maq_to_rangos,
            maq_to_familia,
            op_domain_vals,
            maq_domain_vals,
            presente_vars,
            op_extra_vars,
        ) = _crear_variables_y_dominios(
            model,
            procesos_norm,
            operarios,
            maquinarias,
            RANGOS_BÁSICOS,
            RANGOS_ESPECIALIZADOS,
            nativas_off,
            cant_op_map,
            preseleccion_maq,
            op_planos,
            ots_con_plano,
            skills_manuales,
            preseleccion_op,
            maquinas_por_proceso,
        )

        # El reparto rápido como punto de partida: el solver arranca con todo adentro.
        sembrados = 0
        if reparto and SEMBRAR_REPARTO:
            # Con fecha tope, lo último del rango cierra en el `tope` del último día.
            limite = None
            if hasta_intento is not None and ventanas:
                limite = ventanas[-1].tope if ventanas[-1].tope is not None else ventanas[-1].fin
            sembrados = _sembrar_reparto(model, reparto, inicio_vars, operario_vars, maq_vars,
                                         presente_vars, op_domain_vals, maq_domain_vals,
                                         DUMMY_OP_ID, DUMMY_MAQ_ID, limite=limite)

        # ---- Restricciones ----
        _agregar_restricciones_secuencia(model, procesos_norm, inicio_vars, fin_vars, presente_vars=presente_vars)
        _agregar_cadena_presencia(model, procesos_norm, presente_vars)
        _agregar_distintos_operarios(model, operario_vars, op_extra_vars, DUMMY_OP_ID)
        _agregar_no_solape_operarios(model, REAL_OP_IDS, inicio_vars, fin_vars, dur_map, operario_vars, presente_vars=presente_vars, op_extra_vars=op_extra_vars)
        _agregar_no_solape_maquinas(model,REAL_MAQ_IDS,procesos_norm, inicio_vars,fin_vars,dur_map,maq_vars, presente_vars=presente_vars)
        # Todos los rangos de cada operario (op_to_rango se queda con uno solo).
        op_to_rangos = {}
        for _op_id, _r_id in operarios:
            op_to_rangos.setdefault(_op_id, set()).add(_r_id)

        _agregar_compatibilidad_op_maq(model,procesos_norm,operario_vars,maq_vars,op_domain_vals,maq_domain_vals,op_to_rango,maq_to_rangos,maq_to_familia,DUMMY_OP_ID,DUMMY_MAQ_ID,op_to_rangos,skills_manuales)
        _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars, op_domain_vals,
                                        dummy_op_id=DUMMY_OP_ID, partes=partes,
                                        maq_domain_vals=maq_domain_vals)
        _agregar_continuidad_partes(model, partes, operario_vars, maq_vars, op_extra_vars)

        con_horario_propio = sum(
            1 for c in calendarios.values()
            if c["desde"] > 0 or c["hasta"] < MIN_LABORAL_DIA or c["dias"] != {0, 1, 2, 3, 4}
        )
        dias_del_horizonte = len({v.fecha for v in ventanas})
        logger.info(
            f"PLANIFICADOR: intento {intento + 1}/{len(intentos)} · ventanas generadas = "
            f"{len(ventanas)} ({dias_del_horizonte} días, hasta "
            f"{ventanas[-1].fecha if ventanas else '-'}; fecha_hasta={fecha_hasta}, "
            f"calendario={origen}, "
            f"sábados={'sí' if hay_sabado else 'no, nadie trabaja'}, "
            f"operarios con horario propio={con_horario_propio})"
        )

        # ---- Restricciones de ventanas horarias ----
        _agregar_ventanas_horarias(
            model,
            procesos_norm,
            inicio_vars,
            dur_map,
            ventanas,
            presente_vars=presente_vars,
            operario_vars=operario_vars,
            calendarios=calendarios,
        )

        # ---- Función objetivo ----
        _agregar_funcion_objetivo(
            model,
            procesos_norm,
            inicio_vars,
            fin_vars,
            operario_vars,
            maq_vars,
            op_to_rango,
            maq_to_rangos,
            atraso_mult_por_prioridad,
            RANGOS_BÁSICOS,
            AYUDANTE_ID,
            INGRESANTE_ID,
            PENAL_OVERQUAL,
            PENAL_DUMMY,
            PENAL_DUMMY_MAQ,
            H,
            presente_vars=presente_vars,
            op_extra_vars=op_extra_vars,
            op_to_rangos=op_to_rangos,
            ventanas=ventanas,
        )


        # La semilla, completa: si el reparto rápido cierra con el modelo, el solver arranca
        # desde un plan entero en vez de desde «todo afuera» (ver _completar_semilla).
        if sembrados:
            completa = _completar_semilla(model)
            logger.info(
                f"PLANIFICADOR: punto de partida = reparto rápido ({sembrados} pasos, "
                f"{'plan completo' if completa else 'no cerró con el modelo: sólo orienta'})"
            )

        # ---- Resolver ----
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = seg_intento
        solver.parameters.num_search_workers = int(os.getenv("SOLVER_WORKERS", "0")) or max(2, min(8, os.cpu_count() or 2))
        solver.parameters.log_search_progress = False

        # Corte por estancamiento: si el solver lleva un rato sin encontrar nada mejor,
        # se corta y se usa lo que hay. Sin esto, el tiempo de respuesta era SIEMPRE el
        # máximo (60s): la solución final aparecía a los pocos segundos y el resto era
        # el solver intentando demostrar que no hay nada mejor — una garantía que al
        # taller no le cambia el plan pero sí lo tiene un minuto mirando el spinner.
        # `corte_seg` sale del presupuesto (1/6) y no de un número fijo, así que una
        # tanda chica sigue cortando a los 10 s y una grande espera hasta 40.
        import threading
        import time as _t

        _ultima_mejora = {"t": None}

        class _RegistroMejoras(cp_model.CpSolverSolutionCallback):
            def on_solution_callback(self):
                _ultima_mejora["t"] = _t.monotonic()

        _fin_vigia = threading.Event()

        def _vigia(solver=solver, corte_seg=corte_intento, _ultima_mejora=_ultima_mejora,
                   _fin_vigia=_fin_vigia):
            while not _fin_vigia.wait(1.0):
                ultima = _ultima_mejora["t"]
                if ultima is not None and (_t.monotonic() - ultima) > corte_seg:
                    # stop_search es el camino documentado para frenar desde otro hilo.
                    getattr(solver, "stop_search", getattr(solver, "StopSearch", lambda: None))()
                    return

        hilo_vigia = threading.Thread(target=_vigia, daemon=True)
        hilo_vigia.start()
        _t0 = _t.monotonic()
        try:
            status = solver.Solve(model, _RegistroMejoras())
        finally:
            _fin_vigia.set()

        # ---- Extraer resultados ----
        try:
            resultados = _extraer_resultados(
                solver,
                status,
                procesos_norm,
                inicio_vars,
                fin_vars,
                operario_vars,
                maq_vars,
                op_to_rango,
                DUMMY_OP_ID,
                DUMMY_MAQ_ID,
                ahora_ref,
                presente_vars=presente_vars,
                op_extra_vars=op_extra_vars,
                partes=partes,
                blocked_dates=blocked_dates,
            )
        except PlanificacionException:
            if ultimo_intento:
                raise
            logger.warning("PLANIFICADOR: el primer intento no dio solución; se reintenta con más horizonte.")
            continue

        afuera = [r for r in resultados if r.get("excedente") and not r.get("slot_extra")]
        # Lo que quedó sin persona o sin máquina, contra lo que ya tenía el reparto rápido
        # (lo que nadie del taller puede hacer lo tiene cualquier plan). Con un calendario
        # corto el solver puede «hacer entrar» un paso soltándole la persona: eso también
        # es falta de lugar.
        sin_recurso = _minutos_sin_recurso(
            procesos_norm, dur_map, lambda k: solver.Value(presente_vars[k]),
            lambda k: solver.Value(operario_vars[k]), lambda k: solver.Value(maq_vars[k]),
            DUMMY_OP_ID, DUMMY_MAQ_ID)
        sin_recurso_reparto = _minutos_sin_recurso_del_reparto(procesos_norm, dur_map, reparto)
        logger.info(
            f"PLANIFICADOR: intento {intento + 1} resuelto en {_t.monotonic() - _t0:.1f}s "
            f"({getattr(solver, 'status_name', getattr(solver, 'StatusName', str))(status)}), "
            f"{len(afuera)} pasos afuera del plan, {sin_recurso} min sin persona o máquina "
            f"(el reparto rápido: {sin_recurso_reparto})"
        )
        falto_lugar = bool(afuera) or (
            sin_recurso_reparto is not None and sin_recurso > sin_recurso_reparto)
        if not falto_lugar or ultimo_intento:
            break
        logger.warning(
            f"PLANIFICADOR: con el calendario «{origen}» no entró todo ({len(afuera)} pasos "
            f"afuera, {sin_recurso} min sin persona o máquina); se resuelve de nuevo con "
            f"«{intentos[intento + 1][2]}»."
        )

    # Rangos y familia EFECTIVOS por (orden, proceso): los que el solver usó de
    # verdad, ya con la herencia del SETUP desde su producción. No se devuelve
    # `procesos_norm` entero a propósito — viene partido en tramos y con otras
    # secuencias, así que como lista de procesos mentiría (duplica duraciones y
    # no casa con los resultados). El diagnóstico solo necesita los rangos.
    rangos_efectivos = {(p[0], p[1]): (p[6], p[9]) for p in procesos_norm}
    return resultados, rangos_efectivos

import re
import unicodedata

def _norm(s: str) -> str:
    s = (s or "").upper().strip()
    s = "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", s)

def familia_from_cod_maquina(cod: str) -> str:
    c = _norm(cod)
    if c.startswith("TORNO"): return "TORNO"
    if c.startswith("FRESADORA"): return "FRESADORA"
    if c.startswith("LIMADORA"): return "LIMADORA"
    if c.startswith("GUILLOTINA"): return "GUILLOTINA"
    if c.startswith("PLEGADORA"): return "PLEGADORA"
    if c.startswith("AGUJEREADORA"): return "AGUJEREADORA"
    if c.startswith("SIERRA CIRCULAR"): return "SIERRA_CIRCULAR"
    # Nuevas agregadas para consistencia
    if c.startswith("PRENSA"): return "PRENSA"
    if c.startswith("RECTIFICADORA"): return "RECTIFICADORA"
    if c.startswith("OXICORTE") or c.startswith("SOPLETE"): return "OXICORTE"
    return ""

def familia_from_maquina(nombre: str, cod: str) -> str:
    """Familia de la máquina, sacada del NOMBRE y no del código.

    `cod_maquina` son abreviaturas ("TORY-1", "FCNCY-1", "PLE-1", "GUI-1") y
    familia_from_cod_maquina compara contra palabras enteras ("TORNO",
    "FRESADORA"), así que devolvía "" para las 31 máquinas. Con la familia vacía,
    el filtro por familia de _crear_variables_y_dominios dejaba CERO candidatos y
    todo proceso de producción terminaba en la máquina dummy: el plan salía sin
    máquina y, como el no-solape solo corre sobre máquinas reales, dos OTs podían
    quedar agendadas en el mismo torno a la misma hora.

    El nombre sí es descriptivo ("TORNO 1", "FRESADORA CNC"), y clasificarlo es
    exactamente lo que ya hace familia_requerida_from_proceso. Se reusa esa para
    que máquina y proceso hablen el mismo idioma —si mañana se agrega una familia,
    entra por los dos lados a la vez—. El código queda como fallback por si alguna
    máquina tiene un nombre poco claro pero un código explícito.
    """
    return familia_requerida_from_proceso(nombre or "") or familia_from_cod_maquina(cod or "")

def familia_requerida_from_proceso(nombre_proc: str) -> str:
    n = _norm(nombre_proc)

    # Detección explícita de familias
    if "EN FRESADORA" in n or "FRESADORA" in n or "TALLADO" in n or "AGUJEREADO EN FRESADORA" in n:
        return "FRESADORA"
    
    if "AGUJEREADORA" in n or "RADIAL" in n or "TALADR" in n or "AVELLANAD" in n:
        return "AGUJEREADORA"
    
    if "TORNO" in n or "CILINDRADO" in n or "ROSCADO" in n or "REPUJADO" in n:
        return "TORNO"
    
    if "LIMADORA" in n:
        return "LIMADORA"
    
    if "GUILLOTINA" in n:
        return "GUILLOTINA"
    
    if "PRENSA" in n or "PUNZONADO" in n or "PRENSADO" in n or "CONFORMAD" in n:
        # CONFORMADORA suele ser prensa o plegadora, asumimos Prensa si no se especifica otra
        return "PRENSA"

    if "PLEGADO" in n or "PLEGADORA" in n or "DOBLADO" in n or "DOBLADORA" in n:
        return "PLEGADORA"

    if "SIERRA" in n or "SENSITIVA" in n:
        return "SIERRA_CIRCULAR"

    if "RECTIFICAD" in n:
        return "RECTIFICADORA"
    
    if "OXICORTE" in n or "SOPLETE" in n:
        return "OXICORTE"

    # Soldadura. Va última a propósito: cualquier familia explícita de arriba gana
    # (un "SOLDADURA EN TORNO" es trabajo de torno). El taller tiene cuatro
    # soldadoras y hasta ahora no se reservaba ninguna, porque acá no había rama de
    # soldadura y el parche fue clasificar toda la soldadura como trabajo MANUAL en
    # _get_tipo_proceso. Con eso, «soldadura con tig» decía «No necesita» máquina
    # mientras «pulido» —que no tiene familia— se reservaba la SOLDADORA TIG.
    #
    # TIG y MIG/MAG son máquinas distintas y no se sustituyen, así que son familias
    # separadas. «SOLDADURA» a secas no dice cuál es: se devuelve "" y va sin
    # máquina, que es la verdad, en vez de dejarla elegir cualquiera.
    if "SOLDA" in n:
        if "TIG" in n:
            return "SOLDADORA_TIG"
        if "MIG" in n or "MAG" in n:
            return "SOLDADORA_MIG"
        return ""

    return ""


def _get_tipo_proceso(nombre_proceso: str) -> str:
    """
    Clasifica el proceso en:
    - PRODUCCION_MAQUINA: Requiere máquina específica
    - MANUAL: No requiere máquina
    - SETUP: Preparación o cambio
    - ADMIN: Administrativo / Tercerizado (sin máquina en solver interno)
    """
    n = _norm(nombre_proceso)
    
    # 1. SETUP / PREPARACION / PROGRAMACION
    if n.startswith("PREPARACION") or n.startswith("CAMBIO DE") or "SETUP" in n or "PROGRAM" in n:
        # Excepciones que podrían ser manuales? Por ahora asumimos que SETUP implica tocar máquina
        # salvo que sea algo muy obvio. Pero el usuario pidió: 'PREPARACION...' -> SETUP.
        return "SETUP"

    # 2. PROCESOS MANUALES (Lista explicita fuerte)
    # Palabras clave que indican proceso MANUAL
    keywords_manual = [
        "EMBALAD", "DESARM", "ENSAMBL", "LAVADO", "LIMPIEZA",
        "REBABA", "REBARB", "AMOLAD", "BICELAD", "BISELAD",
        "PINTU", "ARMADO", "AJUSTE", "CONTROL", "REVISION",
        "DISENO", "PLANIFICACION", "CUBICACION", "CONSULTAR",
        "SOLICITAR", "TRABAJO DE FORMA", "MANUAL",
        # Los cuatro de abajo salieron de la planilla de trabas que contestó Lucas
        # (2/9/2026). Los tenía el sistema como procesos de máquina, así que iban a
        # buscar una máquina que reservar y no la encontraban nunca:
        #   PULIDO      → "a mano, con máquina de mano amoladora"
        #   ENGOMADO    → "a mano, sin máquina"
        #   DECAPADO    → "a mano, sin máquina"
        #   PEGADO DE GOMA → "a mano, sin máquina"
        # Esto cierra de paso el pendiente "cargar en qué máquina se hace el pulido":
        # no había que cargar ninguna, el dato era que no usa.
        "PULIDO", "ENGOMAD", "DECAPAD", "PEGADO DE GOMA",
        # "ENDEREZ" se fue de esta lista en la misma pasada. Enderezar bases va en
        # prensa o plegadora según Lucas, así que SÍ usa máquina. Además la palabra
        # solo agarraba la grafía con Z: «ENDEREZADO EN PRENSA» quedaba como manual y
        # «ENDERESAR DE BASES» —el mismo trabajo, escrito con S— como de máquina.
        # Dos respuestas opuestas para lo mismo, según cómo lo tipeó el que cargó la OT.
        # Acá estuvo "SOLDA" desde el 06/07 (feedback Metlo): la soldadura caía en
        # PRODUCCION_MAQUINA, buscaba una familia de máquina que no existía y el
        # proceso quedaba sin nadie. El parche era sobre el síntoma —el agujero real
        # estaba en familia_requerida_from_proceso, que no tenía rama de soldadura—
        # y a cambio dejaba las cuatro soldadoras del taller sin reservar nunca.
        # Ahora las familias SOLDADORA_TIG / SOLDADORA_MIG existen, así que sale.
    ]
    
    if any(k in n for k in keywords_manual):
        return "MANUAL"

    # 3. ADMIN / EXTERNO
    if "TERCERIZ" in n or "EXTERNO" in n:
        return "ADMIN"

    # 4. DEFAULT: PRODUCCION (Asumimos que si no es manual ni setup, busca máquina)
    return "PRODUCCION_MAQUINA"


def proceso_usa_maquina(nombre_proceso: str, es_tercerizado: bool = False) -> bool:
    """
    Devuelve True si el proceso requiere maquinaria (PRODUCCION o SETUP).
    Devuelve False si es MANUAL o ADMIN.

    `es_tercerizado` viene del DATO, no del nombre: hasta ahora un trabajo se
    reconocía como tercerizado sólo si alguien se había acordado de escribir
    "TERCERIZADO" en el nombre del proceso. Lucas contestó en la planilla del 2/9 que
    cilindrado de chapa y repujado en torno se mandan afuera, y esos dos no lo dicen
    en el nombre: sin esto, el planificador les seguía buscando un torno que reservar.
    Se marca poniéndoles el rango TERCERIZADO en Recursos, que es donde el taller lo
    puede ver y cambiar.
    """
    if es_tercerizado:
        return False
    tipo = _get_tipo_proceso(nombre_proceso)
    return tipo in ("PRODUCCION_MAQUINA", "SETUP")

# 🔸 Función async que envuelve al solver
def _filtrar_procesos_por_orden(procesos, orden_id, procesos_por_orden):
    """
    D1 (feedback 06/07): permite planificar procesos SUELTOS.
    Si `procesos_por_orden` restringe esta orden (orden_id presente en el dict),
    devuelve solo los procesos cuyo `id_proceso` esté en la lista elegida.
    Si no hay restricción para esta orden, devuelve todos (comportamiento actual).
    """
    if not procesos_por_orden or orden_id not in procesos_por_orden:
        return list(procesos)
    permitidos = set(procesos_por_orden[orden_id])
    return [rel for rel in procesos if getattr(rel, "id_proceso", None) in permitidos]


def _filtrar_lineas_por_orden(procesos, orden_id, lineas_por_orden):
    """
    Igual que `_filtrar_procesos_por_orden` pero eligiendo PASADAS puntuales
    (orden_trabajo_proceso.id) en vez de procesos.

    Hace falta desde que el mismo proceso puede ir varias veces en una OT: elegir
    "TORNO CNC" en una OT que lo tiene 13 veces no dice cuál de las 13.
    """
    if not lineas_por_orden or orden_id not in lineas_por_orden:
        return None
    permitidas = set(lineas_por_orden[orden_id])
    return [rel for rel in procesos if getattr(rel, "id", None) in permitidas]


def _lineas_ordenadas(rels):
    """
    Las pasadas de una OT en orden de trabajo, con POSICIÓN única.

    El solver indexa todo por (orden_id, secuencia). Usar `rel.orden` como secuencia
    no sirve: no es único —hoy hay 531 filas que comparten paso con otra de la misma
    OT— y dos filas con el mismo paso se pisaban en los diccionarios del modelo, así
    que una desaparecía del plan sin decir nada. Se numera por posición (1..N) sobre
    la lista ya ordenada, que además desempata parejo las repetidas.

    Devuelve [(posicion, rel), ...].
    """
    ordenadas = sorted(rels, key=lambda r: ((r.orden or 0), (getattr(r, "id", 0) or 0)))
    return list(enumerate(ordenadas, start=1))


def _indexar_pausas(pausas_abiertas):
    """(pausa de la OT entera por orden_id, pausa del paso por id de pasada).

    `pausas_abiertas` es lo que devuelve PausaRepository.abiertas_sin_romper: una lista
    de (pausa, id_otvieja), o None si no se pudo leer. Con None no se saltea nada: es lo
    que hacía el planificador antes de RF-03, y es mejor un plan con una OT pausada
    adentro que ningún plan.
    """
    por_ot, por_paso = {}, {}
    for pausa, _nro in pausas_abiertas or ():
        if pausa.id_otp is None:
            por_ot[pausa.id_orden_trabajo] = pausa
        else:
            por_paso[pausa.id_otp] = pausa
    return por_ot, por_paso


def _sacar_lo_pausado(orden, lineas, pausa_ot, pausas_paso):
    """RF-03: lo pausado no se programa. Devuelve (lineas_que_entran, saltado | None).

    · OT entera pausada → no entra ninguna de sus pasadas.
    · Un paso pausado → no entra ese paso NI LOS QUE VAN DESPUÉS en la OT. Los pasos van
      en secuencia (el solver los encadena, ver _agregar_restricciones_secuencia):
      sacar sólo el pausado dejaba al siguiente pegado al anterior, y el plan mandaba
      a soldar una pieza que todavía no salió del torno roto. Los de antes sí entran.
      El corte se mira sobre TODOS los pasos de la OT y no sólo sobre los elegidos: si
      se eligió planificar el 4 y el 5 y el 3 está pausado, el 4 tampoco se puede hacer.

    `saltado` es lo que necesita el aviso (DiagnosticoPlanificacion.diagnosticos_de_pausas):
    la pausa, qué se dejó afuera y cuánto trabajo era. Sólo cuenta lo NO terminado: una
    pasada terminada no es trabajo que se pierda del plan.
    """
    if not lineas:
        return lineas, None

    def _clave(rel):
        return ((rel.orden or 0), (getattr(rel, "id", 0) or 0))

    def _saltado(pausa, alcance, afuera, despues=0):
        pendientes = [r for r in afuera if getattr(r, "id_estado", 1) != 3]
        if not pendientes:
            return None
        return {
            "orden_id": orden.id,
            "numero": getattr(orden, "id_otvieja", None) or orden.id,
            "pausa": pausa,
            "alcance": alcance,
            "procesos": len(pendientes),
            "minutos": sum(int(r.tiempo_proceso or 1) for r in pendientes),
            "despues": despues,
        }

    if pausa_ot is not None:
        return [], _saltado(pausa_ot, "ot", lineas)

    if not pausas_paso:
        return lineas, None
    todas = sorted(getattr(orden, "procesos", None) or lineas, key=_clave)
    pausado = next((r for r in todas
                    if getattr(r, "id", None) in pausas_paso and getattr(r, "id_estado", 1) != 3),
                   None)
    if pausado is None:
        return lineas, None
    corte = _clave(pausado)
    entran = [r for r in lineas if _clave(r) < corte]
    afuera = [r for r in lineas if _clave(r) >= corte]
    despues = len([r for r in afuera if r is not pausado and getattr(r, "id_estado", 1) != 3])
    return entran, _saltado(pausas_paso[pausado.id], "paso", afuera, despues)


async def _plan_armado_sin_lo_pausado(db, plan: list[dict]) -> tuple[list[dict], list[dict]]:
    """RF-03 al CONFIRMAR: saca de un plan ya armado lo que se pausó después de calcularlo.

    El plan que se confirma sale de una vista previa o de un borrador, calculados antes.
    Si entre medio alguien pausó una de sus OT (o un paso), guardar las filas tal cual
    metía en el plan confirmado justo lo que se pidió no programar, sin avisar a nadie.
    Acá se aplica el MISMO corte que al calcular (_sacar_lo_pausado): la OT pausada no
    entra entera; el paso pausado no entra, ni los que van después en la OT (van en
    secuencia); los de antes sí.

    Devuelve (filas que se guardan, saltadas) — `saltadas` con la forma que pide
    DiagnosticoPlanificacion.diagnosticos_de_pausas, para avisar con el formato de
    siempre. Sacar filas no rompe nada de lo que queda: sólo libera máquinas y personas.

    Es la única lectura que hace el guardado además de escribir (ver
    test_guardar_no_recalcula): una consulta chica de las pausas vigentes de esas OT, y
    otra de sus pasos sólo si hay un paso pausado. Si no se pueden leer (migración sin
    correr), se guarda todo, como antes de RF-03.
    """
    ids = sorted({r.get("orden_id") for r in plan if r.get("orden_id") is not None})
    repo = PausaRepository(db)
    abiertas = await repo.abiertas_sin_romper(ids)
    pausas_ot, pausas_paso = _indexar_pausas(abiertas)
    if not pausas_ot and not pausas_paso:
        return plan, []
    numeros = {p.id_orden_trabajo: nro for p, nro in abiertas or ()}

    # Qué pasos van después del pausado: hace falta el orden de TODOS los de la OT (el
    # plan puede traer sólo algunos).
    ots_con_paso = sorted({p.id_orden_trabajo for p in pausas_paso.values()} - set(pausas_ot))
    pasos_por_ot = await repo.pasos_sin_romper(ots_con_paso) if ots_con_paso else {}

    def _pasada(fila):
        return fila.get("id_orden_trabajo_proceso")

    def _saltado(ot_id, pausa, alcance, afuera, pasada_pausada=None):
        pasadas = {(_pasada(f) or ("fila", f.get("proceso_id"), f.get("secuencia"))) for f in afuera}
        return {
            "orden_id": ot_id,
            "numero": numeros.get(ot_id) or ot_id,
            "pausa": pausa,
            "alcance": alcance,
            "procesos": len(pasadas),
            "minutos": sum(int(f.get("duracion_min") or 0) for f in afuera),
            "despues": len(pasadas - {pasada_pausada}) if alcance == "paso" else 0,
        }

    afuera_ids: set[int] = set()   # id() de las filas que no se guardan
    saltadas = []
    for ot_id in ids:
        filas = [f for f in plan if f.get("orden_id") == ot_id]
        if ot_id in pausas_ot:
            afuera_ids.update(id(f) for f in filas)
            saltadas.append(_saltado(ot_id, pausas_ot[ot_id], "ot", filas))
            continue
        if ot_id not in ots_con_paso:
            continue
        # Mismo orden que el solver y que _sacar_lo_pausado: paso y, a igual paso, id.
        pasos = sorted(((orden, id_otp), estado)
                       for orden, id_otp, estado in (pasos_por_ot or {}).get(ot_id, []))
        clave = {id_otp: (orden, id_otp) for (orden, id_otp), _ in pasos}
        pausado = next((id_otp for (_, id_otp), estado in pasos
                        if id_otp in pausas_paso and estado != 3), None)
        if pausado is None and pasos_por_ot is not None:
            # El paso pausado ya se terminó, o no es de esta OT: no corta nada.
            continue
        if pausado is None:
            # No se pudieron leer los pasos: no se sabe qué va después. Lo seguro es no
            # programar nada de esa OT.
            pausa = next(p for p in pausas_paso.values() if p.id_orden_trabajo == ot_id)
            afuera_ids.update(id(f) for f in filas)
            saltadas.append(_saltado(ot_id, pausa, "paso", filas, pausa.id_otp))
            continue
        corte = clave[pausado]
        # Una fila que no dice de qué paso es (o de uno que ya no está) no se puede ubicar
        # antes o después del pausado: tampoco se programa.
        afuera = [f for f in filas if _pasada(f) not in clave or clave[_pasada(f)] >= corte]
        if afuera:
            afuera_ids.update(id(f) for f in afuera)
            saltadas.append(_saltado(ot_id, pausas_paso[pausado], "paso", afuera, pausado))

    if not afuera_ids:
        return plan, []
    return [f for f in plan if id(f) not in afuera_ids], saltadas


def unidades_hechas(orden) -> int:
    """Cuántas unidades de la OT ya no hay que fabricar: las entregadas o, si es más, las
    terminadas sin entregar («Cant.» de Finalizado parcial). Nunca negativo."""
    entregadas = int(getattr(orden, "cantidad_entregada", 0) or 0)
    terminadas = int(getattr(orden, "cantidad_finalizada_parcial", 0) or 0)
    return max(0, entregadas, terminadas)


def minutos_de_lo_que_falta(tiempo_proceso, nombre_proceso: str, unidades, hechas: int) -> int:
    """Los minutos a planificar de un paso, contando solo las unidades que faltan.

    El tiempo cargado en la OT es el del LOTE ENTERO (así viene del Integral). Con una
    entrega parcial, planificar el lote entero inventa trabajo: la OT 13348 tenía 199 de
    200 unidades entregadas y 79 h cargadas, y ocupaba diez días del plan del piloto
    (Julián, 25/9/2026: «dividirlo por piezas y que lo calcule según unidades»).

    - Producción: proporcional a lo que falta, redondeando para arriba (1 de 200 en un
      paso de 2.400 min son 12 min).
    - Preparación y programación (SETUP): enteras. Preparar la máquina tarda lo mismo
      para 1 pieza que para 200.
    - Sin unidades cargadas, sin nada hecho, o con todo hecho pero la OT abierta (dato
      raro, que decide el taller): el tiempo cargado, sin tocar.
    """
    total = int(tiempo_proceso or 0) or 1
    try:
        unidades = int(unidades or 0)
    except (TypeError, ValueError):
        return total
    if unidades <= 0 or hechas <= 0 or hechas >= unidades:
        return total
    if _get_tipo_proceso(nombre_proceso or "") == "SETUP":
        return total
    return max(1, math.ceil(total * (unidades - hechas) / unidades))


def _marcar_lineas(resultados, linea_por_clave, lote_por_clave=None):
    """
    Le pega a cada fila del resultado el id de la PASADA que la originó, para que
    `planificacion.id_orden_trabajo_proceso` pueda apuntar a la línea exacta.

    El solver devuelve la secuencia ORIGINAL (antes de partir en tramos), que es la
    misma con la que se armó el mapa.

    `lote_por_clave` trae, para los pasos achicados por unidades que faltan, los minutos
    del lote entero y las unidades: la pantalla lo muestra («queda 1 de 200 unidades:
    12 min de 2.400») para que nadie crea que el tiempo del paso se cargó mal.
    """
    for r in resultados or []:
        clave = (r.get("orden_id"), r.get("secuencia"))
        r["id_orden_trabajo_proceso"] = linea_por_clave.get(clave)
        lote = (lote_por_clave or {}).get(clave)
        if lote:
            r["minutos_lote"], r["unidades_lote"], r["unidades_faltan"] = lote
    return resultados


async def planificar(
    repo_orden: OrdenTrabajoRepository,
    repo_operario: OperarioRepository,
    repo_maquinaria: MaquinariaRepository,
    repo_planificacion: PlanificacionRepository,
    db,
    ordenes_ids: list[int] | None = None,
    preview: bool = False,
    plan: list[dict] | None = None,
    repo_skill: OperarioProcesoSkillRepository | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    forzar_ordenes_ids: list[int] | None = None,
    procesos_por_orden: dict[int, list[int]] | None = None,
    lineas_por_orden: dict[int, list[int]] | None = None,
    inicio_base: datetime | None = None,
    ajustes_del_plan: dict | None = None,
    solo_estimar: bool = False,
):
    logger.info(f"Service - planificar() rango: desde={fecha_desde} hasta={fecha_hasta} forzar={forzar_ordenes_ids}")

    # 🔹 ARREGLOS QUE VALEN SOLO PARA ESTE CÁLCULO.
    #
    # El panel de trabas propone soluciones ("a esta máquina le falta el rango
    # OFICIAL CNC"). Hasta ahora aplicarlas quería decir escribirlas en Recursos: para
    # destrabar UN plan había que cambiarle los datos al taller para siempre, y una
    # excepción de un día quedaba como regla. Pedido de Julián (17/09/2026): poder
    # aplicar la solución acá nomás.
    #
    # Todo lo que sigue se hace EN MEMORIA y no escribe nada. Se copian las
    # estructuras que vienen de los repositorios en vez de mutarlas: son objetos que
    # el repositorio puede estar reusando, y contaminarlos haría que el ajuste de un
    # plan se le filtre al siguiente.
    _ajustes = ajustes_del_plan or {}
    ajustes_procesos = dict(_ajustes.get("procesos") or {})
    ajustes_maquinarias = dict(_ajustes.get("maquinarias") or {})
    ajustes_skills = list(_ajustes.get("skills_nativas") or [])
    if ajustes_procesos or ajustes_maquinarias or ajustes_skills:
        # Este log va ARRIBA del early-return del guardado a propósito. Un plan con
        # ajustes sale distinto de lo que dicen los datos: si mañana alguien mira el
        # plan guardado y no le cierra con Recursos, esta línea es la única
        # explicación que va a encontrar. Puesto más abajo, el guardado —que es
        # justo el caso que más importa— no lo imprimiría nunca.
        logger.info(
            f"Service - planificar() con ajustes SOLO para este plan (no se guardan "
            f"en Recursos): {len(ajustes_procesos)} proceso(s), "
            f"{len(ajustes_maquinarias)} máquina(s), {len(ajustes_skills)} habilidad(es)"
        )

    # 🔹 Plan ya armado: se guarda TAL CUAL, sin pasar por el solver.
    #
    # Es el camino normal al confirmar desde la vista previa: se guarda lo que el
    # usuario aprobó en pantalla. Volver a resolver acá tardaba lo mismo que la
    # vista previa entera y, peor, podía guardar un reparto distinto del que se
    # miró — el solver no devuelve siempre lo mismo.
    #
    # Va PRIMERO, antes de leer nada. Estaba cincuenta líneas más abajo y para
    # llegar hasta acá el guardado ya se había traído skills, prioridades, rangos,
    # máquinas por proceso, planos, calendarios y feriados: media docena de consultas
    # para después no usarlas.
    #
    # Devuelve la MISMA forma que el camino del solver ({planificados, excedentes,
    # diagnosticos}) y no el dict pelado del repositorio: la auditoría lee
    # `salida["planificados"]` para sacar el id del lote, y con el dict pelado ese
    # campo venía vacío — los guardados quedaban registrados sin lote.
    if not preview and plan:
        logger.info(f"Service - Guardando plan ya armado ({len(plan)} items), sin solver")
        # Los `ajustes_del_plan` NO se aplican acá, y está bien: no hay nada que
        # ajustar. Este camino no calcula, copia — guarda las filas que el usuario
        # aprobó en pantalla, que ya salieron de una vista previa donde los ajustes
        # sí se aplicaron. El plan aprobado se escribe tal cual se miró.
        #
        # EL ARRANQUE ES EL DE LA VISTA PREVIA, no uno nuevo.
        #
        # La vista previa lo devuelve y la pantalla lo manda de vuelta al confirmar, así
        # que las fechas que se guardan son EXACTAMENTE las que se miraron. Recalcularlo
        # acá era pedirle la hora al reloj por segunda vez: una previa armada a las 06:59
        # y confirmada a las 07:01 se guardaba con un día más, y un borrador confirmado
        # al otro día quedaba corrido entero.
        #
        # Si no viene (pestaña con el bundle viejo, borrador guardado antes del
        # 16/09/2026) se recalcula como antes. Sin leer los feriados a propósito:
        # guardar un plan aprobado no toca la base más que para escribirlo —eso es lo
        # que cuida test_guardar_no_recalcula— y acá no hace falta, porque la vuelta de
        # minutos a fecha ya saltea los días bloqueados al mostrar el plan.
        base = base_confiable(inicio_base, _ahora_ar(), fecha_desde)

        # RF-03: lo que se pausó DESPUÉS de calcular este plan no entra. Se avisa con el
        # mismo aviso que al calcular, en la respuesta (la pantalla lo muestra al
        # guardar).
        plan, saltadas_por_pausa = await _plan_armado_sin_lo_pausado(db, plan)
        avisos = []
        if saltadas_por_pausa:
            for s_ in saltadas_por_pausa:
                logger.info(
                    f"PLANIFICADOR (guardar): OT {s_['numero']} pausada después de calcular "
                    f"el plan ({s_['pausa'].motivo}): {s_['procesos']} pasos no se guardan.")
            try:
                from backend.application.DiagnosticoPlanificacion import diagnosticos_de_pausas
                avisos = diagnosticos_de_pausas(saltadas_por_pausa)
            except Exception as e:
                logger.error(f"Service - No se pudieron armar los avisos de lo pausado: {e}")

        if not plan:
            # Todo lo que traía el plan se pausó: no hay nada que guardar, y un lote vacío
            # sería un plan «confirmado» que no programa nada.
            return {
                "planificados": {"mensaje": "No se guardó nada: todo el plan quedó pausado.",
                                 "id_planificacion_lote": None, "registros": 0},
                "excedentes": [],
                "diagnosticos": avisos,
            }
        guardado = await repo_planificacion.insertar_planificacion_lote(
            plan, inicio_base=base)
        return {"planificados": guardado, "excedentes": [], "diagnosticos": avisos}

    forzar_set = set(forzar_ordenes_ids or [])

    # 🔹 Inyectar repo de skills si no viene
    if not repo_skill:
        repo_skill = OperarioProcesoSkillRepository(db)

    # 🔹 Mapa de PRIORIDAD (proceso_id -> {operario_id: nivel 1|2}). No define quién
    #    puede: eso lo dan las nativas (rango). Solo ordena preferencia.
    mapa_skills = await repo_skill.get_map_por_proceso()
    # 🔹 Qué rango significa "esto se manda afuera". Se resuelve por nombre y una sola
    #    vez: el id no está fijo y hardcodearlo es lo que rompe en la próxima migración.
    ids_rango_tercerizado = {
        r.id for r in await RangoRepository(db).find_all()
        if _norm(r.nombre or "") in ("TERCERIZADO", "EXTERNO")
    }
    # 🔹 En qué máquinas se hace cada proceso, si alguien lo cargó en Recursos. Vacío
    #    para un proceso = no cargado: se sigue deduciendo del nombre, como antes.
    maquinas_por_proceso = await ProcesoRepository(db).find_maquinarias_por_proceso()
    # 🔹 Nativas desactivadas (proceso_id -> {operario_id}) para excluir de la elegibilidad
    nativas_off = await repo_skill.get_nativas_deshabilitadas()
    # Prender (o apagar) a alguien solo para este plan. Se copia el dict Y cada set:
    # lo que devuelve el repositorio no es nuestro para mutarlo. Es un dict común, no
    # un defaultdict, así que el alta va sí o sí por `setdefault`.
    if ajustes_skills:
        nativas_off = {p: set(ops) for p, ops in (nativas_off or {}).items()}
        for _a in ajustes_skills:
            _apagados = nativas_off.setdefault(_a["proceso_id"], set())
            if _a.get("habilitado", True):
                _apagados.discard(_a["operario_id"])
            else:
                _apagados.add(_a["operario_id"])
    # 🔹 Habilidades cargadas a mano (proceso_id -> {operario_id}): suman elegibilidad
    #    donde el rango no llega.
    skills_manuales = await repo_skill.get_manuales_por_proceso()
    # 🔹 Quién sabe interpretar planos (id_operario -> bool)
    op_planos = await repo_operario.find_interpreta_planos()
    # 🔹 Horario de cada uno: turno y días que trabaja.
    calendarios = calendarios_de_operarios(await repo_operario.find_all())
    # 🔹 Feriados / días de mantenimiento, ahora desde la base.
    blocked_dates = await DiaBloqueadoRepository(db).listar()

    # 🔹 DESDE CUÁNDO ARRANCA EL PLAN. Una sola vez, acá, y de acá en adelante todos
    #    usan ESTE valor: el solver para armar el plan, la respuesta para mostrarlo y
    #    el guardado para dejarlo escrito. El plan nunca empieza en el pasado: si la
    #    jornada del taller ya arrancó, es para el día siguiente (ver inicio_del_plan).
    arranque = base_confiable(inicio_base, _ahora_ar(), fecha_desde, blocked_dates)
    logger.info(f"Service - arranque del plan: {arranque}")

    ##ordenes = await repo_orden.find_with_procesos()
    if ordenes_ids:
        ordenes = await repo_orden.find_with_procesos_by_ids(ordenes_ids)
    else:
        ordenes = await repo_orden.find_with_procesos()

    operarios = await repo_operario.find_with_rangos()

    # 🔹 RF-03: lo pausado no se programa. Se lee en un savepoint: si la tabla de pausas
    #    no está (migración sin correr), el plan sale como antes, con todo adentro.
    pausas_ot, pausas_paso = _indexar_pausas(
        await PausaRepository(db).abiertas_sin_romper([o.id for o in ordenes]))
    saltadas_por_pausa = []

    # OTs con plano REALMENTE adjunto: sus procesos exigen saber interpretar planos.
    # Se mira la tabla `plano`, no la bandera `tiene_plano` del legacy — ver
    # PlanoRepository.find_ordenes_con_plano.
    ots_con_plano = await PlanoRepository(db).find_ordenes_con_plano()

    # Cargar maquinarias (con rangos)
    maquinarias_orm = await repo_maquinaria.find_with_rangos()
    maquinarias = []
    # Lo que cada máquina tiene cargado en Recursos, guardado aparte ANTES de que le
    # caiga el ajuste encima. El plan se calcula con los rangos ajustados —para eso se
    # ajustaron—, pero el panel de trabas tiene además un botón que escribe en la base, y
    # ese tiene que partir de lo que la base dice: partiendo de lo ajustado guardaría de
    # rebote el rango temporal, y el «Solo en este plan» dejaría de ser solo de este plan.
    maq_rangos_reales = {}
    for m in maquinarias_orm:
        rangos_en_recursos = {rm.id_rango for rm in (m.rango_maquinarias or [])}
        maq_rangos_reales[m.id] = rangos_en_recursos
        # Si la máquina vino ajustada para este plan, sus rangos son los del ajuste y
        # no los de la base. Va como `set` porque el solver cruza esto con `&` e `in`:
        # meter la lista tal cual no explota acá, revienta mucho más abajo y sin decir
        # una palabra de ajustes.
        if m.id in ajustes_maquinarias:
            rangos_ok = set(ajustes_maquinarias[m.id])
        else:
            # Copia y no el mismo set: `maq_rangos_reales` tiene que seguir diciendo lo
            # que dice Recursos aunque alguien más abajo toque el que va al solver.
            rangos_ok = set(rangos_en_recursos)
        #maquinarias.append((m.id, rangos_ok, m.nombre)) esto funciona
        maquinarias.append((m.id, rangos_ok, m.nombre, m.cod_maquina))


    procesos_para_solver = []
    cant_op_map = {}  # (orden_id, secuencia) -> operarios requeridos por el proceso
    preseleccion_maq = {}  # (orden_id, secuencia) -> id_maquinaria forzada (preselección Metlo)
    preseleccion_op = {}   # (orden_id, secuencia) -> id_operario forzado (elegido al cargar la OT)
    linea_por_clave = {}   # (orden_id, secuencia) -> orden_trabajo_proceso.id (qué pasada es)
    lote_por_clave = {}    # (orden_id, secuencia) -> (min del lote, unidades, faltan) si se achicó
    procesos_sin_rango = {}  # id_proceso -> nombre, para avisar al final
    # id_proceso -> rangos que tiene cargados en Recursos. Se anotan SOLO los procesos
    # ajustados: para todos los demás, lo que entra al solver ya es el dato de Recursos,
    # y meterlos acá cambiaría el botón permanente de avisos que hoy están bien.
    rangos_reales_por_proceso = {}

    # -----------------------
    # Procesar cada orden
    # -----------------------
    for orden in ordenes:
        prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

        # D1: si se eligieron procesos sueltos de esta orden, planificamos solo esos.
        # `lineas_por_orden` elige PASADAS puntuales; `procesos_por_orden` es la forma
        # vieja (por proceso) y se mantiene para los clientes que todavía la mandan.
        _elegidas = _filtrar_lineas_por_orden(orden.procesos, orden.id, lineas_por_orden)
        if _elegidas is None:
            _elegidas = _filtrar_procesos_por_orden(orden.procesos, orden.id, procesos_por_orden)
        _elegidas, _saltado = _sacar_lo_pausado(
            orden, _elegidas, pausas_ot.get(orden.id), pausas_paso)
        if _saltado:
            saltadas_por_pausa.append(_saltado)
        # Los pasos TERMINADOS no se vuelven a planificar. `planificar_pendientes` ya los
        # sacaba; este camino no, así que re-planificar una OT con avance le volvía a
        # repartir horas y personas a trabajo hecho. Desde el piloto (28/9) el taller
        # carga avance: sin esto, cada recálculo de la semana inflaba el plan.
        _elegidas = [rel for rel in _elegidas if getattr(rel, "id_estado", 1) != 3]
        _hechas = unidades_hechas(orden)

        # `secuencia` es la POSICIÓN en la OT, no `rel.orden`: ver _lineas_ordenadas.
        for secuencia, rel in _lineas_ordenadas(_elegidas):
            linea_por_clave[(orden.id, secuencia)] = getattr(rel, "id", None)
            cant_op_map[(orden.id, secuencia)] = max(1, int(getattr(rel, "cant_operarios", 1) or 1))
            # Preselección de máquina: si el proceso tiene máquina elegida, se fuerza en el solver.
            _presel_maq = getattr(rel, "id_maquinaria", None)
            if _presel_maq:
                preseleccion_maq[(orden.id, secuencia)] = _presel_maq
            # Preselección de persona: si en la OT se eligió quién lo hace, se fuerza.
            _presel_op = getattr(rel, "id_operario", None)
            if _presel_op:
                preseleccion_op[(orden.id, secuencia)] = _presel_op

            # Nombre del proceso, con la mayúscula del catálogo. Se guardaba en
            # minúscula y ese es el texto que termina en los avisos del planificador:
            # el taller leía «soldadura con mig» y no reconocía su propio proceso.
            # Bajarlo acá no hacía falta para nada — todo lo que clasifica por nombre
            # (_get_tipo_proceso, familia_requerida_from_proceso, _maquinas_por_nombre)
            # pasa por _norm, que ya normaliza mayúsculas y acentos.
            nombre_proceso = (
                rel.proceso.nombre.strip()
                if rel.proceso and rel.proceso.nombre
                else ""
            )
            # El match por nombre de máquina de más abajo sí compara en minúscula
            # contra el nombre crudo de la máquina, así que se baja ahí y no antes.
            nombre_proceso_lower = nombre_proceso.lower()

            # Duración: solo lo que falta fabricar (ver minutos_de_lo_que_falta).
            dur_min = minutos_de_lo_que_falta(
                rel.tiempo_proceso, nombre_proceso, orden.unidades, _hechas)
            if dur_min != (rel.tiempo_proceso or 1):
                lote_por_clave[(orden.id, secuencia)] = (
                    int(rel.tiempo_proceso or 0), int(orden.unidades or 0),
                    int(orden.unidades or 0) - _hechas)

            # Rangos válidos del proceso. Se leen antes que nada porque de acá sale
            # también si el trabajo se manda afuera.
            rangos_validos = [rp.id_rango for rp in getattr(rel.proceso, "rangos", [])]

            # ...salvo que este plan traiga un ajuste para ese proceso, y entonces
            # mandan los rangos del ajuste. Se aplica ACÁ ARRIBA, antes de todo, porque
            # de `rangos_validos` cuelga lo primero que se decide: si el trabajo se
            # manda afuera (el cruce con TERCERIZADO, tres líneas más abajo). Aplicado
            # después, un proceso al que el ajuste le sacó el rango TERCERIZADO se
            # seguiría yendo afuera igual.
            #
            # El ajuste es por proceso del catálogo, así que vale para TODAS las
            # pasadas de ese proceso en todo el plan, no para una OT sola.
            proceso_ajustado = rel.proceso.id in ajustes_procesos
            if proceso_ajustado:
                # Antes de pisarlos, anotar los de Recursos. El diagnóstico DETECTA las
                # trabas con los rangos ajustados —si el ajuste destrabó una, tiene que
                # desaparecer del panel—, pero su botón «Guardar en Recursos» calcula qué
                # escribir sobre estos: si calculara sobre los ajustados, guardaría
                # también el rango que se agregó solo para este cálculo.
                rangos_reales_por_proceso[rel.proceso.id] = set(rangos_validos)
                rangos_validos = list(ajustes_procesos[rel.proceso.id])

            # Clasificar si usa máquina.
            #
            # La marca de la PASADA le gana a la deducción por nombre: si el que cargó
            # la OT dijo que ese paso va a mano, no hay máquina que buscar por más que
            # el proceso se llame OXICORTE. Antes esto no se podía decir —vacío quería
            # decir "elegila vos"— y el planificador le reservaba una igual.
            usa_maquina = proceso_usa_maquina(
                nombre_proceso,
                es_tercerizado=bool(ids_rango_tercerizado & set(rangos_validos)),
            ) and not getattr(rel, "no_lleva_maquina", 0)
            #esto funciona
            familia_req = familia_requerida_from_proceso(nombre_proceso) if usa_maquina else ""

            # Si NO usa máquina → solo depende de operario
            if not usa_maquina:
                rangos_validos = rangos_validos or []

            # -------------------------------
            # Detectar máquina por coincidencia de nombre
            # SOLO si no hay rangos válidos
            # -------------------------------
            # `not proceso_ajustado`: si el ajuste dejó la lista vacía fue a propósito,
            # y este bloque la volvería a llenar por parecido de nombre. El ajuste se
            # revertiría solo, sin que nada lo diga. Por eso el flag y no un "si quedó
            # vacía": el estado final de la lista no distingue las dos situaciones.
            if not rangos_validos and nombre_proceso_lower and not proceso_ajustado:
                for _, rangos_maquina, nombre_maquina, _cod in maquinarias:

                    if not rangos_maquina:
                        continue

                    nombre_maquina_lower = (
                        nombre_maquina.strip().lower()
                        if nombre_maquina else ""
                    )

                    if nombre_maquina_lower and (
                        nombre_maquina_lower in nombre_proceso_lower or
                        nombre_proceso_lower in nombre_maquina_lower
                    ):
                        rangos_validos = list(rangos_maquina)
                        break

            # Un proceso sin rangos es asignable a CUALQUIERA (más abajo:
            # `if not rangos_proc: operarios_validos = REAL_OP_IDS[:]`). Es lo
            # contrario de lo que uno esperaría: el silencio habilita a todos en vez
            # de a nadie. Se acumula para avisarlo UNA vez al final —son decenas de
            # líneas y un log por línea no lo lee nadie— porque si no el problema es
            # invisible: el plan sale igual, solo que con la persona equivocada.
            # Un proceso ajustado a mano no entra en la lista: el aviso es para los que
            # están sin rango por olvido en Recursos, no para el que acaba de decidir
            # en pantalla que este plan va así.
            if not rangos_validos and not proceso_ajustado:
                procesos_sin_rango[rel.proceso.id] = rel.proceso.nombre or f"#{rel.proceso.id}"

            # -------------------------------
            # Agregar al solver
            # -------------------------------
            procesos_para_solver.append((
                orden.id,               # orden_id
                rel.proceso.id,         # proc_id
                secuencia,              # secuencia (posición en la OT, única)
                orden.fecha_prometida,  # deadline
                prioridad_desc,         # prioridad
                dur_min,                # duración
                rangos_validos,         # rangos permitidos
                nombre_proceso,         # nombre
                usa_maquina,            # si usa máquina o no
                familia_req,
                mapa_skills.get(rel.proceso.id, {}) # op_skill_levels
            ))

            # print(f"PROCESO: {rel.proceso.id} {nombre_proceso} usa_maquina={usa_maquina}")

    if procesos_sin_rango:
        detalle = ", ".join(f"{n} (#{i})" for i, n in sorted(procesos_sin_rango.items(), key=lambda x: x[1]))
        logger.warning(
            f"PLANIFICADOR: {len(procesos_sin_rango)} procesos entran SIN RANGO, así que "
            f"se los puede asignar a CUALQUIER operario: {detalle}. "
            f"Cargales el rango en Recursos > Procesos, o corré "
            f"backend/scripts/auditoria_procesos_sin_rango.py para verlos ordenados por impacto."
        )

    # -------------------------------
    # Ejecutar el solver en otro hilo
    # -------------------------------
    # Si el usuario forzó órdenes excedentes (sea durante preview o confirm),
    # re-corremos el solver SIN cota superior de horizonte para que entren todas.
    # Antes solo aplicaba en confirm — eso impedía ver en la vista previa el impacto
    # real de forzar (la OT seguía como excedente y el usuario no veía cómo se
    # acomodaba en operarios/horarios).
    effective_fecha_hasta = None if forzar_set else fecha_hasta

    # 🔹 SOLO ESTIMAR (Paso 1): con la MISMA entrada que iría al solver, pero sin
    #    resolver, sin escribir y sin auditar. Ver EstimacionPlan.py.
    if solo_estimar:
        from backend.application.EstimacionPlan import estimar_plan
        nombres = {o.id: f"{o.nombre} {o.apellido}".strip() for o in await repo_operario.find_all()}
        estimacion = await asyncio.to_thread(
            estimar_plan, procesos_para_solver, operarios, maquinarias, fecha_desde, fecha_hasta,
            nativas_off, cant_op_map, preseleccion_maq, op_planos, ots_con_plano, skills_manuales,
            calendarios, blocked_dates, preseleccion_op, maquinas_por_proceso, arranque,
            nombres_operario=nombres,
            numero_ot={o.id: (o.id_otvieja or o.id) for o in ordenes},
        )
        con_pasos = {p[0] for p in procesos_para_solver}
        estimacion["ots_sin_procesos"] = sum(1 for o in ordenes if o.id not in con_pasos)
        return estimacion

    resultados, rangos_efectivos = await asyncio.to_thread(
        _resolver_planificacion,
        procesos_para_solver,
        operarios,
        maquinarias,
        fecha_desde,
        effective_fecha_hasta,
        nativas_off,
        cant_op_map,
        preseleccion_maq,
        op_planos,
        ots_con_plano,
        skills_manuales,
        calendarios,
        blocked_dates,
        preseleccion_op,
        maquinas_por_proceso,
        # Sólo para el log del presupuesto: el cálculo va por procesos, pero el
        # taller (y la tabla planificacion_intento) hablan en OTs, y cruzar las dos
        # cifras es lo primero que uno quiere cuando una corrida se satura.
        len(ordenes),
        # El arranque del plan, calculado una sola vez acá arriba. Es el mismo que
        # viaja a la pantalla y el que se guarda al confirmar.
        arranque,
    )

    _marcar_lineas(resultados, linea_por_clave, lote_por_clave)
    planificados, excedentes = _split_resultados(resultados)

    # Diagnóstico de lo que traba el plan. El import va acá adentro porque el módulo
    # de diagnóstico usa helpers de este archivo y a nivel de módulo sería circular.
    from backend.application.DiagnosticoPlanificacion import construir_diagnosticos

    try:
        rangos_all = await RangoRepository(db).find_all()
        operarios_all = await repo_operario.find_all()
        diagnosticos = construir_diagnosticos(
            procesos_para_solver,
            operarios,
            maquinarias,
            resultados,
            nombre_rango={r.id: r.nombre for r in rangos_all},
            nombre_operario={o.id: f"{o.nombre} {o.apellido}".strip() for o in operarios_all},
            skills_manuales=skills_manuales,
            nativas_off=nativas_off,
            # El plano es filtro DURO en el solver: si la OT tiene plano y nadie
            # de los habilitados sabe leerlo, el proceso sale sin operario y sin
            # máquina. Sin estos dos datos el diagnóstico creía que había gente
            # disponible y se comía el caso sin explicarlo.
            ots_con_plano=ots_con_plano,
            op_planos=op_planos,
            # Rangos que el solver usó de verdad (el SETUP hereda los de su
            # producción). Explicar con los rangos crudos mandaba a corregir el
            # dato equivocado: "preparacion de fresadora está cargado con MEDIO
            # OFICIAL" cuando el solver había filtrado por OFICIAL CNC.
            rangos_efectivos=rangos_efectivos,
            # El mismo mapa con el que el solver prefiere la habilidad principal
            # (PENAL_SKILL1=0 vs PENAL_SKILL2=2000). Va al diagnóstico para que una
            # solución que habilita a nueve pueda decir quién la va a tomar: sin esto,
            # "se las abrís a 9 personas" se lee como reparto parejo (Lucas, 28/08).
            prioridad_skills=mapa_skills,
            # Los datos SIN los ajustes «solo en este plan». Las trabas se detectan con
            # los ajustados (ver arriba), pero lo que el botón permanente escribiría en
            # la base —y lo que el panel de confirmación muestra como «hoy tiene»— sale
            # de estos: son los únicos que dicen la verdad sobre Recursos.
            maq_rangos_reales=maq_rangos_reales,
            rangos_reales_por_proceso=rangos_reales_por_proceso,
        )

        # Las OTs de los diagnósticos salen con su número VISIBLE (id_otvieja), que
        # es el único que muestra la app en las listas. Adentro del solver viven los
        # ids internos, y dejarlos pasar a pantalla ya confundió una vez: el aviso
        # decía "OTs afectadas: 842, 7492" y buscar esos números en la lista no
        # encontraba nada.
        nro_visible = {o.id: (o.id_otvieja or o.id) for o in ordenes}
        for d in diagnosticos:
            d["impacto"]["ots"] = [nro_visible.get(i, i) for i in d["impacto"]["ots"]]
    except Exception as e:
        # Un diagnóstico que falla no puede tumbar una planificación que salió bien.
        logger.error(f"Service - No se pudieron construir los diagnósticos: {e}")
        diagnosticos = []

    # RF-03: lo que quedó afuera por estar pausado, con el formato de los demás avisos.
    # Va aparte del bloque de arriba a propósito: si el diagnóstico de trabas falla, que
    # el plan no avise que dejó una OT afuera sería peor que no tener las trabas.
    if saltadas_por_pausa:
        try:
            from backend.application.DiagnosticoPlanificacion import (
                diagnosticos_de_pausas, ordenar_diagnosticos,
            )
            _nro = {o.id: (o.id_otvieja or o.id) for o in ordenes}
            avisos_pausa = diagnosticos_de_pausas(saltadas_por_pausa)
            for d in avisos_pausa:
                d["impacto"]["ots"] = [_nro.get(i, i) for i in d["impacto"]["ots"]]
            diagnosticos = ordenar_diagnosticos(diagnosticos + avisos_pausa)
        except Exception as e:
            logger.error(f"Service - No se pudieron armar los avisos de lo pausado: {e}")

    if preview:
        # `inicio_base` viaja a la pantalla y vuelve al confirmar: es lo que ata las
        # fechas que se miran a las fechas que se guardan.
        return {"planificados": planificados, "excedentes": excedentes,
                "diagnosticos": diagnosticos, "inicio_base": arranque.isoformat()}

    # Marcar como forzado_fuera_rango los procesos cuyas órdenes el usuario decidió forzar
    for r in planificados:
        r["forzado_fuera_rango"] = (r["orden_id"] in forzar_set)

    saved = await repo_planificacion.insertar_planificacion_lote(planificados, inicio_base=arranque)
    return {"planificados": saved, "excedentes": excedentes, "diagnosticos": diagnosticos,
            "inicio_base": arranque.isoformat()}

async def planificar_pendientes(
        repo_orden,
        repo_operario,
        repo_maquinaria,
        repo_planificacion,
        db,
        ordenes_ids: list[int] | None = None,
        repo_skill: OperarioProcesoSkillRepository | None = None,
        fecha_desde: date | None = None,
        fecha_hasta: date | None = None,
    ):
        logger.info(f"Service - Planificación de procesos pendientes. rango: desde={fecha_desde} hasta={fecha_hasta}")
        
        if not repo_skill:
            repo_skill = OperarioProcesoSkillRepository(db)
        
        mapa_skills = await repo_skill.get_map_por_proceso()
        # 🔹 Qué rango significa "esto se manda afuera". Se resuelve por nombre y una
        #    sola vez: el id no está fijo y hardcodearlo rompe en la próxima migración.
        ids_rango_tercerizado = {
            r.id for r in await RangoRepository(db).find_all()
            if _norm(r.nombre or "") in ("TERCERIZADO", "EXTERNO")
        }
        # 🔹 Igual que en planificar(): los dos entry points arman su lista por separado
        #    y si el dato se carga en uno solo, el mismo proceso se planifica distinto
        #    según por dónde entró.
        maquinas_por_proceso = await ProcesoRepository(db).find_maquinarias_por_proceso()
        nativas_off = await repo_skill.get_nativas_deshabilitadas()
        skills_manuales = await repo_skill.get_manuales_por_proceso()

        # 🔹 SOLO órdenes con procesos pendientes
        ordenes = await repo_orden.find_with_pending_procesos(ordenes_ids)

        if not ordenes:
            logger.info("Service - No hay procesos pendientes para planificar.")
            return []

        # RF-03: lo pausado tampoco se re-planifica. Este camino no devuelve avisos
        # (la pantalla que lo llama no los muestra), así que queda en el log.
        pausas_ot, pausas_paso = _indexar_pausas(
            await PausaRepository(db).abiertas_sin_romper([o.id for o in ordenes]))

        operarios = await repo_operario.find_with_rangos()
        op_planos = await repo_operario.find_interpreta_planos()
        calendarios = calendarios_de_operarios(await repo_operario.find_all())
        blocked_dates = await DiaBloqueadoRepository(db).listar()

        # OTs con plano REALMENTE adjunto (tabla `plano`, no la bandera del legacy).
        ots_con_plano = await PlanoRepository(db).find_ordenes_con_plano()

        maquinarias_orm = await repo_maquinaria.find_with_rangos()
        #maquinarias = [
        #    (m.id, {rm.id_rango for rm in (m.rango_maquinarias or [])}, m.nombre)
        #    for m in maquinarias_orm
        #]
        maquinarias = [
            (m.id, {rm.id_rango for rm in (m.rango_maquinarias or [])}, m.nombre, m.cod_maquina)
            for m in maquinarias_orm
        ]


        procesos_para_solver = []
        cant_op_map = {}  # (orden_id, secuencia) -> operarios requeridos por el proceso
        linea_por_clave = {}   # (orden_id, secuencia) -> orden_trabajo_proceso.id
        procesos_sin_rango = {}  # id_proceso -> nombre, para avisar al final

        for orden in ordenes:
            prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

            _pendientes = [rel for rel in orden.procesos if rel.id_estado != 3]
            _pendientes, _saltado = _sacar_lo_pausado(
                orden, _pendientes, pausas_ot.get(orden.id), pausas_paso)
            if _saltado:
                logger.info(
                    f"PLANIFICADOR (pendientes): OT {_saltado['numero']} pausada "
                    f"({_saltado['pausa'].motivo}): {_saltado['procesos']} pasos quedan afuera.")
            for secuencia, rel in _lineas_ordenadas(_pendientes):
                linea_por_clave[(orden.id, secuencia)] = getattr(rel, "id", None)
                cant_op_map[(orden.id, secuencia)] = max(1, int(getattr(rel, "cant_operarios", 1) or 1))
                nombre_proceso = rel.proceso.nombre.strip() if rel.proceso else ""
                # Solo lo que falta fabricar, igual que en planificar().
                dur_min = minutos_de_lo_que_falta(
                    rel.tiempo_proceso, nombre_proceso, orden.unidades, unidades_hechas(orden))
                usa_maquina = proceso_usa_maquina(nombre_proceso)
                rangos_validos = [rp.id_rango for rp in getattr(rel.proceso, "rangos", [])]
                familia_req = familia_requerida_from_proceso(nombre_proceso) if usa_maquina else ""
                # Sin rangos = asignable a cualquiera. Acá ni siquiera está el rescate
                # por nombre de máquina que sí hace planificar(), así que el aviso
                # importa más todavía.
                if not rangos_validos:
                    procesos_sin_rango[rel.proceso.id] = rel.proceso.nombre or f"#{rel.proceso.id}"
                #agregue familia req
                procesos_para_solver.append((
                    orden.id,
                    rel.proceso.id,
                    secuencia,
                    orden.fecha_prometida,
                    prioridad_desc,
                    dur_min,
                    rangos_validos,
                    nombre_proceso,
                    usa_maquina,
                    familia_req,
                    mapa_skills.get(rel.proceso.id, {}) # op_skill_levels
                ))

        if procesos_sin_rango:
            detalle = ", ".join(f"{n} (#{i})" for i, n in sorted(procesos_sin_rango.items(), key=lambda x: x[1]))
            logger.warning(
                f"PLANIFICADOR (pendientes): {len(procesos_sin_rango)} procesos entran SIN "
                f"RANGO, así que se los puede asignar a CUALQUIER operario: {detalle}."
            )

        resultados, _rangos_efectivos = await asyncio.to_thread(
            _resolver_planificacion,
            procesos_para_solver,
            operarios,
            maquinarias,
            fecha_desde,
            fecha_hasta,
            nativas_off,
            cant_op_map,
            None,           # preseleccion_maq: no aplica en pendientes
            op_planos,
            ots_con_plano,
            skills_manuales,
            calendarios,
            blocked_dates,
            maquinas_por_proceso=maquinas_por_proceso,
            cant_ordenes=len(ordenes),
        )

        _marcar_lineas(resultados, linea_por_clave)
        planificados, excedentes = _split_resultados(resultados)
        saved = await repo_planificacion.insertar_planificacion_lote(planificados)
        return {"planificados": saved, "excedentes": excedentes}
