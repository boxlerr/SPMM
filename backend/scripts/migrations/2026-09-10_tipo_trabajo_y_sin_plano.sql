-- Reparación / Fabricación, y "no lleva plano"
-- Fecha: 2026-09-10
-- Base: Supabase (Postgres).
-- Pedido de Lucas (reunión 10/09): "al momento de crear la OT poner si es reparación
--         o fabricación... y que aparezca una columna que diga lo de reparación o
--         fabricación. Y el plano: si no lleva, que le puedan poner NO LLEVA, y
--         entonces ya te limpiás. Si dice sin plano lo va a tener que revisar".
--
-- POR QUÉ HACE FALTA UNA COLUMNA NUEVA PARA EL PLANO
--
-- `tiene_plano` es un booleano heredado del legacy y no alcanza: con 0 no se puede
-- distinguir "todavía no lo cargaron" de "esta pieza no lleva plano". Son dos cosas
-- opuestas para el que revisa —una hay que ir a buscarla, la otra hay que saltearla—
-- y hoy se ven iguales. Por eso va una columna aparte y no un tercer valor en
-- `tiene_plano`: esa columna la escribe el sync desde el legacy y no es nuestra.
--
-- REPARACIÓN Y FABRICACIÓN NO NECESITAN COLUMNA
--
-- Ya existen las dos, heredadas del legacy, y están vacías: de 1267 OT, 5 tienen
-- fabricación y ninguna reparación. Lo que falta no es dónde guardarlo sino poder
-- elegirlo en la pantalla. Se dejan como están —dos banderas— porque el sync las
-- escribe; la pantalla las presenta como UNA elección, que es como lo pidió Lucas.
--
-- Agrega:
--   orden_trabajo.no_lleva_plano (SMALLINT NOT NULL DEFAULT 0)
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE orden_trabajo
    ADD COLUMN IF NOT EXISTS no_lleva_plano SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN orden_trabajo.no_lleva_plano IS
    'El taller marcó que esta pieza NO necesita plano. Distinto de tiene_plano=0, '
    'que sólo dice que no hay ninguno cargado todavía.';

-- Para el filtro "mostrame las que hay que ir a buscar": las que no tienen plano y
-- tampoco están marcadas como que no lleva. Parcial porque es el único caso que se
-- consulta y así el índice queda chico.
CREATE INDEX IF NOT EXISTS ix_orden_trabajo_falta_plano
    ON orden_trabajo (id)
    WHERE COALESCE(tiene_plano, 0) = 0 AND COALESCE(no_lleva_plano, 0) = 0;
