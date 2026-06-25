/*
  Migración: Interpretación de planos
  Fecha: 2026-06-25
  Base: SMPP (MSSQL)

  Agrega:
  1) operario.interpreta_planos (BIT) — marca si el operario sabe interpretar planos.
  2) Tabla incidencia_proceso — registro de tiempo perdido / problemas en un proceso
     (ej. cuando alguien no interpreta un plano). Alimenta la métrica del dashboard.

  Idempotente: se puede correr más de una vez sin error.
  IMPORTANTE: correr ESTA migración ANTES de desplegar el código nuevo,
  porque el modelo mapea estas columnas/tablas.
*/

-- 1) Habilidad transversal: ¿sabe interpretar planos?
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.operario') AND name = 'interpreta_planos'
)
BEGIN
    ALTER TABLE dbo.operario
        ADD interpreta_planos BIT NOT NULL CONSTRAINT DF_operario_interpreta_planos DEFAULT 0;
END
GO

-- 2) Registro de incidencias de proceso (tiempo perdido / falta de gente, etc.)
IF NOT EXISTS (
    SELECT 1 FROM sys.tables WHERE name = 'incidencia_proceso' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
    CREATE TABLE dbo.incidencia_proceso (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        id_orden_trabajo  INT          NOT NULL,
        id_proceso        INT          NULL,
        id_operario       INT          NULL,
        tipo              VARCHAR(50)  NOT NULL CONSTRAINT DF_incidencia_tipo DEFAULT 'INTERPRETACION_PLANOS',
        minutos_perdidos  INT          NOT NULL CONSTRAINT DF_incidencia_minutos DEFAULT 0,
        operarios_extra   INT          NOT NULL CONSTRAINT DF_incidencia_extra DEFAULT 0,
        descripcion       NVARCHAR(500) NULL,
        fecha_registro    DATETIME     NOT NULL CONSTRAINT DF_incidencia_fecha DEFAULT GETDATE(),
        CONSTRAINT FK_incidencia_orden    FOREIGN KEY (id_orden_trabajo) REFERENCES dbo.orden_trabajo(id),
        CONSTRAINT FK_incidencia_proceso  FOREIGN KEY (id_proceso)       REFERENCES dbo.proceso(id),
        CONSTRAINT FK_incidencia_operario FOREIGN KEY (id_operario)      REFERENCES dbo.operario(id)
    );

    CREATE INDEX IX_incidencia_tipo_fecha ON dbo.incidencia_proceso (tipo, fecha_registro);
    CREATE INDEX IX_incidencia_operario   ON dbo.incidencia_proceso (id_operario);
END
GO
