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
MIN_LABORAL_DIA = 495
MIN_LABORAL_SEMANA = 5 * MIN_LABORAL_DIA + 300  # Lun–Vie + Sáb medio día = 2775

TRAMOS_LV_LAB = [
    (0, 120),
    (120, 285),
    (285, 495),
]

TRAMOS_SAB_LAB = [
    (0, 300),
]
# ------------------------------------------------------------------
#Funcion para ventanas semanales en tiempo.
def construir_ventanas_semanales(num_semanas: int, start_date: date, blocked_dates: list[str]):
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
            day_capacity = 300 # Approx
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
            
        else:
             # Add segments for this day
             for ini, fin in tramos:
                 ventanas.append((current_base_minutes + ini, current_base_minutes + fin))
             
             # Advance base minutes
             day_duration = MIN_LABORAL_DIA if weekday < 5 else 300
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

        maqs_validas = []

        if tipo_proc == "SETUP":
            # Lógica SETUP: Buscar coincidencia de nombre de máquina
            # Ej: PREPARACION DE TORNO -> busca "TORNO" en nombres de máquinas
            base = (
                nombre_upper
                .replace("PREPARACION DE", "")
                .replace("PREPARACION", "")
                .replace("CAMBIO DE", "")
                .strip()
            )

            # Buscamos máquinas cuyo nombre contenga la base
            # Esto es un filtro simple como pidió el usuario
            posibles = [
                m_id for (m_id, _rs, nombre_m, _cod) in maquinarias
                if base and base in (nombre_m or "").upper()
            ]

            if posibles:
                maqs_validas = posibles
            else:
                # ❌ ANTES: Fallback abierto (REAL_MAQ_IDS)
                # ✅ AHORA: Dummy si no encuentra match
                logger.warning(f"SETUP {proc_id} ({nombre_proc}) no encontró máquina para '{base}'; asignando DUMMY.")
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
    )


def _agregar_restricciones_secuencia(model, procesos_norm, inicio_vars, fin_vars):
    """
    Asegura que, dentro de una misma orden de trabajo,
    los procesos respeten su secuencia.
    """
    for orden_id in set(p[0] for p in procesos_norm):
        procs = [p for p in procesos_norm if p[0] == orden_id]
        procs.sort(key=lambda x: x[2])  # por secuencia
        for i in range(len(procs) - 1):
            act = procs[i]
            sig = procs[i + 1]
            model.Add(inicio_vars[(orden_id, sig[2])] >= fin_vars[(orden_id, act[2])])


def _agregar_no_solape_operarios(
    model,
    REAL_OP_IDS,
    inicio_vars,
    fin_vars,
    dur_map,
    operario_vars,
):
    """
    Añade restricciones de no solapamiento por operario
    usando intervalos opcionales.
    """
    for op_id in REAL_OP_IDS:
        pres_intervals = []
        for (orden_id, secuencia), op_var in operario_vars.items():
            pres = model.NewBoolVar(f"pres_{orden_id}_{secuencia}_op{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())

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
):
    """
    Añade restricciones de no solapamiento por maquinaria
    usando intervalos opcionales.
    """
    for m_id in REAL_MAQ_IDS:
        pres_intervals = []
        for (orden_id, proc_id, secuencia, _fp, _pp, _dur, _rangos, _nombre, usa_maquina,_familia_req, _skills) in procesos_norm:

            # ❌ Proceso manual → no genera intervalos de maquinaria
            if not usa_maquina:
                continue

            maq_var = maq_vars[(orden_id, secuencia)]

            pres = model.NewBoolVar(f"mpres_{orden_id}_{secuencia}_m{m_id}")
            model.Add(maq_var == m_id).OnlyEnforceIf(pres)
            model.Add(maq_var != m_id).OnlyEnforceIf(pres.Not())

            start = inicio_vars[(orden_id, secuencia)]
            end   = fin_vars[(orden_id, secuencia)]
            dur   = dur_map[(orden_id, secuencia)]

            opt_interval = model.NewOptionalIntervalVar(
                start, dur, end, pres,
                f"i_maq_{orden_id}_{secuencia}_{m_id}"
            )
            pres_intervals.append(opt_interval)

        model.AddNoOverlap(pres_intervals)


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
):
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
        total_obj.append((lateness, mult))

        base_prior = model.NewIntVar(0, 10000, f"base_{orden_id}_{secuencia}")
        model.Add(base_prior == (6 - min(peso_prioridad, 5)) * 100)
        total_obj.append((base_prior, 1))

        total_obj.append((inicio_vars[(orden_id, secuencia)], 1))

        # Penalizaciones por dummy
        total_obj.append((pick_dummy, PENAL_DUMMY))
        #total_obj.append((pick_dummy_maq, PENAL_DUMMY_MAQ))
        if usa_maquina:
            total_obj.append((pick_dummy_maq, PENAL_DUMMY_MAQ))


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
            total_obj.append((is_over, PENAL_OVERQUAL))

    model.Minimize(sum(v * c for (v, c) in total_obj))


def _convertir_minutos_a_fecha(minutos_acumulados: int, ahora_ref=None):
    """
    Convierte minutos de trabajo (desde 'ahora') a una fecha real,
    respetando la capacidad diaria definida (MIN_LABORAL_DIA) y calendario.
    Sábados son laborables (300 min), Domingos no.
    """
    from datetime import timedelta
    
    # Load blocked dates first
    config_repo = ConfigRepository()
    blocked_dates = set(config_repo.get_blocked_dates())

    ahora = ahora_ref if ahora_ref else datetime.now()
    inicio_base = ahora
    
    # 1. Ajustar inicio si cae fuera de horario (antes de 7 o despues de 17)
    if inicio_base.hour < 7:
        inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
    elif inicio_base.hour >= 17:
        inicio_base = inicio_base + timedelta(days=1)
        inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
    
    # Helper para avanzar a un día válido (CHECK BLOCKED HERE)
    def avanzar_a_dia_valido(fecha):
        while True:
            wd = fecha.weekday()
            is_blocked = fecha.strftime("%Y-%m-%d") in blocked_dates
            # Domingo (6) O Bloqueado -> Saltar
            if wd == 6 or is_blocked: 
                fecha += timedelta(days=1)
                fecha = fecha.replace(hour=7, minute=0, second=0, microsecond=0)
            else:
                break
        return fecha

    # 2. Asegurar que el día de inicio es válido
    tiempo_actual = avanzar_a_dia_valido(inicio_base)
    minutos_restantes = minutos_acumulados

    # Minutos por dia laboral (7 a 17 = 10 horas = 600 min)
    while minutos_restantes > 0:
        wd = tiempo_actual.weekday()
        
        # Determinar capacidad máxima de hoy
        if wd < 5: # Lun-Vie
            capacidad_hoy = MIN_LABORAL_DIA # 495
        elif wd == 5: # Sab
            capacidad_hoy = 300
        else:
            capacidad_hoy = 0 # No debería pasar
            
        # Hora fin jornada basado en capacidad?
        # El visualizador usaba 17:00 fijo. Esto es aproximado.
        # Si capacity=495, fin es 15:15.
        # Si visualizamos hasta las 17:00, distorsionamos la linea de tiempo del solver.
        # Probemos alinear con 17:00 (600m) para Lun-Vie y ajustar?
        # Mejor usar capacidad real para descontar minutos.
        
        # Definir inicio jornada hoy
        hora_inicio_jornada = tiempo_actual.replace(hour=7, minute=0, second=0, microsecond=0)
        
        if tiempo_actual < hora_inicio_jornada:
             tiempo_actual = hora_inicio_jornada

        # Fin de jornada
        fin_jornada = hora_inicio_jornada + timedelta(minutes=capacidad_hoy)
        
        if tiempo_actual >= fin_jornada:
            tiempo_actual += timedelta(days=1)
            tiempo_actual = tiempo_actual.replace(hour=7, minute=0, second=0, microsecond=0)
            tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
            continue

        minutos_disponibles_hoy = (fin_jornada - tiempo_actual).total_seconds() / 60
        
        if minutos_restantes <= minutos_disponibles_hoy:
            tiempo_actual += timedelta(minutes=minutos_restantes)
            minutos_restantes = 0
        else:
            tiempo_actual += timedelta(minutes=minutos_disponibles_hoy)
            minutos_restantes -= minutos_disponibles_hoy
            # Avanzar al proximo dia laboral
            tiempo_actual += timedelta(days=1)
            tiempo_actual = tiempo_actual.replace(hour=7, minute=0, second=0, microsecond=0)
            tiempo_actual = avanzar_a_dia_valido(tiempo_actual)
    
    return tiempo_actual.isoformat()


def _extraer_resultados(solver,status,procesos_norm,inicio_vars,fin_vars,operario_vars,maq_vars,op_to_rango, DUMMY_OP_ID,DUMMY_MAQ_ID, start_time_ref):
    """
    Transforma la solución CP-SAT en la lista de dicts que tu servicio guarda en BD.
    """
    resultados = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (orden_id, proc_id, secuencia, fecha_prometida,
            peso_prioridad, dur, rangos_proc, nombre_proceso,usa_maquinaria,_familia_req, _skills) in procesos_norm:

            op_id  = solver.Value(operario_vars[(orden_id, secuencia)])
            maq_id = solver.Value(maq_vars[(orden_id, secuencia)])

            inicio_m = solver.Value(inicio_vars[(orden_id, secuencia)])
            fin_m = solver.Value(fin_vars[(orden_id, secuencia)])

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
                # Fechas estimadas reales - USANDO REFERENCIA FIJA
                "fecha_inicio_estimada": _convertir_minutos_a_fecha(inicio_m, start_time_ref),
                "fecha_fin_estimada": _convertir_minutos_a_fecha(fin_m, start_time_ref),
            })
        
        # 🔹 ORDENAR RESULTADOS POR ORDEN Y SECUENCIA PARA EVITAR CONFUSIÓN EN UI
        resultados.sort(key=lambda x: (x["orden_id"], x["secuencia"]))
    else:
        logger.warning("No se encontró solución.")
        raise PlanificacionException("No se pudo generar una planificación viable con las restricciones actuales.")

    return resultados

def _agregar_ventanas_horarias(model,procesos_norm,inicio_vars,dur_map,ventanas):
    """
    Obliga a que cada proceso:
    - empiece dentro de una ventana laboral
    - termine antes de que esa ventana cierre
    """

    for (orden_id, proc_id, secuencia, *_resto) in procesos_norm:
        start = inicio_vars[(orden_id, secuencia)]
        dur = dur_map[(orden_id, secuencia)]

        # Un booleano por ventana
        en_ventana = []

        for idx, (v_ini, v_fin) in enumerate(ventanas):
            b = model.NewBoolVar(f"vent_{orden_id}_{secuencia}_{idx}")

            # Si b == 1 → el proceso está dentro de esta ventana
            model.Add(start >= v_ini).OnlyEnforceIf(b)
            model.Add(start < v_fin).OnlyEnforceIf(b)

            en_ventana.append(b)

        # Debe estar en EXACTAMENTE una ventana
        model.Add(sum(en_ventana) == 1)

# ------------------------------------------------------------
# Solver principal (refactorizado)
# ------------------------------------------------------------

def _resolver_planificacion(procesos, operarios, maquinarias):
    model = cp_model.CpModel()
    
    # Init Config
    config_repo = ConfigRepository()
    blocked_dates = config_repo.get_blocked_dates()
    logger.info(f"PLANIFICADOR: Fechas bloqueadas cargadas: {blocked_dates}")
    
    # Determine start date (Logic similar to conversion)
    ahora = datetime.now()
    inicio_base = ahora
    if inicio_base.hour < 7:
        inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
    elif inicio_base.hour >= 17:
        inicio_base = inicio_base + timedelta(days=1)
        inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
    
    # Skip weekends for start
    while inicio_base.weekday() >= 5: 
        inicio_base += timedelta(days=1)
        inicio_base = inicio_base.replace(hour=7, minute=0, second=0, microsecond=0)
        
    start_date = inicio_base.date()


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
    ) = _crear_variables_y_dominios(
        model,
        procesos_norm,
        operarios,
        maquinarias,
        RANGOS_BÁSICOS,
        RANGOS_ESPECIALIZADOS,
    )

    # ---- Restricciones ----
    _agregar_restricciones_secuencia(model, procesos_norm, inicio_vars, fin_vars)
    _agregar_no_solape_operarios(model, REAL_OP_IDS, inicio_vars, fin_vars, dur_map, operario_vars)
    _agregar_no_solape_maquinas(model,REAL_MAQ_IDS,procesos_norm, inicio_vars,fin_vars,dur_map,maq_vars)
    _agregar_compatibilidad_op_maq(model,procesos_norm,operario_vars,maq_vars,op_domain_vals,maq_domain_vals,op_to_rango,maq_to_rangos,maq_to_familia,DUMMY_OP_ID,DUMMY_MAQ_ID)
    # ---- Crear ventanas semanales ----
    num_semanas = math.ceil(H / MIN_LABORAL_SEMANA) + 1
    ventanas = construir_ventanas_semanales(num_semanas, start_date, blocked_dates)
    #ventanas = construir_ventanas_semanales()

    # ---- Restricciones de ventanas horarias ----
    _agregar_ventanas_horarias(
        model,
        procesos_norm,
        inicio_vars,
        dur_map,
        ventanas
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
    )


    # ---- Resolver ----
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30
    solver.parameters.num_search_workers = 8
    solver.parameters.log_search_progress = False

    status = solver.Solve(model)

    # Capturamos el 'ahora' una sola vez para que todas las conversiones sean consistentes
    ahora_audit = datetime.now()

    # ---- Auditoría de Precedencias ----
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        logger.info(f"AUDITORÍA DE PRECEDENCIAS: Verificando solución (Ref: {ahora_audit.isoformat()})...")
        ord_ids = sorted(list(set(p[0] for p in procesos_norm)))
        for oid in ord_ids:
            p_order = sorted([p for p in procesos_norm if p[0] == oid], key=lambda x: x[2])
            prev_end = -1
            for p_info in p_order:
                oid_p, pid_p, seq_p = p_info[0], p_info[1], p_info[2]
                st_val = solver.Value(inicio_vars[(oid_p, seq_p)])
                en_val = solver.Value(fin_vars[(oid_p, seq_p)])
                
                # Convertir a fecha para el log también
                fecha_st = _convertir_minutos_a_fecha(st_val, ahora_audit)
                
                msg = f"OT {oid_p} | Seq {seq_p} | Proc {pid_p} | Start {st_val} ({fecha_st}) | End {en_val}"
                if st_val < prev_end:
                    logger.error(f"❌ VIOLACIÓN: {msg} (Inicia antes de que termine el anterior en {prev_end})")
                else:
                    logger.info(f"✅ OK: {msg}")
                prev_end = en_val

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
        ahora_audit
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
    
    # 1. SETUP / PREPARACION
    if n.startswith("PREPARACION") or n.startswith("CAMBIO DE") or "SETUP" in n:
        # Excepciones que podrían ser manuales? Por ahora asumimos que SETUP implica tocar máquina
        # salvo que sea algo muy obvio. Pero el usuario pidió: 'PREPARACION...' -> SETUP.
        return "SETUP"

    # 2. PROCESOS MANUALES (Lista explicita fuerte)
    # Palabras clave que indican proceso MANUAL
    keywords_manual = [
        "EMBALAD", "DESARM", "ENSAMBL", "LAVADO", "LIMPIEZA",
        "REBABA", "REBARB", "AMOLAD", "PROGRAM", "BICELAD", "BISELAD", 
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
):
    
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
    resultados = await asyncio.to_thread(
        _resolver_planificacion,
        procesos_para_solver,
        operarios,
        maquinarias
    )

    if preview:
        return resultados

    # Insertar resultados
    return await repo_planificacion.insertar_planificacion_lote(resultados)

async def planificar_pendientes(
        repo_orden,
        repo_operario,
        repo_maquinaria,
        repo_planificacion,
        db,
        ordenes_ids: list[int] | None = None,
        repo_skill: OperarioProcesoSkillRepository | None = None
    ):
        logger.info("Service - Planificación de procesos pendientes.")
        
        if not repo_skill:
            repo_skill = OperarioProcesoSkillRepository(db)
        
        mapa_skills = await repo_skill.get_map_por_proceso()

        # 🔹 SOLO órdenes con procesos pendientes
        ordenes = await repo_orden.find_with_pending_procesos(ordenes_ids)

        if not ordenes:
            logger.info("Service - No hay procesos pendientes para planificar.")
            return []

        operarios = await repo_operario.find_with_rangos()

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
            maquinarias
        )

        return await repo_planificacion.insertar_planificacion_lote(resultados)
