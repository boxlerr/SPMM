# backend/application/PlanificacionService.py
import asyncio
import os
from ortools.sat.python import cp_model
from datetime import datetime, time,date

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


HORA_APERTURA = time(7, 0)

# Una ventana del horizonte. `ini`/`fin` son minutos del timeline comprimido; el resto
# ubica la ventana en el calendario para poder cruzarla con el horario de cada persona.
Ventana = namedtuple("Ventana", "ini fin weekday ini_dia fin_dia")

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
    """
    Construye las ventanas horarias del horizonte.
    Si `fecha_hasta` viene, limita el horizonte a (fecha_hasta - start_date) días INCLUSIVE.
    Si no, usa num_semanas * 7 días (comportamiento previo).
    """
    ventanas = []

    current_date = start_date
    # Find next Monday to align with generic week structure if needed? 
    # Actually, the logic below 'semana * MIN_LABORAL_SEMANA' assumes generic weeks starting Mon.
    # BUT, the solver starts at T=0.
    # If T=0 is Wednesday, then day 0 is Wednesday.
    # But the loop below `for dia in range(5)` implies structure: 5 days work, 1 day sat.
    # If we want to align with real calendar, we must iterate DAY BY DAY from T=0 up to Horizon.
    # Re-writing to be day-based instead of generic week based is safer for specific dates.
    
    # Calculate total days needed roughly
    if fecha_hasta is not None:
        # Rango cerrado: contar días desde start_date hasta fecha_hasta inclusive
        total_days = max(1, (fecha_hasta - start_date).days + 1)
    else:
        total_days = num_semanas * 7
    
    accumulated_minutes = 0
    
    # Check what T=0 implies. T=0 is the start of the first window?
    # No, T=0 is "Now" (or projected start).
    # If "Now" is Wed 10am, and we add a window (0, 120), that means Wed 10am-12pm.
    
    # We need to act carefully to not break existing relative timeline.
    # EXISTING LOGIC:
    # 5 days of TRAMOS_LV_LAB (495 mins each)
    # 1 day of TRAMOS_SAB_LAB (300 mins)
    # Total 2775 mins/week.
    
    # We will iterate days. If a day is blocked, we simply DO NOT add its windows to the list.
    # But we must continue incrementing 'base_time' (accumulated minutes)?
    # NO. If a day is blocked, it adds ZERO capacity.
    # BUT, T=0 and T=100 are relative minutes of *utilized* time? 
    # Or absolute clock time?
    # OptionalIntervalVar uses Size (duration). 
    # Windows constrain Start time.
    # If I skip a day, the 'clock' (relative time) shouldn't skip?
    # In CP-SAT for scheduling, usually the timeline is continuous.
    # If I say "Window 1: 0-495", "Window 2: 1000-1495". 
    # Gaps are non-working time.
    # So if Tuesday is blocked, I create a larger gap between Mon and Wed.
    
    # We need to map [0, H] timeline to Calendar Days.
    # Let's assume T=0 aligns with `start_date` at 7:00 AM (or whatever start hour).
    
    # Correct iteration:
    current_iter_date = start_date
    current_base_minutes = 0
    
    # We iterate enough days to cover the horizon
    # 5 weeks ~ 35 days.
    
    for _ in range(total_days): # Iterate calendar days
        day_str = current_iter_date.strftime("%Y-%m-%d")
        weekday = current_iter_date.weekday() # 0=Mon, 6=Sun
        
        # Determine schedule for this day
        tramos = []
        if weekday < 5: # Mon-Fri
            tramos = TRAMOS_LV_LAB # [(0, 120), ...] relative to day start
            day_capacity = MIN_LABORAL_DIA
        elif weekday == 5: # Sat
            tramos = TRAMOS_SAB_LAB
            day_capacity = MIN_LABORAL_SABADO
        else:
            tramos = [] # Sun
            day_capacity = 0
            
        # CHECK BLOCKING
        if day_str in blocked_dates:
            logger.info(f"DIA BLOQUEADO: {day_str} (skipped)")
            tramos = [] # Blocked!
            # We still advance the "clock" if the clock was absolute?
            # The solver's variable 'start' is an integer.
            # If we want 'start' to represent working minutes, it's one thing.
            # If 'start' represents ABSOLUTE minutes from T=0, it's another.
            # _convertir_minutos_a_fecha's logic suggests 'start' is WORKING minutes?
            # "minutos_acumulados".
            # If 'start' is working minutes, we don't need windows?
            # Wait, `_agregar_no_solape_operarios` uses `dur_map` (duration in working minutes).
            # `opt_interval = model.NewOptionalIntervalVar(start, dur, end, pres, ...)`
            # If `start` and `end` are working minutes (compressed time), then we don't need gaps.
            # BUT `_agregar_ventanas_horarias` constrains `start`.
            # If we use windows, `start` is usually REAL TIME (absolute).
            # Let's check `construir_ventanas_semanales` original output.
            # It returns `(base_dia + ini, base_dia + fin)`. 
            # base_dia increases by MIN_LABORAL_DIA (495).
            # This implies the timeline is COMPRESSED into working minutes.
            # i.e. Minute 495 is End of Mon, Minute 496 is Start of Tue.
            # THERE ARE NO GAPS FOR NIGHTS in the variable domain explicitly?
            # `ventanas` checks: `start >= v_ini` and `start < v_fin`.
            # If `v_fin` of Day 1 is 495, and `v_ini` of Day 2 is 495.
            # Then they are contiguous.
            
            # CONCLUSION: The solver works in "Working Minutes" space (Continuous).
            # 0 = Start Mon. 495 = End Mon/Start Tue.
            # Nights/Weekends don't exist in the timeline integers.
            
            # SO, to "Block" a day (Friday):
            # We must NOT generate capacity for it.
            # Real calendar time: Mon, Tue, Wed, Thu, Fri(Blocked), Sat, Sun, Mon.
            # Working timeline: [MonChunk][TueChunk][WedChunk][ThuChunk][SatChunk][MonChunk]...
            # The "FridayChunk" is simply missing from the sequence.
            # And `start_date` logic in `_convertir_minutos_a_fecha` must know this to map back correctly?
            # YES.
            # If we skip Fri in the solver, the solver sees [Thu][Sat].
            # But `_convertir_minutos_a_fecha` blindly skips weekends but doesn't know about custom blocks.
            # Crucial: We must also update `_convertir_minutos_a_fecha` (or equivalent) to respect blocked dates!
            # AND `construir_ventanas_semanales` defines the constraint structure.
            
            # WAIT.
            # If `start` is working minutes.
            # `model.Add(sum(en_ventana) == 1)` forces task to fall into a specific 'bucket'.
            # Trams LV: (0, 120), (120, 285)...
            # These buckets partition the continuous working timeline.
            # If we want to skip Friday:
            # We simply DO NOT create constraints for Friday?
            # No. The working timeline is just a sequence of minutes.
            # If we skip Friday, the minutes that WOULD have assigned to Friday should just belong to Saturday.
            # i.e. Minute X corresponds to Thu 16:00. Minute X+60 corresponds to Sat 07:00 (since Fri is skipped).
            # This mapping is done by `_convertir_minutos_a_fecha`.
            # The Solver doesn't care about "Friday". It creates a sequence of tasks.
            # The 'Ventanas' constraints seem to enforce "Breaks" within a day?
            # Original: (0, 120) ... (285, 495). 
            # These are contiguous! (0-120, 120-285, 285-495).
            # So the constraint basically forces the task to be within a sub-block?
            # Maybe to align with breaks (Lunch)?
            # If we skip a day, we just don't contribute its "chunks" to the `_convertir_minutos_a_fecha` mapping.
            
            # PROBLEM: `construir_ventanas_semanales` is used to build constraints.
            # `_convertir_minutos_a_fecha` is used to display result.
            # They must be in sync.
            
            # STRATEGY:
            # 1. We keep the solver logic mostly as is (working minutes).
            # 2. We need to tell `_convertir_minutos_a_fecha` about blocked dates so it skips them when projecting minutes -> date.
            # 3. Does `construir_ventanas_semanales` actually affect *which* day it is?
            # It builds `ventanas`.
            # (0, 120), (120, 285)...
            # It just segments the timeline.
            # If we have 5 days, we have 5 * 3 = 15 segments.
            # If Friday is blocked, do we have 4 days?
            # Yes. The timeline is shorter (or represents different days).
            # But the 'Weeks' structure in `construir_ventanas_semanales` logic (lines 40-54) hardcodes "5 days + 1 Sat".
            # I must change this to dynamic iteration logic.
            
            pass 
            
        elif weekday == 5 and not incluir_sabado:
            # Nadie trabaja los sábados: el día no aporta capacidad. Antes se generaba
            # igual y el modelo se creía 300 minutos por persona por semana que no
            # existen, con lo cual toda fecha prometida salía optimista.
            logger.info(f"SABADO SIN GENTE: {day_str} (sin ventanas)")
        else:
             # Add segments for this day. Se guarda además el día de la semana y el
             # tramo dentro del día: hace falta para poder decir "este operario no
             # trabaja los sábados" o "no entra antes de las 9".
             for ini, fin in tramos:
                 ventanas.append(Ventana(
                     ini=current_base_minutes + ini,
                     fin=current_base_minutes + fin,
                     weekday=weekday,
                     ini_dia=ini,
                     fin_dia=fin,
                 ))

             # Advance base minutes
             day_duration = MIN_LABORAL_DIA if weekday < 5 else MIN_LABORAL_SABADO
             current_base_minutes += day_duration
        
        # Advance calendar
        current_iter_date += timedelta(days=1)
        
    return ventanas

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


def _partir_procesos_largos(procesos_norm, cant_op_map=None, preseleccion_maq=None):
    """Parte los procesos que no entran en ningún tramo laboral.

    Un proceso de 12 horas no cabe en ninguna ventana, así que el modelo lo dejaba
    afuera y —por la cadena de presencia— se llevaba puesto todo el resto de la OT.
    En la corrida de prueba eso dejaba fuera 103 de 241 procesos con la fábrica a
    menos de la mitad de su capacidad.

    Acá el proceso se corta en partes que sí entran en el horario disponible. Las
    partes quedan encadenadas (una detrás de la otra) y, en el modelo, atadas al
    MISMO operario y la MISMA máquina, así que sigue siendo un solo trabajo hecho
    por una sola persona: lo único que cambia es que ocupa varios tramos.

    El corte es parejo (750 min -> 3 partes de 250, no 270+270+210) para que no
    quede una última parte mínima colgando y para repartir mejor entre días.

    Devuelve (procesos_norm, cant_op_map, preseleccion_maq, partes), donde `partes`
    mapea la clave original a las claves nuevas:
        {(orden_id, secuencia_orig): {"orig": tupla, "claves": [(orden_id, sec_new), ...]}}
    """
    cant_op_map = cant_op_map or {}
    preseleccion_maq = preseleccion_maq or {}

    nuevos, partes = [], {}
    nuevo_cant_op, nueva_presel = {}, {}

    for proc in procesos_norm:
        (orden_id, proc_id, secuencia, fecha_prometida, peso, dur,
         rangos, nombre, usa_maquina, familia, skills) = proc

        n_partes = max(1, math.ceil(dur / MAX_MIN_TRAMO))
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

        partes[clave_orig] = {"orig": proc, "claves": claves}

        if len(duraciones) > 1:
            logger.info(
                f"PLANIFICADOR: '{nombre}' de la OT {orden_id} dura {dur} min y no entra "
                f"en un tramo (máx {MAX_MIN_TRAMO}); se parte en {len(duraciones)} tramos "
                f"de {duraciones} min, mismo operario y misma máquina."
            )

    return nuevos, nuevo_cant_op, nueva_presel, partes


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
    op_planos = op_planos or {}
    ots_con_plano = ots_con_plano or set()
    skills_manuales = skills_manuales or {}

    op_to_rango = {op_id: r_id for (op_id, r_id) in operarios}
    REAL_OP_IDS = [op_id for (op_id, _) in operarios]
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

        # Variable de operario
        op_var = model.NewIntVarFromDomain(
            cp_model.Domain.FromValues(operarios_validos),
            f"op_{orden_id}_{secuencia}"
        )

        # ✔ REGISTRAR OPERARIOS ANTES DE ABANDONAR LA ITERACIÓN
        op_domain_vals[(orden_id, secuencia)] = operarios_validos[:]
        operario_vars[(orden_id, secuencia)] = op_var

        # Slots extra de operario si el proceso requiere más de 1 persona.
        # Mismo dominio que el principal (incluye DUMMY para casos sin gente suficiente).
        k_ops = int(cant_op_map.get((orden_id, secuencia), 1) or 1)
        if k_ops > 1:
            extras = []
            for j in range(1, k_ops):
                ev = model.NewIntVarFromDomain(
                    cp_model.Domain.FromValues(operarios_validos),
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
            # 1. Filtrar por familia requerida si existe
            candidates = REAL_MAQ_IDS[:]
            
            if familia_req:
                candidates = [m for m in candidates if maq_to_familia.get(m) == familia_req]
            
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


def _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars=None):
    """
    Fuerza a que procesos coordinados (ej: Programacion + Produccion)
    usen la misma máquina y, si se pasa `operario_vars`, el MISMO operario
    (el que prepara la máquina es el que la usa). Ver A2 (feedback 06/07).

    Solo para pares realmente relacionados: ver _setup_de_esta_produccion.
    """
    # Agrupar por OT
    ord_ids = set(p[0] for p in procesos_norm)
    for oid in ord_ids:
        # Procesos de esta OT ordenados por secuencia
        p_order = sorted([p for p in procesos_norm if p[0] == oid], key=lambda x: x[2])
        
        for i in range(len(p_order) - 1):
            act = p_order[i]
            sig = p_order[i+1]
            
            # (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc, nombre_proceso,usa_maquinaria, familia_req, op_skill)
            seq_a  = act[2]
            name_a = act[7]
            usa_m_a= act[8]
            
            seq_s  = sig[2]
            name_s = sig[7]
            usa_m_s= sig[8]
            
            # Si el actual es la preparación del siguiente (misma familia de máquina)
            # Y ambos están marcados para usar máquina
            if _setup_de_esta_produccion(act, sig) and usa_m_a and usa_m_s:
                # Forzamos igualdad de la variable de máquina
                model.Add(maq_vars[(oid, seq_a)] == maq_vars[(oid, seq_s)])
                logger.info(f"COORDINACIÓN: Vinculando máquinas de Seq {seq_a} ({name_a}) y Seq {seq_s} ({name_s}) en OT {oid}")
                # A2 (feedback 06/07): preparación y producción deben ser el MISMO operario.
                # Son consecutivos en la secuencia (fin_setup <= inicio_prod), así que no hay
                # solape temporal y la igualdad es factible. OJO: si el setup no tiene operario
                # apto y cae en DUMMY, arrastra la producción a DUMMY también (queda visible
                # como "sin asignar", que es el comportamiento esperado).
                if operario_vars is not None:
                    model.Add(operario_vars[(oid, seq_a)] == operario_vars[(oid, seq_s)])
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
    op_to_rangos = op_to_rangos or {}
    skills_manuales = skills_manuales or {}
    for (orden_id, proc_id, secuencia, _fp,
        _pp, _dur, rangos_proc, _nombre_proc, usa_maquina,familia_req, _skills) in procesos_norm:

        op_var = operario_vars[(orden_id, secuencia)]
        maq_var = maq_vars[(orden_id, secuencia)]

        ops_dom  = op_domain_vals[(orden_id, secuencia)]
        maqs_dom = maq_domain_vals[(orden_id, secuencia)]

        # ❌ Proceso manual → no usa máquina real
        if not usa_maquina:
            allowed_pairs = [
                [op_id, DUMMY_MAQ_ID] for op_id in ops_dom
            ]
            model.AddAllowedAssignments([op_var, maq_var], allowed_pairs)
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

        model.AddAllowedAssignments([op_var, maq_var], allowed_pairs)



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
):
    # Pesos de prioridad para excedentes (más agresivo: prio 1 vale 100x prio 5)
    PESO_EXCED_POR_PRIO = {1: 10000, 2: 5000, 3: 1000, 4: 300, 5: 100}
    W_FUERA = 100_000_000
    """
    Construye la lista total_obj con todos los términos de la función objetivo
    y la añade al modelo.
    """
    total_obj = []
    now = datetime.now()

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
        end = fin_vars[(orden_id, secuencia)]
        if fecha_prometida:
            try:
                if isinstance(fecha_prometida, str):
                    fp_dt = datetime.fromisoformat(fecha_prometida)
                elif isinstance(fecha_prometida, date) and not isinstance(fecha_prometida, datetime):
                    fp_dt = datetime.combine(fecha_prometida, time.min)
                else:
                    fp_dt = fecha_prometida
                if fp_dt.date() < date(1970, 1, 1):
                    deadline_rel = H * 10
                else:
                    delta_min = int((fp_dt - now).total_seconds() // 60)
                    deadline_rel = min(max(0, delta_min), H * 10)
            except Exception as e:
                logger.warning(f"Error parseando fecha prometida: {e}. Usando deadline fallback.")
                deadline_rel = H * 10
        else:
            deadline_rel = H * 10

        diff = model.NewIntVar(-H * 10, H * 10, f"diff_{orden_id}_{secuencia}")
        model.Add(diff == end - deadline_rel)

        lateness = model.NewIntVar(0, H * 10, f"late_{orden_id}_{secuencia}")
        model.AddMaxEquality(lateness, [diff, 0])

        mult = atraso_mult_por_prioridad.get(peso_prioridad, 200)

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

    model.Minimize(sum(v * c for (v, c) in total_obj))


def _convertir_minutos_a_fecha(minutos_acumulados: int, ahora_ref=None, blocked_dates=None):
    """
    Convierte minutos de trabajo lógicos a una fecha real del calendario físico.

    La jornada sale de TRAMOS_LV_LAB / TRAMOS_SAB_LAB, no de números sueltos: es la
    misma que usa el solver para armar las ventanas. Antes acá había una copia con
    555 y 105 escritos a mano, así que un día entero de trabajo caía a las 18:00
    —dos horas después de que el taller cierra— y la fecha prometida al cliente
    heredaba ese error.
    """
    from datetime import timedelta

    # Los días bloqueados llegan de afuera (los lee el servicio, que sí tiene sesión de
    # base). Antes esta función abría el archivo de configuración cada vez que la
    # llamaban: dos lecturas de disco POR FILA del resultado.
    blocked_dates = set(blocked_dates or ())

    ahora = ahora_ref if ahora_ref else datetime.now()
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

        if minutos_restantes >= capacidad_hoy:
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
            fecha_fin_est = _convertir_minutos_a_fecha(fin_m, start_time_ref, blocked_dates)

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
# Solver principal (refactorizado)
# ------------------------------------------------------------

def _resolver_planificacion(procesos, operarios, maquinarias, fecha_desde: date | None = None, fecha_hasta: date | None = None, nativas_off=None, cant_op_map=None, preseleccion_maq=None, op_planos=None, ots_con_plano=None, skills_manuales=None, calendarios=None, blocked_dates=None):
    model = cp_model.CpModel()

    # Los días bloqueados los trae el servicio desde la base (ver DiaBloqueadoRepository).
    blocked_dates = list(blocked_dates or ())
    logger.info(f"PLANIFICADOR: Fechas bloqueadas cargadas: {blocked_dates}")

    # Determine start date
    ahora = datetime.now()
    if fecha_desde is None or fecha_desde <= ahora.date():
        # Default: hoy con ajuste por hora
        inicio_base = ahora
        if inicio_base.hour < 7:
            inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
        elif inicio_base.hour >= 17:
            inicio_base = inicio_base + timedelta(days=1)
            inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
    else:
        # fecha_desde futura: arrancar 07:00 de ese día
        inicio_base = datetime.combine(fecha_desde, time(7, 0))

    # Saltar fin de semana y días bloqueados desde el candidato
    blocked_set = set(blocked_dates)
    while inicio_base.weekday() >= 5 or inicio_base.strftime("%Y-%m-%d") in blocked_set:
        inicio_base += timedelta(days=1)
        inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)

    start_date = inicio_base.date()
    logger.info(f"PLANIFICADOR: start_date efectivo = {start_date} (fecha_desde solicitada = {fecha_desde})")


    # ---- Parámetros ----
    prioridad_pesos = {"urgente": 1, "urgente 1": 1, "urgente 2": 2, "normal": 3, "baja": 4}
    atraso_mult_por_prioridad = {1: 1000, 2: 800, 3: 500, 4: 300, 5: 200}

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
    PENAL_DUMMY = 1_000_000
    PENAL_DUMMY_MAQ = 1_000_000

    # ---- Normalizar procesos ----
    procesos_norm, H_local = _normalizar_procesos(procesos, prioridad_pesos)

    # ---- Partir los que no entran en un tramo laboral ----
    # H no cambia: la suma total de trabajo es la misma, solo se reparte en más piezas.
    procesos_norm, cant_op_map, preseleccion_maq, partes = _partir_procesos_largos(
        procesos_norm, cant_op_map, preseleccion_maq
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
    procesos_norm_list = [list(p) for p in procesos_norm]
    for oid in set(p[0] for p in procesos_norm):
        idxs = sorted([i for i, p in enumerate(procesos_norm) if p[0] == oid], key=lambda i: procesos_norm[i][2])
        for j in range(len(idxs)-1):
            idx_a = idxs[j]
            idx_s = idxs[j+1]
            if _setup_de_esta_produccion(procesos_norm[idx_a], procesos_norm[idx_s]):
                # Heredar familia (idx 9) y rangos (idx 6)
                procesos_norm_list[idx_a][9] = procesos_norm[idx_s][9]
                procesos_norm_list[idx_a][6] = procesos_norm[idx_s][6]
    procesos_norm = [tuple(p) for p in procesos_norm_list]

    # H se usa en helpers (lo hago global dentro de esta función)
    global H
    H = H_local

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
    )

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
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars, operario_vars)
    _agregar_continuidad_partes(model, partes, operario_vars, maq_vars, op_extra_vars)
    # ---- Crear ventanas semanales ----
    # ¿Trabaja alguien los sábados? Si no, el día no aporta capacidad y hay que contar
    # más semanas para el mismo trabajo; si lo dejáramos como antes, el horizonte se
    # quedaría corto y sobrarían procesos por una razón inventada.
    # Solo los que entran al plan: `calendarios` viene de todos los operarios, y los
    # que no están disponibles no tienen ni dominio ni no-solape, así que restringirles
    # ventanas sería agregar restricciones sobre alguien que no existe para el modelo.
    calendarios = {op: c for op, c in (calendarios or {}).items() if op in set(REAL_OP_IDS)}
    hay_sabado = any(5 in c["dias"] for c in calendarios.values()) if calendarios else True
    min_semana = 5 * MIN_LABORAL_DIA + (MIN_LABORAL_SABADO if hay_sabado else 0)

    num_semanas = math.ceil(H / min_semana) + 1
    ventanas = construir_ventanas_semanales(
        num_semanas, start_date, blocked_dates, fecha_hasta=fecha_hasta, incluir_sabado=hay_sabado
    )
    con_horario_propio = sum(
        1 for c in calendarios.values()
        if c["desde"] > 0 or c["hasta"] < MIN_LABORAL_DIA or c["dias"] != {0, 1, 2, 3, 4}
    )
    logger.info(
        f"PLANIFICADOR: ventanas generadas = {len(ventanas)} (fecha_hasta={fecha_hasta}, "
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
    )


    # ---- Resolver ----
    solver = cp_model.CpSolver()
    # Presupuesto de tiempo y de hilos ajustados a la máquina REAL, no a la de
    # desarrollo. Esto estaba fijo en 8 workers, pensado para una laptop: en Cloud
    # Run el servicio tiene 1-2 vCPU, así que 8 hilos peleándose la misma CPU hacían
    # al solver MÁS lento (el intento de Lucas del 15/08 se comió los 60s enteros
    # para 6 OTs que localmente salen en 10s) y multiplicaban la memoria — cada
    # worker mantiene su propia copia del modelo, y el contenedor murió por OOM con
    # 1115 MiB. Con workers = cpus, en Cloud Run son 2 y en la laptop los que haya.
    solver.parameters.max_time_in_seconds = int(os.getenv("SOLVER_MAX_SEG", "60"))
    solver.parameters.num_search_workers = int(os.getenv("SOLVER_WORKERS", "0")) or max(2, min(8, os.cpu_count() or 2))
    solver.parameters.log_search_progress = False

    # Corte por estancamiento: si el solver lleva un rato sin encontrar nada mejor,
    # se corta y se usa lo que hay. Sin esto, el tiempo de respuesta era SIEMPRE el
    # máximo (60s): la solución final aparecía a los pocos segundos y el resto era
    # el solver intentando demostrar que no hay nada mejor — una garantía que al
    # taller no le cambia el plan pero sí lo tiene un minuto mirando el spinner.
    import threading
    import time as _t

    _ultima_mejora = {"t": None}

    class _RegistroMejoras(cp_model.CpSolverSolutionCallback):
        def on_solution_callback(self):
            _ultima_mejora["t"] = _t.monotonic()

    corte_seg = int(os.getenv("SOLVER_CORTE_SIN_MEJORA_SEG", "10"))
    _fin_vigia = threading.Event()

    def _vigia():
        while not _fin_vigia.wait(1.0):
            ultima = _ultima_mejora["t"]
            if ultima is not None and (_t.monotonic() - ultima) > corte_seg:
                # stop_search es el camino documentado para frenar desde otro hilo.
                getattr(solver, "stop_search", getattr(solver, "StopSearch", lambda: None))()
                return

    hilo_vigia = threading.Thread(target=_vigia, daemon=True)
    hilo_vigia.start()
    try:
        status = solver.Solve(model, _RegistroMejoras())
    finally:
        _fin_vigia.set()

    ahora_ref = inicio_base

    # ---- Extraer resultados ----
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

    return resultados

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

    # Caso especial: Soldadura? Por defecto soldadura a veces no tiene máquina especifica en BD,
    # pero si hay máquinas de soldar, se deberia agregar aqui. 
    # Por ahora no se pidió explícitamente Soldadura como familia de máquina crítica, 
    # pero el usuario pasó lista.
    
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
        "ENDEREZ", "PINTU", "ARMADO", "AJUSTE", "CONTROL", "REVISION",
        "DISENO", "PLANIFICACION", "CUBICACION", "CONSULTAR",
        "SOLICITAR", "TRABAJO DE FORMA", "MANUAL",
        # A1 (feedback Metlo 06/07): la soldadura depende del soldador (skill/rango),
        # no de una máquina específica. Sin esto caía en PRODUCCION_MAQUINA y buscaba
        # una familia de máquina inexistente → el proceso quedaba "sin nadie".
        # "SOLDA" cubre SOLDADURA / SOLDAR / SOLDADO / SOLDADURA MIG, etc.
        "SOLDA",
    ]
    
    if any(k in n for k in keywords_manual):
        return "MANUAL"

    # 3. ADMIN / EXTERNO
    if "TERCERIZ" in n or "EXTERNO" in n:
        return "ADMIN"

    # 4. DEFAULT: PRODUCCION (Asumimos que si no es manual ni setup, busca máquina)
    return "PRODUCCION_MAQUINA"


def proceso_usa_maquina(nombre_proceso: str) -> bool:
    """
    Devuelve True si el proceso requiere maquinaria (PRODUCCION o SETUP).
    Devuelve False si es MANUAL o ADMIN.
    """
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
):
    logger.info(f"Service - planificar() rango: desde={fecha_desde} hasta={fecha_hasta} forzar={forzar_ordenes_ids}")
    forzar_set = set(forzar_ordenes_ids or [])

    # 🔹 Inyectar repo de skills si no viene
    if not repo_skill:
        repo_skill = OperarioProcesoSkillRepository(db)

    # 🔹 Mapa de PRIORIDAD (proceso_id -> {operario_id: nivel 1|2}). No define quién
    #    puede: eso lo dan las nativas (rango). Solo ordena preferencia.
    mapa_skills = await repo_skill.get_map_por_proceso()
    # 🔹 Nativas desactivadas (proceso_id -> {operario_id}) para excluir de la elegibilidad
    nativas_off = await repo_skill.get_nativas_deshabilitadas()
    # 🔹 Habilidades cargadas a mano (proceso_id -> {operario_id}): suman elegibilidad
    #    donde el rango no llega.
    skills_manuales = await repo_skill.get_manuales_por_proceso()
    # 🔹 Quién sabe interpretar planos (id_operario -> bool)
    op_planos = await repo_operario.find_interpreta_planos()
    # 🔹 Horario de cada uno: turno y días que trabaja.
    calendarios = calendarios_de_operarios(await repo_operario.find_all())
    # 🔹 Feriados / días de mantenimiento, ahora desde la base.
    blocked_dates = await DiaBloqueadoRepository(db).listar()

    # 🔹 Si nos pasan un plan manual, lo guardamos directamente sin pasar por el solver
    if not preview and plan:
        logger.info(f"Service - Guardando plan manual ({len(plan)} items)")
        return await repo_planificacion.insertar_planificacion_lote(plan)

    ##ordenes = await repo_orden.find_with_procesos()
    if ordenes_ids:
        ordenes = await repo_orden.find_with_procesos_by_ids(ordenes_ids)
    else:
        ordenes = await repo_orden.find_with_procesos()

    operarios = await repo_operario.find_with_rangos()

    # OTs con plano REALMENTE adjunto: sus procesos exigen saber interpretar planos.
    # Se mira la tabla `plano`, no la bandera `tiene_plano` del legacy — ver
    # PlanoRepository.find_ordenes_con_plano.
    ots_con_plano = await PlanoRepository(db).find_ordenes_con_plano()

    # Cargar maquinarias (con rangos)
    maquinarias_orm = await repo_maquinaria.find_with_rangos()
    maquinarias = []
    for m in maquinarias_orm:
        rangos_ok = {rm.id_rango for rm in (m.rango_maquinarias or [])}
        #maquinarias.append((m.id, rangos_ok, m.nombre)) esto funciona
        maquinarias.append((m.id, rangos_ok, m.nombre, m.cod_maquina))


    procesos_para_solver = []
    cant_op_map = {}  # (orden_id, secuencia) -> operarios requeridos por el proceso
    preseleccion_maq = {}  # (orden_id, secuencia) -> id_maquinaria forzada (preselección Metlo)
    procesos_sin_rango = {}  # id_proceso -> nombre, para avisar al final

    # -----------------------
    # Procesar cada orden
    # -----------------------
    for orden in ordenes:
        prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

        # D1: si se eligieron procesos sueltos de esta orden, planificamos solo esos.
        for rel in _filtrar_procesos_por_orden(orden.procesos, orden.id, procesos_por_orden):
            cant_op_map[(orden.id, rel.orden)] = max(1, int(getattr(rel, "cant_operarios", 1) or 1))
            # Preselección de máquina: si el proceso tiene máquina elegida, se fuerza en el solver.
            _presel_maq = getattr(rel, "id_maquinaria", None)
            if _presel_maq:
                preseleccion_maq[(orden.id, rel.orden)] = _presel_maq

            # Duración mínima
            dur_min = rel.tiempo_proceso or 1

            # Nombre del proceso
            nombre_proceso = (
                rel.proceso.nombre.strip().lower()
                if rel.proceso and rel.proceso.nombre
                else ""
            )

            # Clasificar si usa máquina
            usa_maquina = proceso_usa_maquina(nombre_proceso)
            #esto funciona
            familia_req = familia_requerida_from_proceso(nombre_proceso) if usa_maquina else ""
            
            # Rangos válidos del proceso
            rangos_validos = [rp.id_rango for rp in getattr(rel.proceso, "rangos", [])]

            # Si NO usa máquina → solo depende de operario
            if not usa_maquina:
                rangos_validos = rangos_validos or []

            # -------------------------------
            # Detectar máquina por coincidencia de nombre
            # SOLO si no hay rangos válidos
            # -------------------------------
            if not rangos_validos and nombre_proceso:
                for _, rangos_maquina, nombre_maquina, _cod in maquinarias:

                    if not rangos_maquina:
                        continue

                    nombre_maquina_lower = (
                        nombre_maquina.strip().lower()
                        if nombre_maquina else ""
                    )

                    if nombre_maquina_lower and (
                        nombre_maquina_lower in nombre_proceso or
                        nombre_proceso in nombre_maquina_lower
                    ):
                        rangos_validos = list(rangos_maquina)
                        break

            # Un proceso sin rangos es asignable a CUALQUIERA (más abajo:
            # `if not rangos_proc: operarios_validos = REAL_OP_IDS[:]`). Es lo
            # contrario de lo que uno esperaría: el silencio habilita a todos en vez
            # de a nadie. Se acumula para avisarlo UNA vez al final —son decenas de
            # líneas y un log por línea no lo lee nadie— porque si no el problema es
            # invisible: el plan sale igual, solo que con la persona equivocada.
            if not rangos_validos:
                procesos_sin_rango[rel.proceso.id] = rel.proceso.nombre or f"#{rel.proceso.id}"

            # -------------------------------
            # Agregar al solver
            # -------------------------------
            procesos_para_solver.append((
                orden.id,               # orden_id
                rel.proceso.id,         # proc_id
                rel.orden,              # secuencia
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

    resultados = await asyncio.to_thread(
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
    )

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
        )
    except Exception as e:
        # Un diagnóstico que falla no puede tumbar una planificación que salió bien.
        logger.error(f"Service - No se pudieron construir los diagnósticos: {e}")
        diagnosticos = []

    if preview:
        return {"planificados": planificados, "excedentes": excedentes, "diagnosticos": diagnosticos}

    # Marcar como forzado_fuera_rango los procesos cuyas órdenes el usuario decidió forzar
    for r in planificados:
        r["forzado_fuera_rango"] = (r["orden_id"] in forzar_set)

    saved = await repo_planificacion.insertar_planificacion_lote(planificados)
    return {"planificados": saved, "excedentes": excedentes, "diagnosticos": diagnosticos}

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
        nativas_off = await repo_skill.get_nativas_deshabilitadas()
        skills_manuales = await repo_skill.get_manuales_por_proceso()

        # 🔹 SOLO órdenes con procesos pendientes
        ordenes = await repo_orden.find_with_pending_procesos(ordenes_ids)

        if not ordenes:
            logger.info("Service - No hay procesos pendientes para planificar.")
            return []

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
        procesos_sin_rango = {}  # id_proceso -> nombre, para avisar al final

        for orden in ordenes:
            prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

            for rel in orden.procesos:
                # Saltar procesos finalizados (doble seguridad)
                if rel.id_estado == 3:
                    continue

                cant_op_map[(orden.id, rel.orden)] = max(1, int(getattr(rel, "cant_operarios", 1) or 1))
                dur_min = rel.tiempo_proceso or 1
                nombre_proceso = rel.proceso.nombre.lower() if rel.proceso else ""
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
                    rel.orden,
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

        resultados = await asyncio.to_thread(
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
        )

        planificados, excedentes = _split_resultados(resultados)
        saved = await repo_planificacion.insertar_planificacion_lote(planificados)
        return {"planificados": saved, "excedentes": excedentes}
