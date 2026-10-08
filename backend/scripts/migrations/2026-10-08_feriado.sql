-- Los feriados de Argentina, traídos solos, y si el taller trabaja o no cada uno
-- Fecha: 2026-10-08
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El 8/10 se corrió el planificador sobre 10 OT al azar y un tercio de los pasos caía el
-- lunes 12/10, feriado. dia_bloqueado no tenía nada después de febrero: los feriados se
-- cargaban a mano en «Configurar feriados» y nadie se acordaba. Julián: «automatizalo de
-- alguna forma el tema de los feriados en argentina y que lo muestre al momento de
-- planificar si quiere elegirlo o no».
--
-- CÓMO
--
-- Esta tabla es el calendario oficial (lo trae FeriadoRepository de ArgentinaDatos, una vez
-- por semana) más la decisión del taller para cada día. dia_bloqueado sigue siendo lo que se
-- bloquea a mano (mantenimiento, un paro); lo que el planificador no trabaja es la UNIÓN de
-- dia_bloqueado y de los feriados que bloquean (DiaBloqueadoRepository.listar):
--
--   se_trabaja = true   → se trabaja, aunque sea feriado.
--   se_trabaja = false  → no se trabaja.
--   se_trabaja = NULL   → nadie lo decidió: un feriado (inamovible o trasladable) no se
--                         trabaja; un día no laborable («puente») sí, porque es optativo
--                         para el empleador.
--
-- Volver a traer el calendario pisa nombre y tipo pero nunca se_trabaja: lo que eligió el
-- taller queda.
--
-- Crea:
--   feriado
-- No toca ninguna fila existente ni ninguna columna de otra tabla. Borrarla no rompe nada:
-- el planificador vuelve a mirar sólo dia_bloqueado y la tabla se vuelve a llenar sola.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE TABLE IF NOT EXISTS feriado (
    fecha DATE PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    se_trabaja BOOLEAN,
    decidido_por VARCHAR(120),
    decidido_en TIMESTAMP,
    traido_en TIMESTAMP NOT NULL
);

COMMENT ON TABLE feriado IS
    'Feriados y días no laborables nacionales de Argentina (los trae FeriadoRepository de '
    'api.argentinadatos.com) y si el taller trabaja cada uno. El planificador no trabaja la '
    'unión de dia_bloqueado y de los feriados que bloquean.';

COMMENT ON COLUMN feriado.tipo IS
    'inamovible, trasladable o puente (día no laborable, optativo para el empleador), como '
    'lo da la fuente.';

COMMENT ON COLUMN feriado.se_trabaja IS
    'Lo que eligió el taller. NULL = no se eligió: un puente se trabaja y cualquier otro '
    'feriado no. Volver a traer el calendario no lo pisa.';

COMMENT ON COLUMN feriado.traido_en IS
    'La última vez que la fuente lo confirmó, hora local sin zona. Pasada una semana se '
    'vuelve a traer el año (a veces se decreta un feriado nuevo en el año).';
