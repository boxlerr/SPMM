-- "Dos OT no pueden tener el mismo número"
-- Fecha: 2026-09-15
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- Al crear una OT desde SPMM sin escribir el número, el backend lo genera con
-- `SELECT max(id_otvieja) + 1` adentro de la transacción (OrdenTrabajoService). Si dos
-- personas crean una orden al mismo tiempo —Camilo y Lucas, que es exactamente lo que
-- pasa a la mañana— las dos leen el mismo máximo y las dos escriben el mismo número.
-- Y no había nada que lo impidiera: `id_otvieja` tenía índice pero NO era único.
--
-- El resultado sería dos órdenes distintas con el mismo número en un taller que
-- identifica todo por ese número: los papeles, el remito, el pedido del cliente. Y en
-- silencio — nadie se entera hasta que alguien busca la OT y aparecen dos.
--
-- Medido antes de crear el índice (15/09/2026): 0 repetidos y 0 en NULL sobre 1267
-- órdenes, así que entra limpio.
--
-- QUÉ CAMBIA EN LA PRÁCTICA
--
-- Con el índice, la segunda de las dos escrituras simultáneas FALLA en vez de pasar. El
-- servicio la reintenta recalculando el máximo, así que la persona no ve nada: le toca
-- el número siguiente. Si el reintento también choca (tres veces), ahí sí ve un error —
-- que es infinitamente mejor que dos órdenes con el mismo número.
--
-- Se permite NULL a propósito: `UNIQUE` en Postgres no cuenta los NULL, y una OT creada
-- acá que todavía no tiene número del sistema viejo es un estado válido.
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE UNIQUE INDEX IF NOT EXISTS ux_orden_trabajo_id_otvieja
    ON orden_trabajo (id_otvieja)
    WHERE id_otvieja IS NOT NULL;
