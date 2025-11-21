# backend/application/PlanificacionService.py
import asyncio
from ortools.sat.python import cp_model
from datetime import datetime, time

import uuid

from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository
#from backend.infrastructure.PlanificacionRepository import PlanificacionRepository
# 🔸 Función síncrona que corre OR-Tools
from datetime import datetime

from ortools.sat.python import cp_model
from datetime import datetime, time, date

from datetime import datetime, time, date, timedelta
from ortools.sat.python import cp_model

from sqlalchemy import text


def _resolver_planificacion(procesos, operarios, maquinarias):
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

    PENAL_OVERQUAL = 50
    PENAL_DUMMY = 1_000_000
    PENAL_DUMMY_MAQ = 1_000_000

    # ---- Normalización ----
    procesos_norm = []
    for (orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc, dur_min, rangos_validos, nombre_proceso) in procesos:
        dur = int(dur_min) if dur_min is not None else 1
        if dur <= 0:
            dur = 1
        peso_prioridad = prioridad_pesos.get((prioridad_desc or "").strip().lower(), 5)
        rangos_proc = list(rangos_validos or [])
        procesos_norm.append((orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc, nombre_proceso))

    H = sum(p[5] for p in procesos_norm) + 8 * 60

    # ---- Variables ----
    inicio_vars, fin_vars, intervalo_vars, operario_vars = {}, {}, {}, {}
    maq_vars = {}
    dur_map = {}

    op_to_rango = {op_id: r_id for (op_id, r_id) in operarios}
    REAL_OP_IDS = [op_id for (op_id, _) in operarios]
    DUMMY_OP_ID = 999999

    REAL_MAQ_IDS = [m_id for (m_id, _rs, _nombre) in maquinarias]
    DUMMY_MAQ_ID = 999998

    maq_to_rangos = {m_id: set(rs) for (m_id, rs, _nombre) in maquinarias}

    op_domain_vals = {}
    maq_domain_vals = {}

    for (orden_id, proc_id, secuencia, _, _, dur, rangos_proc, nombre_proc) in procesos_norm:
        start = model.NewIntVar(0, H, f"start_{orden_id}_{proc_id}")
        end   = model.NewIntVar(0, H, f"end_{orden_id}_{proc_id}")
        itv   = model.NewIntervalVar(start, dur, end, f"int_{orden_id}_{proc_id}")
        dur_map[(orden_id, proc_id)] = dur

        # ---- Operarios válidos
        if not rangos_proc:
            operarios_validos = REAL_OP_IDS[:]
        else:
            requiere_basicos = any(rid in RANGOS_BÁSICOS for rid in rangos_proc)
            requiere_especial = any(rid in RANGOS_ESPECIALIZADOS for rid in rangos_proc)
            if requiere_especial:
                objetivo = set(rangos_proc) & RANGOS_ESPECIALIZADOS
                operarios_validos = [op_id for (op_id, rango_id) in operarios if rango_id in objetivo]
            elif requiere_basicos:
                operarios_validos = REAL_OP_IDS[:]
            else:
                operarios_validos = [op_id for (op_id, rango_id) in operarios if rango_id in rangos_proc]

        if not operarios_validos:
            print(f"⚠️ Proceso {proc_id} sin operarios válidos; usando dummy")
            operarios_validos = [DUMMY_OP_ID]

        op_var = model.NewIntVarFromDomain(cp_model.Domain.FromValues(operarios_validos), f"op_{orden_id}_{proc_id}")

        # ---- Maquinarias válidas 🧩 MODIFICADO PARA PREPARACION
        nombre_proc_upper = (nombre_proc or "").upper()
        if "PREPARACION" in nombre_proc_upper:
            # Extrae parte del nombre luego de "PREPARACION DE"
            base_name = nombre_proc_upper.replace("PREPARACION DE", "").replace("PREPARACION", "").strip()
            posibles = []
            for (m_id, _rangos, nombre_m) in maquinarias:
                if base_name and base_name in nombre_m.upper():
                    posibles.append(m_id)

            if posibles:
                maqs_validas = posibles
            else:
                print(f"⚠️ Proceso {proc_id} ({nombre_proc}) no encontró máquina directa; usando fallback")
                maqs_validas = REAL_MAQ_IDS[:]
        else:
            # Regla general por rangos
            if not rangos_proc:
                maqs_validas = REAL_MAQ_IDS[:]
            else:
                req = set(rangos_proc)
                maqs_validas = [m_id for (m_id, rs, _n) in maquinarias if req & rs]

        if not maqs_validas:
            print(f"⚠️ Proceso {proc_id} sin máquinas compatibles; usando dummy")
            maqs_validas = [DUMMY_MAQ_ID]

        maq_var = model.NewIntVarFromDomain(cp_model.Domain.FromValues(maqs_validas), f"maq_{orden_id}_{proc_id}")

        op_domain_vals[(orden_id, proc_id)] = operarios_validos[:]
        maq_domain_vals[(orden_id, proc_id)] = maqs_validas[:]

        inicio_vars[(orden_id, proc_id)] = start
        fin_vars[(orden_id, proc_id)] = end
        intervalo_vars[(orden_id, proc_id)] = itv
        operario_vars[(orden_id, proc_id)] = op_var
        maq_vars[(orden_id, proc_id)] = maq_var

    # ---- Secuencia por OT
    for orden_id in set(p[0] for p in procesos_norm):
        procs = [p for p in procesos_norm if p[0] == orden_id]
        procs.sort(key=lambda x: x[2])
        for i in range(len(procs) - 1):
            act = procs[i]
            sig = procs[i + 1]
            model.Add(inicio_vars[(orden_id, sig[1])] >= fin_vars[(orden_id, act[1])])

    # ---- No solapamiento por operario (intervalos opcionales)
    for op_id in REAL_OP_IDS:
        pres_intervals = []
        for (orden_id, proc_id), op_var in operario_vars.items():
            pres = model.NewBoolVar(f"pres_{orden_id}_{proc_id}_op{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())

            start = inicio_vars[(orden_id, proc_id)]
            end   = fin_vars[(orden_id, proc_id)]
            dur   = dur_map[(orden_id, proc_id)]
            opt_interval = model.NewOptionalIntervalVar(start, dur, end, pres, f"i_op_{orden_id}_{proc_id}_{op_id}")
            pres_intervals.append(opt_interval)
        model.AddNoOverlap(pres_intervals)

    # ---- No solapamiento por maquinaria (intervalos opcionales) 👈 NUEVO
    for m_id in REAL_MAQ_IDS:
        pres_intervals = []
        for (orden_id, proc_id), maq_var in maq_vars.items():
            pres = model.NewBoolVar(f"mpres_{orden_id}_{proc_id}_m{m_id}")
            model.Add(maq_var == m_id).OnlyEnforceIf(pres)
            model.Add(maq_var != m_id).OnlyEnforceIf(pres.Not())

            start = inicio_vars[(orden_id, proc_id)]
            end   = fin_vars[(orden_id, proc_id)]
            dur   = dur_map[(orden_id, proc_id)]
            opt_interval = model.NewOptionalIntervalVar(start, dur, end, pres, f"i_maq_{orden_id}_{proc_id}_{m_id}")
            pres_intervals.append(opt_interval)
        model.AddNoOverlap(pres_intervals)

    # ---- Consistencia Operario–Maquinaria (AllowedAssignments) 👈 NUEVO
    """    for (orden_id, proc_id, _seq, _fp, _pp, _dur, rangos_proc, _nombre_proc) in procesos_norm:
        #for (orden_id, proc_id, _seq, _fp, _pp, _dur, rangos_proc) in procesos_norm:
            op_var = operario_vars[(orden_id, proc_id)]
            maq_var = maq_vars[(orden_id, proc_id)]

            # Pares (op, maq) permitidos: el rango del operario debe estar habilitado por esa máquina.
            allowed_pairs = []
            # Además, si el proceso tiene rangos, que la máquina tenga al menos uno de esos rangos.
            needs = set(rangos_proc)

            for op_id in REAL_OP_IDS:
                rango_op = op_to_rango[op_id]
                for m_id in REAL_MAQ_IDS:
                    if rango_op in maq_to_rangos[m_id]:
                        if not needs or (needs & maq_to_rangos[m_id]):
                            allowed_pairs.append([op_id, m_id])

            # Si no hay pares, permitimos dummy maquina (para no romper) y penalizamos fuerte.
            if not allowed_pairs:
                # Permitimos cualquier op con dummy maquina si el op_var lo permite
                allowed_pairs = [[op_id, DUMMY_MAQ_ID] for op_id in REAL_OP_IDS]

            model.AddAllowedAssignments([op_var, maq_var], allowed_pairs)"""
    for (orden_id, proc_id, _seq, _fp, _pp, _dur, rangos_proc, _nombre_proc) in procesos_norm:
        op_var = operario_vars[(orden_id, proc_id)]
        maq_var = maq_vars[(orden_id, proc_id)]

        ops_dom  = op_domain_vals[(orden_id, proc_id)]
        maqs_dom = maq_domain_vals[(orden_id, proc_id)]
        needs = set(rangos_proc)

        allowed_pairs = []

        for op_id in ops_dom:
            # Si es DUMMY op, solo se permite con DUMMY maq
            if op_id == DUMMY_OP_ID:
                if DUMMY_MAQ_ID in maqs_dom:
                    allowed_pairs.append([DUMMY_OP_ID, DUMMY_MAQ_ID])
                continue

            rango_op = op_to_rango.get(op_id)

            for m_id in maqs_dom:
                # Si es DUMMY maq, lo permitimos con cualquier operario real
                if m_id == DUMMY_MAQ_ID:
                    allowed_pairs.append([op_id, DUMMY_MAQ_ID])
                    continue

                mrangos = maq_to_rangos.get(m_id, set())
                if rango_op in mrangos and (not needs or (needs & mrangos)):
                    allowed_pairs.append([op_id, m_id])

        # Evita tabla vacía (causa INFEASIBLE)
        if not allowed_pairs:
            if (DUMMY_OP_ID in ops_dom) and (DUMMY_MAQ_ID in maqs_dom):
                allowed_pairs.append([DUMMY_OP_ID, DUMMY_MAQ_ID])
            else:
                for op_id in ops_dom:
                    for m_id in maqs_dom:
                        allowed_pairs.append([op_id, m_id])

        model.AddAllowedAssignments([op_var, maq_var], allowed_pairs)

    # ---- Asignación única (op y maq) + objetivo
    total_obj = []
    now = datetime.now()
    for (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc, nombre_proceso) in procesos_norm:
    #for (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc) in procesos_norm:
        op_var  = operario_vars[(orden_id, proc_id)]
        maq_var = maq_vars[(orden_id, proc_id)]

        # Exactly-one entre operarios reales + dummy
        pres_list = []
        for op_id in REAL_OP_IDS:
            pres = model.NewBoolVar(f"pick_op_{orden_id}_{proc_id}_{op_id}")
            model.Add(op_var == op_id).OnlyEnforceIf(pres)
            model.Add(op_var != op_id).OnlyEnforceIf(pres.Not())
            pres_list.append(pres)

        pick_dummy = model.NewBoolVar(f"pick_op_{orden_id}_{proc_id}_dummy")
        model.Add(op_var == DUMMY_OP_ID).OnlyEnforceIf(pick_dummy)
        model.Add(op_var != DUMMY_OP_ID).OnlyEnforceIf(pick_dummy.Not())
        model.Add(sum(pres_list) + pick_dummy == 1)

        # Exactly-one para maquinaria (reales + dummy)
        mpres_list = []
        for m_id in REAL_MAQ_IDS:
            mp = model.NewBoolVar(f"pick_maq_{orden_id}_{proc_id}_{m_id}")
            model.Add(maq_var == m_id).OnlyEnforceIf(mp)
            model.Add(maq_var != m_id).OnlyEnforceIf(mp.Not())
            mpres_list.append(mp)

        pick_dummy_maq = model.NewBoolVar(f"pick_maq_{orden_id}_{proc_id}_dummy")
        model.Add(maq_var == DUMMY_MAQ_ID).OnlyEnforceIf(pick_dummy_maq)
        model.Add(maq_var != DUMMY_MAQ_ID).OnlyEnforceIf(pick_dummy_maq.Not())
        model.Add(sum(mpres_list) + pick_dummy_maq == 1)

        # ---- Objetivo (igual que tenías) + penalizaciones dummy y sobre-cualificación
        end = fin_vars[(orden_id, proc_id)]
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

        # Penalizaciones por no asignar
        total_obj.append((pick_dummy, PENAL_DUMMY))
        total_obj.append((pick_dummy_maq, PENAL_DUMMY_MAQ))

        # Penalización leve por sobre-cualificación en tareas básicas (igual que ya tenías)
        if rangos_proc and any(rid in RANGOS_BÁSICOS for rid in rangos_proc):
            is_over = model.NewBoolVar(f"overq_{orden_id}_{proc_id}")
            not_b1 = model.NewBoolVar(f"not_peon_{orden_id}_{proc_id}")
            not_b2 = model.NewBoolVar(f"not_ayud_{orden_id}_{proc_id}")
            model.Add(op_var != PEON_ID).OnlyEnforceIf(not_b1)
            model.Add(op_var == PEON_ID).OnlyEnforceIf(not_b1.Not())
            model.Add(op_var != AYUDANTE_ID).OnlyEnforceIf(not_b2)
            model.Add(op_var == AYUDANTE_ID).OnlyEnforceIf(not_b2.Not())
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
        for (orden_id, proc_id, secuencia, fecha_prometida, peso_prioridad, dur, rangos_proc, nombre_proceso) in procesos_norm:
            op_id  = solver.Value(operario_vars[(orden_id, proc_id)])
            maq_id = solver.Value(maq_vars[(orden_id, proc_id)])
            resultados.append({
                "orden_id": orden_id,
                "proceso_id": proc_id,
                "nombre_proceso": nombre_proceso,
                "inicio_min": solver.Value(inicio_vars[(orden_id, proc_id)]),
                "fin_min": solver.Value(fin_vars[(orden_id, proc_id)]),
                "duracion_min": dur,
                "prioridad_peso": peso_prioridad,
                "id_operario": op_id if op_id != DUMMY_OP_ID else None,
                "id_rango_operario": op_to_rango.get(op_id) if op_id != DUMMY_OP_ID else None,
                "id_maquinaria": maq_id if maq_id != DUMMY_MAQ_ID else None,     # 👈 NUEVO en salida
                "rangos_permitidos_proceso": rangos_proc,
                "fecha_prometida": (
                    fecha_prometida.strftime("%Y-%m-%d")
                    if isinstance(fecha_prometida, (date, datetime))
                    else (fecha_prometida if isinstance(fecha_prometida, str) else None)
                ),
                "sin_asignar": (op_id == DUMMY_OP_ID),
                "sin_maquinaria": (maq_id == DUMMY_MAQ_ID),
            })
    else:
        print("❌ No se encontró solución.")

    return resultados
    
    

# 🔸 Función async que envuelve al solver

async def planificar(repo_orden: OrdenTrabajoRepository, repo_operario: OperarioRepository, repo_maquinaria: MaquinariaRepository,db):
    ordenes = await repo_orden.find_with_procesos()
    operarios = await repo_operario.find_with_rangos()  # [(id_operario, id_rango), ...]

    # Cargamos máquinas (con sus rangos permitidos)
    maquinarias_orm = await repo_maquinaria.find_with_rangos()  # devuelve maquinarias con sus rangos
    # Construimos: [(id_maquinaria, {rango_id, ...}), ...]
    maquinarias = []
    for m in maquinarias_orm:
        rangos_ok = {rm.id_rango for rm in (m.rango_maquinarias or [])}
        maquinarias.append((m.id, rangos_ok, m.nombre))


    procesos_para_solver = []
    for orden in ordenes:
        prioridad_desc = orden.prioridad.descripcion.strip().lower() if orden.prioridad else None

        for rel in orden.procesos:
            dur_min = rel.tiempo_proceso or 1  # minutos (puede ser None/0)
            # ✅ rangos válidos del proceso (RangoProceso)
            rangos_validos = [rp.id_rango for rp in getattr(rel.proceso, "rangos", [])]

            # ✅ Agregamos el nombre del proceso al final (nuevo campo)
            nombre_proceso = rel.proceso.nombre.strip().lower() if rel.proceso and rel.proceso.nombre else ""

            procesos_para_solver.append((
                orden.id,                  # orden_id
                rel.proceso.id,            # proc_id
                rel.orden,                 # secuencia dentro de la OT
                orden.fecha_prometida,     # deadline
                prioridad_desc,            # "urgente", "normal", etc.
                dur_min,                   # duración (min)
                rangos_validos,            # lista de rangos válidos (puede estar vacía)
                nombre_proceso             # 👈 nuevo campo
            ))

    resultados = await asyncio.to_thread(_resolver_planificacion, procesos_para_solver, operarios, maquinarias)
    
    # ✅ Generar ID único del lote y descripción
    id_lote = str(uuid.uuid4())
    descripcion_lote = f"Planificación {datetime.now():%B %Y}".capitalize()

    # ✅ Insertar directamente a la BD sin repositorio
    insert_query = """
        INSERT INTO planificacion (
            orden_id, proceso_id, id_operario, id_rango_operario, id_maquinaria,
            sin_maquinaria, inicio_min, fin_min, duracion_min, prioridad_peso,
            fecha_prometida, sin_asignar, nombre_proceso, rangos_permitidos,
            id_planificacion_lote, descripcion_lote, creado_en
        )
        VALUES (
            :orden_id, :proceso_id, :id_operario, :id_rango_operario, :id_maquinaria,
            :sin_maquinaria, :inicio_min, :fin_min, :duracion_min, :prioridad_peso,
            :fecha_prometida, :sin_asignar, :nombre_proceso, :rangos_permitidos,
            :id_planificacion_lote, :descripcion_lote, :creado_en
        )
    """

    for r in resultados:
        params = {
            "orden_id": r["orden_id"],
            "proceso_id": r["proceso_id"],
            "id_operario": r.get("id_operario"),
            "id_rango_operario": r.get("id_rango_operario"),
            "id_maquinaria": r.get("id_maquinaria"),
            "sin_maquinaria": r.get("sin_maquinaria", False),
            "inicio_min": r["inicio_min"],
            "fin_min": r["fin_min"],
            "duracion_min": r["duracion_min"],
            "prioridad_peso": r["prioridad_peso"],
            "fecha_prometida": r.get("fecha_prometida"),
            "sin_asignar": r.get("sin_asignar", False),
            "nombre_proceso": r.get("nombre_proceso"),
            "rangos_permitidos": str(r.get("rangos_permitidos_proceso", [])),
            "id_planificacion_lote": id_lote,
            "descripcion_lote": descripcion_lote,
            "creado_en": datetime.now(),
        }
        await db.execute(text(insert_query), params)

    await db.commit()

    return {
        "mensaje": f"Planificación guardada ({len(resultados)} registros)",
        "id_planificacion_lote": id_lote,
        "descripcion_lote": descripcion_lote
    }
    
    #return resultados



