/*
  Migración: habilidades MANUALES (fuera del rango)
  Fecha: 2026-08-07
  Base: Supabase (PostgreSQL)

  Agrega operario_proceso_skill.manual (BOOLEAN NOT NULL DEFAULT FALSE).

  Para qué: hasta ahora el universo de lo que un operario sabe hacer lo fijaban
  únicamente sus rangos (skills NATIVAS). Si alguien sabía hacer algo que su rango no
  le da, la única salida era cambiarle el rango —y eso se lo da a TODOS los que
  comparten ese rango—. Una fila con manual = TRUE agrega ese proceso a la
  elegibilidad de ESE operario, sin tocar rangos ni pisar a nadie más.

  Semántica de la fila, ya con tres ejes independientes:
    - manual     -> de dónde sale la habilidad. FALSE = override sobre una nativa,
                    TRUE = la habilidad la agregó alguien a mano.
    - nivel      -> prioridad (0 sin marcar, 1 SKILL 1, 2 SKILL 2). Una manual se
                    prioriza igual que una nativa.
    - habilitado -> FALSE apaga la habilidad; el planificador no la asigna.

  Ojo con el default: TIENE que ser FALSE. Las filas viejas nivel 1/2 sobre procesos
  que el rango ya no da son restos del modelo anterior (SKILLS 1/2 como catálogo
  abierto) y hoy el planificador las ignora. Si entraran como manuales, la migración
  le estaría devolviendo elegibilidad a gente a la que se le sacó a propósito.

  Idempotente: se puede correr más de una vez.
  IMPORTANTE: correr ANTES de desplegar el código nuevo — el ORM mapea la columna y
  un SELECT contra una tabla sin ella rompe la lectura de operarios.
*/

ALTER TABLE operario_proceso_skill
    ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN operario_proceso_skill.manual IS
    'TRUE = habilidad cargada a mano (habilita el proceso aunque el rango no lo dé). FALSE = override sobre una nativa.';

-- El planificador arma el mapa de manuales habilitadas por proceso en cada corrida.
-- Índice parcial: las manuales son un puñado al lado del resto de la tabla.
CREATE INDEX IF NOT EXISTS ix_operario_proceso_skill_manual
    ON operario_proceso_skill (id_proceso)
    WHERE manual;
