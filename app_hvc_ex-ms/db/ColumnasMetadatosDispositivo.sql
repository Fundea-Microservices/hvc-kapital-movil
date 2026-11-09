/* =============================================================================
   METADATOS DEL DISPOSITIVO - columnas que faltaban en Dispositivos_AppEx
   ============================================================================= */

-- Modelo del equipo (ej. "sdk_gphone64_x86_64"). NULL para no romper enrolados.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('Dispositivos_AppEx') AND name = 'Modelo'
)
BEGIN
    ALTER TABLE Dispositivos_AppEx ADD Modelo NVARCHAR(100) NULL;
END;
GO

-- Sistema operativo y version (ej. "android 15").
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('Dispositivos_AppEx') AND name = 'VersionSO'
)
BEGIN
    ALTER TABLE Dispositivos_AppEx ADD VersionSO NVARCHAR(50) NULL;
END;
GO
