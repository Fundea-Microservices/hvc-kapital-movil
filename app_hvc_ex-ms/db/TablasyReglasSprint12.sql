/* =============================================================================
   Sprint 12 — Cambio obligatorio de contrasena al primer ingreso
   ============================================================================= */

SET NOCOUNT ON;
GO

/* -----------------------------------------------------------------------------
   0. DIAGNOSTICO PREVIO (solo lectura)
   -------------------------------------------------------------------------- */
IF OBJECT_ID('Usuarios_AppEx', 'U') IS NULL
    PRINT '*** Usuarios_AppEx NO EXISTE. Ejecutar antes TablasyReglasSprint2.sql. ***';
ELSE
    SELECT
        COUNT(*) AS TotalUsuarios,
        SUM(CASE WHEN COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NOT NULL
                 THEN 1 ELSE 0 END) AS YaTieneColumna
    FROM Usuarios_AppEx;
GO

/* -----------------------------------------------------------------------------
   1. RequiereCambioPassword
   -------------------------------------------------------------------------- */
IF COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NULL
BEGIN
    ALTER TABLE Usuarios_AppEx
        ADD RequiereCambioPassword BIT NOT NULL
        CONSTRAINT DF_Usuarios_RequiereCambioPassword DEFAULT (1);
    PRINT 'Usuarios_AppEx.RequiereCambioPassword: columna creada (DEFAULT 1).';

    EXEC('
        UPDATE Usuarios_AppEx SET RequiereCambioPassword = 0;
        PRINT ''Usuarios_AppEx: exonerados '' + CAST(@@ROWCOUNT AS VARCHAR(20)) + '' usuario(s) existente(s) (RequiereCambioPassword = 0).'';
    ');
END
ELSE
    PRINT 'Usuarios_AppEx.RequiereCambioPassword: ya existia, no se toca (exoneracion ya aplicada en su momento).';
GO

/* -----------------------------------------------------------------------------
   2. FechaUltimoCambioPassword
   -------------------------------------------------------------------------- */
IF COL_LENGTH('Usuarios_AppEx', 'FechaUltimoCambioPassword') IS NULL
BEGIN
    ALTER TABLE Usuarios_AppEx ADD FechaUltimoCambioPassword DATETIME NULL;
    PRINT 'Usuarios_AppEx.FechaUltimoCambioPassword: columna creada.';
END
ELSE
    PRINT 'Usuarios_AppEx.FechaUltimoCambioPassword: ya existia, no se toca.';
GO

/* -----------------------------------------------------------------------------
   3. VERIFICACION REAL
   -------------------------------------------------------------------------- */
IF COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NOT NULL
   AND COL_LENGTH('Usuarios_AppEx', 'FechaUltimoCambioPassword') IS NOT NULL
    PRINT 'VERIFICADO: las columnas existen. El login ya puede devolver requiereCambioPassword.';
ELSE
    PRINT '*** FALLO: alguna columna no se creo. Revisar los errores de arriba. ***';
GO

IF COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NOT NULL
    EXEC('
        SELECT
            COUNT(*)                                                        AS TotalUsuarios,
            SUM(CASE WHEN RequiereCambioPassword = 0 THEN 1 ELSE 0 END)     AS Exonerados,
            SUM(CASE WHEN RequiereCambioPassword = 1 THEN 1 ELSE 0 END)     AS Forzados
        FROM Usuarios_AppEx;
    ');
GO

/* -----------------------------------------------------------------------------
   2-BIS. (OPCIONAL, INVERSO) Forzar el cambio a usuarios concretos
   -------------------------------------------------------------------------- */
-- UPDATE Usuarios_AppEx
-- SET RequiereCambioPassword = 1
-- WHERE IdUsuario IN (/* pegar aqui los IdUsuario a forzar */);
-- GO

PRINT '=== Sprint 12 aplicado. Probar login: la respuesta debe traer requiereCambioPassword. ===';
GO
