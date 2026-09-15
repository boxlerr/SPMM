-- "Este paso NO lleva máquina: se hace a mano"
-- Fecha: 2026-09-15
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Hasta hoy la columna «recurso maquinaria» de un paso tenía DOS valores posibles y
-- ninguno de los dos quería decir "a mano":
--
--   NULL        → nadie eligió máquina, QUE EL PLANIFICADOR ELIJA. Y elige: deduce la
--                 familia del nombre del proceso y le busca una máquina igual.
--   <id>        → forzar esa máquina.
--
-- O sea que un trabajo que se hace a mano no se podía expresar. El planificador lo
-- clasifica por el NOMBRE (`proceso_usa_maquina`), así que «OXICORTE» o «ENDEREZADO»
-- salen a buscar máquina sí o sí, aunque el que carga la OT sepa que esa vez va a mano.
--
-- Es exactamente el mismo problema que ya se resolvió dos veces, y se resuelve igual:
--   · 10/09 con los planos     → `orden_trabajo.no_lleva_plano`
--   · 11/09 con la materia prima → `orden_trabajo.no_lleva_materia_prima`
-- En los tres casos el cero tapaba dos cosas opuestas: "falta cargarlo" y "no lleva".
--
-- DE DÓNDE SALE
--
-- De las 25 preguntas que quedaron abiertas el 15/09 después de cargar la planilla del
-- taller, CINCO son este caso y ninguna se podía contestar cargando un dato:
--   · ENDEREZADO: «prensa 1 / prensa 2 / plegadora / A MANO SIN MAQUINA — depende el
--     trabajo, se especificará la máquina en cada OT»;
--   · OXICORTE y PREPARACION DE EQUIPO OXICORTE: «tubo de oxígeno y soplete», que no es
--     una máquina del taller;
--   · PREPARACION DE PINTURA: «compresor y pistola de pintura», ídem;
--   · FABRICACION DE DISPISITIVO y PREPARACION DISPOSITIVO: «no tiene máquina
--     específica, depende del dispositivo».
-- Decisión de Julián: no hay que preguntarlas — el que carga la OT elige la máquina, o
-- elige que no lleva. Esta columna es lo que hacía falta para que eso se pueda elegir.
--
-- POR QUÉ POR PASADA Y NO POR PROCESO
--
-- Porque es por trabajo, no por proceso: el mismo ENDEREZADO va en prensa en una orden
-- y a mano en la siguiente. Ponerlo en el catálogo de procesos obligaría a decidirlo una
-- sola vez para siempre, que es justo lo que el taller dijo que NO quiere.
--
-- Agrega:
--   orden_trabajo_proceso.no_lleva_maquina (SMALLINT NOT NULL DEFAULT 0)
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE orden_trabajo_proceso
    ADD COLUMN IF NOT EXISTS no_lleva_maquina SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN orden_trabajo_proceso.no_lleva_maquina IS
    'El que cargó la OT marcó que este paso se hace a mano y NO usa máquina. Distinto '
    'de id_maquinaria NULL, que significa "que elija el planificador" y hace que salga '
    'a buscar una. Con esto en 1 el paso entra al plan sin reservar ninguna máquina.';

-- El planificador lee todas las pasadas de las OT abiertas y necesita saber cuáles
-- están marcadas. Parcial porque las marcadas son la minoría y así el índice queda chico.
CREATE INDEX IF NOT EXISTS ix_otp_no_lleva_maquina
    ON orden_trabajo_proceso (id_orden_trabajo)
    WHERE COALESCE(no_lleva_maquina, 0) = 1;
