-- Días no laborables (feriados, mantenimiento, paros) a la base.
--
-- Vivían en backend/data/config.json, un archivo dentro del contenedor. En Cloud Run
-- eso significa que se pierden en cada deploy y que cada instancia tiene su propia
-- copia: se cargaba un feriado, funcionaba un rato, y después el día reaparecía como
-- laborable sin que nadie lo hubiera tocado.
--
-- El repositorio la crea solo (DiaBloqueadoRepository._ensure_tabla) y, la primera vez
-- que se consulta, importa lo que hubiera quedado en el archivo. Este SQL queda para
-- poder aplicarla a mano si se prefiere no depender del self-healing.

CREATE TABLE IF NOT EXISTS dia_bloqueado (
    fecha DATE PRIMARY KEY,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW()
);
