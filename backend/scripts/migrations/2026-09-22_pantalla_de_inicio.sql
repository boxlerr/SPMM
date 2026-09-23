-- La pantalla con la que arranca cada persona (RF-28)
-- Fecha: 2026-09-22
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- El SRS pide (RF-28) «personalizar el dashboard inicial por tipo de usuario». Es la
-- pantalla_inicio de Don Joaquín (supabase/migrations/20260826f_usuarios_pantalla_inicio.sql),
-- pedida por Julián («quiero lo mismo, copialo»), con una cosa más: allá se fija sólo
-- por persona; acá además hay una por ROL, que es lo que el SRS llama «tipo de usuario».
--
--   · usuario.pantalla_inicio: la de esa persona. Pisa la de su rol.
--   · rol.pantalla_inicio: la de todos los de ese rol que no tengan una propia.
--   · NULL en los dos = el inicio de siempre (el Dashboard, o la primera pantalla del
--     menú que pueda ver).
--
-- Lo que se guarda es la dirección de una pantalla del menú ('/operaciones'). Qué valores
-- valen lo dice el catálogo de código (backend/core/permisos.py, PANTALLAS_DE_INICIO) y lo
-- valida la API: acá no va un CHECK, porque cada ítem nuevo del menú pediría otra
-- migración para poder elegirse.
--
-- Guardarla NO da permiso para verla. Si la persona no puede abrir la pantalla fijada
-- (le sacaron el permiso y nadie la actualizó), entra al Dashboard, y si tampoco puede,
-- a la primera pantalla del menú que sí pueda ver: nunca a un cartel de «no tenés acceso».
-- Eso lo decide la pantalla (frontend/src/lib/permisos.ts, rutaInicio), igual que DJ.
--
-- LOS USUARIOS QUE YA EXISTEN
--
-- Dos columnas nuevas, las dos NULL: nadie cambia de pantalla por la migración. Todos
-- siguen entrando exactamente adonde entran hoy. No toca ninguna fila existente.
--
-- NO SE SIEMBRA NINGUNA POR ROL, a propósito. Qué pantalla le conviene a cada rol es una
-- decisión del taller (pendiente con Lucas) y se fija desde Configuración › Usuarios y
-- permisos. Sembrarla acá obligaría a un UPDATE que corre en cada arranque y volvería a
-- poner la pantalla que alguien sacó desde la pantalla de permisos.
--
-- ORDEN
--
-- Va DESPUÉS de 2026-09-22_permisos_por_rol_y_area, que crea la tabla rol. Si esa no
-- llegó a aplicarse, ésta tampoco (va entera en una transacción) y se reintenta en el
-- próximo arranque.
--
-- SI ESTO NO LLEGA A APLICARSE
--
-- Nada depende de estas columnas para entrar: están mapeadas `deferred` (fuera del SELECT
-- del login) y se leen aparte, con una consulta que tolera que falten. Sin ellas todos
-- entran adonde entran hoy; lo único que no anda es fijar una pantalla (la API contesta
-- 503 y lo dice).
--
-- LOCKS
--
-- Cada ADD COLUMN toma ACCESS EXCLUSIVE un instante sobre su tabla (usuario se lee en
-- cada pedido). El lock_timeout de migraciones.py lo acota.
--
-- Crea:
--   usuario.pantalla_inicio (VARCHAR(80), NULL)
--   rol.pantalla_inicio     (VARCHAR(80), NULL)
-- No toca ninguna fila existente.
--
-- Idempotente: se puede correr las veces que haga falta. Se aplica sola al levantar
-- el backend (backend/infrastructure/migraciones.py).

ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS pantalla_inicio VARCHAR(80);

ALTER TABLE rol
    ADD COLUMN IF NOT EXISTS pantalla_inicio VARCHAR(80);

COMMENT ON COLUMN usuario.pantalla_inicio IS
    'Pantalla a la que entra esta persona después del login (RF-28), por ejemplo '
    '/operaciones. Pisa la de su rol. NULL = la de su rol, y si su rol tampoco tiene, el '
    'inicio de siempre. Si no la puede abrir, entra al Dashboard (o a la primera que pueda '
    'ver). Los valores válidos los dice PANTALLAS_DE_INICIO de backend/core/permisos.py.';

COMMENT ON COLUMN rol.pantalla_inicio IS
    'Pantalla a la que entran después del login los de este rol que no tienen una propia '
    '(RF-28). NULL = el inicio de siempre: el Dashboard, o la primera pantalla del menú que '
    'puedan ver.';
