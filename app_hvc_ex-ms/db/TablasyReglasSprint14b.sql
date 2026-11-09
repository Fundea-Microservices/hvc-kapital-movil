/* =============================================================================
   SPRINT 14b - ENCABEZADO DE ENCUESTAS RECHAZADAS (deuda del Sprint 14)
   ============================================================================= */

-- 1. Encabezado de las gestiones rechazadas ----------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID('appEx_Encuestas_Rechazadas') AND type = 'U'
)
BEGIN
    CREATE TABLE appEx_Encuestas_Rechazadas (
        IdEncuestaRechazada BIGINT IDENTITY(1,1) PRIMARY KEY,
        IdRechazo           NVARCHAR(64)  NOT NULL,

        Origen              NVARCHAR(10)  NOT NULL,  

        -- NULL en AD-HOC: esa gestion se creo en campo y no existe en pre.Precarga.
        IdPrecarga          UNIQUEIDENTIFIER NULL,
        IdEmpresa           INT           NULL,
        DispositivoID       VARCHAR(100)  NULL,       

        IdEncuesta          INT           NOT NULL,

        IdUsuario           INT           NOT NULL,

        UuidInstancia       NVARCHAR(100) NULL,

        NombreCliente       NVARCHAR(200) NULL,
        Documento           NVARCHAR(50)  NULL,
        Cuenta              NVARCHAR(50)  NULL,
        Operacion           NVARCHAR(50)  NULL,
        Expediente          NVARCHAR(50)  NULL,

        Motivo              NVARCHAR(500) NOT NULL,

        FechaRechazoDisp    DATETIME      NULL,
        FechaRegistro       DATETIME      NOT NULL DEFAULT GETDATE(),

        AfectadasPrecarga   INT           NOT NULL DEFAULT 0,

        -- PREPARADO PARA EL FUTURO CERCANO: las respuestas parciales que el asesor
        
        RespuestasEnviadas  BIT           NOT NULL DEFAULT 0,

        CONSTRAINT CK_EncRech_Origen CHECK (Origen IN ('PRECARGA','AD-HOC')),

        -- Coherencia origen <-> IdPrecarga en la BD, no solo en el DTO: el endpoint
        -- no es el unico camino posible a esta tabla a lo largo de su vida.
        CONSTRAINT CK_EncRech_Coherencia CHECK (
            (Origen = 'PRECARGA' AND IdPrecarga IS NOT NULL)
         OR (Origen = 'AD-HOC'   AND IdPrecarga IS NULL)
        ),

        CONSTRAINT FK_EncRech_Encuesta FOREIGN KEY (IdEncuesta)
            REFERENCES appEx_Encuesta(IdEncuesta)
    );

    CREATE UNIQUE INDEX UX_EncRech_IdRechazo
        ON appEx_Encuestas_Rechazadas (IdRechazo);
    CREATE INDEX IX_EncRech_IdPrecarga
        ON appEx_Encuestas_Rechazadas (IdPrecarga);
    -- El reporte natural es "rechazos de mi empresa en un rango de fechas".
    CREATE INDEX IX_EncRech_Empresa_Fecha
        ON appEx_Encuestas_Rechazadas (IdEmpresa, FechaRegistro);

    PRINT 'Tabla appEx_Encuestas_Rechazadas creada.';
END
ELSE
    PRINT 'Tabla appEx_Encuestas_Rechazadas ya existia (no-op).';

-- Sin FK a pre.Precarga a proposito: es otro schema, su PK es Correlativo (no Id)
-- y las AD-HOC llevan NULL.
IF EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID('appEx_Encuestas_Rechazadas') AND type = 'U'
)
    PRINT 'OK: appEx_Encuestas_Rechazadas existe.';
ELSE
    RAISERROR('FALLO: no se pudo crear appEx_Encuestas_Rechazadas.', 16, 1);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_EncRech_IdRechazo')
    PRINT 'OK: indice UNIQUE de idempotencia presente.';
ELSE
    RAISERROR('FALLO: sin UNIQUE en IdRechazo la idempotencia NO existe y el endpoint duplicara encabezados.', 16, 1);

-- 3. Sondeo de pre.Precarga (NO la altera) -----------------------------------
-- Esta tabla es de otro desarrollador. 

PRINT '--- Sondeo de pre.Precarga (informativo) ---';
SELECT c.name AS Columna, t.name AS Tipo, c.max_length AS LongitudBytes, c.is_nullable
FROM sys.columns c
INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('pre.Precarga')
  AND c.name IN ('Id', 'Estado', 'Comentario', 'IdUsractualiza', 'Updated_At');

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('pre.Precarga') AND name = 'Comentario'
)
    RAISERROR('ATENCION: pre.Precarga no tiene columna Comentario. El espejo del motivo fallara; ajustar el nombre real en surveys.service.ts o agregar la columna con el dueno de esa tabla.', 16, 1);
ELSE
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.columns c
        INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID('pre.Precarga') AND c.name = 'Comentario'
          -- max_length = -1 es MAX (ilimitado): eso siempre cabe.
          AND c.max_length <> -1
          AND (CASE WHEN t.name LIKE 'n%' THEN c.max_length / 2 ELSE c.max_length END) < 500
    )
        RAISERROR('ATENCION: pre.Precarga.Comentario admite MENOS de 500 caracteres. Bajar MAX_LONGITUD_MOTIVO en la app y el tope del DTO a ese valor, o el UPDATE fallara por truncamiento DENTRO de la transaccion y revertira el encabezado.', 16, 1);
    ELSE
        PRINT 'OK: pre.Precarga.Comentario existe y admite el tope del motivo.';
END

-- Un CHECK sobre Estado que no admita 'RECHAZADO' haria fallar el espejo igual que
-- fallo con 'FINALIZADO', y al ir en la transaccion revertiria el encabezado.
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    INNER JOIN sys.columns c
        ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('pre.Precarga')
      AND c.name = 'Estado'
      AND cc.definition NOT LIKE '%RECHAZADO%'
)
    RAISERROR('ATENCION: pre.Precarga.Estado tiene un CHECK que NO admite RECHAZADO. El espejo del rechazo fallara y revertira el encabezado. Ajustar el constraint con el dueno de esa tabla.', 16, 1);
ELSE
    PRINT 'OK: pre.Precarga.Estado admite RECHAZADO (sin CHECK que lo impida).';

-- RECORDATORIO OPERATIVO: tras desplegar este script hay que reconstruir el
-- backend (npm run build) y reiniciarlo.