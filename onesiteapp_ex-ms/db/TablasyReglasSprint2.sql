-- 1. Tabla de Roles y Permisos (Con JSON para la App)
CREATE TABLE Roles_Permisos_AppEx (
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
CREATE TABLE Usuarios_AppEx (
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
CREATE TABLE Sesiones_AppEx (
    IdSesion INT IDENTITY(1,1) PRIMARY KEY,
    IdUsuario INT NOT NULL FOREIGN KEY REFERENCES Usuarios(IdUsuario),
    IdDispositivo INT NOT NULL FOREIGN KEY REFERENCES Dispositivos(IdDispositivo),
    RefreshToken VARCHAR(255) UNIQUE NOT NULL,
    FechaExpiracion DATETIME NOT NULL,
    Activa BIT DEFAULT 1
);
GO