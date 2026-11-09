-- 1. Tabla de Control de Versiones (Para sincronización de Deltas)
CREATE TABLE App_Hvc_Control_Versiones (
    TablaNombre VARCHAR(50) PRIMARY KEY,
    UltimaModificacion DATETIME NOT NULL DEFAULT GETDATE()
);

-- Insertamos los registros iniciales para las tablas que vamos a sincronizar
INSERT INTO App_Hvc_Control_Versiones(TablaNombre) VALUES ('Empresas'), ('Dispositivos');

-- 2. Tabla de Empresas
CREATE TABLE App_Hvc_Empresas (
    IdEmpresa INT IDENTITY(1,1) PRIMARY KEY,
    NombreEmpresa VARCHAR(100) NOT NULL,
    CodigoEnrolamiento VARCHAR(20) UNIQUE NOT NULL,
    Estado BIT DEFAULT 1, -- 1 = Activo, 0 = Inactivo
    FechaCreacion DATETIME DEFAULT GETDATE()
);

-- Insertamos una empresa de prueba para el Sprint 1
INSERT INTO App_Hvc_Empresas(NombreEmpresa, CodigoEnrolamiento) VALUES ('Empresa GT Demo', 'GT-2026-DEMO');

-- 3. Tabla de Dispositivos
CREATE TABLE App_Hvc_Dispositivos (
    IdDispositivo INT IDENTITY(1,1) PRIMARY KEY,
    HardwareID VARCHAR(100) UNIQUE NOT NULL, -- Regla: Inmutable tras registro
    DeviceToken VARCHAR(255) UNIQUE NOT NULL,
    Estado BIT DEFAULT 1,
    -- Metadatos que envia PUT /devices/metadata tras el enrolamiento.
    Modelo NVARCHAR(100) NULL,
    VersionSO NVARCHAR(50) NULL,
    FechaIngreso DATETIME DEFAULT GETDATE(),
    FechaModificacion DATETIME DEFAULT GETDATE()
);

GO

-- 4. Cumplimiento de Regla 4.1: Triggers de Versión
-- Este trigger se dispara cada vez que hay un INSERT, UPDATE o DELETE en Dispositivos
CREATE TRIGGER App_Hvc_trg_UpdateVersion_Dispositivos
ON App_Hvc_Dispositivos
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE Control_Versiones
    SET UltimaModificacion = GETDATE()
    WHERE TablaNombre = 'Dispositivos';
END;
GO

-- 1. Tabla de Roles y Permisos (Con JSON para la App)
CREATE TABLE App_hvc_Roles_Permisos (
    IdRol INT IDENTITY(1,1) PRIMARY KEY,
    NombreRol VARCHAR(50) NOT NULL,
    -- Guardaremos los permisos como JSON para facilitar la lectura en la app móvil
    PermisosJSON NVARCHAR(MAX) NOT NULL DEFAULT '{}', 
    AccesoLectura BIT DEFAULT 1,
    AccesoEscritura BIT DEFAULT 0
);

-- Insertamos un rol administrador base
INSERT INTO Roles_Permisos (NombreRol, PermisosJSON, AccesoLectura, AccesoEscritura) 
VALUES ('Administrador', '{"modulos": ["encuestas", "reportes"]}', 1, 1);

-- 2. Tabla de Usuarios
CREATE TABLE App_hvc_Usuarios (
    IdUsuario INT IDENTITY(1,1) PRIMARY KEY,
    Username VARCHAR(50) UNIQUE NOT NULL,
    -- Longitud de 255 es obligatoria para los hashes de BCrypt o Argon2
    PasswordHash VARCHAR(255) NOT NULL, 
    NombreCompleto VARCHAR(100) NOT NULL,
    IdEmpresa INT NOT NULL FOREIGN KEY REFERENCES Empresas(IdEmpresa),
    IdRol INT NOT NULL FOREIGN KEY REFERENCES Roles_Permisos(IdRol),
    Estado BIT DEFAULT 1 -- 1 = Alta, 0 = Baja (Regla 2.5)
);

INSERT INTO Usuarios (Username, PasswordHash, NombreCompleto, IdEmpresa, IdRol, Estado)
VALUES (
    'usuario.demo',
    'SIN_CONTRASENA_ASIGNADA',
    'Juan Demo',
    1, -- Asumiendo que el IdEmpresa del Sprint 1 es 1
    1
);

-- 3. Tabla de Sesiones Activas (Refresh Tokens)
CREATE TABLE App_hvc_Sesiones (
    IdSesion INT IDENTITY(1,1) PRIMARY KEY,
    IdUsuario INT NOT NULL FOREIGN KEY REFERENCES Usuarios(IdUsuario),
    IdDispositivo INT NOT NULL FOREIGN KEY REFERENCES Dispositivos(IdDispositivo),
    RefreshToken VARCHAR(255) UNIQUE NOT NULL,
    FechaExpiracion DATETIME NOT NULL,
    Activa BIT DEFAULT 1
);
GO

-- 1. Tabla de Parámetros Globales (Key-Value)
CREATE TABLE App_Hvc_Cat_Parametros (
    Clave VARCHAR(50) PRIMARY KEY,
    Valor VARCHAR(255) NOT NULL,
    FechaModificacion DATETIME DEFAULT GETDATE()
);

-- 2. Tabla de Menús (Acordeón / Jerarquía)
CREATE TABLE App_Hvc_Cat_Menu (
    IdMenu INT IDENTITY(1,1) PRIMARY KEY,
    IdPadre INT NULL FOREIGN KEY REFERENCES App_Hvc_Cat_Menu(IdMenu), -- Relación consigo misma
    Titulo VARCHAR(100) NOT NULL,
    Icono VARCHAR(50) NULL,
    Orden INT NOT NULL DEFAULT 0,
    RutaPantalla VARCHAR(100) NULL,
    IdPermisoRequerido INT NULL, 
    Estado BIT DEFAULT 1, -- 1 = Activo, 0 = Inactivo / Eliminado lógico
    FechaModificacion DATETIME DEFAULT GETDATE()
);

-- 3. Tabla de Log de Sincronización (Auditoría - Regla 3.2)
CREATE TABLE App_Hvc_Log_Sincronizacion (
    IdLog INT IDENTITY(1,1) PRIMARY KEY,
    IdDispositivo INT NOT NULL FOREIGN KEY REFERENCES App_Hvc_Dispositivos(IdDispositivo),
    TablaNombre VARCHAR(50) NOT NULL,
    FechaSinc DATETIME NOT NULL DEFAULT GETDATE(),
    Exitoso BIT DEFAULT 0 -- Se actualiza a 1 al recibir el ConfirmarSinc (ACK)
);

GO

-- Registramos las nuevas tablas en el Control de Versiones
INSERT INTO App_Hvc_Control_Versiones (TablaNombre, UltimaModificacion) 
VALUES ('App_Hvc_Cat_Menus', GETDATE()), ('App_Hvc_Cat_Parametross', GETDATE());

GO

-- 4. TRIGGER: Cumplimiento de Reglas Críticas 3.1 y 3.5 (Menús)
CREATE TRIGGER App_Hvc_trg_UpdateMenu_Version
ON App_Hvc_Cat_Menu
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- A. Actualizar Control_Versiones (Regla 3.1)
    UPDATE App_Hvc_Control_Versiones
    SET UltimaModificacion = GETDATE()
    WHERE TablaNombre = 'App_Hvc_Cat_Menu';

    -- B. Regla 3.5: Prevención de Opciones Huérfanas
    -- Si un menú Padre fue desactivado (Estado = 0), desactivar automáticamente a sus hijos.
    IF UPDATE(Estado)
    BEGIN
        UPDATE Hijos
        SET Hijos.Estado = 0, Hijos.FechaModificacion = GETDATE()
        FROM App_Hvc_Cat_Menu Hijos
        INNER JOIN inserted i ON Hijos.IdPadre = i.IdMenu
        WHERE i.Estado = 0;
    END
END;
GO

-- 5. TRIGGER: Control de versiones para Parámetros
CREATE TRIGGER App_Hvc_trg_UpdateParametros_Version
ON App_Hvc_Cat_Parametros
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE App_Hvc_Control_Versiones
    SET UltimaModificacion = GETDATE()
    WHERE TablaNombre = 'App_Hvc_Cat_Parametross';
END;
GO

-- Insertamos datos de prueba para el menú
INSERT INTO App_Hvc_Cat_Menu (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('Inicio', 'home', 1, '/dashboard', NULL);
INSERT INTO App_Hvc_Cat_Menu (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('Gestiones', 'clipboard', 2, NULL, NULL);
INSERT INTO App_Hvc_Cat_Menu (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('Perfil', 'clipboard', 3, NULL, NULL);
-- Hijo de Encuestas (IdPadre = 2)
INSERT INTO App_Hvc_Cat_Menu (Titulo, Icono, Orden, RutaPantalla, IdPadre) VALUES ('SGRAS Línea base', 'plus', 1, '/encuestas/nueva', 2);

-- Insertamos el menú donde crearemos los formularios
INSERT INTO App_Hvc_Cat_Menu (Titulo, Icono, Orden, RutaPantalla, IdPadre) 
VALUES ('Gestión de Campo', 'clipboard', 5, '/encuestas_dinamicas', NULL);