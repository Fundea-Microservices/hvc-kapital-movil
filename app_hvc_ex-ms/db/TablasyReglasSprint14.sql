/* =============================================================================
   Sprint 14 — Cierre del ciclo de precarga: IdPrecarga + estado FINALIZADO
   ============================================================================= */

-- 1. Columna de traza en la tabla de capturas ---------------------------------
-- NULL para las capturas ad-hoc: esas NO salen de una precarga y no tienen origen.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('appEx_Encabezado_Captura') AND name = 'IdPrecarga'
)
BEGIN
    ALTER TABLE appEx_Encabezado_Captura ADD IdPrecarga UNIQUEIDENTIFIER NULL;
    PRINT 'Columna appEx_Encabezado_Captura.IdPrecarga agregada.';
END
ELSE
    PRINT 'Columna appEx_Encabezado_Captura.IdPrecarga ya existia (no-op).';


IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('appEx_Encabezado_Captura') AND name = 'IdPrecarga'
)
    PRINT 'OK: appEx_Encabezado_Captura.IdPrecarga existe.';
ELSE
    RAISERROR('FALLO: no se pudo crear appEx_Encabezado_Captura.IdPrecarga.', 16, 1);

-- 3. Estado 'FINALIZADO' de pre.Precarga --------------------------------------

IF EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    INNER JOIN sys.columns c
        ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('pre.Precarga')
      AND c.name = 'Estado'
      AND cc.definition NOT LIKE '%FINALIZADO%'
)
    RAISERROR('ATENCION: pre.Precarga.Estado tiene un CHECK que NO admite FINALIZADO. El /submit fallara al marcar la precarga. Ajustar el constraint con el dueno de esa tabla.', 16, 1);
ELSE
    PRINT 'OK: pre.Precarga.Estado admite FINALIZADO (sin CHECK que lo impida).';
