-- Se crean las tablas maestras del microservicio SGRAS Encuestas
CREATE TABLE appEx_Encuesta (
    IdEncuesta INT IDENTITY(1,1) PRIMARY KEY,
    Nombre VARCHAR(255) NOT NULL,
    VersionActiva INT DEFAULT 1,
    Estado BIT DEFAULT 1,
    FechaModificacion DATETIME DEFAULT GETDATE()
);

CREATE TABLE appEx_Seccion (
    IdSeccion INT IDENTITY(1,1) PRIMARY KEY,
    IdEncuesta INT FOREIGN KEY REFERENCES appEx_Encuesta(IdEncuesta),
    Titulo VARCHAR(255) NOT NULL,
    Orden INT NOT NULL,
    EsVisibleDefault BIT DEFAULT 1,
    FechaModificacion DATETIME DEFAULT GETDATE()
);

CREATE TABLE appEx_Pregunta (
    IdPregunta INT IDENTITY(1,1) PRIMARY KEY,
    IdSeccion INT FOREIGN KEY REFERENCES appEx_Seccion(IdSeccion),
    IdMatrizPadre INT NULL,
    Etiqueta TEXT NOT NULL,
    TipoDato VARCHAR(50) NOT NULL,
    OrigenDatosTipo VARCHAR(50) NULL,
    OrigenDatosCmd VARCHAR(255) NULL,
    EsEditable BIT DEFAULT 1,
    EsVisibleDefault BIT DEFAULT 1,
    Orden INT NOT NULL,
    FechaModificacion DATETIME DEFAULT GETDATE()
);
-- 1. Agregamos la columna 'Opciones' para soportar Radio, Checkbox y Selects agregado 6/05/2026
ALTER TABLE appEx_Pregunta 
ADD Opciones NVARCHAR(MAX) NULL;

CREATE TABLE appEx_Reglas (
    IdPregunta INT PRIMARY KEY FOREIGN KEY REFERENCES appEx_Pregunta(IdPregunta),
    SintaxisCalculo TEXT NULL,
    ReglaValidacion TEXT NULL,
    ReglaVisibilidad TEXT NULL
);

-- Se crea la tabla transaccional para recibir el JSON Bulk (S5)
CREATE TABLE appEx_Respuestas (
    IdRespuesta BIGINT IDENTITY(1,1) PRIMARY KEY,
    IdEncuesta INT FOREIGN KEY REFERENCES appEx_Encuesta(IdEncuesta),
    IdPregunta INT FOREIGN KEY REFERENCES appEx_Pregunta(IdPregunta),
    UUID_Instancia UNIQUEIDENTIFIER NULL,
    Valor TEXT NULL,
    FechaSincronizacion DATETIME DEFAULT GETDATE()
);

-- Se registra en el control de versiones para la sincronización
INSERT INTO Control_Versiones_AppEx (TablaNombre, UltimaModificacion) VALUES 
('appEx_Encuesta', GETDATE()), 
('appEx_Seccion', GETDATE()), 
('appEx_Pregunta', GETDATE());