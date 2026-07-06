# Dashboards Metlo — plan y datos necesarios

Diseño de los 2 dashboards que pidió Lucas (reunión 2-jul-2026). Este doc define
**qué datos alimentan cada métrica** y **qué falta recolectar**, para poder construir
la parte que ya se puede y dejar el resto listo para cuando haya datos.

## 🔑 El dato clave: tiempo estimado vs. tiempo real

| Concepto | De dónde sale | Estado |
|---|---|---|
| **Tiempo estimado** por proceso | `orden_trabajo_proceso.tiempo_proceso` (minutos) | ✅ ya se carga (lo pone el encargado en la OT) |
| **Tiempo real** por proceso | `fin_real - inicio_real` de `orden_trabajo_proceso` | ✅ se captura solo al marcar estado (ver abajo) |
| **Operario** de un proceso | `planificacion.id_operario` (JOIN por `orden_id` + `proceso_id`) | ✅ existe (lo asigna el planificador) |

### La captura del tiempo real YA existe (auto)
`OrdenTrabajoRepository` estampa los tiempos al cambiar el estado de un proceso:
- → **En Proceso (id_estado=2)**: `inicio_real = now()` (si no estaba).
- → **Finalizado (id_estado=3)**: `fin_real = now()`.
- → **Pendiente (id_estado=1)**: resetea ambos.

**Importante:** hasta el 2026-07-06 esto no servía porque el sync forzaba `id_estado=1`
cada 5 min y borraba los tiempos. **Con el corte del sync (paso 6 desactivado) ahora
persisten.** Por eso el corte también destraba los dashboards.

## 📋 Qué hay que recolectar
**Nada nuevo de infraestructura.** Solo el flujo operativo: que el encargado/pasante
marque los procesos **En Proceso → Finalizado** a medida que avanzan. Es exactamente
lo que Lucas planea con el pasante de datos de la UNP. A partir de ahí los tiempos
reales se acumulan solos y los dashboards se llenan.

---

## Dashboard GENERAL
Objetivo (Lucas): tiempo estimado vs. real por proceso, urgencias y cumplimiento de plazos.

| Métrica | Fórmula / fuente | ¿Listo hoy? |
|---|---|---|
| Estimado vs. real por proceso | `SUM(tiempo_proceso)` vs `SUM(DATEDIFF(min, inicio_real, fin_real))` agrupado por `proceso` | 🟡 se construye ya; se llena a medida que se marca avance |
| Desvío % por proceso | `(real - estimado) / estimado` | 🟡 idem |
| Cumplimiento de plazos | `fecha_entrega` vs `fecha_prometida` por OT | 🟢 datos ya existen |
| Urgencias / OTs críticas | próximas a vencer (ya hay endpoint `/ordenes-estadisticas/criticas`) | 🟢 ya existe (`OrdenesCriticas`) |

Ya existe un dashboard general con varios componentes (`StatsCards`, `OrdenesCriticas`,
`SectorOccupation`, `TimelineEntregas`, `AverageTime`, etc.). **Lo que falta agregar** es
la tarjeta **"Estimado vs. Real por proceso"** (la métrica central que pidió Lucas).

## Dashboard POR EMPLEADO / OPERARIO
Objetivo (Lucas): rendimiento por operario (¿cumple el tiempo estimado?) para detectar
capacitación / ajustes de personal.

| Métrica | Fórmula / fuente | ¿Listo hoy? |
|---|---|---|
| Estimado vs. real por operario | procesos de `planificacion` (id_operario) ⨝ `orden_trabajo_proceso` (`fin_real-inicio_real`) | 🟡 se construye ya; se llena con el avance marcado |
| Desvío % por operario | `(real - estimado) / estimado` promedio | 🟡 idem |
| Ranking de operarios | ordenar por desvío | 🟡 idem |

Requisito que remarcó Lucas: los **procesos que hacen los operarios deben "machear"**
con los procesos del sistema (skills = proceso). Eso ya está modelado
(`operario_proceso_skill`), así que el macheo está.

**Falta construir:** el endpoint de rendimiento por operario + la vista. (Hoy existe
`OperatorLoadTab` que muestra *carga* por operario, no *rendimiento estimado-vs-real*.)

---

## Plan de build (cuando se arranque)
1. **Backend** — 2 endpoints (SQL crudo estilo `DashboardAPI`, solo lectura):
   - `GET /dashboard/rendimiento-procesos` → estimado vs real agrupado por proceso.
   - `GET /dashboard/rendimiento-operarios` → estimado vs real agrupado por operario.
   - Sólo cuentan procesos con `inicio_real` y `fin_real` no nulos (los que ya se marcaron).
2. **Frontend** — 2 tarjetas/vistas nuevas:
   - "Estimado vs. Real por proceso" en el dashboard general.
   - Vista "Rendimiento por operario" (ranking + desvío).
   - **Empty state claro** mientras no haya datos: *"Esperando registros de tiempo real —
     marcá procesos como En Proceso → Finalizado para empezar a medir."*
3. Se puede construir **ahora** (es aditivo, no toca los flujos del cutover); mostrará
   datos parciales hasta que se acumule avance marcado.

## Estado
- 🟢 Pipeline de datos: **listo** (captura automática + persiste post-corte del sync).
- 🔴 Vistas/endpoints de rendimiento: **a construir** (aditivo, sin bloquear el cutover).
- Dependencia real: que se empiece a **marcar el avance** de los procesos (flujo del lunes).
