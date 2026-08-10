/*
  Migración: limpieza del catálogo de procesos
  Fecha: 2026-08-10
  Base: Supabase (PostgreSQL)

  Arregla basura heredada de la migración de julio (SQL Server -> Supabase), que
  copió `proceso` tal cual, con duplicados y espacios sobrantes. NO la genera el
  sync: `_upsert` machea con `_clave()` (strip + upper), así que lo que se limpie
  acá no se vuelve a insertar (sync_db.py:88).

  Qué hace:

  1. Le pone nombre al proceso id=3177, que estaba en blanco. Se usa en 6 líneas de
     OT pendientes, así que NO se puede borrar: se veía como una fila vacía en la
     pantalla de OTs y en el buscador de habilidades. El sync nunca lo va a pisar
     —descarta los nombres vacíos del legacy (sync_db.py:356)— ni lo renombra.
     No cambia nada del plan: '' y 'SIN NOMBRE (REVISAR)' clasifican igual
     (PRODUCCION_MAQUINA, sin familia).

  2. Borra 'AGUJEREADO Y ROSCADO ' (182), duplicado por un espacio del 183. No lo
     usa nadie: ni OTs, ni rangos, ni skills. El DELETE lleva los NOT EXISTS igual,
     para que si alguien lo empezó a usar entre que se escribió esto y se corrió,
     no se borre en silencio.

  3. Saca los espacios sobrantes de los 77 nombres que los tenían. Es cosmético: la
     clasificación del planificador es por substring sobre el nombre normalizado
     (_norm), así que recortar no puede cambiar a qué familia de máquina va.

  Lo que NO hace, a propósito — y es lo más importante de este archivo:

  Hay procesos duplicados que las OTs usan POR DUPLICADO. Las 120 OTs que tienen
  'ROSCADO' lo tienen DOS VECES: id 131 e id 318, misma secuencia, mismo tiempo.
  Idem 'SOLDADURA' (325 y 339) en la OT 7533. O sea que esas OTs se planifican con
  el doble de trabajo del que tienen, y encima con criterios distintos: el 131 está
  restringido al rango OFICIAL y el 318, sin rango, se lo puede asignar cualquiera.

  Unificarlos implica BORRAR líneas de orden_trabajo_proceso (la PK es
  (id_orden_trabajo, id_proceso), así que no se pueden repuntar: chocan). Eso es
  tirar trabajo cargado, no limpiar nombres, y cambia el plan de 120 OTs
  pendientes. Va aparte y con el visto bueno de Metlo.

  Idempotente: se puede correr más de una vez.
*/

BEGIN;

-- 1. El proceso sin nombre.
UPDATE proceso
   SET nombre = 'SIN NOMBRE (REVISAR)'
 WHERE id = 3177
   AND (nombre IS NULL OR btrim(nombre) = '');

-- 2. Duplicado sin uso.
DELETE FROM proceso
 WHERE id = 182
   AND NOT EXISTS (SELECT 1 FROM orden_trabajo_proceso o WHERE o.id_proceso = proceso.id)
   AND NOT EXISTS (SELECT 1 FROM rango_proceso r        WHERE r.id_proceso = proceso.id)
   AND NOT EXISTS (SELECT 1 FROM operario_proceso_skill s WHERE s.id_proceso = proceso.id);

-- 3. Espacios sobrantes en el resto del catálogo.
UPDATE proceso
   SET nombre = btrim(nombre)
 WHERE nombre IS NOT NULL
   AND nombre <> btrim(nombre);

COMMIT;
