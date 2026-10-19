-- Los proveedores que SPMM toma desde la lista del paso tercerizado
-- Fecha: 2026-10-19
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- En la vista previa del plan, al elegir el proveedor de un paso tercerizado, Julián pidió
-- poder escribir uno nuevo, editarlo y eliminarlo ahí mismo. Los proveedores son los de
-- materias primas, que trae el espejo del Integral cada 10 minutos (y pisa lo que se cambie
-- acá). Julián eligió que SPMM mande en los que se tocan desde esa lista: queda la hora en
-- que se los editó o dio de baja y el espejo ya no los pisa (ver
-- backend/scripts/importar_materia_prima_legacy.paso_proveedores).
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE proveedor
    ADD COLUMN IF NOT EXISTS editado_en_spmm TIMESTAMP;

COMMENT ON COLUMN proveedor.editado_en_spmm IS
    'Cuándo se lo editó o dio de baja en SPMM (lista del paso tercerizado, desde el 19/10/2026). '
    'Desde ahí manda SPMM: el espejo del Integral no lo vuelve a pisar. NULL = lo sigue trayendo el espejo.';
