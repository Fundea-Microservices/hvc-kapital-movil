-- 1. Tabla de Control de Versiones (Para sincronización de Deltas)
CREATE TABLE Control_Versiones_AppEx (
    TablaNombre VARCHAR(50) PRIMARY KEY,
    UltimaModificacion DATETIME NOT NULL DEFAULT GETDATE()
);

-- Insertamos los registros iniciales para las tablas que vamos a sincronizar
INSERT INTO Control_Versiones_AppEx (TablaNombre) VALUES ('Empresas'), ('Dispositivos');

-- 2. Tabla de Empresas
CREATE TABLE Empresas_AppEx (
    IdEmpresa INT IDENTITY(1,1) PRIMARY KEY,
    NombreEmpresa VARCHAR(100) NOT NULL,
    CodigoEnrolamiento VARCHAR(20) UNIQUE NOT NULL,
    Estado BIT DEFAULT 1, -- 1 = Activo, 0 = Inactivo
    FechaCreacion DATETIME DEFAULT GETDATE()
);

-- Insertamos una empresa de prueba para el Sprint 1
INSERT INTO Empresas_AppEx (NombreEmpresa, CodigoEnrolamiento) VALUES ('Empresa GT Demo', 'GT-2026-DEMO');

-- 3. Tabla de Dispositivos
CREATE TABLE Dispositivos_AppEx (
    IdDispositivo INT IDENTITY(1,1) PRIMARY KEY,
    HardwareID VARCHAR(100) UNIQUE NOT NULL, -- Regla: Inmutable tras registro
    DeviceToken VARCHAR(255) UNIQUE NOT NULL,
    Estado BIT DEFAULT 1,
    FechaIngreso DATETIME DEFAULT GETDATE(),
    FechaModificacion DATETIME DEFAULT GETDATE()
);

GO

-- 4. Cumplimiento de Regla 4.1: Triggers de Versión
-- Este trigger se dispara cada vez que hay un INSERT, UPDATE o DELETE en Dispositivos
CREATE TRIGGER trg_UpdateVersion_Dispositivos
ON Dispositivos_AppEx
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE Control_Versiones_AppEx
    SET UltimaModificacion = GETDATE()
    WHERE TablaNombre = 'Dispositivos_AppEx';
END;
GO