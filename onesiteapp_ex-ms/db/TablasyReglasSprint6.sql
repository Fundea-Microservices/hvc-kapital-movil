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