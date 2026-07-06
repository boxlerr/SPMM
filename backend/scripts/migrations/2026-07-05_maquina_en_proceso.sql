/*
  Migración: Máquina preseleccionada por proceso de una OT
  Fecha: 2026-07-05
  Base: SMPP (MSSQL)
  Pedido: Reunión Metlo 2-jul-2026 — "agregar campo Máquina a la carga de procesos
          de la OT" + "preselección de máquina" (forzar un proceso a una máquina).

  Agrega:
    orden_trabajo_proceso.id_maquinaria (INT NULL, FK -> maquinaria.id)
      · NULL  = sin preselección: el planificador elige la máquina.
      · <id>  = preselección: se fuerza ese proceso a esa máquina.

  Idempotente: se puede correr más de una vez sin error.

  IMPORTANTE:
    - Correr ESTA migración ANTES de desplegar el código nuevo (el modelo mapea
      la columna; si no existe, el ORM rompe al leer procesos).
    - La columna es NULLABLE y sin default de negocio: las filas existentes quedan
      en NULL (comportamiento actual = el planificador sigue eligiendo máquina).
    - El sync (backend/scripts/sync_db.py) NO toca esta columna: su MERGE no la
      nombra en el set-list, igual que no toca cant_operarios. Por lo tanto la
      máquina preseleccionada en SPMM NO se pisa cada 5 minutos.
*/

-- 1) Columna id_maquinaria en orden_trabajo_proceso
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.orden_trabajo_proceso') AND name = 'id_maquinaria'
)
BEGIN
    ALTER TABLE dbo.orden_trabajo_proceso
        ADD id_maquinaria INT NULL;
END
GO

-- 2) FK a maquinaria (sólo si la columna existe y la FK todavía no)
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.orden_trabajo_proceso') AND name = 'id_maquinaria'
)
AND NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_otproceso_maquinaria'
)
BEGIN
    ALTER TABLE dbo.orden_trabajo_proceso
        ADD CONSTRAINT FK_otproceso_maquinaria
        FOREIGN KEY (id_maquinaria) REFERENCES dbo.maquinaria(id);
END
GO

-- 3) Índice para búsquedas por máquina (opcional, ayuda al planificador/reportes)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_otproceso_maquinaria' AND object_id = OBJECT_ID('dbo.orden_trabajo_proceso')
)
BEGIN
    CREATE INDEX IX_otproceso_maquinaria
        ON dbo.orden_trabajo_proceso (id_maquinaria);
END
GO
