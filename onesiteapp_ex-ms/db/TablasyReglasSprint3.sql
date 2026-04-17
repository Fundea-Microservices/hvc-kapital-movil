-- 1. Tabla de Parámetros Globales (Key-Value)
CREATE TABLE Cat_Parametros_AppEx (
    Clave VARCHAR(50) PRIMARY KEY,
    Valor VARCHAR(255) NOT NULL,
    FechaModificacion DATETIME DEFAULT GETDATE()
);

-- 2. Tabla de Menús (Acordeón / Jerarquía)
CREATE TABLE Cat_Menu_AppEx (
    IdMenu INT IDENTITY(1,1) PRIMARY KEY,
    IdPadre INT NULL FOREIGN KEY REFERENCES Cat_Menu_AppEx(IdMenu), -- Relación consigo misma
    Titulo VARCHAR(100) NOT NULL,
    Icono VARCHAR(50) NULL,
    Orden INT NOT NULL DEFAULT 0,
    RutaPantalla VARCHAR(100) NULL,
    IdPermisoRequerido INT NULL, 
    Estado BIT DEFAULT 1, -- 1 = Activo, 0 = Inactivo / Eliminado lógico
    FechaModificacion DATETIME DEFAULT GETDATE()
);

-- 3. Tabla de Log de Sincronización (Auditoría - Regla 3.2)
CREATE TABLE Log_Sincronizacion_AppEx (
    IdLog INT IDENTITY(1,1) PRIMARY KEY,
    IdDispositivo INT NOT NULL FOREIGN KEY REFERENCES Dispositivos_AppEx(IdDispositivo),
    TablaNombre VARCHAR(50) NOT NULL,
    FechaSinc DATETIME NOT NULL DEFAULT GETDATE(),
    Exitoso BIT DEFAULT 0 -- Se actualiza a 1 al recibir el ConfirmarSinc (ACK)
);

GO

-- Registramos las nuevas tablas en el Control de Versiones
INSERT INTO Control_Versiones_AppEx (TablaNombre, UltimaModificacion) 
VALUES ('Cat_Menus_AppEx', GETDATE()), ('Cat_Parametross_AppEx', GETDATE());

GO

-- 4. TRIGGER: Cumplimiento de Reglas Críticas 3.1 y 3.5 (Menús)
CREATE TRIGGER trg_UpdateMenu_Version_AppEx
ON Cat_Menu_AppEx
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- A. Actualizar Control_Versiones (Regla 3.1)
    UPDATE Control_Versiones_AppEx
    SET UltimaModificacion = GETDATE()
    WHERE TablaNombre = 'Cat_Menu_AppEx';

    -- B. Regla 3.5: Prevención de Opciones Huérfanas
    -- Si un menú Padre fue desactivado (Estado = 0), desactivar automáticamente a sus hijos.
    IF UPDATE(Estado)
    BEGIN
        UPDATE Hijos
        SET Hijos.Estado = 0, Hijos.FechaModificacion = GETDATE()
        FROM Cat_Menu_AppEx Hijos
        INNER JOIN inserted i ON Hijos.IdPadre = i.IdMenu
        WHERE i.Estado = 0;
    END
END;
GO

-- 5. TRIGGER: Control de versiones para Parámetros
CREATE TRIGGER trg_UpdateParametros_Version_AppEx
ON Cat_Parametros_AppEx
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE Control_Versiones_AppEx
    SET UltimaModificacion = GETDATE()
    WHERE TablaNombre = 'Cat_Parametross_AppEx';
END;
GO

-- Insertamos datos de prueba para el menú
INSERT INTO Cat_Menu_AppEx (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('Inicio', 'home', 1, '/dashboard', NULL);
INSERT INTO Cat_Menu_AppEx (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('Gestiones', 'clipboard', 2, NULL, NULL);
INSERT INTO Cat_Menu_AppEx (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('Perfil', 'clipboard', 3, NULL, NULL);
-- Hijo de Encuestas (IdPadre = 2)
INSERT INTO Cat_Menu_AppEx (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('SGRAS Línea base', 'plus', 1, '/encuestas/nueva', 2);