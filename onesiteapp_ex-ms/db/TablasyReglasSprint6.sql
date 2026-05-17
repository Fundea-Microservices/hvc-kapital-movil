-- Se crea la tabla maestra de catálogos para SGRAS (S2.1)
CREATE TABLE appEx_Catalogos_Maestro (
    IdCatalogo INT IDENTITY(1,1) PRIMARY KEY,
    NombreCatalogo VARCHAR(100) NOT NULL,
    CodigoOpcion VARCHAR(50) NOT NULL,
    ValorOpcion TEXT NOT NULL,
    IdPadreOpcion VARCHAR(50) NULL,
    FechaModificacion DATETIME DEFAULT GETDATE()
);

-- Se registra en el control de versiones
INSERT INTO Control_Versiones_AppEx (TablaNombre, UltimaModificacion) 
VALUES ('appEx_Catalogos_Maestro', GETDATE());

  Secciones cargadas: [undefined, undefined]
 LOG  Preguntas cargadas: [{"etiqueta": "¿Ha sido operado alguna vez?", "id_matriz_padre": null, "tipo": "RADIO"}, 
 {"etiqueta": "Ingresos Mensuales", "id_matriz_padre": null, "tipo": "NUMERO"}, 
 {"etiqueta": "Motivo de la operación", "id_matriz_padre": null, "tipo": "TEXTO"}, 
 {"etiqueta": "Egresos Mensuales", "id_matriz_padre": null, "tipo": "NUMERO"},
  {"etiqueta": "Ingreso Neto Disponible", "id_matriz_padre": null, "tipo": "NUMERO"}]


  -- El sistema crea la tabla maestra para agrupar sesiones de encuestas (Auditoría)
CREATE TABLE appEx_Encabezado_Captura (
    IdCaptura BIGINT IDENTITY(1,1) PRIMARY KEY,
    IdEncuesta INT NOT NULL,
    IdUsuario INT NOT NULL,
    FechaInicio DATETIME NOT NULL,
    FechaFin DATETIME NOT NULL,
    Latitud DECIMAL(9,6) NULL,
    Longitud DECIMAL(9,6) NULL,
    DispositivoID VARCHAR(100) NULL,
    FechaSincronizacion DATETIME DEFAULT GETDATE(),
    -- Relación con la tabla de encuestas
    CONSTRAINT FK_Encabezado_Encuesta FOREIGN KEY (IdEncuesta) REFERENCES appEx_Encuesta(IdEncuesta)
);

-- El sistema altera la tabla de Respuestas para vincularla al nuevo Encabezado
ALTER TABLE appEx_Respuestas ADD IdCaptura BIGINT NULL;
ALTER TABLE appEx_Respuestas ADD CONSTRAINT FK_Respuesta_Encabezado FOREIGN KEY (IdCaptura) REFERENCES appEx_Encabezado_Captura(IdCaptura);

PRINT 'Tabla appEx_Encabezado_Captura creada y vinculada con éxito.';

-- 2. El sistema actualiza las preguntas para que dejen de usar JSON quemado y usen el catálogo
UPDATE appEx_Pregunta 
SET Opciones = 'CAT_PARENTESCO' 
WHERE Etiqueta LIKE 'Parentesco';

UPDATE appEx_Pregunta 
SET Opciones = 'CAT_GENERO' 
WHERE Etiqueta LIKE 'Género';

--------------------------------------------------------
----------------------------------------------------------
CREATE TABLE stats_SGRAS_Plana (
    IdCaptura BIGINT PRIMARY KEY,
    IdEncuesta INT,
    IdUsuario INT,
    FechaFin DATETIME,
    -- Columnas horizontales basadas en las etiquetas
    Nombre_Completo VARCHAR(255),
    Correo_Electronico VARCHAR(255),
    Sueldo_Base DECIMAL(18,2),
    Gastos_Fijos DECIMAL(18,2),
    Saldo_Neto DECIMAL(18,2)
);
GO

-- 2. El sistema crea el Disparador (Trigger)
CREATE TRIGGER trg_AplanarRespuestas
ON appEx_Respuestas
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- El sistema inserta un registro base en la tabla plana si no existe (basado en el IdCaptura)
    INSERT INTO stats_SGRAS_Plana (IdCaptura, IdEncuesta)
    SELECT DISTINCT i.IdCaptura, i.IdEncuesta
    FROM inserted i
    WHERE i.IdCaptura IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM stats_SGRAS_Plana p WHERE p.IdCaptura = i.IdCaptura);

    -- El sistema actualiza las columnas horizontales dinámicamente mapeando la pregunta con su valor
    UPDATE p
    SET 
        -- Mapeo rústico pero efectivo: Se busca la etiqueta de la pregunta insertada y se asigna el valor
        p.Nombre_Completo = CASE WHEN q.Etiqueta LIKE 'Nombre Completo%' THEN i.Valor ELSE p.Nombre_Completo END,
        p.Correo_Electronico = CASE WHEN q.Etiqueta LIKE 'Correo Electr%' THEN i.Valor ELSE p.Correo_Electronico END,
        p.Sueldo_Base = CASE WHEN q.Etiqueta LIKE 'Sueldo Base%' THEN CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Sueldo_Base END,
        p.Gastos_Fijos = CASE WHEN q.Etiqueta LIKE 'Gastos Fijos%' THEN CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Gastos_Fijos END,
        p.Saldo_Neto = CASE WHEN q.Etiqueta LIKE 'Saldo Neto%' THEN CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Saldo_Neto END
    FROM stats_SGRAS_Plana p
    INNER JOIN inserted i ON p.IdCaptura = i.IdCaptura
    INNER JOIN appEx_Pregunta q ON i.IdPregunta = q.IdPregunta;
END;
GO
PRINT 'Tabla Plana y Trigger ETL creados con éxito.';


-- LOTE 1: Asegurar que las columnas existen
IF NOT EXISTS(SELECT 1 FROM sys.columns WHERE Name = N'IdCaptura' AND Object_ID = Object_ID(N'appEx_Respuestas'))
BEGIN
    ALTER TABLE appEx_Respuestas ADD IdCaptura BIGINT NULL;
    ALTER TABLE appEx_Respuestas ADD CONSTRAINT FK_Respuesta_Encabezado FOREIGN KEY (IdCaptura) REFERENCES appEx_Encabezado_Captura(IdCaptura);
END
GO

-- LOTE 2: Crear el Trigger de Aplanamiento
CREATE OR ALTER TRIGGER trg_AplanarRespuestas
ON appEx_Respuestas
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Insertamos el registro base si no existe
    INSERT INTO stats_SGRAS_Plana (IdCaptura, IdEncuesta)
    SELECT DISTINCT i.IdCaptura, i.IdEncuesta
    FROM inserted i
    WHERE i.IdCaptura IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM stats_SGRAS_Plana p WHERE p.IdCaptura = i.IdCaptura);

    -- Actualizamos las columnas dinámicamente
    UPDATE p
    SET 
        p.Nombre_Completo = CASE WHEN q.Etiqueta LIKE 'Nombre Completo%' THEN i.Valor ELSE p.Nombre_Completo END,
        p.Correo_Electronico = CASE WHEN q.Etiqueta LIKE 'Correo Electr%' THEN i.Valor ELSE p.Correo_Electronico END,
        p.Sueldo_Base = CASE WHEN q.Etiqueta LIKE 'Sueldo Base%' THEN CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Sueldo_Base END,
        p.Gastos_Fijos = CASE WHEN q.Etiqueta LIKE 'Gastos Fijos%' THEN CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Gastos_Fijos END,
        p.Saldo_Neto = CASE WHEN q.Etiqueta LIKE 'Saldo Neto%' THEN CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Saldo_Neto END
    FROM stats_SGRAS_Plana p
    INNER JOIN inserted i ON p.IdCaptura = i.IdCaptura
    INNER JOIN appEx_Pregunta q ON i.IdPregunta = q.IdPregunta;
END;
GO
PRINT 'Trigger compilado y creado exitosamente.';

-- El sistema crea la tabla de Accesos Parametrizables
CREATE TABLE appEx_Acceso (
    IdAcceso INT IDENTITY(1,1) PRIMARY KEY,
    IdMenu INT NULL,          -- Si es NULL, aplica a toda una sección o encuesta
    IdRol INT NOT NULL,       -- Relacionado a Roles_Permisos_AppEx
    IdMainMenu INT NULL,      -- Para crear submenús jerárquicos
    IdEncuesta INT NULL,      -- NUEVO: Si tiene un ID, este rol puede ver esta encuesta
    OrdenMenu INT DEFAULT 1,
    MostrarApp BIT DEFAULT 1, -- 1 = Se ve en el celular
    MostrarWeb BIT DEFAULT 0, -- 1 = Se ve en el panel de admin
    Activo BIT DEFAULT 1,
    
    -- Foreign Keys
    CONSTRAINT FK_Acceso_Rol FOREIGN KEY (IdRol) REFERENCES Roles_Permisos_AppEx(IdRol),
    CONSTRAINT FK_Acceso_Encuesta FOREIGN KEY (IdEncuesta) REFERENCES appEx_Encuesta(IdEncuesta)
);

PRINT 'Tabla appEx_Acceso creada con éxito.';