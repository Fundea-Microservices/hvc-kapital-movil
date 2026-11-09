/* =============================================================================
   SINCRONIZACION EN HvcKapital
   ============================================================================= */

-- 1. auth.Menu: NADA que agregar --------------------------------------------
--    auth.Acceso ya resuelve lo que faltaba, y mejor: por ROL, no por menu.
--      a.ordenMenu   -> el orden
--      a.mainMenuId  -> el menu padre
--      a.showApp     -> 1 = va al telefono, 0 = solo BackOffice
--    El menu se arma con el JOIN Usuario -> Rol -> Acceso -> Menu.
--
--    REVERSION, si ya se corrio una version anterior de este script y se
--    agregaron columnas que resultaron innecesarias (no se ejecuta solo):
-- ALTER TABLE auth.Menu DROP CONSTRAINT FK_Menu_MenuPadre;
-- ALTER TABLE auth.Menu DROP COLUMN MenuPadreId;
-- ALTER TABLE auth.Menu DROP COLUMN PermisoCodigo;
-- ALTER TABLE auth.Menu DROP CONSTRAINT <nombre_del_default_de_Orden>;
-- ALTER TABLE auth.Menu DROP COLUMN Orden;

-- 2. Parametros globales de la app -------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('app.Cat_Parametros') AND type = 'U')
BEGIN
    CREATE TABLE app.Cat_Parametros (
        Clave             VARCHAR(100) NOT NULL PRIMARY KEY,
        Valor             NVARCHAR(500) NULL,
        FechaModificacion DATETIME NOT NULL DEFAULT GETDATE()
    );
    INSERT INTO app.Cat_Parametros (Clave, Valor) VALUES ('VERSION_MINIMA_APP', '1.0.0');
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.Cat_Parametros') AND name = 'FechaModificacion')
    ALTER TABLE app.Cat_Parametros ADD FechaModificacion DATETIME NOT NULL DEFAULT GETDATE();
GO

-- 3. Auditoria de sincronizaciones (el ACK de la app) ------------------------
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('app.Log_Sincronizacion') AND type = 'U')
BEGIN
    CREATE TABLE app.Log_Sincronizacion (
        IdLog         INT IDENTITY(1,1) PRIMARY KEY,
        IdDispositivo INT NOT NULL,
        TablaNombre   VARCHAR(100) NOT NULL,
        FechaSinc     DATETIME NOT NULL DEFAULT GETDATE(),
        Exitoso       BIT NOT NULL DEFAULT 1
    );
END;
GO

-- 4. Control de versiones: filas de las tablas que la app sincroniza ---------
IF NOT EXISTS (SELECT 1 FROM app.ControlVersiones WHERE TablaNombre = 'auth.Menu')
    INSERT INTO app.ControlVersiones (TablaNombre, UltimaModificacion) VALUES ('auth.Menu', GETDATE());
GO
IF NOT EXISTS (SELECT 1 FROM app.ControlVersiones WHERE TablaNombre = 'app.Cat_Parametros')
    INSERT INTO app.ControlVersiones (TablaNombre, UltimaModificacion) VALUES ('app.Cat_Parametros', GETDATE());
GO
