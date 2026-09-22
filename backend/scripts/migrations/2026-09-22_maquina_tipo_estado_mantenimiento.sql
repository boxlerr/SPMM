-- Tipo, estado operativo y frecuencia de mantenimiento de cada máquina (RF-08)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-08) «registrar todas las máquinas disponibles, incluyendo: nombre,
-- tipo, capacidad, estado operativo y frecuencia de mantenimiento». De esos cinco datos
-- la tabla `maquinaria` tenía uno entero (nombre), uno a medias (capacidad: la columna
-- existía pero no había dónde cargarla) y tres que no existían en ningún lado.
--
-- No se crea tabla nueva: son tres columnas más sobre `maquinaria`, que ya tiene el
-- ABM completo en Recursos.
--
-- `tipo` — LISTA CERRADA, NO TEXTO LIBRE
--
-- Texto libre se llena de variantes de la misma palabra ('Torno', 'TORNO ', 'tornos'),
-- que es lo que ya pasó con el catálogo de procesos, duplicado por un doble espacio.
-- Los valores son las mismas familias con las que el planificador clasifica máquinas
-- y procesos (familia_requerida_from_proceso en PlanificacionService.py) más OTRO:
-- si mañana se quiere cruzar el tipo cargado contra la familia que pide un proceso, los
-- dos lados ya hablan el mismo idioma. La lista vive en MaquinariaService.TIPOS_MAQUINA
-- y la valida el backend; un test cuida que el front ofrezca la misma.
-- NULL = no se cargó. NO se completa deduciéndolo del nombre, aunque se podría: sería
-- escribir un dato del taller por nuestra cuenta.
--
-- `estado_operativo` — NOT NULL DEFAULT 'operativa'
--
-- Valores: 'operativa' | 'en_mantenimiento' | 'fuera_de_servicio'.
-- El DEFAULT es una SUPOSICIÓN sobre las ~31 máquinas ya cargadas: que hoy están
-- andando. Es la única lectura razonable —el taller las está usando y el planificador
-- las reparte todos los días— pero hay que decírselo al cliente, no darla por buena en
-- silencio. Las otras dos columnas quedan NULL a propósito.
--
-- OJO: por ahora el estado es INFORMATIVO. El planificador carga todas las máquinas sin
-- mirarlo (PlanificacionService, `find_with_rangos`), así que una máquina «fuera de
-- servicio» se sigue ofreciendo. Sacarla del plan es un filtro de una línea, pero hace
-- que sus procesos caigan en la máquina dummy y salgan «sin máquina»: es un cambio de
-- plan visible para todo el taller y se decide aparte.
--
-- `frecuencia_mantenimiento_dias` — INTEGER NULL
--
-- Cada cuántos días le toca mantenimiento. En días porque es como lo dice el taller
-- («cada 3 meses» = 90). NULL = no se le lleva frecuencia, que no es lo mismo que 0.
--
-- Sin índices: ninguna consulta filtra por estas columnas (la lista de máquinas se trae
-- entera, son ~31 filas).
--
-- Agrega:
--   maquinaria.tipo                          (VARCHAR(40) NULL)
--   maquinaria.estado_operativo              (VARCHAR(20) NOT NULL DEFAULT 'operativa')
--   maquinaria.frecuencia_mantenimiento_dias (INTEGER NULL)
--
-- Idempotente: se puede correr las veces que haga falta. No reescribe ni borra filas:
-- las existentes quedan con tipo y frecuencia en NULL y estado 'operativa'.

ALTER TABLE maquinaria
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(40),
    ADD COLUMN IF NOT EXISTS estado_operativo VARCHAR(20) NOT NULL DEFAULT 'operativa',
    ADD COLUMN IF NOT EXISTS frecuencia_mantenimiento_dias INTEGER;

COMMENT ON COLUMN maquinaria.tipo IS
    'Qué clase de máquina es, de una lista cerrada alineada con las familias del '
    'planificador (TORNO, FRESADORA, PRENSA...; ver MaquinariaService.TIPOS_MAQUINA). '
    'NULL = no se cargó; nunca se completa deduciéndolo del nombre.';

COMMENT ON COLUMN maquinaria.estado_operativo IS
    'operativa, en_mantenimiento o fuera_de_servicio. Las máquinas cargadas antes del '
    '22/09/2026 quedaron en operativa por suposición (el taller las estaba usando). Por '
    'ahora es informativo: el planificador todavía no lo mira.';

COMMENT ON COLUMN maquinaria.frecuencia_mantenimiento_dias IS
    'Cada cuántos días le toca mantenimiento. NULL = no se le lleva frecuencia, que no '
    'es lo mismo que 0.';
