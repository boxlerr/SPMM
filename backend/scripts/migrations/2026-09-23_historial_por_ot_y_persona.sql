-- Auditoría: el historial de UNA OT y de UNA persona (RF-17)
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-17) «repositorio centralizado de documentos históricos y registros de
-- auditoría de cada orden y cada operario». Desde hoy Auditoría tiene dos vistas nuevas,
-- «Historial de una OT» y «Historial de una persona», que arma el servidor con el
-- registro central (`auditoria_movimiento`) buscado por entidad y número, completado con
-- las tablas que guardan cada hecho (backend/application/HistorialService.py).
--
-- Casi todo lo que esa búsqueda pide ya tiene índice (el de entidad + número, del 15/09).
-- Lo que no: los pedidos cuyo número está en el CUERPO y no en la dirección —el estado
-- masivo («marcar como terminadas estas 5 OT»), la materia prima que se agrega a una OT,
-- los consumos y las no conformidades que no se pudieron guardar—. Esas filas no tienen
-- `id_entidad` y se buscan por el camino. Sin este índice Postgres usa el de entidad +
-- número con `id_entidad IS NULL`, que trae TODAS las filas sin número (también las altas
-- de clientes, máquinas, personas...) y lee el detalle de cada una. Con éste, sólo las de
-- esos cuatro caminos. Medido en un Postgres 16 local descartable (en_US.UTF-8) con
-- 220.000 filas, 15 % sin número y 5 % en esos caminos
-- (23/09/2026):
--   · de 13,0 ms a 5,8 ms la consulta de las filas «con el número en el cuerpo»;
--   · el índice ocupa 2,3 MB contra 455 MB de la tabla: es PARCIAL (sólo las filas sin
--     número) y crece mucho menos que ella.
-- La diferencia crece con la proporción de altas de otras cosas en el registro.
--
-- NO REESCRIBE NINGUNA FILA: un índice y su comentario.
--
-- LOCKS
--
-- CREATE INDEX (sin CONCURRENTLY: migraciones.py corre cada migración en una
-- transacción) frena las ESCRITURAS en la tabla del registro mientras se arma: con las
-- filas de hoy son milisegundos, y el lock_timeout de migraciones.py lo acota a 3 s. Si
-- no llega, el arranque sigue y la próxima instancia lo reintenta. Las lecturas no se
-- frenan, y ninguna pantalla depende de que esto esté: sin el índice el historial anda
-- igual, un poco más lento.
--
-- Crea:
--   ix_auditoria_mov_sin_numero  (ruta, creado_en) WHERE id_entidad IS NULL
--   su COMMENT
--
-- Idempotente: se puede correr las veces que haga falta.

CREATE INDEX IF NOT EXISTS ix_auditoria_mov_sin_numero
    ON auditoria_movimiento (ruta, creado_en)
    WHERE id_entidad IS NULL;

COMMENT ON INDEX ix_auditoria_mov_sin_numero IS 'RF-17: los pedidos cuyo número va en el cuerpo y no en la dirección (estado masivo, materia prima de la OT, consumos y no conformidades que no se pudieron guardar). Los busca el historial de una OT en Auditoría.';
