# backend/application/PlanificacionService.py
import asyncio
from ortools.sat.python import cp_model
from datetime import datetime, time

from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

# 🔸 Función síncrona que corre OR-Tools
from datetime import datetime

from ortools.sat.python import cp_model
from datetime import datetime, time, date

from datetime import datetime, time, date, timedelta
from ortools.sat.python import cp_model
"""
def _resolver_planificacion(procesos, operarios):
    
    Planificador con:
    - Prioridades, Fechas prometidas, Duración
    - Secuencia dentro de cada OT (no solapadas)
    - Asignación de operarios según rangos permitidos por proceso
    - No solapamiento de tareas por operario
    
    model = cp_model.CpModel()

    # ---- Parámetros ----
    prioridad_pesos = {"urgente": 1, "urgente 1": 1, "urgente 2": 2, "normal": 3, "baja": 4}
    atraso_mult_por_prioridad = {1: 1000, 2: 800, 3: 500, 4: 300, 5: 200}

    # ---- Normalización ----
    # procesos = [(orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc, dur_min, rangos_validos:list[int])]
    procesos_norm = []
    for (orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc, dur_min, rangos_validos) in procesos:
        dur = int(dur_min) if dur_min is not None else 1
        if dur <= 0: dur = 1
        peso_prioridad = prioridad_pesos.get((prioridad_desc or "").strip().lower(), 5)

        # aseguramos lista
        rangos_proc = list(rangos_validos or [])
        procesos_norm.append((orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc))

    H = sum(p[5] for p in procesos_norm) + 60

    # ---- Variables ----
    inicio_vars, fin_vars, intervalo_vars, operario_vars = {}, {}, {}, {}
    # map rápido para saber el rango de un operario asignado
    op_to_rango = {op_id: r_id for (op_id, r_id) in operarios}

    for (orden_id, proc_id, secuencia, _, _, dur, rangos_proc) in procesos_norm:
        start = model.NewIntVar(0, H, f"start_{orden_id}_{proc_id}")
        end   = model.NewIntVar(0, H, f"end_{orden_id}_{proc_id}")
        itv   = model.NewIntervalVar(start, dur, end, f"int_{orden_id}_{proc_id}")

        # ✅ Determinar operarios válidos
        if rangos_proc:
            operarios_validos = [op_id for (op_id, rango_id) in operarios if rango_id in rangos_proc]
        else:
            # sin rangos definidos para el proceso → sin restricción
            operarios_validos = [op_id for (op_id, _) in operarios]

        if not operarios_validos:
            # Evitamos romper el modelo; log + dominio dummy
            print(f"⚠️ Proceso {proc_id} no tiene operarios válidos (rangos requeridos: {rangos_proc})")
            operarios_validos = [999999]  # dominio ficticio

        op_var = model.NewIntVarFromDomain(cp_model.Domain.FromValues(operarios_validos), f"op_{orden_id}_{proc_id}")

        inicio_vars[(orden_id, proc_id)] = start
        fin_vars[(orden_id, proc_id)] = end
        intervalo_vars[(orden_id, proc_id)] = itv
        operario_vars[(orden_id, proc_id)] = op_var

    # ---- Secuencia por OT (tiempo real) ----
    for orden_id in set(p[0] for p in procesos_norm):
        procs = [p for p in procesos_norm if p[0] == orden_id]
        procs.sort(key=lambda x: x[2])  # por secuencia
        for i in range(len(procs) - 1):
            act = procs[i]
            sig = procs[i + 1]
            model.Add(inicio_vars[(orden_id, sig[1])] >= fin_vars[(orden_id, act[1])])

    # ---- No solapamiento por operario (presencia condicional) ----
    for op_id in [op[0] for op in operarios]:
        pres_intervals = []
        for (orden_id, proc_id), op_var in operario_vars.items():
            pres = model.NewBoolVar(f"pres_{orden_id}_{proc_id}_op{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())

            # 🔹 crear un intervalo opcional en lugar de tupla
            start = inicio_vars[(orden_id, proc_id)]
            dur   = procesos_norm[[p[1] for p in procesos_norm].index(proc_id)][5]
            end   = fin_vars[(orden_id, proc_id)]
            opt_interval = model.NewOptionalIntervalVar(start, dur, end, pres, f"opt_{orden_id}_{proc_id}_op{op_id}")
            pres_intervals.append(opt_interval)

        # ✅ ahora AddNoOverlap recibe solo IntervalVar opcionales válidos
        model.AddNoOverlap(pres_intervals)


    # ---- Objetivo: prioridad + atraso + leve preferencia por inicios tempranos ----
    now = datetime.now()
    total_obj = []

    for (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, _rangos_proc) in procesos_norm:
        end = fin_vars[(orden_id, proc_id)]

        # deadline relativo
        if fecha_prometida:
            try:
                fp_dt = fecha_prometida if isinstance(fecha_prometida, datetime) else datetime.combine(fecha_prometida, time.min)
                if fp_dt.date() < date(1970, 1, 1):
                    deadline_rel = H * 10
                else:
                    delta_min = int((fp_dt - now).total_seconds() // 60)
                    deadline_rel = min(max(0, delta_min), H * 10)
            except Exception:
                deadline_rel = H * 10
        else:
            deadline_rel = H * 10

        diff = model.NewIntVar(-H * 10, H * 10, f"diff_{orden_id}_{proc_id}")
        model.Add(diff == end - deadline_rel)

        lateness = model.NewIntVar(0, H * 10, f"late_{orden_id}_{proc_id}")
        model.AddMaxEquality(lateness, [diff, 0])

        mult = atraso_mult_por_prioridad.get(peso_prioridad, 200)
        total_obj.append((lateness, mult))

        base_prior = model.NewIntVar(0, 10000, f"base_{orden_id}_{proc_id}")
        model.Add(base_prior == (6 - min(peso_prioridad, 5)) * 100)
        total_obj.append((base_prior, 1))

        total_obj.append((inicio_vars[(orden_id, proc_id)], 1))

    model.Minimize(sum(v * c for (v, c) in total_obj))

    # ---- Resolver ----
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    status = solver.Solve(model)

    resultados = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc) in procesos_norm:
            op_id = solver.Value(operario_vars[(orden_id, proc_id)])
            resultados.append({
                "orden_id": orden_id,
                "proceso_id": proc_id,
                "inicio_min": solver.Value(inicio_vars[(orden_id, proc_id)]),
                "fin_min": solver.Value(fin_vars[(orden_id, proc_id)]),
                "duracion_min": dur,
                "prioridad_peso": peso_prioridad,
                "id_operario": op_id,
                "id_rango_operario": op_to_rango.get(op_id),   # útil para debug / UI
                "rangos_permitidos_proceso": rangos_proc,       # útil para debug / UI
                "fecha_prometida": fecha_prometida.strftime("%Y-%m-%d") if fecha_prometida else None
            })
    else:
        print("❌ No se encontró solución.")

    return resultados
"""

def _resolver_planificacion(procesos, operarios):
    """
    Planificador con:
    - Prioridades, Fechas prometidas, Duración
    - Secuencia dentro de cada OT (no solapadas)
    - Asignación de operarios según rangos permitidos por proceso
    - No solapamiento de tareas por operario
    """
    model = cp_model.CpModel()

    # ---- Parámetros ----
    prioridad_pesos = {"urgente": 1, "urgente 1": 1, "urgente 2": 2, "normal": 3, "baja": 4}
    atraso_mult_por_prioridad = {1: 1000, 2: 800, 3: 500, 4: 300, 5: 200}

    # ✅ IDs de rangos (ajustar si difieren en tu BD)
    PEON_ID = 1
    AYUDANTE_ID = 11
    OFICIAL_ESP_ID = 8
    TECNICO_ID = 14

    RANGOS_BÁSICOS = {PEON_ID, AYUDANTE_ID}
    RANGOS_ESPECIALIZADOS = {OFICIAL_ESP_ID, TECNICO_ID}

    # Penalizaciones
    PENAL_OVERQUAL = 50        # leve penalización por sobre-cualificación (rango alto haciendo tarea básica)
    PENAL_DUMMY = 1_000_000    # muy alta: evita "sin asignar" salvo que sea imposible

    # ---- Normalización ----
    # procesos = [(orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc, dur_min, rangos_validos:list[int])]
    procesos_norm = []
    for (orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc, dur_min, rangos_validos) in procesos:
        dur = int(dur_min) if dur_min is not None else 1
        if dur <= 0:
            dur = 1
        peso_prioridad = prioridad_pesos.get((prioridad_desc or "").strip().lower(), 5)

        # aseguramos lista
        rangos_proc = list(rangos_validos or [])
        procesos_norm.append((orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc))

    # Horizonte un poco más laxo
    H = sum(p[5] for p in procesos_norm) + 8 * 60  # +8hs

    # ---- Variables ----
    inicio_vars, fin_vars, intervalo_vars, operario_vars = {}, {}, {}, {}
    dur_map = {}
    # map rápido para saber el rango de un operario asignado
    op_to_rango = {op_id: r_id for (op_id, r_id) in operarios}

    # Dominio de operarios reales y dummy
    REAL_OP_IDS = [op_id for (op_id, _) in operarios]
    DUMMY_OP_ID = 999999

    for (orden_id, proc_id, secuencia, _, _, dur, rangos_proc) in procesos_norm:
        start = model.NewIntVar(0, H, f"start_{orden_id}_{proc_id}")
        end   = model.NewIntVar(0, H, f"end_{orden_id}_{proc_id}")
        itv   = model.NewIntervalVar(start, dur, end, f"int_{orden_id}_{proc_id}")

        dur_map[(orden_id, proc_id)] = dur

        # ✅ Determinar operarios válidos con política jerárquica:
        # - Si el proceso pide rangos básicos (PEÓN/AYUDANTE) → puede hacerlo cualquiera (flexibilizamos)
        # - Si el proceso pide especializados (OFICIAL ESP./TÉCNICO) → restringimos a esos rangos
        if not rangos_proc:
            # sin rangos definidos para el proceso → sin restricción
            operarios_validos = REAL_OP_IDS[:]
        else:
            requiere_basicos = any(rid in RANGOS_BÁSICOS for rid in rangos_proc)
            requiere_especial = any(rid in RANGOS_ESPECIALIZADOS for rid in rangos_proc)
            if requiere_especial:
                # Solo operarios cuyo rango esté en los requeridos especializados
                objetivo = set(rangos_proc) & RANGOS_ESPECIALIZADOS
                operarios_validos = [op_id for (op_id, rango_id) in operarios if rango_id in objetivo]
            elif requiere_basicos:
                # Cualquiera puede (rango alto cubre tarea básica)
                operarios_validos = REAL_OP_IDS[:]
            else:
                # Otros casos: match exacto por IDs listados
                operarios_validos = [op_id for (op_id, rango_id) in operarios if rango_id in rangos_proc]

        if not operarios_validos:
            # Evitamos romper el modelo; log + dejamos dummy con gran penalización
            print(f"⚠️ Proceso {proc_id} no tiene operarios válidos (rangos requeridos: {rangos_proc})")
            operarios_validos = [DUMMY_OP_ID]

        op_var = model.NewIntVarFromDomain(cp_model.Domain.FromValues(operarios_validos), f"op_{orden_id}_{proc_id}")

        inicio_vars[(orden_id, proc_id)] = start
        fin_vars[(orden_id, proc_id)] = end
        intervalo_vars[(orden_id, proc_id)] = itv
        operario_vars[(orden_id, proc_id)] = op_var

    # ---- Secuencia por OT (tiempo real) ----
    for orden_id in set(p[0] for p in procesos_norm):
        procs = [p for p in procesos_norm if p[0] == orden_id]
        procs.sort(key=lambda x: x[2])  # por secuencia
        for i in range(len(procs) - 1):
            act = procs[i]
            sig = procs[i + 1]
            model.Add(inicio_vars[(orden_id, sig[1])] >= fin_vars[(orden_id, act[1])])

    # ---- No solapamiento por operario (intervalos opcionales) + asignación única ----
    for op_id in REAL_OP_IDS:
        pres_intervals = []
        for (orden_id, proc_id), op_var in operario_vars.items():
            # Si este operador no está en el dominio de la variable, saltamos
            # (para evitar crear literales inútiles)
            # Nota: comprobamos rápido con Domain.FromValues en la creación; aquí aproximamos:
            # creamos literal y canalizamos igualmente (es eficiente).
            pres = model.NewBoolVar(f"pres_{orden_id}_{proc_id}_op{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())

            start = inicio_vars[(orden_id, proc_id)]
            end   = fin_vars[(orden_id, proc_id)]
            dur   = dur_map[(orden_id, proc_id)]
            opt_interval = model.NewOptionalIntervalVar(start, dur, end, pres, f"opt_{orden_id}_{proc_id}_op{op_id}")
            pres_intervals.append(opt_interval)

        model.AddNoOverlap(pres_intervals)

    # Para cada tarea: asegurar que exactamente uno esté elegido (algún real o dummy)
    total_obj = []
    now = datetime.now()

    for (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc) in procesos_norm:
        op_var = operario_vars[(orden_id, proc_id)]

        # Literales de presencia para reales
        pres_list = []
        for op_id in REAL_OP_IDS:
            pres = model.NewBoolVar(f"pick_{orden_id}_{proc_id}_op{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())
            pres_list.append(pres)

        # Dummy (sin recurso)
        pick_dummy = model.NewBoolVar(f"pick_{orden_id}_{proc_id}_dummy")
        model.Add(op_var == DUMMY_OP_ID).OnlyEnforceIf(pick_dummy)
        model.Add(op_var != DUMMY_OP_ID).OnlyEnforceIf(pick_dummy.Not())

        # Exactly-one entre reales y dummy
        model.Add(sum(pres_list) + pick_dummy == 1)

        # ---- Objetivo: prioridad + atraso + leve preferencia por inicios tempranos ----
        end = fin_vars[(orden_id, proc_id)]
        # deadline relativo
        if fecha_prometida:
            try:
                fp_dt = fecha_prometida if isinstance(fecha_prometida, datetime) else datetime.combine(fecha_prometida, time.min)
                if fp_dt.date() < date(1970, 1, 1):
                    deadline_rel = H * 10
                else:
                    delta_min = int((fp_dt - now).total_seconds() // 60)
                    deadline_rel = min(max(0, delta_min), H * 10)
            except Exception:
                deadline_rel = H * 10
        else:
            deadline_rel = H * 10

        diff = model.NewIntVar(-H * 10, H * 10, f"diff_{orden_id}_{proc_id}")
        model.Add(diff == end - deadline_rel)

        lateness = model.NewIntVar(0, H * 10, f"late_{orden_id}_{proc_id}")
        model.AddMaxEquality(lateness, [diff, 0])

        mult = atraso_mult_por_prioridad.get(peso_prioridad, 200)
        total_obj.append((lateness, mult))

        base_prior = model.NewIntVar(0, 10000, f"base_{orden_id}_{proc_id}")
        model.Add(base_prior == (6 - min(peso_prioridad, 5)) * 100)
        total_obj.append((base_prior, 1))

        total_obj.append((inicio_vars[(orden_id, proc_id)], 1))

        # Penalización por dummy (sin asignar)
        total_obj.append((pick_dummy, PENAL_DUMMY))

        # Penalización leve por sobre-cualificación en tareas básicas
        if rangos_proc and any(rid in RANGOS_BÁSICOS for rid in rangos_proc):
            # Si el operario asignado NO es básico, penalizamos un poquito
            is_over = model.NewBoolVar(f"overq_{orden_id}_{proc_id}")
            # over = OR(op_var not in RANGOS_BÁSICOS)
            # Implementamos con dos literales (o una tabla pequeña):
            in_basic = model.NewBoolVar(f"in_basic_{orden_id}_{proc_id}")
            # Si hay exactamente 2 básicos, podemos hacer:
            b1 = model.NewBoolVar(f"eq_b1_{orden_id}_{proc_id}")
            b2 = model.NewBoolVar(f"eq_b2_{orden_id}_{proc_id}")
            model.Add(op_var == PEON_ID).OnlyEnforceIf(b1)
            model.Add(op_var != PEON_ID).OnlyEnforceIf(b1.Not())
            model.Add(op_var == AYUDANTE_ID).OnlyEnforceIf(b2)
            model.Add(op_var != AYUDANTE_ID).OnlyEnforceIf(b2.Not())
            model.Add(in_basic == 1).OnlyEnforceIf([b1, b2.Not()])  # (op==PEON) y no AYUDANTE a la vez
            # La forma más estable: AllowedAssignments pequeña:
            # model.AddAllowedAssignments([op_var], [[PEON_ID], [AYUDANTE_ID]])  # esto restringiría demasiado
            # Por simplicidad: definimos over = NOT(in_basic) vía canalización aproximada:
            # Ligamos is_over con (op_var != PEON_ID) AND (op_var != AYUDANTE_ID)
            not_b1 = model.NewBoolVar(f"not_b1_{orden_id}_{proc_id}")
            not_b2 = model.NewBoolVar(f"not_b2_{orden_id}_{proc_id}")
            model.Add(op_var != PEON_ID).OnlyEnforceIf(not_b1)
            model.Add(op_var == PEON_ID).OnlyEnforceIf(not_b1.Not())
            model.Add(op_var != AYUDANTE_ID).OnlyEnforceIf(not_b2)
            model.Add(op_var == AYUDANTE_ID).OnlyEnforceIf(not_b2.Not())
            # is_over = AND(not_b1, not_b2)
            # CP-SAT no tiene AND directo, lo modelamos: is_over <= not_b1, is_over <= not_b2, is_over >= not_b1 + not_b2 - 1
            model.Add(is_over <= not_b1)
            model.Add(is_over <= not_b2)
            tmp = model.NewIntVar(0, 2, f"tmp_over_{orden_id}_{proc_id}")
            model.Add(tmp == not_b1 + not_b2)
            model.Add(is_over >= tmp - 1)
            total_obj.append((is_over, PENAL_OVERQUAL))

    model.Minimize(sum(v * c for (v, c) in total_obj))

    # ---- Resolver ----
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30
    solver.parameters.num_search_workers = 8
    solver.parameters.log_search_progress = True

    status = solver.Solve(model)

    resultados = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc) in procesos_norm:
            op_id = solver.Value(operario_vars[(orden_id, proc_id)])
            resultados.append({
                "orden_id": orden_id,
                "proceso_id": proc_id,
                "inicio_min": solver.Value(inicio_vars[(orden_id, proc_id)]),
                "fin_min": solver.Value(fin_vars[(orden_id, proc_id)]),
                "duracion_min": dur,
                "prioridad_peso": peso_prioridad,
                "id_operario": op_id if op_id != DUMMY_OP_ID else None,
                "id_rango_operario": op_to_rango.get(op_id) if op_id != DUMMY_OP_ID else None,
                "rangos_permitidos_proceso": rangos_proc,
                "fecha_prometida": fecha_prometida.strftime("%Y-%m-%d") if fecha_prometida else None,
                "sin_asignar": (op_id == DUMMY_OP_ID)
            })
    else:
        print("❌ No se encontró solución.")

    return resultados




# 🔸 Función async que envuelve al solver
"""async def planificar(repo_orden: OrdenTrabajoRepository, repo_operario: OperarioRepository):
    ordenes = await repo_orden.find_with_procesos()
    operarios = await repo_operario.find_with_rangos()  # [(id_operario, id_rango), ...]

    procesos_para_solver = []
    for orden in ordenes:
        prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

        for rel in orden.procesos:
            dur_min = rel.tiempo_proceso or 1  # minutos (puede ser None/0)

            # ✅ NUEVO: lista de rangos permitidos para el proceso (vía RangoProceso)
            rangos_validos = [rp.id_rango for rp in getattr(rel.proceso, "rangos", [])]

            procesos_para_solver.append((
                orden.id,
                rel.proceso.id,
                rel.orden,                 # secuencia dentro de la OT
                orden.fecha_prometida,     # deadline
                prioridad_desc,            # "urgente", "normal", etc.
                dur_min,                   # duración (min)
                rangos_validos             # ✅ lista de rangos válidos (puede estar vacía)
            ))

    # ✅ pasar operarios al solver (antes faltaba)
    resultados = await asyncio.to_thread(_resolver_planificacion, procesos_para_solver, operarios)
    return resultados"""
async def planificar(repo_orden: OrdenTrabajoRepository, repo_operario: OperarioRepository):
    ordenes = await repo_orden.find_with_procesos()
    operarios = await repo_operario.find_with_rangos()  # [(id_operario, id_rango), ...]

    procesos_para_solver = []
    for orden in ordenes:
        prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

        for rel in orden.procesos:
            dur_min = rel.tiempo_proceso or 1  # minutos (puede ser None/0)

            # ✅ NUEVO: lista de rangos permitidos para el proceso (vía RangoProceso)
            rangos_validos = [rp.id_rango for rp in getattr(rel.proceso, "rangos", [])]

            procesos_para_solver.append((
                orden.id,
                rel.proceso.id,
                rel.orden,                 # secuencia dentro de la OT
                orden.fecha_prometida,     # deadline
                prioridad_desc,            # "urgente", "normal", etc.
                dur_min,                   # duración (min)
                rangos_validos             # lista de rangos válidos (puede estar vacía)
            ))

    resultados = await asyncio.to_thread(_resolver_planificacion, procesos_para_solver, operarios)
    return resultados
