/* =============================================================================
   Sprint 13 — Sesion unica por usuario + desvinculacion de dispositivo
   ============================================================================= */

SET NOCOUNT ON;
GO

/* -----------------------------------------------------------------------------
   0. DIAGNOSTICO PREVIO (solo lectura)
   -------------------------------------------------------------------------- */
IF OBJECT_ID('Sesiones_AppEx', 'U') IS NULL
    PRINT '*** Sesiones_AppEx NO EXISTE. Ejecutar antes TablasyReglasSprint2.sql. ***';
ELSE
    SELECT
        COUNT(*)                                                     AS TotalSesiones,
        SUM(CASE WHEN Activa = 1 THEN 1 ELSE 0 END)                  AS Activas
    FROM Sesiones_AppEx;
GO

/* -----------------------------------------------------------------------------
   1. IX_Sesiones_IdUsuario_Activa  (login: invalidar por usuario)
   -------------------------------------------------------------------------- */
IF OBJECT_ID('Sesiones_AppEx', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sesiones_IdUsuario_Activa')
BEGIN
    CREATE INDEX IX_Sesiones_IdUsuario_Activa
        ON Sesiones_AppEx (IdUsuario, Activa);
    PRINT 'IX_Sesiones_IdUsuario_Activa: creado.';
END
ELSE
    PRINT 'IX_Sesiones_IdUsuario_Activa: ya existia o falta la tabla, no se toca.';
GO

/* -----------------------------------------------------------------------------
   2. IX_Sesiones_IdDispositivo  (desvinculacion / bloqueo: invalidar por equipo)
   -------------------------------------------------------------------------- */
IF OBJECT_ID('Sesiones_AppEx', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sesiones_IdDispositivo')
BEGIN
    CREATE INDEX IX_Sesiones_IdDispositivo
        ON Sesiones_AppEx (IdDispositivo);
    PRINT 'IX_Sesiones_IdDispositivo: creado.';
END
ELSE
    PRINT 'IX_Sesiones_IdDispositivo: ya existia o falta la tabla, no se toca.';
GO

/* -----------------------------------------------------------------------------
   3. VERIFICACION REAL
   -------------------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sesiones_IdUsuario_Activa')
   AND EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sesiones_IdDispositivo')
    PRINT 'VERIFICADO: ambos indices de Sesiones_AppEx existen.';
ELSE
    PRINT '*** FALLO: algun indice no se creo. Revisar los errores de arriba. ***';
GO

PRINT '=== Sprint 13 aplicado. La sesion unica y la desvinculacion ya tienen soporte de indices. ===';
GO
