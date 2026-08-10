/*
  Migración: desduplicar los procesos repetidos dentro de las OTs
  Fecha: 2026-08-10
  Base: Supabase (PostgreSQL)

  Continúa 2026-08-10_limpieza_catalogo_procesos.sql, que dejó pendiente esto por
  ser destructivo. Aprobado por Julián el 10-ago.

  EL PROBLEMA
  El cutover del 28-jul copió `proceso` tal cual del SQL Server, duplicados incluidos:
  quedaron dos filas 'ROSCADO' (131 y 318) y dos 'SOLDADURA' (325 y 339), con el
  nombre idéntico byte a byte. Las líneas de OT quedaron materializadas contra las
  dos, así que 120 OTs pendientes tienen el roscado cargado DOS veces (y la OT 7533,
  la soldadura).

  No es que el trabajo lleve dos roscados. Verificado antes de tocar nada:
    - las 120 tienen las dos copias en la MISMA secuencia, con el MISMO tiempo y el
      MISMO estado; cero OTs las tienen en pasos distintos;
    - la PK de orden_trabajo_proceso es (id_orden_trabajo, id_proceso), o sea que un
      mismo proceso no se puede cargar dos veces en una OT ni queriendo: un segundo
      roscado real sería otra secuencia, y no hay ninguna así.

  CONSECUENCIAS QUE CORRIGE
    1. Esas OTs se planificaban con el doble del trabajo real.
    2. Las dos copias se regían distinto: el 131 está limitado al rango OFICIAL y el
       318, sin rango, era asignable a CUALQUIERA (PlanificacionService: sin rangos
       en el proceso, `operarios_validos = REAL_OP_IDS[:]`). O sea que la mitad del
       roscado se le podía asignar a alguien que no lo hace.

  CRITERIO
  Se conserva la copia canónica y se borra la otra:
    - ROSCADO   -> queda 131 (tiene el rango OFICIAL y 9 skills de operarios); se va el 318.
    - SOLDADURA -> queda 339; se va el 325, que era el que venía con el espacio de más.
      (Ninguno de los dos tiene rango ni skills: son equivalentes, se elige el limpio.)

  SEGURIDAD
    - Se respaldan las filas borradas en backup_20260810_* ANTES de borrar. Para
      revertir: INSERT INTO <tabla> SELECT * FROM backup_20260810_<...>;
    - El DELETE solo saca la línea duplicada si la OT CONSERVA la copia canónica. Si
      alguna OT tuviera únicamente la copia mala, se queda como está y no pierde el
      paso. (Al momento de escribir esto: 0 OTs en esa situación, las 120 tienen ambas.)
    - Verificado antes: 0 incidencias y 0 filas de planificación apuntando a estos
      procesos, así que no quedan huérfanos.

  Idempotente: correrlo de nuevo no borra nada más ni pisa el respaldo.
*/

BEGIN;

-- 1. Respaldo de todo lo que se va a borrar.
CREATE TABLE IF NOT EXISTS backup_20260810_otp_duplicados AS
SELECT * FROM orden_trabajo_proceso WHERE id_proceso IN (318, 325);

CREATE TABLE IF NOT EXISTS backup_20260810_proceso_duplicados AS
SELECT * FROM proceso WHERE id IN (318, 325);

-- 2. Las líneas duplicadas, solo donde la OT conserva la canónica.
DELETE FROM orden_trabajo_proceso AS a
 WHERE a.id_proceso = 318
   AND EXISTS (SELECT 1 FROM orden_trabajo_proceso b
                WHERE b.id_orden_trabajo = a.id_orden_trabajo AND b.id_proceso = 131);

DELETE FROM orden_trabajo_proceso AS a
 WHERE a.id_proceso = 325
   AND EXISTS (SELECT 1 FROM orden_trabajo_proceso b
                WHERE b.id_orden_trabajo = a.id_orden_trabajo AND b.id_proceso = 339);

-- 3. Las filas duplicadas del catálogo, ya sin uso.
DELETE FROM proceso AS p
 WHERE p.id IN (318, 325)
   AND NOT EXISTS (SELECT 1 FROM orden_trabajo_proceso  o WHERE o.id_proceso = p.id)
   AND NOT EXISTS (SELECT 1 FROM rango_proceso          r WHERE r.id_proceso = p.id)
   AND NOT EXISTS (SELECT 1 FROM operario_proceso_skill s WHERE s.id_proceso = p.id)
   AND NOT EXISTS (SELECT 1 FROM incidencia_proceso     i WHERE i.id_proceso = p.id);

COMMIT;
