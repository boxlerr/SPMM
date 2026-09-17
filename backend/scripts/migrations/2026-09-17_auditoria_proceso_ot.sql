-- Quién agregó, cambió o sacó cada paso de cada OT
-- Fecha: 2026-09-17
-- Base: Supabase (Postgres).
--
-- POR QUÉ, SI YA ESTÁ `auditoria_movimiento`
--
-- Pedido de Julián: «auditoría de quién agregue, elimine o modifique cada proceso en
-- cada OT, siempre, en cualquier pantalla, con su usuario, hora y día bien completo,
-- por si hay dudas de que se duplican cosas y si lo agregó un usuario».
--
-- `auditoria_movimiento` guarda el PEDIDO: el método, la dirección y el cuerpo que
-- mandó el navegador. Para «¿quién borró la persona?» alcanza, porque el pedido ES el
-- cambio. Para los procesos de una OT no alcanza, por tres razones:
--
--   1. El guardado manda la lista COMPLETA de pasos. Un cuerpo con 12 procesos no
--      dice cuál se agregó ni cuál se fue: hay que compararlo contra lo que había, y
--      eso no está en ningún lado.
--   2. Ese cuerpo se recorta a los 20 primeros ítems y a 4000 caracteres. En una OT
--      larga el detalle ni siquiera está entero.
--   3. Guarda el id de la OT, nunca el de la pasada. Y la pregunta es justamente por
--      UNA pasada: la OT 7497 tiene TORNO CNC trece veces.
--
-- Acá se guarda el CAMBIO ya comparado: una fila por pasada tocada, con el antes y el
-- después de cada campo. Las dos tablas conviven y contestan cosas distintas: allá
-- «qué se intentó» (incluido lo que falló), acá «qué quedó».
--
-- QUIÉN LA ESCRIBE
--
-- El ORM, no los endpoints: backend/infrastructure/auditoria_procesos.py se engancha
-- al `after_flush` de SQLAlchemy, así que toda escritura que pase por el ORM queda
-- registrada — incluidas las pantallas que todavía no existen. Son 14 los caminos que
-- escriben orden_trabajo_proceso hoy; poner la llamada en cada uno era garantizar que
-- el decimoquinto no la tenga.
--
-- Los dos UPDATE masivos que quedaron en SQL crudo (el estado de varias OT, y el
-- blanqueo al borrar una persona o una máquina) llaman a `anotar()` a mano.
--
-- LO QUE NO VA A ESTAR
--
-- Lo anterior a esta fecha. No se puede reconstruir: nunca se guardó. La pantalla lo
-- dice en vez de dejar pensar que esos pasos aparecieron solos — los procesos que ya
-- estaban vinieron de la migración del sistema viejo.
--
-- Crea:
--   auditoria_proceso_ot (+ 2 índices)
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS auditoria_proceso_ot (
    id BIGSERIAL PRIMARY KEY,
    -- Hora local del taller, sin zona, como TODAS las fechas de esta base. Con
    -- segundos: dos pasadas agregadas en el mismo guardado caen en el mismo minuto y
    -- el orden entre ellas es lo que se viene a mirar.
    creado_en TIMESTAMP NOT NULL,
    -- Quién. NULL = no se registró (un script, una corrida a mano contra la base).
    -- La pantalla lo muestra como «el sistema»; nunca un autor inventado.
    id_usuario INTEGER,
    usuario VARCHAR(120),
    -- Desde qué pantalla: «Planificador», «Ficha de la orden», «Catálogo de
    -- procesos»… Es la diferencia entre un paso que alguien sacó a propósito y uno
    -- que se fue de arrastre al borrar ese proceso del catálogo.
    origen VARCHAR(60),
    id_orden_trabajo INTEGER NOT NULL,
    -- La pasada tocada. Queda huérfano a propósito cuando la fila se borra: es el
    -- número con el que se sigue su rastro hacia atrás.
    id_otp BIGINT,
    id_proceso INTEGER,
    -- Copia del nombre al momento del cambio. No es redundante: el catálogo se puede
    -- borrar, y ese es justo el caso donde después se pregunta qué era.
    nombre_proceso VARCHAR(200),
    -- alta | baja | edicion
    accion VARCHAR(10) NOT NULL,
    -- En qué paso estaba. Ubica; no identifica (el paso no es único en la OT y se
    -- renumera solo en cada guardado).
    paso INTEGER,
    -- Sólo en las ediciones: [{"campo","antes","despues"}], con los valores ya en
    -- castellano y no con ids sueltos.
    cambios TEXT,
    -- La frase armada, que es lo único que se lee en la pantalla.
    descripcion TEXT NOT NULL,
    metodo VARCHAR(10),
    ruta VARCHAR(300)
);

-- «Mostrame qué pasó con los pasos de la OT 1081», que es la pregunta que motivó esto.
CREATE INDEX IF NOT EXISTS ix_auditoria_proc_ot
    ON auditoria_proceso_ot (id_orden_trabajo, creado_en DESC);

-- La pantalla de Auditoría siempre pide lo último primero.
CREATE INDEX IF NOT EXISTS ix_auditoria_proc_creado_en
    ON auditoria_proceso_ot (creado_en DESC);
