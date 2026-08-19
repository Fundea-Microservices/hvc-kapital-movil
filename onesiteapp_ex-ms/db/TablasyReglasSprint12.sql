/* =============================================================================
   Sprint 12 — Cambio obligatorio de contrasena al primer ingreso
   =============================================================================

   Script IDEMPOTENTE. Verificarlo ejecutandolo DOS VECES seguidas.

   QUE HACE
   1. Usuarios_AppEx.RequiereCambioPassword  BIT NOT NULL DEFAULT 1, y EXONERA a los
      usuarios que ya existian (los deja en 0: no se les fuerza el cambio).
   2. Usuarios_AppEx.FechaUltimoCambioPassword DATETIME NULL.
   3. Verificaciones que leen el estado REAL.

   POR QUE
   El login devuelve ahora la bandera `requiereCambioPassword`. La app la usa para
   forzar la pantalla de cambio de contrasena antes de dejar entrar al Dashboard.
   El DEFAULT 1 hace que TODO usuario NUEVO (creado con credencial temporal) entre
   obligado a cambiarla; el backend la pone en 0 tras un cambio exitoso.

   DECISION SOBRE LOS USUARIOS EXISTENTES (17 al momento de escribir esto)
   Anadir la columna con DEFAULT 1 rellenaria con 1 tambien a los usuarios que YA
   existen, forzandolos a todos. NO es lo que se quiere: esas cuentas ya usan su
   contrasena. Por eso, JUSTO despues de crear la columna, se hace un UPDATE que
   pone en 0 a todas las filas existentes en ese instante. A partir de ahi:
     - Los usuarios que ya estaban  -> RequiereCambioPassword = 0 (no se les molesta).
     - Los usuarios NUEVOS          -> nacen con el DEFAULT 1 y SI seran forzados.

   POR QUE ES IDEMPOTENTE Y SEGURO
   La exoneracion vive DENTRO del bloque `IF columna NO EXISTE`, asi que ocurre una
   sola vez en la vida del esquema: al crear la columna. En una segunda ejecucion el
   ALTER se salta y el UPDATE tambien, de modo que NO revierte a 0 a los usuarios
   nuevos que legitimamente deban cambiar la contrasena.

   El UPDATE va por EXEC (SQL dinamico) a proposito: en un mismo lote, referenciar por
   nombre una columna recien creada da error de parseo 207 ("Invalid column name").
   EXEC difiere la resolucion del nombre a tiempo de ejecucion y evita ese error.
   ============================================================================= */

SET NOCOUNT ON;
GO

/* -----------------------------------------------------------------------------
   0. DIAGNOSTICO PREVIO (solo lectura)
   -------------------------------------------------------------------------- */
IF OBJECT_ID('Usuarios_AppEx', 'U') IS NULL
    PRINT '*** Usuarios_AppEx NO EXISTE. Ejecutar antes TablasyReglasSprint2.sql. ***';
ELSE
    SELECT
        COUNT(*) AS TotalUsuarios,
        SUM(CASE WHEN COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NOT NULL
                 THEN 1 ELSE 0 END) AS YaTieneColumna
    FROM Usuarios_AppEx;
GO

/* -----------------------------------------------------------------------------
   1. RequiereCambioPassword
   --------------------------------------------------------------------------
   Se comprueba con COL_LENGTH -que devuelve NULL si la columna no existe- en vez
   de un try/catch: es la forma barata y legible de hacer el ALTER idempotente.
   NOT NULL + DEFAULT 1 en una tabla con filas obliga a SQL Server a materializar
   el valor; es intencional (ver cabecera).
   -------------------------------------------------------------------------- */
IF COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NULL
BEGIN
    ALTER TABLE Usuarios_AppEx
        ADD RequiereCambioPassword BIT NOT NULL
        CONSTRAINT DF_Usuarios_RequiereCambioPassword DEFAULT (1);
    PRINT 'Usuarios_AppEx.RequiereCambioPassword: columna creada (DEFAULT 1).';

    /* EXONERAR a los usuarios que ya existian: el DEFAULT los dejo en 1, se los pasa
       a 0 para no forzarlos. Solo corre aqui, al crear la columna (idempotente).
       EXEC evita el error de parseo 207 por referenciar la columna recien creada en
       el mismo lote. @@ROWCOUNT tras el EXEC no es fiable, se cuenta dentro. */
    EXEC('
        UPDATE Usuarios_AppEx SET RequiereCambioPassword = 0;
        PRINT ''Usuarios_AppEx: exonerados '' + CAST(@@ROWCOUNT AS VARCHAR(20)) + '' usuario(s) existente(s) (RequiereCambioPassword = 0).'';
    ');
END
ELSE
    PRINT 'Usuarios_AppEx.RequiereCambioPassword: ya existia, no se toca (exoneracion ya aplicada en su momento).';
GO

/* -----------------------------------------------------------------------------
   2. FechaUltimoCambioPassword
   --------------------------------------------------------------------------
   NULL a proposito: una fila sin fecha significa "nunca cambio la temporal". El
   backend la sella con GETDATE() en el UPDATE del cambio exitoso.
   -------------------------------------------------------------------------- */
IF COL_LENGTH('Usuarios_AppEx', 'FechaUltimoCambioPassword') IS NULL
BEGIN
    ALTER TABLE Usuarios_AppEx ADD FechaUltimoCambioPassword DATETIME NULL;
    PRINT 'Usuarios_AppEx.FechaUltimoCambioPassword: columna creada.';
END
ELSE
    PRINT 'Usuarios_AppEx.FechaUltimoCambioPassword: ya existia, no se toca.';
GO

/* -----------------------------------------------------------------------------
   3. VERIFICACION REAL
   --------------------------------------------------------------------------
   Un PRINT no prueba nada: tras un error de nivel 16 el lote continua y el mensaje
   de exito se imprime igual. Se comprueba que AMBAS columnas existan de verdad.
   -------------------------------------------------------------------------- */
IF COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NOT NULL
   AND COL_LENGTH('Usuarios_AppEx', 'FechaUltimoCambioPassword') IS NOT NULL
    PRINT 'VERIFICADO: las columnas existen. El login ya puede devolver requiereCambioPassword.';
ELSE
    PRINT '*** FALLO: alguna columna no se creo. Revisar los errores de arriba. ***';
GO

/* Reparto real tras aplicar: se ESPERA que los 17 existentes queden en Exonerados y
   que Forzados sea 0 (aun no hay usuarios nuevos). Se usa EXEC porque la columna
   podria no existir al PARSEAR si el bloque 1 fallo, y no queremos tumbar el lote. */
IF COL_LENGTH('Usuarios_AppEx', 'RequiereCambioPassword') IS NOT NULL
    EXEC('
        SELECT
            COUNT(*)                                                        AS TotalUsuarios,
            SUM(CASE WHEN RequiereCambioPassword = 0 THEN 1 ELSE 0 END)     AS Exonerados,
            SUM(CASE WHEN RequiereCambioPassword = 1 THEN 1 ELSE 0 END)     AS Forzados
        FROM Usuarios_AppEx;
    ');
GO

/* -----------------------------------------------------------------------------
   2-BIS. (OPCIONAL, INVERSO) Forzar el cambio a usuarios concretos
   --------------------------------------------------------------------------
   La exoneracion de los existentes ya se hizo automaticamente en el bloque 1. Este
   bloque es para lo CONTRARIO: si en algun momento se quiere OBLIGAR a un usuario ya
   existente a cambiar la contrasena (p.ej. sospecha de credencial filtrada), poner
   su bandera en 1. Descomentar y listar los IdUsuario.
   -------------------------------------------------------------------------- */
-- UPDATE Usuarios_AppEx
-- SET RequiereCambioPassword = 1
-- WHERE IdUsuario IN (/* pegar aqui los IdUsuario a forzar */);
-- GO

PRINT '=== Sprint 12 aplicado. Probar login: la respuesta debe traer requiereCambioPassword. ===';
GO
