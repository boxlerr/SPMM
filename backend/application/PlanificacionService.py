# backend/application/PlanificacionService.py
import asyncio
from ortools.sat.python import cp_model
from datetime import datetime, time,date

from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
from backend.infrastructure.PlanificacionRepository import PlanificacionRepository
from backend.infrastructure.ConfigRepository import ConfigRepository
from backend.infrastructure.OperarioProcesoSkillRepository import OperarioProcesoSkillRepository
from datetime import timedelta

from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.PlanificacionException import PlanificacionException

from backend.commons.loggers.logger import logger

from sqlalchemy import text

import math

import re
import unicodedata

##Variables:
# Jornada física L-V: 07:00 a 16:00 (9 hs). Pausas: 15' desayuno + 30' almuerzo = 45' muertos.
# Tiempo laboral real = 8h 15min = 495 min/día.
MIN_LABORAL_DIA = 495
MIN_LABORAL_SEMANA = 5 * MIN_LABORAL_DIA  # Sólo L-V por defecto = 2475

# Fase 3: capacidades extras opcionales habilitadas bajo demanda
HE_MIN_DIA = 120        # 2 hs extra al final del día (16:00 a 18:00) cuando permitir_he
SAB_MIN_DIA = 300       # 5 hs corridas el sábado (07:00 a 12:00) cuando permitir_sabado

# Tramos en minutos laborales (espacio comprimido del solver).
# Las pausas físicas se aplican en _convertir_minutos_a_fecha, no acá.
TRAMOS_LV_LAB = [
    (0, 120),    # 07:00 - 09:00
    (120, 285),  # 09:15 - 12:00 (post-desayuno)
    (285, 495),  # 12:30 - 16:00 (post-almuerzo)
]

# Sábado off por defecto. Se mantiene la constante por compatibilidad,
# pero no genera capacidad en el solver.
TRAMOS_SAB_LAB = []


def _capacidad_dia(weekday: int, permitir_he: bool, permitir_sabado: bool) -> int:
    """Capacidad del timeline global por día calendario (en minutos comprimidos)."""
    if weekday < 5:
        return MIN_LABORAL_DIA + (HE_MIN_DIA if permitir_he else 0)
    if weekday == 5:
        return SAB_MIN_DIA if permitir_sabado else 0
    return 0


def _tramos_dia_global(weekday: int, permitir_he: bool, permitir_sabado: bool):
    """Tramos globales (default, dummy) en el día. Devuelve lista [(ini, fin)]."""
    if weekday < 5:
        tramos = list(TRAMOS_LV_LAB)
        if permitir_he:
            tramos.append((MIN_LABORAL_DIA, MIN_LABORAL_DIA + HE_MIN_DIA))
        return tramos
    if weekday == 5 and permitir_sabado:
        return [(0, SAB_MIN_DIA)]
    return []
# ------------------------------------------------------------------
#Funcion para ventanas semanales en tiempo.
def construir_ventanas_semanales(num_semanas: int, start_date: date, blocked_dates: list[str], fecha_hasta: date | None = None, permitir_he: bool = False, permitir_sabado: bool = False):
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
        
        # Determine schedule for this day (con flags Fase 3)
        tramos = _tramos_dia_global(weekday, permitir_he, permitir_sabado)
        day_capacity = _capacidad_dia(weekday, permitir_he, permitir_sabado)
            
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
            
        else:
             # Add segments for this day
             for ini, fin in tramos:
                 ventanas.append((current_base_minutes + ini, current_base_minutes + fin))

             # Advance base minutes (sólo si el día aporta capacidad)
             current_base_minutes += day_capacity
        
        # Advance calendar
        current_iter_date += timedelta(days=1)
        
    return ventanas


# Mapeo weekday() (0..6) → código que usamos en dias_trabajo del operario
_WEEKDAY_TO_CODE = {0: "MON", 1: "TUE", 2: "WED", 3: "THU", 4: "FRI", 5: "SAT", 6: "SUN"}


def _jornada_real_min(horario: dict) -> int:
    """
    Devuelve los minutos laborales reales que aporta un operario en un día,
    truncados al máximo del solver (MIN_LABORAL_DIA = 495).
    """
    hi = horario.get("hora_inicio")
    hf = horario.get("hora_fin")
    if hi is None or hf is None:
        return 0
    inicio = hi.hour * 60 + hi.minute
    fin = hf.hour * 60 + hf.minute
    if fin <= inicio:
        return 0
    bruto = fin - inicio
    pausas = int(horario.get("min_desayuno") or 0) + int(horario.get("min_almuerzo") or 0)
    real = max(0, bruto - pausas)
    return min(real, MIN_LABORAL_DIA)


def _tramos_para_jornada(jornada_min: int) -> list[tuple[int, int]]:
    """
    Adapta TRAMOS_LV_LAB a una jornada de 'jornada_min' minutos truncando
    el último tramo. Mantiene los breakpoints de pausas estándar (120, 285).
    Si la jornada es muy corta, recorta tramos enteros.
    """
    if jornada_min <= 0:
        return []
    tramos = []
    for ini, fin in TRAMOS_LV_LAB:
        if jornada_min <= ini:
            break
        tramos.append((ini, min(fin, jornada_min)))
    return tramos


def construir_ventanas_por_operario(
    horarios_por_operario: dict,
    start_date: date,
    blocked_dates: list[str],
    fecha_hasta: date | None = None,
    num_semanas: int = 1,
    permitir_he: bool = False,
    permitir_sabado: bool = False,
):
    """
    Para cada operario devuelve sus ventanas en el timeline comprimido global.

    El timeline global avanza la capacidad del día (495 + HE opcional en L-V,
    300 en sábado si se permite, 0 si no). Cada operario ve sólo los tramos
    que le corresponden según su jornada base, sus días de trabajo y los flags.

    Reglas Fase 3:
        - Si `permitir_he` está activo, los operarios con jornada base = 495
          reciben un tramo extra (495, 615) en L-V (16:00-18:00).
        - Si `permitir_sabado` está activo, todos los operarios reciben un
          tramo (0, 300) el sábado, ignorando si tienen SAT en `dias_trabajo`
          (es una orden global por urgencia).

    Returns: dict[op_id, list[(ini, fin)]]
    """
    if fecha_hasta is not None:
        total_days = max(1, (fecha_hasta - start_date).days + 1)
    else:
        total_days = num_semanas * 7

    blocked_set = set(blocked_dates)
    out = {op_id: [] for op_id in horarios_por_operario.keys()}
    cur = start_date
    base = 0

    for _ in range(total_days):
        wd = cur.weekday()
        day_str = cur.strftime("%Y-%m-%d")
        bloqueado = day_str in blocked_set
        codigo = _WEEKDAY_TO_CODE[wd]

        capacidad = _capacidad_dia(wd, permitir_he, permitir_sabado)
        if bloqueado or capacidad == 0:
            cur += timedelta(days=1)
            continue

        if wd < 5:
            for op_id, horario in horarios_por_operario.items():
                if codigo not in horario["dias_trabajo"]:
                    continue
                jornada = _jornada_real_min(horario)
                tramos = _tramos_para_jornada(jornada)
                for ini, fin in tramos:
                    out[op_id].append((base + ini, base + fin))
                # HE: solo operarios con jornada completa estandar acceden al tramo extra
                if permitir_he and jornada >= MIN_LABORAL_DIA:
                    out[op_id].append((base + MIN_LABORAL_DIA, base + MIN_LABORAL_DIA + HE_MIN_DIA))
        elif wd == 5 and permitir_sabado:
            # Sábado de urgencia: todos los operarios disponibles, 5 hs corridas
            for op_id in horarios_por_operario.keys():
                out[op_id].append((base, base + SAB_MIN_DIA))

        base += capacidad
        cur += timedelta(days=1)

    return out


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
    H = total_trabajo + 495

    return procesos_norm, H


def _crear_variables_y_dominios(
    model,
    procesos_norm,
    operarios,
    maquinarias,
    RANGOS_BÁSICOS,
    RANGOS_ESPECIALIZADOS,
):
    """
    Crea variables de inicio/fin/intervalos, dominios de operarios/maquinarias
    y devuelve todos los dicts necesarios para el resto del modelo.
    """

    inicio_vars, fin_vars, intervalo_vars = {}, {}, {}
    operario_vars, maq_vars = {}, {}
    presente_vars = {}
    dur_map = {}

    op_to_rango = {op_id: r_id for (op_id, r_id) in operarios}
    REAL_OP_IDS = [op_id for (op_id, _) in operarios]
    DUMMY_OP_ID = 999999

    #REAL_MAQ_IDS = [m_id for (m_id, _rs, _n) in maquinarias]
    #DUMMY_MAQ_ID = 999998

    #maq_to_rangos = {m_id: set(rs) for (m_id, rs, _n) in maquinarias}
    REAL_MAQ_IDS = [m_id for (m_id, _rs, _n, _cod) in maquinarias]
    DUMMY_MAQ_ID = 999998

    maq_to_rangos = {m_id: set(rs) for (m_id, rs, _n, _cod) in maquinarias}

    # NUEVO: familia/tipo de cada máquina según cod_maquina
    maq_to_familia = {m_id: familia_from_cod_maquina(_cod) for (m_id, _rs, _n, _cod) in maquinarias}

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
        if op_skill_levels:
            # Lógica de Skills primero
            operarios_validos = list(op_skill_levels.keys())
        elif not rangos_proc:
            operarios_validos = REAL_OP_IDS[:]
        else:
            requiere_basicos   = any(r in RANGOS_BÁSICOS for r in rangos_proc)
            requiere_especial  = any(r in RANGOS_ESPECIALIZADOS for r in rangos_proc)

            if requiere_especial:
                objetivo = set(rangos_proc) & RANGOS_ESPECIALIZADOS
                operarios_validos = [op_id for (op_id, rango) in operarios if rango in objetivo]
            elif requiere_basicos:
                operarios_validos = REAL_OP_IDS[:]
            else:
                operarios_validos = [op_id for (op_id, rango) in operarios if rango in rangos_proc]

        if not operarios_validos:
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
        inicio_vars[(orden_id, secuencia)] = start
        fin_vars[(orden_id, secuencia)] = end
        intervalo_vars[(orden_id, secuencia)] = itv

        # ----------------- Caso especial: proceso sin maquinaria -----------------
        if not usa_maquina:
            maqs_validas = [DUMMY_MAQ_ID]

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
    )


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
):
    """
    Añade restricciones de no solapamiento por operario
    usando intervalos opcionales. Si presente_vars está, el intervalo
    solo participa si el proceso está presente.
    """
    for op_id in REAL_OP_IDS:
        pres_intervals = []
        for (orden_id, secuencia), op_var in operario_vars.items():
            es_op = model.NewBoolVar(f"esop_{orden_id}_{secuencia}_op{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(es_op)
            model.Add(op_var != op_id).OnlyEnforceIf(es_op.Not())

            if presente_vars is not None:
                # pres = es_op AND presente
                pres = model.NewBoolVar(f"usaop_{orden_id}_{secuencia}_op{op_id}")
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
                f"i_op_{orden_id}_{secuencia}_{op_id}"
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


def _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars):
    """
    Fuerza a que procesos coordinados (ej: Programacion + Produccion) 
    usen la misma máquina.
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
            
            # Si el actual es SETUP y el siguiente es PRODUCCIÓN
            # Y ambos están marcados para usar máquina
            tipo_act = _get_tipo_proceso(name_a)
            tipo_sig = _get_tipo_proceso(name_s)
            
            if tipo_act == "SETUP" and tipo_sig == "PRODUCCION_MAQUINA" and usa_m_a and usa_m_s:
                # Forzamos igualdad de la variable de máquina
                model.Add(maq_vars[(oid, seq_a)] == maq_vars[(oid, seq_s)])
                logger.info(f"COORDINACIÓN: Vinculando máquinas de Seq {seq_a} ({name_a}) y Seq {seq_s} ({name_s}) en OT {oid}")


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
):
    """
    Añade restricciones de compatibilidad Operario–Maquinaria
    mediante AddAllowedAssignments.
    """
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
        allowed_pairs = []

        for op_id in ops_dom:
            # dummy-op → solo dummy-machinery
            if op_id == DUMMY_OP_ID:
                if DUMMY_MAQ_ID in maqs_dom:
                    allowed_pairs.append([DUMMY_OP_ID, DUMMY_MAQ_ID])
                continue

            rango_op = op_to_rango.get(op_id)

            for m_id in maqs_dom:
                # dummy-maq → permitido para cualquier operario
                if m_id == DUMMY_MAQ_ID:
                    allowed_pairs.append([op_id, DUMMY_MAQ_ID])
                    continue

                if familia_req:
                    if maq_to_familia.get(m_id) != familia_req:
                        continue
                    
                mrangos = maq_to_rangos.get(m_id, set())
                if rango_op in mrangos and (not needs or (needs & mrangos)):
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
    PEON_ID,
    AYUDANTE_ID,
    PENAL_OVERQUAL,
    PENAL_DUMMY,
    PENAL_DUMMY_MAQ,
    H,
    presente_vars=None,
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

    PENAL_SKILL1 = 2000
    PENAL_SKILL2 = 5000

    for (orden_id, proc_id, secuencia, fecha_prometida,
        peso_prioridad, dur, rangos_proc, nombre_proceso,usa_maquina,_familia_req,
        op_skill_levels) in procesos_norm:

        op_var  = operario_vars[(orden_id, secuencia)]
        maq_var = maq_vars[(orden_id, secuencia)]

        # --- Exactly-one operario (reales + dummy) ---
        pres_list = []
        for op_id in op_to_rango.keys():
            if op_id == 999999:  # dummy, lo tratamos aparte
                continue
            pres = model.NewBoolVar(f"pick_op_{orden_id}_{secuencia}_{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())
            pres_list.append(pres)

            # Penalización por Skill Level
            if op_skill_levels and op_id in op_skill_levels:
                nivel = op_skill_levels[op_id]
                if nivel == 1:
                    total_obj.append((pres, PENAL_SKILL1))
                elif nivel == 2:
                    total_obj.append((pres, PENAL_SKILL2))

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


        # Penalización por sobre-cualificación en tareas básicas
        if rangos_proc and any(rid in RANGOS_BÁSICOS for rid in rangos_proc):
            is_over = model.NewBoolVar(f"overq_{orden_id}_{secuencia}")
            not_b1 = model.NewBoolVar(f"not_peon_{orden_id}_{secuencia}")
            not_b2 = model.NewBoolVar(f"not_ayud_{orden_id}_{secuencia}")
            model.Add(op_var != PEON_ID).OnlyEnforceIf(not_b1)
            model.Add(op_var == PEON_ID).OnlyEnforceIf(not_b1.Not())
            model.Add(op_var != AYUDANTE_ID).OnlyEnforceIf(not_b2)
            model.Add(op_var == AYUDANTE_ID).OnlyEnforceIf(not_b2.Not())
            model.Add(is_over <= not_b1)
            model.Add(is_over <= not_b2)
            tmp = model.NewIntVar(0, 2, f"tmp_over_{orden_id}_{secuencia}")
            model.Add(tmp == not_b1 + not_b2)
            model.Add(is_over >= tmp - 1)
            over_eff = _gate_bool(is_over, f"over_eff_{orden_id}_{secuencia}")
            total_obj.append((over_eff, PENAL_OVERQUAL))

        # --- Término dominante: excedente ---
        if presente is not None:
            peso_exced = PESO_EXCED_POR_PRIO.get(peso_prioridad, 100)
            ausente = model.NewBoolVar(f"ausente_{orden_id}_{secuencia}")
            model.Add(ausente == 1 - presente)
            total_obj.append((ausente, W_FUERA * peso_exced))

    model.Minimize(sum(v * c for (v, c) in total_obj))


def _convertir_minutos_a_fecha(minutos_acumulados: int, ahora_ref=None, permitir_he: bool = False, permitir_sabado: bool = False):
    """
    Convierte minutos de trabajo lógicos a una fecha real del calendario físico.
    Jornada física L-V: 07:00 a 16:00 (9 hs).
    Pausas: 15' desayuno tras tramo 1, 30' almuerzo tras tramo 2.
    Tiempo laboral real = 495 min/día. Sábado y domingo off por defecto.

    Fase 3:
        - permitir_he: agrega 120 min extra al final del día L-V (16:00-18:00).
          Capacidad L-V = 615, sin pausas adicionales en el tramo HE.
        - permitir_sabado: agrega 5 hs al sábado (07:00-12:00, sin pausas).
          Capacidad sábado = 300.
    """
    from datetime import timedelta

    # Load blocked dates first
    config_repo = ConfigRepository()
    blocked_dates = set(config_repo.get_blocked_dates())

    ahora = ahora_ref if ahora_ref else datetime.now()
    inicio_base = ahora.replace(hour=7, minute=0, second=0, microsecond=0)

    def avanzar_a_dia_valido(fecha):
        while True:
            wd = fecha.weekday()
            is_blocked = fecha.strftime("%Y-%m-%d") in blocked_dates
            cap = _capacidad_dia(wd, permitir_he, permitir_sabado)
            if is_blocked or cap == 0:
                fecha += timedelta(days=1)
            else:
                break
        return fecha

    tiempo_actual = avanzar_a_dia_valido(inicio_base)
    minutos_restantes = minutos_acumulados

    while minutos_restantes > 0:
        wd = tiempo_actual.weekday()
        capacidad_hoy = _capacidad_dia(wd, permitir_he, permitir_sabado)

        if capacidad_hoy == 0:
            tiempo_actual += timedelta(days=1)
            tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
            continue

        if minutos_restantes >= capacidad_hoy:
            minutos_restantes -= capacidad_hoy
            tiempo_actual += timedelta(days=1)
            tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
        else:
            if wd < 5:
                # Tramos físicos L-V (con HE si aplica)
                if minutos_restantes <= 120:
                    tiempo_actual += timedelta(minutes=minutos_restantes)
                elif minutos_restantes <= 285:
                    tiempo_actual += timedelta(minutes=minutos_restantes + 15)
                elif minutos_restantes <= MIN_LABORAL_DIA:
                    tiempo_actual += timedelta(minutes=minutos_restantes + 45)
                else:
                    # tramo HE (495..615): 16:00 + (min - 495)
                    # físicamente: 7:00 + 495 + 45 (pausas) + (min - 495) = 7:00 + min + 45
                    tiempo_actual += timedelta(minutes=minutos_restantes + 45)
            else:
                # Sábado: sin pausas, 7:00 + min
                tiempo_actual += timedelta(minutes=minutos_restantes)

            minutos_restantes = 0

    return tiempo_actual.isoformat()


def _extraer_resultados(solver,status,procesos_norm,inicio_vars,fin_vars,operario_vars,maq_vars,op_to_rango, DUMMY_OP_ID,DUMMY_MAQ_ID, start_time_ref, presente_vars=None, permitir_he: bool = False, permitir_sabado: bool = False):
    """
    Transforma la solución CP-SAT en la lista de dicts que tu servicio guarda en BD.
    Cada resultado incluye `excedente`: True si el proceso no entra en el horizonte (presente=0).
    """
    resultados = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (orden_id, proc_id, secuencia, fecha_prometida,
            peso_prioridad, dur, rangos_proc, nombre_proceso,usa_maquinaria,_familia_req, _skills) in procesos_norm:

            op_id  = solver.Value(operario_vars[(orden_id, secuencia)])
            maq_id = solver.Value(maq_vars[(orden_id, secuencia)])

            inicio_m = solver.Value(inicio_vars[(orden_id, secuencia)])
            fin_m = solver.Value(fin_vars[(orden_id, secuencia)])

            if presente_vars is not None:
                excedente = (solver.Value(presente_vars[(orden_id, secuencia)]) == 0)
            else:
                excedente = False

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
                "fecha_prometida": (
                    fecha_prometida.strftime("%Y-%m-%d")
                    if isinstance(fecha_prometida, (date, datetime))
                    else (fecha_prometida if isinstance(fecha_prometida, str) else None)
                ),
                "sin_asignar": (op_id == DUMMY_OP_ID),
                "sin_maquinaria": (maq_id == DUMMY_MAQ_ID),
                "excedente": excedente,
                "fecha_inicio_estimada": _convertir_minutos_a_fecha(inicio_m, start_time_ref, permitir_he, permitir_sabado),
                "fecha_fin_estimada": _convertir_minutos_a_fecha(fin_m, start_time_ref, permitir_he, permitir_sabado),
            })

        resultados.sort(key=lambda x: (x["orden_id"], x["secuencia"]))
    else:
        logger.warning(f"No se encontró solución. status={status}")
        raise PlanificacionException("No se pudo generar una planificación viable con las restricciones actuales.")

    return resultados

def _max_tramo_disponible(permitir_he: bool, permitir_sabado: bool) -> tuple[int, str]:
    """
    Devuelve (minutos, etiqueta) del tramo individual más grande disponible
    según los flags activos. Sirve para diagnóstico de procesos no fragmentables.
    """
    candidatos = [(120, "mañana L-V"), (165, "mediodía L-V"), (210, "tarde L-V")]
    if permitir_he:
        candidatos.append((120, "HE L-V"))
    if permitir_sabado:
        candidatos.append((300, "sábado"))
    candidatos.sort(reverse=True)
    return candidatos[0]


def _fmt_dur(min_total: int) -> str:
    h, m = divmod(int(min_total), 60)
    if h and m:
        return f"{h}h {m:02d}min"
    if h:
        return f"{h}h"
    return f"{m}min"


def _anotar_motivos_excedentes(resultados: list[dict], permitir_he: bool, permitir_sabado: bool) -> None:
    """
    Mutates `resultados` in place: añade `motivo_excedente` y `motivo_descripcion`
    a cada item con `excedente=True`.

    Categorías (por prioridad de detección):
        - sin_operario: ningún operario tiene rango/skill compatible.
        - sin_maquina: ningún equipo compatible con el proceso.
        - proceso_largo: la duración supera la ventana individual más grande.
        - secuencia_bloqueada: el proceso anterior de la misma orden no entró.
        - capacidad_insuficiente: default cuando no aplica nada de lo anterior.
    """
    max_tramo, etiqueta_tramo = _max_tramo_disponible(permitir_he, permitir_sabado)

    excedentes_por_orden: dict = {}
    for r in resultados:
        if not r.get("excedente"):
            continue
        excedentes_por_orden.setdefault(r["orden_id"], []).append(r)

    for orden_id, items in excedentes_por_orden.items():
        items.sort(key=lambda x: x.get("secuencia") or 0)
        for r in items:
            dur = int(r.get("duracion_min") or 0)
            sin_op = bool(r.get("sin_asignar"))
            sin_maq = bool(r.get("sin_maquinaria"))

            if sin_op:
                r["motivo_excedente"] = "sin_operario"
                r["motivo_descripcion"] = (
                    "No hay operario con el rango o skill requerido para este proceso."
                )
                continue

            if sin_maq:
                r["motivo_excedente"] = "sin_maquina"
                r["motivo_descripcion"] = (
                    "No hay máquina compatible con el proceso."
                )
                continue

            if dur > max_tramo:
                desc = (
                    f"El proceso dura {_fmt_dur(dur)} y la ventana individual más grande "
                    f"disponible es de {_fmt_dur(max_tramo)} ({etiqueta_tramo}). "
                    f"No se puede partir entre tramos en el modelo actual."
                )
                # Si todavía hay flags por habilitar, aclarar si ayudarían o no
                tramo_he = 120
                tramo_sab = 300
                if not permitir_he and dur <= max(max_tramo, tramo_he):
                    pass  # no ayuda
                if not permitir_sabado and dur <= tramo_sab:
                    desc += " Habilitar sábados (5 hs) podría alcanzar."
                elif (not permitir_he) and (not permitir_sabado) and dur > tramo_sab:
                    desc += " Habilitar HE/sábado no resolvería este caso (proceso > 5 hs)."
                r["motivo_excedente"] = "proceso_largo"
                r["motivo_descripcion"] = desc
                continue

            anteriores_excedentes = [
                x for x in items
                if (x.get("secuencia") or 0) < (r.get("secuencia") or 0)
            ]
            if anteriores_excedentes:
                ant = anteriores_excedentes[-1]
                nombre_ant = ant.get("nombre_proceso") or "anterior"
                r["motivo_excedente"] = "secuencia_bloqueada"
                r["motivo_descripcion"] = (
                    f"El proceso anterior de la orden ({nombre_ant.strip()}, "
                    f"sec. #{ant.get('secuencia')}) no entró en el plan."
                )
                continue

            r["motivo_excedente"] = "capacidad_insuficiente"
            r["motivo_descripcion"] = (
                "Los recursos disponibles están saturados en el rango del horizonte. "
                "Habilitar HE o sábado podría ayudar."
            )


def _construir_sugerencia(
    excedentes: list[dict],
    horarios_por_operario: dict | None,
    permitir_he: bool,
    permitir_sabado: bool,
) -> dict | None:
    """
    Detector Fase 3: si entre los excedentes hay procesos con prioridad <= 2 (urgentes),
    construye una sugerencia para el usuario explicando cuánta capacidad extra
    podría obtener habilitando HE y/o sábado.

    Sólo emite sugerencia mientras existan flags todavía OFF que puedan ayudar.
    Devuelve None si no aplica.
    """
    if not excedentes:
        return None

    urgentes = [e for e in excedentes if (e.get("prioridad_peso") or 99) <= 2]
    if not urgentes:
        return None

    minutos_faltantes = sum(int(e.get("duracion_min") or 0) for e in urgentes)
    cantidad_urgentes = len(urgentes)

    # Capacidad extra por día y semana que aporta cada flag (estimación global).
    # Asumimos que en promedio los operarios elegibles para HE son los que tienen
    # jornada base >= 495. Si no tenemos horarios cargados, usamos 1 operario como cota inferior
    # informativa (la UI puede multiplicar por la cantidad real luego).
    if horarios_por_operario:
        n_ops_he = sum(
            1 for h in horarios_por_operario.values()
            if _jornada_real_min(h) >= MIN_LABORAL_DIA
        )
        n_ops_sab = len(horarios_por_operario)
    else:
        n_ops_he = 1
        n_ops_sab = 1

    # Asumimos 5 días L-V por semana para HE
    he_min_semana = HE_MIN_DIA * 5 * n_ops_he
    sab_min_semana = SAB_MIN_DIA * n_ops_sab

    opciones = []
    if not permitir_he and he_min_semana > 0:
        opciones.append({
            "tipo": "he",
            "descripcion": f"Habilitar 2 hs extras diarias L-V ({n_ops_he} operario{'s' if n_ops_he != 1 else ''} con jornada completa)",
            "capacidad_extra_min_semana": he_min_semana,
        })
    if not permitir_sabado and sab_min_semana > 0:
        opciones.append({
            "tipo": "sabado",
            "descripcion": f"Habilitar sábados con 5 hs ({n_ops_sab} operario{'s' if n_ops_sab != 1 else ''})",
            "capacidad_extra_min_semana": sab_min_semana,
        })
    if (not permitir_he) and (not permitir_sabado) and (he_min_semana + sab_min_semana) > 0:
        opciones.append({
            "tipo": "ambos",
            "descripcion": "Habilitar HE y sábados",
            "capacidad_extra_min_semana": he_min_semana + sab_min_semana,
        })

    if not opciones:
        return None

    return {
        "motivo": f"{cantidad_urgentes} urgencia{'s' if cantidad_urgentes != 1 else ''} no entran en el plan estándar",
        "minutos_faltantes": minutos_faltantes,
        "cantidad_urgentes_excedentes": cantidad_urgentes,
        "opciones": opciones,
    }


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


def _agregar_ventanas_horarias(model,procesos_norm,inicio_vars,dur_map,ventanas, presente_vars=None):
    """
    Variante legacy (ventanas globales para todos). Conservada por compatibilidad.
    Obliga a que cada proceso:
    - empiece dentro de una ventana laboral
    - termine antes de que esa ventana cierre
    Si presente_vars está, solo aplica cuando el proceso está presente.
    Si un proceso NO entra en ninguna ventana del horizonte → presente = 0.
    """

    for (orden_id, proc_id, secuencia, *_resto) in procesos_norm:
        key = (orden_id, secuencia)
        start = inicio_vars[key]
        dur = dur_map[key]

        # Un booleano por ventana donde el proceso podría caber
        en_ventana = []

        for idx, (v_ini, v_fin) in enumerate(ventanas):
            if dur > (v_fin - v_ini):
                continue  # No cabe en esta ventana → no la considero

            b = model.NewBoolVar(f"vent_{orden_id}_{secuencia}_{idx}")
            # Si b == 1 → el proceso está dentro de esta ventana
            model.Add(start >= v_ini).OnlyEnforceIf(b)
            model.Add(start < v_fin).OnlyEnforceIf(b)
            en_ventana.append(b)

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


def _agregar_ventanas_horarias_por_operario(
    model,
    procesos_norm,
    inicio_vars,
    dur_map,
    operario_vars,
    op_domain_vals,
    ventanas_por_op,
    ventanas_default,
    DUMMY_OP_ID,
    presente_vars=None,
):
    """
    Igual que `_agregar_ventanas_horarias` pero con ventanas distintas por operario.

    Para cada proceso crea un booleano por (op_id_candidato, ventana_del_operario)
    donde la duración del proceso entra. Si ese booleano = 1, fuerza:
        - el operario asignado coincide con op_id_candidato
        - el inicio cae dentro de esa ventana

    Restricciones:
        - presente=1 → exactamente UN booleano activo
        - presente=0 → ningún booleano activo
        - sin presente → exactamente UN booleano activo (modo legacy)

    El operario dummy usa `ventanas_default` (capacidad estándar), de modo que
    los procesos sin operario válido siempre tienen al menos una ventana viable
    y no se fuerza infactibilidad.
    """
    for (orden_id, proc_id, secuencia, *_resto) in procesos_norm:
        key = (orden_id, secuencia)
        start = inicio_vars[key]
        dur = dur_map[key]
        op_var = operario_vars[key]
        candidatos = op_domain_vals.get(key, [])

        en_ventana_total = []

        for op_id in candidatos:
            if op_id == DUMMY_OP_ID:
                vents = ventanas_default
            else:
                vents = ventanas_por_op.get(op_id, [])

            for idx, (v_ini, v_fin) in enumerate(vents):
                if dur > (v_fin - v_ini):
                    continue

                b = model.NewBoolVar(f"vent_{orden_id}_{secuencia}_op{op_id}_{idx}")
                # b == 1 implica que el operario es op_id y el inicio cae en esta ventana
                model.Add(op_var == op_id).OnlyEnforceIf(b)
                model.Add(start >= v_ini).OnlyEnforceIf(b)
                model.Add(start < v_fin).OnlyEnforceIf(b)
                en_ventana_total.append(b)

        if presente_vars is not None:
            presente = presente_vars[key]
            if en_ventana_total:
                model.Add(sum(en_ventana_total) == 1).OnlyEnforceIf(presente)
                model.Add(sum(en_ventana_total) == 0).OnlyEnforceIf(presente.Not())
            else:
                # Sin combinaciones viables → excedente forzoso
                model.Add(presente == 0)
        else:
            if en_ventana_total:
                model.Add(sum(en_ventana_total) == 1)

# ------------------------------------------------------------
# Solver principal (refactorizado)
# ------------------------------------------------------------

def _resolver_planificacion(procesos, operarios, maquinarias, fecha_desde: date | None = None, fecha_hasta: date | None = None, horarios_por_operario: dict | None = None, permitir_he: bool = False, permitir_sabado: bool = False):
    model = cp_model.CpModel()

    # Init Config
    config_repo = ConfigRepository()
    blocked_dates = config_repo.get_blocked_dates()
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
    PEON_ID = 1
    AYUDANTE_ID = 11
    OFICIAL_ESP_ID = 8
    TECNICO_ID = 14

    RANGOS_BÁSICOS = {PEON_ID, AYUDANTE_ID}
    RANGOS_ESPECIALIZADOS = {OFICIAL_ESP_ID, TECNICO_ID}

    PENAL_OVERQUAL = 50
    PENAL_DUMMY = 1_000_000
    PENAL_DUMMY_MAQ = 1_000_000

    # ---- Normalizar procesos ----
    procesos_norm, H_local = _normalizar_procesos(procesos, prioridad_pesos)

    # ---- Coordinación de dominios: SETUP hereda de PRODUCCIÓN ----
    # Si un SETUP precede a una PRODUCCIÓN, debe usar el mismo dominio de máquinas
    procesos_norm_list = [list(p) for p in procesos_norm]
    for oid in set(p[0] for p in procesos_norm):
        idxs = sorted([i for i, p in enumerate(procesos_norm) if p[0] == oid], key=lambda i: procesos_norm[i][2])
        for j in range(len(idxs)-1):
            idx_a = idxs[j]
            idx_s = idxs[j+1]
            if (_get_tipo_proceso(procesos_norm[idx_a][7]) == "SETUP" and 
                _get_tipo_proceso(procesos_norm[idx_s][7]) == "PRODUCCION_MAQUINA"):
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
    ) = _crear_variables_y_dominios(
        model,
        procesos_norm,
        operarios,
        maquinarias,
        RANGOS_BÁSICOS,
        RANGOS_ESPECIALIZADOS,
    )

    # ---- Restricciones ----
    _agregar_restricciones_secuencia(model, procesos_norm, inicio_vars, fin_vars, presente_vars=presente_vars)
    _agregar_cadena_presencia(model, procesos_norm, presente_vars)
    _agregar_no_solape_operarios(model, REAL_OP_IDS, inicio_vars, fin_vars, dur_map, operario_vars, presente_vars=presente_vars)
    _agregar_no_solape_maquinas(model,REAL_MAQ_IDS,procesos_norm, inicio_vars,fin_vars,dur_map,maq_vars, presente_vars=presente_vars)
    _agregar_compatibilidad_op_maq(model,procesos_norm,operario_vars,maq_vars,op_domain_vals,maq_domain_vals,op_to_rango,maq_to_rangos,maq_to_familia,DUMMY_OP_ID,DUMMY_MAQ_ID)
    _agregar_coordinacion_maq_setup(model, procesos_norm, maq_vars)
    # ---- Crear ventanas semanales ----
    num_semanas = math.ceil(H / MIN_LABORAL_SEMANA) + 1
    ventanas_default = construir_ventanas_semanales(
        num_semanas, start_date, blocked_dates,
        fecha_hasta=fecha_hasta,
        permitir_he=permitir_he,
        permitir_sabado=permitir_sabado,
    )

    if horarios_por_operario:
        ventanas_por_op = construir_ventanas_por_operario(
            horarios_por_operario,
            start_date,
            blocked_dates,
            fecha_hasta=fecha_hasta,
            num_semanas=num_semanas,
            permitir_he=permitir_he,
            permitir_sabado=permitir_sabado,
        )
        # Operarios sin horario explícito (raros) → usan ventanas estándar
        for op_id in REAL_OP_IDS:
            if op_id not in ventanas_por_op:
                ventanas_por_op[op_id] = list(ventanas_default)

        total_vents = sum(len(v) for v in ventanas_por_op.values())
        logger.info(
            f"PLANIFICADOR: ventanas por operario = {total_vents} totales "
            f"({len(ventanas_por_op)} operarios), default = {len(ventanas_default)} "
            f"(fecha_hasta={fecha_hasta})"
        )

        _agregar_ventanas_horarias_por_operario(
            model,
            procesos_norm,
            inicio_vars,
            dur_map,
            operario_vars,
            op_domain_vals,
            ventanas_por_op,
            ventanas_default,
            DUMMY_OP_ID,
            presente_vars=presente_vars,
        )
    else:
        # Fallback: sin horarios cargados, usamos las ventanas globales (modo Fase 1)
        logger.info(f"PLANIFICADOR: ventanas globales = {len(ventanas_default)} (sin horarios por operario)")
        _agregar_ventanas_horarias(
            model,
            procesos_norm,
            inicio_vars,
            dur_map,
            ventanas_default,
            presente_vars=presente_vars,
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
        PEON_ID,
        AYUDANTE_ID,
        PENAL_OVERQUAL,
        PENAL_DUMMY,
        PENAL_DUMMY_MAQ,
        H,
        presente_vars=presente_vars,
    )


    # ---- Resolver ----
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60
    solver.parameters.num_search_workers = 8
    solver.parameters.log_search_progress = False

    status = solver.Solve(model)

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
        permitir_he=permitir_he,
        permitir_sabado=permitir_sabado,
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
        "SOLICITAR", "TRABAJO DE FORMA", "MANUAL"
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
    permitir_he: bool = False,
    permitir_sabado: bool = False,
):
    logger.info(f"Service - planificar() rango: desde={fecha_desde} hasta={fecha_hasta} forzar={forzar_ordenes_ids}")
    forzar_set = set(forzar_ordenes_ids or [])

    # 🔹 Inyectar repo de skills si no viene
    if not repo_skill:
        repo_skill = OperarioProcesoSkillRepository(db)

    # 🔹 Cargar mapa de skills (proceso_id -> {operario_id: nivel})
    mapa_skills = await repo_skill.get_map_por_proceso()

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
    horarios_por_operario = await repo_operario.find_horarios_por_operario()

    # Cargar maquinarias (con rangos)
    maquinarias_orm = await repo_maquinaria.find_with_rangos()
    maquinarias = []
    for m in maquinarias_orm:
        rangos_ok = {rm.id_rango for rm in (m.rango_maquinarias or [])}
        #maquinarias.append((m.id, rangos_ok, m.nombre)) esto funciona
        maquinarias.append((m.id, rangos_ok, m.nombre, m.cod_maquina))


    procesos_para_solver = []

    # -----------------------
    # Procesar cada orden
    # -----------------------
    for orden in ordenes:
        prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

        for rel in orden.procesos:

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

    # -------------------------------
    # Ejecutar el solver en otro hilo
    # -------------------------------
    # Si el usuario forzó órdenes excedentes en el confirm, re-corremos el solver
    # SIN cota superior de horizonte para que entren todas, y marcamos las forzadas.
    effective_fecha_hasta = None if (not preview and forzar_set) else fecha_hasta

    resultados = await asyncio.to_thread(
        _resolver_planificacion,
        procesos_para_solver,
        operarios,
        maquinarias,
        fecha_desde,
        effective_fecha_hasta,
        horarios_por_operario,
        permitir_he,
        permitir_sabado,
    )

    _anotar_motivos_excedentes(resultados, permitir_he, permitir_sabado)
    planificados, excedentes = _split_resultados(resultados)

    # Fase 3: si quedan urgencias en excedentes y NO se permitieron HE/sábado todavía,
    # construimos una sugerencia para que el usuario decida.
    sugerencia = None
    if not (permitir_he and permitir_sabado):
        sugerencia = _construir_sugerencia(
            excedentes,
            horarios_por_operario,
            permitir_he,
            permitir_sabado,
        )

    if preview:
        resp = {"planificados": planificados, "excedentes": excedentes}
        if sugerencia:
            resp["sugerencia"] = sugerencia
        return resp

    # Marcar como forzado_fuera_rango los procesos cuyas órdenes el usuario decidió forzar
    for r in planificados:
        r["forzado_fuera_rango"] = (r["orden_id"] in forzar_set)

    saved = await repo_planificacion.insertar_planificacion_lote(planificados)
    resp = {"planificados": saved, "excedentes": excedentes}
    if sugerencia:
        resp["sugerencia"] = sugerencia
    return resp

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
        permitir_he: bool = False,
        permitir_sabado: bool = False,
    ):
        logger.info(f"Service - Planificación de procesos pendientes. rango: desde={fecha_desde} hasta={fecha_hasta}")

        if not repo_skill:
            repo_skill = OperarioProcesoSkillRepository(db)

        mapa_skills = await repo_skill.get_map_por_proceso()

        # 🔹 SOLO órdenes con procesos pendientes
        ordenes = await repo_orden.find_with_pending_procesos(ordenes_ids)

        if not ordenes:
            logger.info("Service - No hay procesos pendientes para planificar.")
            return []

        operarios = await repo_operario.find_with_rangos()
        horarios_por_operario = await repo_operario.find_horarios_por_operario()

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

        for orden in ordenes:
            prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

            for rel in orden.procesos:
                # Saltar procesos finalizados (doble seguridad)
                if rel.id_estado == 3:
                    continue

                dur_min = rel.tiempo_proceso or 1
                nombre_proceso = rel.proceso.nombre.lower() if rel.proceso else ""
                usa_maquina = proceso_usa_maquina(nombre_proceso)
                rangos_validos = [rp.id_rango for rp in getattr(rel.proceso, "rangos", [])]
                familia_req = familia_requerida_from_proceso(nombre_proceso) if usa_maquina else ""
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

        resultados = await asyncio.to_thread(
            _resolver_planificacion,
            procesos_para_solver,
            operarios,
            maquinarias,
            fecha_desde,
            fecha_hasta,
            horarios_por_operario,
            permitir_he,
            permitir_sabado,
        )

        _anotar_motivos_excedentes(resultados, permitir_he, permitir_sabado)
        planificados, excedentes = _split_resultados(resultados)

        sugerencia = None
        if not (permitir_he and permitir_sabado):
            sugerencia = _construir_sugerencia(
                excedentes,
                horarios_por_operario,
                permitir_he,
                permitir_sabado,
            )

        saved = await repo_planificacion.insertar_planificacion_lote(planificados)
        resp = {"planificados": saved, "excedentes": excedentes}
        if sugerencia:
            resp["sugerencia"] = sugerencia
        return resp
