/* =============================================================================
   ENROLAMIENTO POR USUARIO (base HvcKapital)
   El codigo de enrolamiento deja de vivir en Empresas y pasa a auth.Usuario:
   el equipo queda atado a una PERSONA, no a una empresa.
   Script idempotente: se puede correr varias veces.
   ============================================================================= */

-- 1. Tabla de dispositivos ---------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID('app.Dispositivos') AND type = 'U'
)
BEGIN
    CREATE TABLE app.Dispositivos (
        IdDispositivo     INT IDENTITY(1,1) PRIMARY KEY,
        HardwareID        VARCHAR(100)     NOT NULL UNIQUE,  -- inmutable tras registro
        DeviceToken       VARCHAR(255)     NOT NULL UNIQUE,
        IdUsuario         UNIQUEIDENTIFIER NOT NULL,         -- dueno del enrolamiento
        Estado            BIT              DEFAULT 1,        -- 0 = bloqueado por admin
        Modelo            NVARCHAR(100)    NULL,
        VersionSO         NVARCHAR(50)     NULL,
        FechaIngreso      DATETIME         DEFAULT GETDATE(),
        FechaModificacion DATETIME         DEFAULT GETDATE()
    );
END;
GO

-- 2. Columnas que pueden faltar si la tabla ya existia ------------------------
-- Se agrega como NULL: una tabla con filas no admite NOT NULL sin valor por defecto.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.Dispositivos') AND name = 'IdUsuario')
    ALTER TABLE app.Dispositivos ADD IdUsuario UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.Dispositivos') AND name = 'Modelo')
    ALTER TABLE app.Dispositivos ADD Modelo NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.Dispositivos') AND name = 'VersionSO')
    ALTER TABLE app.Dispositivos ADD VersionSO NVARCHAR(50) NULL;
GO

-- 3. Integridad referencial contra el usuario dueno ---------------------------
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Dispositivos_Usuario')
BEGIN
    ALTER TABLE app.Dispositivos
      ADD CONSTRAINT FK_Dispositivos_Usuario
      FOREIGN KEY (IdUsuario) REFERENCES auth.Usuario(id);
END;
GO

-- 4. El codigo de enrolamiento es una credencial: unico entre los que existen.
--    El indice filtrado permite varios usuarios SIN codigo (NULL) sin chocar.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Usuario_CodigoEnrolamiento')
BEGIN
    CREATE UNIQUE INDEX UX_Usuario_CodigoEnrolamiento
      ON auth.Usuario (CodigoEnrolamiento)
      WHERE CodigoEnrolamiento IS NOT NULL;
END;
GO
