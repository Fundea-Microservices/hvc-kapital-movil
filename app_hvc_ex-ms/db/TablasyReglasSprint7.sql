-- =============================================================================
-- SPRINT 7: Vinculación Dispositivo ↔ Empresa (deuda técnica del Anexo 1)
-- El diccionario de datos define Dispositivos.IdEmpresa INT (FK) pero la tabla
-- se creó sin esa columna, por lo que el enrolamiento nunca vinculó el equipo
-- a su empresa (multiempresa roto).
-- =============================================================================

-- 1. Columna nueva (NULL para no romper los dispositivos ya enrolados)
ALTER TABLE Dispositivos_AppEx ADD IdEmpresa INT NULL;
GO

-- 2. Integridad referencial contra Empresas
ALTER TABLE Dispositivos_AppEx
  ADD CONSTRAINT FK_Dispositivos_Empresas
  FOREIGN KEY (IdEmpresa) REFERENCES Empresas_AppEx(IdEmpresa);
GO

-- 3. Backfill opcional: si el ambiente tiene UNA sola empresa activa, vincular
--    los dispositivos legacy a ella. (Con varias empresas, dejar en NULL y se
--    re-vincularán automáticamente cuando el equipo vuelva a enrolar.)
IF (SELECT COUNT(*) FROM Empresas_AppEx WHERE Estado = 1) = 1
BEGIN
  UPDATE Dispositivos_AppEx
  SET IdEmpresa = (SELECT TOP 1 IdEmpresa FROM Empresas_AppEx WHERE Estado = 1)
  WHERE IdEmpresa IS NULL;
END;
GO

-- =============================================================================
-- 4. Menú gateado por permisos (Anexo 1, sprint 3.2: Cat_Menu.IdPermisoRequerido)
--    NULL = el ítem de menú es visible para todos (comportamiento actual).
--    Con valor = la App lo oculta si el permiso no está en el permisos_json del usuario.
-- =============================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('Cat_Menu_AppEx') AND name = 'IdPermisoRequerido'
)
BEGIN
  ALTER TABLE Cat_Menu_AppEx ADD IdPermisoRequerido INT NULL;
END;
GO
