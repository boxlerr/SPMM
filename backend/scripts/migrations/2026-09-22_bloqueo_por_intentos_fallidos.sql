-- Bloquear el acceso tras 5 intentos fallidos seguidos (RF-26)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-26) «bloquear el acceso tras 5 intentos fallidos consecutivos de
-- inicio de sesión». Hasta hoy el login no llevaba la cuenta de nada: se podía probar
-- contraseñas contra un usuario todas las veces que uno quisiera, y la URL de la app
-- es pública (Vercel).
--
-- QUÉ SE DECIDIÓ (y qué queda por confirmar)
--
-- El bloqueo es TEMPORAL: 15 minutos, y se levanta solo. Además un administrador lo
-- puede levantar antes desde Configuración › Usuarios («Desbloquear»). Un bloqueo
-- permanente, que sólo saque un admin, es más estricto pero puede dejar a Lucas
-- afuera en el taller justo cuando no hay nadie para destrabarlo — y si el bloqueado
-- es el único admin, no lo destraba nadie sin tocar la base. Los 5 intentos y los 15
-- minutos viven en AuthService (MAX_INTENTOS_FALLIDOS, MINUTOS_DE_BLOQUEO); cambiarlos
-- no pide migración.
--
-- LAS DOS COLUMNAS
--
--   intentos_fallidos  cuántas contraseñas malas SEGUIDAS lleva. Un ingreso bueno la
--                      vuelve a 0; el desbloqueo del admin también. Al llegar a 5 la
--                      cuenta se bloquea. Mientras está bloqueada no sigue sumando.
--   bloqueado_hasta    hasta cuándo no puede entrar, ni con la contraseña correcta.
--                      NULL = no está bloqueada. Si ya pasó, tampoco: el próximo
--                      intento la limpia y arranca de cero. Hora local del taller y
--                      sin zona, como todas las fechas de esta base.
--
-- LOS USUARIOS QUE YA EXISTEN
--
-- Arrancan en 0 intentos y sin bloqueo (el DEFAULT y el NULL): nadie queda afuera por
-- esta migración. No reescribe ni borra ninguna fila.
--
-- Agrega:
--   usuario.intentos_fallidos  (INTEGER NOT NULL DEFAULT 0)
--   usuario.bloqueado_hasta    (TIMESTAMP NULL, hora local AR sin zona)
--
-- Idempotente: se puede correr las veces que haga falta. Se aplica sola al levantar
-- el backend (backend/infrastructure/migraciones.py) y hace falta ANTES del primer
-- login: SQLAlchemy pide las dos columnas en cada SELECT de usuario.

ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMP;

COMMENT ON COLUMN usuario.intentos_fallidos IS
    'Contraseñas incorrectas SEGUIDAS en el login (RF-26). Vuelve a 0 con un ingreso bueno '
    'o cuando un administrador desbloquea la cuenta. Al llegar a 5 se llena bloqueado_hasta.';

COMMENT ON COLUMN usuario.bloqueado_hasta IS
    'Hasta cuándo la cuenta no puede entrar, ni con la contraseña correcta (RF-26). NULL = '
    'no está bloqueada; si ya pasó, tampoco. Bloqueo temporal de 15 minutos que se levanta '
    'solo; un administrador lo puede levantar antes. Hora local del taller, sin zona.';
