-- Auditoría: los Ingresos y la Actividad por persona, en una sección confidencial propia
-- Fecha: 2026-09-23
-- Base: Supabase (Postgres).
--
-- POR QUÉ
--
-- RF-25 agregó a Auditoría la vista Ingresos (quién entró y salió, cada intento fallido
-- contra cada cuenta, con la IP y el navegador) y la Actividad por persona (cada cuenta
-- con su último ingreso y sus intentos fallidos). Las dos colgaban de «Todo lo que se
-- hizo» (auditoria_movimientos), que NO es confidencial: hereda el nivel del área. Así,
-- abrirle Auditoría a un rol para que vea «Pasos de las OT» le abría también las IP y
-- los intentos contra cada cuenta, sin que nadie lo decidiera aparte.
--
-- Se agrega una sección nueva, CONFIDENCIAL: cerrada para todo el que no sea admin
-- aunque tenga Auditoría, hasta que se le otorgue a propósito (a un rol o a una
-- persona) desde la pantalla de permisos. Es la misma regla de «Rendimiento por
-- persona» y de «Usuarios y permisos».
--
-- NO se marca confidencial «Todo lo que se hizo»: eso le cambiaría lo que ve a quien ya
-- lo tenga abierto, y lo decide Lucas (se hace desde la pantalla de permisos, sin
-- migración). Hoy nadie que no sea admin tiene Auditoría en la matriz sembrada.
--
-- NO REESCRIBE NINGUNA FILA: un INSERT con ON CONFLICT DO NOTHING. Si la sección ya
-- existe (o se le cambió la marca desde la pantalla), queda como está.
--
-- Crea:
--   la fila 'auditoria_ingresos' de `seccion`
--
-- Idempotente: se puede correr las veces que haga falta.

INSERT INTO seccion (codigo, area_codigo, nombre, orden, confidencial) VALUES
    ('auditoria_ingresos', 'auditoria', 'Ingresos y actividad por persona', 13, TRUE)
ON CONFLICT (codigo) DO NOTHING;
