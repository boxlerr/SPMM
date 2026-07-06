# Avances — Reunión Metlo 2-jul-2026 (Bloque 1: carga de procesos y máquinas en la OT)

Documento vivo del progreso de las tareas de la reunión.
Fuente de tareas: página Notion "Tareas — Reunión 2 jul 2026 (11:30)".

> **Nota de entorno:** este trabajo se hizo sin poder levantar la app (el sandbox
> no arranca `next dev`) ni conectar a la DB (solo lectura y hoy inalcanzable).
> Verificación hecha: `python -m py_compile` (backend) + `tsc --noEmit` (frontend, 0 errores).
> **Falta:** correr la migración en SMPP + deploy + prueba funcional en la app real.

---

## Estado por ítem

| Ítem del acta | Estado | Detalle |
|---|---|---|
| Rehacer carga como **listado** (proceso·min·orden·máquina·cant.emp.) | 🟡 Código listo (modal + inline) | `ProcesosEditor` integrado en `CreateWorkOrderModal` **y** en el alta inline `AddProcessRow`. Falta deploy. |
| Campo **Máquina** | 🟡 Código listo, pendiente migración | Columna nueva `orden_trabajo_proceso.id_maquinaria`. Backend cableado (crear/editar/agregar). |
| Campo **Cant. empleados** | 🟢 Ya existía + en el listado | `cant_operarios` end-to-end desde antes. |
| **Tilde por proceso** (incluir/excluir) | 🟡 Código listo (modal) | Todos tildados por defecto; destildado no se guarda. Falta deploy. |
| **Preselección de máquina** (forzar) | 🟡 Persistencia lista / planner pendiente | Elegir máquina = candado (se guarda `id_maquinaria`). Falta que el planificador CP-SAT **respete** la máquina forzada. |
| **Traer historial** (por producto cód+desc) | 🔴 Pendiente | Necesita endpoint backend nuevo + botón (el botón ya está en el componente, se activa al pasar `onTraerHistorial`). |
| Revisar campo **"fecha"** | 🟢 Resuelto por el rediseño | Según la transcripción, "fecha" es una **columna de la lista de procesos** que "no tiene sentido". El listado nuevo (`ProcesosEditor`) **no la incluye**. |

Leyenda: 🟢 hecho/live · 🟡 código listo, pendiente deploy/migración · 🔴 pendiente.

## Notas verificadas contra la transcripción (reunión 2-jul, 00:37–00:55)
- **Columnas exactas que pidió Lucas:** proceso · minutos · orden · máquina · cant. empleados (+ botón traer historial). **NO** va columna "fecha".
- **Máquina = restricción DURA:** "forzar a que diga: esto se hace ahí. Si está tapada porque la asignó antes, cagaste." → el planificador debe fijar la máquina aunque genere cuello de botella (no es sugerencia).
- **Tilde:** todos tildados por defecto; se destilda el que no va. Se usa manual y sobre todo al **traer historial**.
- **Traer historial:** parámetro = **código + descripción** del producto. Trae los procesos de una fabricación/reparación anterior, todos tildados; se destilda lo que esta vez no va.
- **Orden:** por arrastre (ya existe en planificación); no es una columna de input.
- **Script/sync (Bloque 2):** solución acordada = **quitar sólo la ruta de procesos** del MERGE (traer todo el resto: cabecera, etc., menos procesos). Desde el **lunes** Metlo carga procesos SÓLO en el sistema nuevo; Lucas avisa a Matías. (= Opción A de la memoria: SPMM dueño de procesos.)
- **Deadline mencionado:** cutover **lunes** (6-jul-2026). Julián se comprometió a: (1) modificar el script para que no traiga procesos, (2) tener la visual de **editar y agregar** procesos con máquina + tilde.

---

## Cambios de código (increment "Máquina de punta a punta")

### Base de datos (correr ANTES del deploy)
- `backend/scripts/migrations/2026-07-05_maquina_en_proceso.sql`
  - Agrega `orden_trabajo_proceso.id_maquinaria INT NULL` + FK a `maquinaria` + índice.
  - Idempotente. **No** toca el sync (`sync_db.py` no la nombra en su MERGE → no se pisa).
  - NULL = sin preselección (el planificador elige). `<id>` = máquina forzada.

### Backend
- `domain/OrdenTrabajoProceso.py` — mapea `id_maquinaria`.
- `dto/OrdenTrabajoResponseDTO.py` — expone `id_maquinaria` (escalar; el front resuelve el nombre).
- `application/OrdenTrabajoService.py` — `crearOrdenTrabajo` y `agregarProceso` persisten la máquina.
- `infrastructure/OrdenTrabajoRepository.py` — `agregarProceso` y `update_processes_full` (edición).
- `presentation/OrdenTrabajoAPI.py` — `AgregarProcesoRequest.id_maquinaria`.

### Frontend
- `components/planning/ProcesosEditor.tsx` — **nuevo** componente listado (tilde·#·proceso·min·máquina·cant.emp. + botón "Traer historial").
- `components/CreateWorkOrderModal.tsx` — pestaña "Procesos" usa `ProcesosEditor`; guarda/lee `maquinaria_id` y respeta el tilde.
- `components/planning/AddProcessRow.tsx` — alta inline reescrita para usar el mismo `ProcesosEditor`; manda `id_maquinaria` en `POST /ordenes/{id}/procesos`.

### Sync / Corte al sistema nuevo (Bloque 2)
- `scripts/sync_db.py` — **DESACTIVADO** el paso 6 (`QUERY_SYNC_OT_PROCESOS`) dentro de `run_sync()`.
  Era la "ruta de procesos" que cada 5 min pisaba lo editado en SPMM (forzaba `id_estado=1`,
  sobreescribía `orden`/`tiempo_proceso`, re-insertaba procesos borrados). La query queda
  definida en el archivo pero comentada su ejecución (revertible descomentando 2 líneas).
  **Se mantiene** todo el resto del sync: cabecera de OT, zombies, catálogos (incl. catálogo
  de procesos paso 5), materia prima. Toma efecto al **redeployar/reiniciar el backend**
  (el sync se lanza desde `presentation/main.py`).
  - Efecto: una OT nueva creada en el sistema viejo llega SIN procesos → el encargado los
    carga en SPMM. Acordado con Lucas (avisa a Matías; cutover lunes 6-jul).

---

## Pasos para dejarlo live (los hace Julián)
1. Correr `2026-07-05_maquina_en_proceso.sql` en SMPP.
2. **Deploy del backend** → activa 2 cosas: (a) el modelo lee `id_maquinaria`, (b) el sync deja de traer procesos (`sync_db.py`).
3. Deploy del frontend.
4. Probar:
   - Crear/editar una OT, elegir máquina en un proceso, guardar, reabrir → la máquina persiste.
   - Editar un proceso en SPMM (minutos/estado) y esperar >5 min → **ya NO se revierte** (antes se pisaba).

## Próximos increments (pendientes)
- Endpoint **"Traer historial"** por producto (código+descripción) + activar el botón.
- Planificador CP-SAT: respetar la **máquina forzada** (`id_maquinaria` fija el dominio de máquina del proceso).
