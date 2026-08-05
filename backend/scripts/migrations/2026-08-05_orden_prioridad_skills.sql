/*
  Migración: orden de preferencia dentro de SKILLS 1 / SKILLS 2
  Fecha: 2026-08-05
  Base: Supabase (PostgreSQL)  <-- OJO: las migraciones anteriores son T-SQL/MSSQL,
        previas al cutover del 28-jul-2026. Esta va en Postgres.

  Agrega operario_proceso_skill.orden (SMALLINT NULL): posición del proceso dentro
  de su lista de prioridad. 0 = primero = más preferido.

  Para qué: SKILLS 1 y 2 dicen a quién preferir, pero dentro de una misma lista no
  había forma de decir "a este antes que a este otro". El planificador ahora usa
  `orden` como desempate FINO dentro del nivel — el nivel sigue mandando (ver
  PlanificacionService._agregar_objetivo: el aporte de `orden` está acotado para
  que un SKILL 1 al fondo de la lista siga ganándole a un SKILL 2 al tope).

  NULL = sin posición asignada; se trata como el final de la lista. Por eso la
  columna es nullable y no hace falta backfill: las filas viejas siguen andando.

  Idempotente: se puede correr más de una vez.
  IMPORTANTE: correr ANTES de desplegar el código nuevo — el ORM mapea la columna
  y un SELECT contra una tabla sin ella rompe la lectura de operarios.
*/

ALTER TABLE operario_proceso_skill
    ADD COLUMN IF NOT EXISTS orden SMALLINT;

COMMENT ON COLUMN operario_proceso_skill.orden IS
    'Posición dentro de SKILLS 1/2 (0 = primero = más preferido). NULL = al final.';

-- Búsqueda del planificador: arma el mapa de prioridades por proceso ordenado.
CREATE INDEX IF NOT EXISTS ix_operario_proceso_skill_nivel_orden
    ON operario_proceso_skill (id_proceso, nivel, orden);
