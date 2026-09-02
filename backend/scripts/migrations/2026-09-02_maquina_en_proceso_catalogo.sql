-- En qué máquinas se hace cada proceso, como DATO del catálogo.
--
-- Hasta ahora esto no era un dato: el planificador lo deducía del NOMBRE del proceso
-- (familia_requerida_from_proceso). Por eso «reparación de rosca» se planificaba sin
-- reservar ningún torno, y por eso Lucas tuvo que contestar en la planilla de trabas
-- en qué máquina se hace cada cosa: el sistema no tenía dónde guardar la respuesta.
--
-- Pedido de Julián el 2/9: «esto se tiene que hacer al momento de crear el proceso,
-- o sea cualquier proceso se le podría seleccionar».
--
-- Es N:N y no un id suelto en `proceso` a propósito: hay seis tornos y atar CILINDRADO
-- a uno solo le sacaría al planificador la única elección que sí sabe hacer. La tabla
-- contesta "en qué máquinas se PUEDE hacer", que es la lista que el solver ya arma hoy
-- deduciéndola; ahora la puede leer.
--
-- Sin filas para un proceso = dato no cargado = se sigue deduciendo por nombre, igual
-- que hasta hoy. Los 415 procesos existentes se comportan idéntico hasta que alguien
-- cargue algo. El respaldo por nombre no es transitorio: el sync da de alta procesos
-- nuevos solo, así que siempre va a haber procesos sin este dato.

CREATE TABLE IF NOT EXISTS proceso_maquinaria (
    id_proceso    INTEGER NOT NULL REFERENCES proceso(id)    ON DELETE CASCADE,
    id_maquinaria INTEGER NOT NULL REFERENCES maquinaria(id) ON DELETE CASCADE,
    CONSTRAINT pk_proceso_maquinaria PRIMARY KEY (id_proceso, id_maquinaria)
);

CREATE INDEX IF NOT EXISTS ix_proceso_maquinaria_proceso
    ON proceso_maquinaria (id_proceso);
