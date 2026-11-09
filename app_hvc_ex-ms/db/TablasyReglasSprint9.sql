/* =============================================================================
   Sprint 9 — Corrección del control de versiones del menú y de los parámetros
   =============================================================================

   PROBLEMA 1 — Filas de control con el nombre mal escrito
   TablasyReglasSprint3.sql sembró Control_Versiones_AppEx con:
       'Cat_Menus_AppEx'        (sobra la "s")
       'Cat_Parametross_AppEx'  (doble "s")
   mientras sync.service.ts consulta 'Cat_Menu_AppEx' y 'Cat_Parametros_AppEx'.
   Como esas filas no existen, el SELECT devuelve vacío y el servicio reventaba con
   TypeError -> HTTP 500 en TODA sincronización incremental. El backend ya se blindó
   para no lanzar, pero sin las filas correctas se pierde la optimización: se
   consultarían los deltas en cada sincronización aunque no haya cambios.

   PROBLEMA 2 — El trigger de parámetros escribe en el nombre equivocado
   trg_UpdateParametros_Version_AppEx actualiza 'Cat_Parametross_AppEx', que nadie
   lee. Consecuencia: el gate de parámetros NUNCA se abre en incremental y los
   parámetros globales (SYNC_CATALOGOS_LIMIT, GPS_TIMEOUT_MS, VERSION_MINIMA_APP...)
   dejan de refrescarse en la app tras la primera carga.

   PROBLEMA 3 — Un DELETE físico de un menú es invisible para la app
   El trigger del menú es AFTER INSERT, UPDATE: no cubre DELETE. Y añadirlo al AFTER
   tampoco serviría, porque la fila ya no existe y el delta
   (SELECT ... WHERE FechaModificacion > @0) no puede reportarla; haría falta una
   tabla de lápidas. La solución que encaja con el diseño existente es convertir el
   borrado físico en lógico (Estado = 0), que la app ya sabe procesar como 'deleted'.

   Script IDEMPOTENTE: se puede ejecutar varias veces sin efectos adversos.
   ============================================================================= */

SET NOCOUNT ON;
GO

/* -----------------------------------------------------------------------------
   1. Filas de control con el nombre correcto
   -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM Control_Versiones_AppEx WHERE TablaNombre = 'Cat_Menu_AppEx')
BEGIN
    INSERT INTO Control_Versiones_AppEx (TablaNombre, UltimaModificacion)
    VALUES ('Cat_Menu_AppEx', GETDATE());
    PRINT 'Control_Versiones_AppEx: fila Cat_Menu_AppEx creada.';
END
ELSE
    PRINT 'Control_Versiones_AppEx: fila Cat_Menu_AppEx ya existia.';
GO

IF NOT EXISTS (SELECT 1 FROM Control_Versiones_AppEx WHERE TablaNombre = 'Cat_Parametros_AppEx')
BEGIN
    INSERT INTO Control_Versiones_AppEx (TablaNombre, UltimaModificacion)
    VALUES ('Cat_Parametros_AppEx', GETDATE());
    PRINT 'Control_Versiones_AppEx: fila Cat_Parametros_AppEx creada.';
END
ELSE
    PRINT 'Control_Versiones_AppEx: fila Cat_Parametros_AppEx ya existia.';
GO

/* Se eliminan las mal escritas SOLO después de haber garantizado las correctas. */
DELETE FROM Control_Versiones_AppEx
WHERE TablaNombre IN ('Cat_Menus_AppEx', 'Cat_Parametross_AppEx');
GO

/* -----------------------------------------------------------------------------
   2. Trigger de parámetros: apuntar al nombre que el servicio realmente lee
   -------------------------------------------------------------------------- */
IF OBJECT_ID('trg_UpdateParametros_Version_AppEx', 'TR') IS NOT NULL
    DROP TRIGGER trg_UpdateParametros_Version_AppEx;
GO

CREATE TRIGGER trg_UpdateParametros_Version_AppEx
ON Cat_Parametros_AppEx
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE Control_Versiones_AppEx
    SET UltimaModificacion = GETDATE()
    WHERE TablaNombre = 'Cat_Parametros_AppEx';   -- antes: 'Cat_Parametross_AppEx'
END;
GO

/* -----------------------------------------------------------------------------
   3. Borrado físico de menús -> borrado lógico
   INSTEAD OF DELETE sustituye la eliminación por Estado = 0. Al hacerlo con un
   UPDATE, se dispara el trigger AFTER UPDATE ya existente, que refresca
   Control_Versiones y desactiva en cascada los menús hijos (Regla 3.5).
   -------------------------------------------------------------------------- */
IF OBJECT_ID('trg_MenuBorradoLogico_AppEx', 'TR') IS NOT NULL
    DROP TRIGGER trg_MenuBorradoLogico_AppEx;
GO

CREATE TRIGGER trg_MenuBorradoLogico_AppEx
ON Cat_Menu_AppEx
INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE m
    SET m.Estado = 0,
        m.FechaModificacion = GETDATE()
    FROM Cat_Menu_AppEx m
    INNER JOIN deleted d ON m.IdMenu = d.IdMenu
    WHERE m.Estado = 1;   -- si ya estaba inactivo, no se toca la fecha
END;
GO

PRINT 'Sprint 9 aplicado.';
GO

/* -----------------------------------------------------------------------------
   VERIFICACIÓN (ejecutar manualmente tras el script)

   -- Deben aparecer exactamente Cat_Menu_AppEx y Cat_Parametros_AppEx,
   -- y NINGUNA con "Menus" o "Parametross":
   SELECT TablaNombre, UltimaModificacion FROM Control_Versiones_AppEx;

   -- El borrado debe dejar la fila inactiva, no eliminarla:
   --   DELETE FROM Cat_Menu_AppEx WHERE IdMenu = <id de prueba>;
   --   SELECT IdMenu, Titulo, Estado FROM Cat_Menu_AppEx WHERE IdMenu = <id>;
   -------------------------------------------------------------------------- */
