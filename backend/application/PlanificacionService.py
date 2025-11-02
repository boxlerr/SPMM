# backend/application/PlanificacionService.py
import asyncio
from ortools.sat.python import cp_model
from datetime import datetime, time

from backend.infrastructure.ProcesoRepository import ProcesoRepository
from backend.infrastructure.MaquinariaRepository import MaquinariaRepository
from backend.infrastructure.OperarioRepository import OperarioRepository
from backend.infrastructure.OrdenTrabajoRepository import OrdenTrabajoRepository

# 🔸 Función síncrona que corre OR-Tools
from ortools.sat.python import cp_model
from datetime import datetime

from ortools.sat.python import cp_model

def _resolver_planificacion(procesos):
    """
    Planificador que considera la descripción de la prioridad (Urgente, Normal, etc.)
    y la fecha prometida.
    """

    model = cp_model.CpModel()
    posicion_vars = {}

    # 🔸 Asignamos valores numéricos según prioridad
    prioridad_pesos = {
        "urgente": 1,
        "urgente 1": 1,
        "urgente 2": 2,
        "normal": 3,
        "baja": 4,
    }

    # Variables
    for (orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc) in procesos:
        posicion_vars[(orden_id, proc_id)] = model.NewIntVar(1, len(procesos), f"pos_{orden_id}_{proc_id}")

    # Restricciones de secuencia (como antes)
    for orden_id in set(p[0] for p in procesos):
        procesos_orden = [p for p in procesos if p[0] == orden_id]
        procesos_orden.sort(key=lambda x: x[2])
        for i in range(len(procesos_orden) - 1):
            actual = procesos_orden[i] #1
            siguiente = procesos_orden[i + 1] 
            model.Add(posicion_vars[(orden_id, siguiente[1])] > posicion_vars[(orden_id, actual[1])])

    # 🔸 Objetivo: dar prioridad según urgencia + fecha
    total_penalizacion = []
    for (orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc) in procesos:
        peso_prioridad = prioridad_pesos.get(prioridad_desc, 5)  # si no la encuentra, la toma como baja
        if fecha_prometida:
            # si es date, convertirlo a datetime (a las 00:00hs)
            if isinstance(fecha_prometida, datetime):
                fecha_ts = int(fecha_prometida.timestamp())
            else:
                fecha_ts = int(datetime.combine(fecha_prometida, time.min).timestamp())
        else:
            fecha_ts = 0

        penalizacion = model.NewIntVar(0, 10**9, f"pen_{orden_id}_{proc_id}")
        model.Add(penalizacion == fecha_ts // 100000 + (peso_prioridad * 100))
        total_penalizacion.append(penalizacion + posicion_vars[(orden_id, proc_id)])

    model.Minimize(sum(total_penalizacion))

    # Resolver
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    status = solver.Solve(model)

    resultados = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (orden_id, proc_id, secuencia, fecha_prometida, prioridad_desc) in procesos:
            posicion = solver.Value(posicion_vars[(orden_id, proc_id)])
            resultados.append({
                "orden_id": orden_id,
                "proceso_id": proc_id,
                "posicion_planificada": posicion,
                "prioridad": prioridad_desc,
                "fecha_prometida": fecha_prometida.strftime("%Y-%m-%d") if fecha_prometida else None
            })
    else:
        print("No se encontró solución.")

    return resultados





# 🔸 Función async que envuelve al solver
async def planificar(repo_orden: OrdenTrabajoRepository):
    ordenes = await repo_orden.find_with_procesos()

    procesos_para_solver = []
    for orden in ordenes:
        prioridad_desc = None
        if orden.prioridad:
            prioridad_desc = orden.prioridad.descripcion.strip().lower()
            
        for rel in orden.procesos:
            procesos_para_solver.append((
                orden.id,
                rel.proceso.id,
                rel.orden,                   # campo de la tabla asociativa
                orden.fecha_prometida,       # 👈 deadline
                prioridad_desc               # 👈 texto ("urgente", "normal", etc.)
            ))

    resultados = await asyncio.to_thread(_resolver_planificacion, procesos_para_solver)
    
    
    
    return resultados



