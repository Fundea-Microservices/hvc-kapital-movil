/* =============================================================================
   Semilla MINIMA para poder entrar a la app en un ambiente nuevo (DB Hvc-App).

   Este script es idempotente: se puede correr dos veces sin duplicar nada.

   Contrasena del usuario que crea: Temporal2026$
   Para usar otra, regenerar el hash (NO se guarda en texto plano):
     cd app_hvc_ex-ms && node -e "console.log(require('bcrypt').hashSync('TU_CLAVE',10))"
   y reemplazar @PasswordHash abajo.
   ============================================================================= */

SET NOCOUNT ON;

DECLARE @Username       VARCHAR(50)  = 'ralonzo';
DECLARE @NombreCompleto VARCHAR(100) = 'Usuario de pruebas HVC';
DECLARE @PasswordHash   VARCHAR(255) = '$2b$10$1A.o6xDYKl8E9rFGeBHpn.xl9bDpYRuJ6.keh7XPx1QKjmqdb80hG';

--- 1. Empresa ------------------------------------------------------------
DECLARE @IdEmpresa INT = (
    SELECT TOP 1 IdEmpresa FROM Dispositivos_AppEx
    WHERE IdEmpresa IS NOT NULL AND Estado = 1
    ORDER BY IdDispositivo DESC
);

IF @IdEmpresa IS NULL
BEGIN
    SELECT @IdEmpresa = IdEmpresa FROM Empresas_AppEX WHERE CodigoEnrolamiento = 'GT-2026-DEMO';
    IF @IdEmpresa IS NULL
    BEGIN
        INSERT INTO Empresas_AppEX (NombreEmpresa, CodigoEnrolamiento)
        VALUES ('Empresa HVC Demo', 'GT-2026-DEMO');
        SET @IdEmpresa = SCOPE_IDENTITY();
    END
END

/* --- 2. Rol ---------------------------------------------------------------- */
DECLARE @IdRol INT = (SELECT TOP 1 IdRol FROM Roles_Permisos_AppEx WHERE NombreRol = 'Administrador');

IF @IdRol IS NULL
BEGIN
    INSERT INTO Roles_Permisos_AppEx (NombreRol, PermisosJSON, AccesoLectura, AccesoEscritura)
    VALUES ('Administrador', '{"modulos": ["encuestas", "reportes"]}', 1, 1);
    SET @IdRol = SCOPE_IDENTITY();
END

--- 3. Usuario -----------------------------------------------------------. 
IF NOT EXISTS (SELECT 1 FROM Usuarios_AppEx WHERE Username = @Username)
BEGIN
    INSERT INTO Usuarios_AppEx
        (Username, PasswordHash, NombreCompleto, IdEmpresa, IdRol, Estado, RequiereCambioPassword)
    VALUES
        (@Username, @PasswordHash, @NombreCompleto, @IdEmpresa, @IdRol, 1, 1);
    PRINT 'Usuarios_AppEx: usuario creado.';
END
ELSE
BEGIN
    UPDATE Usuarios_AppEx
    SET PasswordHash = @PasswordHash, Estado = 1, RequiereCambioPassword = 1,
        IdEmpresa = @IdEmpresa, IdRol = @IdRol
    WHERE Username = @Username;
    PRINT 'Usuarios_AppEx: usuario ya existia, se reactivo y se reseteo la clave.';
END

/* --- 4. Verificacion ------------------------------------------------------ */
SELECT u.IdUsuario, u.Username, u.Estado, u.RequiereCambioPassword,
       u.IdEmpresa, u.IdRol, e.NombreEmpresa
FROM Usuarios_AppEx u
LEFT JOIN Empresas_AppEX e ON e.IdEmpresa = u.IdEmpresa
WHERE u.Username = @Username;

SELECT IdDispositivo, HardwareID, Estado, IdEmpresa FROM Dispositivos_AppEx;
