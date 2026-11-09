/* =============================================================================
   SESIONES POR USUARIO (base HvcKapital)
   El login ocurre FUERA (API de auth, puerto 3200). Esta tabla ya no guarda el
   refresh token: registra que un usuario abrio sesion en un equipo concreto,
   para poder cortarla desde el BackOffice.
   Script idempotente. Solo recrea la tabla si esta VACIA: nunca borra datos.
   ============================================================================= */

-- 1. Crear la tabla si no existe -------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID('app.Sesiones') AND type = 'U'
)
BEGIN
    CREATE TABLE app.Sesiones (
        IdSesion        INT IDENTITY(1,1) PRIMARY KEY,
        IdUsuario       UNIQUEIDENTIFIER NOT NULL,   -- auth.Usuario.id
        IdDispositivo   INT              NOT NULL,   -- app.Dispositivos.IdDispositivo
        RefreshToken    VARCHAR(255)     NULL,       -- el API 3200 no emite refresh
        FechaInicio     DATETIME         NOT NULL DEFAULT GETDATE(),
        FechaExpiracion DATETIME         NULL,
        Activa          BIT              NOT NULL DEFAULT 1
    );
END;
GO

-- 2. Si existe pero con la forma vieja (IdUsuario entero), se recrea.
--    La guarda de filas evita destruir sesiones reales: si hay datos, no toca nada
--    y avisa para migrarla a mano.
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('app.Sesiones') AND type = 'U')
BEGIN
    DECLARE @tipoOk BIT = 0, @filas INT = 0;

    SELECT @tipoOk = CASE WHEN t.name = 'uniqueidentifier' THEN 1 ELSE 0 END
    FROM sys.columns c
    JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('app.Sesiones') AND c.name = 'IdUsuario';

    SELECT @filas = COUNT(*) FROM app.Sesiones;

    IF @tipoOk = 0 AND @filas = 0
    BEGIN
        DROP TABLE app.Sesiones;
        CREATE TABLE app.Sesiones (
            IdSesion        INT IDENTITY(1,1) PRIMARY KEY,
            IdUsuario       UNIQUEIDENTIFIER NOT NULL,
            IdDispositivo   INT              NOT NULL,
            RefreshToken    VARCHAR(255)     NULL,
            FechaInicio     DATETIME         NOT NULL DEFAULT GETDATE(),
            FechaExpiracion DATETIME         NULL,
            Activa          BIT              NOT NULL DEFAULT 1
        );
        PRINT 'app.Sesiones recreada con IdUsuario UNIQUEIDENTIFIER (estaba vacia).';
    END
    ELSE IF @tipoOk = 0
    BEGIN
        PRINT 'ATENCION: app.Sesiones tiene filas y un IdUsuario que no es GUID. Migrar a mano.';
    END
END;
GO

-- 3. Columna que puede faltar si la tabla ya existia con la forma correcta ---
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.Sesiones') AND name = 'FechaInicio')
    ALTER TABLE app.Sesiones ADD FechaInicio DATETIME NOT NULL DEFAULT GETDATE();
GO

-- 3b. RefreshToken debe admitir NULL ----------------------------------------
--     El API de auth (3200) no emite refresh token, asi que la sesion se
--     registra sin el. Si la columna quedo NOT NULL, el INSERT falla con 515.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('app.Sesiones') AND name = 'RefreshToken' AND is_nullable = 0
)
    ALTER TABLE app.Sesiones ALTER COLUMN RefreshToken VARCHAR(255) NULL;
GO

-- 3c. El UNIQUE de RefreshToken solo admite UN nulo -------------------------
--     SQL Server considera iguales entre si a todos los NULL, asi que la
--     segunda sesion sin refresh token choca con la primera (error 2627).
--     Se cambia por un indice filtrado: unico entre los tokens que existen,
--     sin limite de filas sin token.
DECLARE @uq SYSNAME;
SELECT @uq = kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic
  ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
JOIN sys.columns c
  ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('app.Sesiones')
  AND kc.type = 'UQ'
  AND c.name = 'RefreshToken';

IF @uq IS NOT NULL
BEGIN
    EXEC('ALTER TABLE app.Sesiones DROP CONSTRAINT [' + @uq + ']');
    PRINT 'Quitado el UNIQUE de RefreshToken: impedia mas de una sesion sin token.';
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Sesiones_RefreshToken')
    CREATE UNIQUE INDEX UX_Sesiones_RefreshToken
      ON app.Sesiones (RefreshToken)
      WHERE RefreshToken IS NOT NULL;
GO

-- 4. Indice de consulta: cortar por equipo y listar lo activo de un usuario --
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sesiones_Dispositivo_Activa')
    CREATE INDEX IX_Sesiones_Dispositivo_Activa ON app.Sesiones (IdDispositivo, Activa);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Sesiones_Usuario_Activa')
    CREATE INDEX IX_Sesiones_Usuario_Activa ON app.Sesiones (IdUsuario, Activa);
GO
