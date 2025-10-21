# backend/application/PlanificacionService.py
import asyncio
from ortools.sat.python import cp_model
from datetime import datetime, timedelta

# 🔸 Función síncrona que corre OR-Tools
def _resolver_planificacion():
    procesos, maquinas, operarios, feriados = obtener_datos_simulados()
    model = cp_model.CpModel()

    tareas = {}
    operario_vars = {}
    maquina_vars = {}
    horizon = sum([p[3] for p in procesos])

    # Variables por proceso
    for (orden_id, proc_id, nombre, duracion, maquinas_permitidas, operarios_req, prioridad, deadline) in procesos:
        start = model.NewIntVar(0, horizon, f"start_{proc_id}")
        end = model.NewIntVar(0, horizon, f"end_{proc_id}")
        interval = model.NewIntervalVar(start, duracion, end, f"interval_{proc_id}")

        maquina_var = model.NewIntVarFromDomain(
            cp_model.Domain.FromValues(maquinas_permitidas),
            f"maquina_{proc_id}"
        )

        posibles_op = [op["id"] for op in operarios]
        op_var = model.NewIntVarFromDomain(
            cp_model.Domain.FromValues(posibles_op),
            f"operario_{proc_id}"
        )

        tareas[proc_id] = (start, end, interval, duracion, deadline)
        maquina_vars[proc_id] = maquina_var
        operario_vars[proc_id] = op_var

    # Secuencia por orden
    procesos_por_orden = {}
    for p in procesos:
        procesos_por_orden.setdefault(p[0], []).append(p[1])
    for orden, procs in procesos_por_orden.items():
        procs.sort()
        for i in range(len(procs) - 1):
            model.Add(tareas[procs[i + 1]][0] >= tareas[procs[i]][1])

    # No solapar máquinas
    for m in maquinas:
        intervals = [tareas[p[1]][2] for p in procesos if m in p[4]]
        if intervals:
            model.AddNoOverlap(intervals)

    # No solapar operarios
    for op in [o["id"] for o in operarios]:
        intervals = []
        for (orden_id, proc_id, nombre, duracion, maquinas_permitidas, operarios_req, prioridad, deadline) in procesos:
            intervals.append(tareas[proc_id][2])
        if intervals:
            model.AddNoOverlap(intervals)

    # Deadlines con penalización
    retrasos = []
    for (orden_id, proc_id, nombre, duracion, maquinas_permitidas, operarios_req, prioridad, deadline) in procesos:
        deadline_min = int((deadline - datetime(2025, 10, 17, 8, 0)).total_seconds() / 60)
        retraso = model.NewIntVar(0, horizon, f"retraso_{proc_id}")
        model.Add(retraso >= tareas[proc_id][1] - deadline_min)
        retrasos.append(retraso)

    makespan = model.NewIntVar(0, horizon, "makespan")
    model.AddMaxEquality(makespan, [t[1] for t in tareas.values()])
    model.Minimize(makespan + sum(retrasos))

    # Resolver
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    status = solver.Solve(model)

    resultados = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for proc_id, (start, end, interval, duracion, deadline) in tareas.items():
            s = solver.Value(start)
            e = solver.Value(end)
            op = solver.Value(operario_vars[proc_id])
            maq = solver.Value(maquina_vars[proc_id])
            resultados.append({
                "proceso_id": proc_id,
                "inicio": s,
                "fin": e,
                "operario": op,
                "maquina": maq
            })
    return resultados


# 🔸 Función async que envuelve al solver
async def planificar():
    return await asyncio.to_thread(_resolver_planificacion)


# Datos simulados
def obtener_datos_simulados():
    procesos = [
        (1, 101, "Corte", 120, [1], 1, 1, datetime(2025, 10, 25, 17, 0)),
        (1, 102, "Pulido", 60, [2], 1, 1, datetime(2025, 10, 25, 17, 0)),
        (2, 201, "Corte", 90, [1, 2], 2, 2, datetime(2025, 10, 26, 17, 0)),
        (2, 202, "Pintura", 180, [3], 1, 2, datetime(2025, 10, 26, 17, 0)),
    ]
    maquinas = [1, 2, 3]
    operarios = [
        {"id": 1, "habilidades_principales": [1], "habilidades_secundarias": [2]},
        {"id": 2, "habilidades_principales": [1, 2], "habilidades_secundarias": [3]},
        {"id": 3, "habilidades_principales": [3], "habilidades_secundarias": []},
    ]
    feriados = [
        datetime(2025, 10, 20).date(),
        datetime(2025, 12, 25).date()
    ]
    return procesos, maquinas, operarios, feriados
