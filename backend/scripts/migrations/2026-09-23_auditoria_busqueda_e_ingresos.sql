-- Auditoría: buscar en TODO el registro (por persona y por fecha) y los ingresos (RF-25)
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-25) «registrar un log de todas las acciones realizadas por cada
-- usuario». La tabla `auditoria_movimiento` ya guardaba cada alta, cambio y baja, pero:
--
--   · La pantalla traía los últimos 300 movimientos y filtraba en el navegador: lo que
--     alguien hizo hace un mes no aparecía aunque estuviera guardado, y no había filtro
--     de fechas. Desde hoy los filtros van al servidor, de a páginas, con el total.
--   · Entrar, salir y equivocarse la contraseña no quedaban en ningún lado. Desde hoy
--     sí (backend/infrastructure/auditoria_movimientos.py, «INGRESOS Y SALIDAS»), con
--     acciones nuevas en la columna `accion`: ingresó, salió, intento fallido, cambió su
--     clave, restableció clave y pidió recuperar (bloqueó y desbloqueó ya existían).
--
-- Las dos búsquedas que se agregan son «todo lo de esta persona, lo último primero» y
-- «todos los ingresos / intentos fallidos, lo último primero» (la vista Ingresos y la
-- Actividad por persona). Con los índices de la migración del 15/09 —fecha, y
-- entidad + número— las dos recorren la tabla entera cuando lo buscado es poco.
-- Medido en un Postgres 16 local descartable con 60.000 filas (23/09/2026):
--   · una persona que casi no usa el sistema (50 filas): de 6,2 ms (Seq Scan) a
--     0,02 ms (Bitmap Index Scan sobre este índice y el de entidad + número);
--   · una acción rara (20 desbloqueos): de 2,0 ms (Seq Scan) a 0,01 ms.
-- Con la tabla creciendo, lo de sin índice crece con ella; con índice, no. Cuando lo
-- buscado abunda (una persona que hace mucho, «los ingresos») el plan sigue usando el
-- índice de la fecha, que es lo mejor para «lo último primero».
--
-- El índice de la fecha que ya existe (creado_en DESC) sigue siendo el de la lista sin
-- filtros y el del rango de fechas.
--
-- NO REESCRIBE NINGUNA FILA: sólo índices y el comentario de una columna. No hay
-- borrado automático del registro (decisión conservadora, pendiente con el taller).
--
-- LOCKS
--
-- CREATE INDEX (sin CONCURRENTLY: migraciones.py corre cada migración en una
-- transacción, y CONCURRENTLY no puede ir adentro de una) frena las ESCRITURAS en la
-- tabla mientras se arma. Es la tabla del registro, con unos miles de filas: se arma en
-- milisegundos, y el lock_timeout de migraciones.py lo acota a 3 s. Si no llega, el
-- arranque sigue y la próxima instancia lo reintenta. Las lecturas no se frenan.
--
-- Crea:
--   ix_auditoria_mov_usuario_fecha  (id_usuario, creado_en DESC)
--   ix_auditoria_mov_accion_fecha   (accion, creado_en DESC)
--   el COMMENT de auditoria_movimiento.accion
--
-- Idempotente: se puede correr las veces que haga falta.

-- «Todo lo que hizo Lucas», lo último primero.
CREATE INDEX IF NOT EXISTS ix_auditoria_mov_usuario_fecha
    ON auditoria_movimiento (id_usuario, creado_en DESC);

-- «Los ingresos», «los intentos fallidos»: filtran por acción y ordenan por fecha.
CREATE INDEX IF NOT EXISTS ix_auditoria_mov_accion_fecha
    ON auditoria_movimiento (accion, creado_en DESC);

COMMENT ON COLUMN auditoria_movimiento.accion IS
    'Qué pasó, en castellano: creó, editó o eliminó (sale del método HTTP) o un verbo '
    'propio (pausó, restauró, desbloqueó...). Desde el 23/09/2026 (RF-25) también los '
    'ingresos: ingresó, salió, intento fallido, cambió su clave, restableció clave, pidió '
    'recuperar y bloqueó. En esas filas id_entidad es la cuenta (usuario.id_usuario), y un '
    'intento fallido o un bloqueo no tienen autor: no se sabe quién tipeó.';
