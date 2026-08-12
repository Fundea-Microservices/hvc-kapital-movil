/* =============================================================================
   Sprint 11 — Deuda tecnica: matrices y analitica
   =============================================================================

   Script IDEMPOTENTE. Verificarlo ejecutandolo DOS VECES seguidas.

   QUE HACE
   1. appEx_Respuestas.UUID_Instancia de UNIQUEIDENTIFIER a VARCHAR(80).
   2. trg_AplanarRespuestas ahora tambien llena IdUsuario y FechaFin.
   3. Backfill de stats_SGRAS_Plana (el historico NO se rellena solo).
   4. Verificaciones que leen el estado REAL.

   POR QUE EL PUNTO 1 ES URGENTE
   La aplicacion identifica las filas hijas de una matriz con '<uuid>_<uuid>'. Ese
   texto NO es un GUID valido, asi que SQL Server no puede convertirlo y CUALQUIER
   /submit con una matriz rellena falla por completo. El asesor ve "no se pudo
   sincronizar" y reintenta indefinidamente. Solo no ha destruido datos porque, al
   parecer, ninguna encuesta con matriz ha llegado a enviarse todavia.

   Se ensancha la columna en vez de partirla en dos (UUID_Instancia + UUID_Fila)
   porque la aplicacion no necesita ningun cambio y queda consistente con
   appEx_Multimedia.ClaveInstancia, que ya se creo como VARCHAR(80) por este motivo.
   Se pierde la validacion de formato que daba el tipo GUID: es el precio de aceptar
   la clave compuesta que el dispositivo ya construye.

   ATENCION: el ALTER del punto 1 REESCRIBE la tabla. Medir antes el volumen:
       SELECT COUNT(*) FROM appEx_Respuestas;
   Con muchas filas, hacerlo en ventana de mantenimiento y con respaldo previo.
   ============================================================================= */

SET NOCOUNT ON;
GO

/* -----------------------------------------------------------------------------
   0. DIAGNOSTICO PREVIO (solo lectura)
   --------------------------------------------------------------------------
   Un ALTER COLUMN falla si la columna participa en un indice o en una restriccion.
   Este bloque los LISTA para que se decida que hacer; no borra nada por su cuenta,
   porque soltar un indice ajeno sin avisar es peor que detenerse.
   -------------------------------------------------------------------------- */
SELECT
    'INDICE QUE BLOQUEA EL ALTER' AS Aviso,
    i.name  AS Indice,
    i.type_desc AS Tipo,
    i.is_unique AS EsUnico
FROM sys.index_columns ic
INNER JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE ic.object_id = OBJECT_ID('appEx_Respuestas')
  AND c.name = 'UUID_Instancia';

SELECT
    COUNT(*)                                           AS TotalRespuestas,
    SUM(CASE WHEN UUID_Instancia IS NOT NULL THEN 1 ELSE 0 END) AS ConUuidInstancia
FROM appEx_Respuestas;
GO


/* -----------------------------------------------------------------------------
   1. UUID_Instancia -> VARCHAR(80)
   -------------------------------------------------------------------------- */
/* La condicion comprueba la PROPIEDAD que importa -si caben 80 caracteres- y no un
   tipo concreto. La version anterior preguntaba por 'uniqueidentifier' porque asi lo
   declara TablasyReglasSprint5.sql, y en la base real la columna ya era
   NVARCHAR(100): el script no describia el esquema vigente.

   Ojo con max_length: en sys.columns esta en BYTES, y nvarchar usa dos por caracter.
   Un nvarchar(100) reporta 200. Comparar 200 contra 80 sin dividir daria por buena
   una columna que no cabe, y al reves. -1 significa MAX. */
DECLARE @CaracteresActuales INT = (
    SELECT CASE
             WHEN c.max_length = -1 THEN 2147483647
             WHEN t.name IN ('nvarchar', 'nchar') THEN c.max_length / 2
             ELSE c.max_length
           END
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('appEx_Respuestas') AND c.name = 'UUID_Instancia'
);

DECLARE @EsTexto BIT = (
    SELECT CASE WHEN t.name IN ('varchar', 'nvarchar', 'char', 'nchar') THEN 1 ELSE 0 END
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('appEx_Respuestas') AND c.name = 'UUID_Instancia'
);

/* La clave compuesta de una fila de matriz es '<uuid>_<uuid>' = 73 caracteres. */
IF @EsTexto = 0 OR @CaracteresActuales < 80
BEGIN
    /* La conversion desde uniqueidentifier conserva los GUID existentes en su
       representacion textual con guiones, que es exactamente lo que la aplicacion
       envia para las preguntas fuera de matriz. No hay perdida de datos. */
    ALTER TABLE appEx_Respuestas ALTER COLUMN UUID_Instancia VARCHAR(80) NULL;
    PRINT 'appEx_Respuestas.UUID_Instancia: migrado a VARCHAR(80).';
END
ELSE
    PRINT 'appEx_Respuestas.UUID_Instancia: ya admite 80+ caracteres, no se migra.';
GO

/* La vista de multimedia referencia esa columna y guarda metadatos del tipo
   ANTERIOR. Sin refrescarla devuelve el tipo viejo y puede truncar en silencio. */
IF OBJECT_ID('vw_appEx_RespuestasMultimedia', 'V') IS NOT NULL
BEGIN
    EXEC sp_refreshview 'vw_appEx_RespuestasMultimedia';
    PRINT 'vw_appEx_RespuestasMultimedia: metadatos refrescados.';
END
GO

/* Verificacion REAL. Un PRINT no prueba nada: tras un error de nivel 16 el lote
   continua y el mensaje de exito se imprime igual (leccion del Sprint 10). */
IF EXISTS (
    SELECT 1 FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('appEx_Respuestas')
      AND c.name = 'UUID_Instancia'
      AND t.name IN ('varchar', 'nvarchar', 'char', 'nchar')
      AND (c.max_length = -1
           OR (CASE WHEN t.name IN ('nvarchar', 'nchar') THEN c.max_length / 2 ELSE c.max_length END) >= 80)
)
    PRINT 'VERIFICADO: UUID_Instancia admite la clave compuesta. Las matrices pueden sincronizar.';
ELSE
    PRINT '*** FALLO: UUID_Instancia no admite 80 caracteres. Revisar los indices del bloque 0. ***';
GO


/* -----------------------------------------------------------------------------
   2. trg_AplanarRespuestas: llenar tambien IdUsuario y FechaFin
   --------------------------------------------------------------------------
   stats_SGRAS_Plana declara esas dos columnas desde el Sprint 6, pero el trigger
   NUNCA las lleno: solo insertaba IdCaptura e IdEncuesta. Aunque hubiera compilado
   (no lo hizo, por el TEXT), la analitica habria salido sin usuario ni fecha, que
   son justo las dos dimensiones por las que se reportaria.

   Se conserva TRY_CAST del Sprint 10: devuelve NULL en vez de lanzar, y como el
   trigger corre DENTRO de la transaccion del /submit, un CAST que falla se lleva
   por delante la encuesta completa del asesor.
   -------------------------------------------------------------------------- */
IF OBJECT_ID('trg_AplanarRespuestas', 'TR') IS NOT NULL
BEGIN
    EXEC('
    ALTER TRIGGER trg_AplanarRespuestas
    ON appEx_Respuestas
    AFTER INSERT
    AS
    BEGIN
        SET NOCOUNT ON;

        INSERT INTO stats_SGRAS_Plana (IdCaptura, IdEncuesta, IdUsuario, FechaFin)
        SELECT DISTINCT i.IdCaptura, i.IdEncuesta, e.IdUsuario, e.FechaFin
        FROM inserted i
        LEFT JOIN appEx_Encabezado_Captura e ON e.IdCaptura = i.IdCaptura
        WHERE i.IdCaptura IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM stats_SGRAS_Plana p WHERE p.IdCaptura = i.IdCaptura);

        UPDATE p
        SET
            p.Nombre_Completo = CASE WHEN q.Etiqueta LIKE ''Nombre Completo%'' THEN i.Valor ELSE p.Nombre_Completo END,
            p.Correo_Electronico = CASE WHEN q.Etiqueta LIKE ''Correo Electr%'' THEN i.Valor ELSE p.Correo_Electronico END,
            p.Sueldo_Base = CASE WHEN q.Etiqueta LIKE ''Sueldo Base%'' THEN TRY_CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Sueldo_Base END,
            p.Gastos_Fijos = CASE WHEN q.Etiqueta LIKE ''Gastos Fijos%'' THEN TRY_CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Gastos_Fijos END,
            p.Saldo_Neto = CASE WHEN q.Etiqueta LIKE ''Saldo Neto%'' THEN TRY_CAST(i.Valor AS DECIMAL(18,2)) ELSE p.Saldo_Neto END
        FROM stats_SGRAS_Plana p
        INNER JOIN inserted i ON p.IdCaptura = i.IdCaptura
        INNER JOIN appEx_Pregunta q ON i.IdPregunta = q.IdPregunta;
    END;
    ');
    PRINT 'trg_AplanarRespuestas: actualizado (TRY_CAST + IdUsuario + FechaFin).';
END
ELSE
    PRINT '*** trg_AplanarRespuestas NO EXISTE. Ejecutar antes TablasyReglasSprint6.sql. ***';
GO

IF OBJECT_ID('trg_AplanarRespuestas', 'TR') IS NOT NULL
BEGIN
    IF OBJECT_DEFINITION(OBJECT_ID('trg_AplanarRespuestas')) LIKE '%TRY_CAST%'
       AND OBJECT_DEFINITION(OBJECT_ID('trg_AplanarRespuestas')) LIKE '%IdUsuario%'
        PRINT 'VERIFICADO: el trigger contiene TRY_CAST y llena IdUsuario.';
    ELSE
        PRINT '*** FALLO: el trigger no quedo actualizado. Revisar los errores de arriba. ***';
END
GO


/* -----------------------------------------------------------------------------
   3. BACKFILL de stats_SGRAS_Plana
   --------------------------------------------------------------------------
   El trigger solo actua sobre capturas NUEVAS. Como nunca llego a compilar desde
   el Sprint 6, todo el historico esta fuera de la tabla y arreglarlo no lo trae
   de vuelta: hay que reconstruirlo.

   Se hace con un PIVOTE agrupado por IdCaptura y no fila a fila como el trigger.
   El trigger procesa el lote 'inserted' de un INSERT concreto; aqui hay que
   consolidar TODAS las respuestas de cada captura de una sola pasada, o cada
   UPDATE pisaria al anterior con NULL.

   Idempotente: el INSERT filtra por NOT EXISTS y el UPDATE recalcula desde cero.
   -------------------------------------------------------------------------- */
INSERT INTO stats_SGRAS_Plana (IdCaptura, IdEncuesta, IdUsuario, FechaFin)
SELECT DISTINCT
    r.IdCaptura,
    r.IdEncuesta,
    e.IdUsuario,
    e.FechaFin
FROM appEx_Respuestas r
LEFT JOIN appEx_Encabezado_Captura e ON e.IdCaptura = r.IdCaptura
WHERE r.IdCaptura IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stats_SGRAS_Plana p WHERE p.IdCaptura = r.IdCaptura);

PRINT 'Backfill: filas base insertadas -> ' + CAST(@@ROWCOUNT AS VARCHAR(20));
GO

;WITH Pivote AS (
    SELECT
        r.IdCaptura,
        MAX(CASE WHEN q.Etiqueta LIKE 'Nombre Completo%' THEN r.Valor END) AS Nombre_Completo,
        MAX(CASE WHEN q.Etiqueta LIKE 'Correo Electr%'   THEN r.Valor END) AS Correo_Electronico,
        /* TRY_CAST y no CAST: un "no aplica" tecleado en una pregunta etiquetada
           como numerica devolveria NULL en vez de abortar el backfill entero. */
        MAX(CASE WHEN q.Etiqueta LIKE 'Sueldo Base%'  THEN TRY_CAST(r.Valor AS DECIMAL(18,2)) END) AS Sueldo_Base,
        MAX(CASE WHEN q.Etiqueta LIKE 'Gastos Fijos%' THEN TRY_CAST(r.Valor AS DECIMAL(18,2)) END) AS Gastos_Fijos,
        MAX(CASE WHEN q.Etiqueta LIKE 'Saldo Neto%'   THEN TRY_CAST(r.Valor AS DECIMAL(18,2)) END) AS Saldo_Neto
    FROM appEx_Respuestas r
    INNER JOIN appEx_Pregunta q ON q.IdPregunta = r.IdPregunta
    WHERE r.IdCaptura IS NOT NULL
    GROUP BY r.IdCaptura
)
UPDATE p
SET p.Nombre_Completo     = COALESCE(v.Nombre_Completo,     p.Nombre_Completo),
    p.Correo_Electronico  = COALESCE(v.Correo_Electronico,  p.Correo_Electronico),
    p.Sueldo_Base         = COALESCE(v.Sueldo_Base,         p.Sueldo_Base),
    p.Gastos_Fijos        = COALESCE(v.Gastos_Fijos,        p.Gastos_Fijos),
    p.Saldo_Neto          = COALESCE(v.Saldo_Neto,          p.Saldo_Neto)
FROM stats_SGRAS_Plana p
INNER JOIN Pivote v ON v.IdCaptura = p.IdCaptura;

PRINT 'Backfill: filas actualizadas -> ' + CAST(@@ROWCOUNT AS VARCHAR(20));
GO

/* Completar usuario y fecha en las filas que ya existian sin ellos. */
UPDATE p
SET p.IdUsuario = COALESCE(p.IdUsuario, e.IdUsuario),
    p.FechaFin  = COALESCE(p.FechaFin,  e.FechaFin)
FROM stats_SGRAS_Plana p
INNER JOIN appEx_Encabezado_Captura e ON e.IdCaptura = p.IdCaptura
WHERE p.IdUsuario IS NULL OR p.FechaFin IS NULL;
GO


/* -----------------------------------------------------------------------------
   4. VERIFICACION DEL BACKFILL
   --------------------------------------------------------------------------
   'SinNingunDatoMapeado' es el numero que hay que MIRAR, no ignorar: son capturas
   cuyas preguntas no coinciden con NINGUNA de las cinco etiquetas que el trigger
   busca ('Sueldo Base%', 'Nombre Completo%'...). No es un fallo del script: es la
   senal de que el BackOffice nombra las preguntas de otra forma y esta analitica
   esta mirando etiquetas que ya no existen.
   -------------------------------------------------------------------------- */
SELECT
    (SELECT COUNT(DISTINCT IdCaptura) FROM appEx_Respuestas WHERE IdCaptura IS NOT NULL) AS CapturasConRespuestas,
    (SELECT COUNT(*) FROM stats_SGRAS_Plana)                                             AS FilasEnTablaPlana,
    (SELECT COUNT(*) FROM stats_SGRAS_Plana
      WHERE Nombre_Completo IS NULL AND Correo_Electronico IS NULL
        AND Sueldo_Base IS NULL AND Gastos_Fijos IS NULL AND Saldo_Neto IS NULL)         AS SinNingunDatoMapeado,
    (SELECT COUNT(*) FROM stats_SGRAS_Plana WHERE IdUsuario IS NULL)                     AS SinUsuario;
GO

/* Etiquetas reales que existen hoy, para contrastarlas con las que busca el
   trigger. Si ninguna empieza por 'Sueldo Base', 'Nombre Completo', etc., esta
   tabla no sirve tal como esta y conviene decidir si se reescribe o se elimina.

   El CAST a VARCHAR es obligatorio: appEx_Pregunta.Etiqueta es TEXT/NTEXT, tipo que
   NO se puede usar en GROUP BY ni ORDER BY (Msg 306). Es el mismo tipo obsoleto que
   ya obligo a migrar appEx_Respuestas.Valor; aqui solo se convierte para consultar,
   pero la etiqueta en si sigue siendo TEXT en la tabla real. */
SELECT TOP 40 CAST(q.Etiqueta AS VARCHAR(255)) AS Etiqueta, COUNT(*) AS Veces
FROM appEx_Respuestas r
INNER JOIN appEx_Pregunta q ON q.IdPregunta = r.IdPregunta
GROUP BY CAST(q.Etiqueta AS VARCHAR(255))
ORDER BY COUNT(*) DESC;
GO

/* -----------------------------------------------------------------------------
   5. BITACORA DE ERRORES DE LA APLICACION
   --------------------------------------------------------------------------
   Hoy, cuando la aplicacion falla en campo -sin senal, a horas de la agencia- no
   queda ningun rastro: el asesor reporta "no funciona" dias despues y no hay forma
   de saber que ocurrio. La aplicacion guarda el error en una tabla local y lo envia
   en la siguiente sincronizacion; aqui es donde aterriza.

   Se decidio esta via en lugar de Sentry: sin dependencias nativas (no obliga a
   recompilar la app), funciona offline -que es el escenario real, no la excepcion-
   y los datos no salen de la infraestructura de FUNDEA.

   NO CONTIENE DATOS DEL ENCUESTADO. El saneado ocurre en el dispositivo antes de
   persistir (domain/diagnostico/bitacora.ts): se redactan credenciales y solo se
   admiten valores escalares en el contexto.
   -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'appEx_BitacoraErrores')
BEGIN
    CREATE TABLE appEx_BitacoraErrores (
        IdBitacora    BIGINT IDENTITY(1,1) NOT NULL,
        Nivel         VARCHAR(10)   NOT NULL,   -- ERROR | WARN
        Origen        VARCHAR(100)  NOT NULL,   -- syncManager.FASE1, multimedia.subida...
        Mensaje       VARCHAR(400)  NOT NULL,
        Detalle       VARCHAR(2500) NULL,       -- pila de llamadas, ya recortada
        ContextoJson  VARCHAR(1000) NULL,       -- solo escalares
        VersionApp    VARCHAR(20)   NOT NULL,
        Plataforma    VARCHAR(20)   NULL,
        IdUsuario     INT           NULL,
        DispositivoID VARCHAR(100)  NULL,
        /* Cuando OCURRIO en el dispositivo, no cuando llego. Pueden pasar dias
           entre ambas: es justo el escenario que motiva esta tabla. */
        FechaError    DATETIME      NOT NULL,
        FechaRecepcion DATETIME     NOT NULL CONSTRAINT DF_Bitacora_FechaRecepcion DEFAULT (GETDATE()),

        CONSTRAINT PK_appEx_BitacoraErrores PRIMARY KEY CLUSTERED (IdBitacora)
    );
    PRINT 'appEx_BitacoraErrores: tabla creada.';
END
ELSE
    PRINT 'appEx_BitacoraErrores: la tabla ya existia.';
GO

/* Indice de consulta: soporte pregunta "que fallo en este equipo esta semana" y
   "que errores trae la version que acabamos de publicar". */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Bitacora_Dispositivo_Fecha')
BEGIN
    CREATE INDEX IX_Bitacora_Dispositivo_Fecha
        ON appEx_BitacoraErrores (DispositivoID, FechaError DESC)
        INCLUDE (Nivel, Origen, VersionApp);
    PRINT 'appEx_BitacoraErrores: indice de consulta creado.';
END
GO

/* Parametro que la app lee por sync: cuantas entradas sube por ciclo. */
MERGE Cat_Parametros_AppEx AS destino
USING (VALUES ('BITACORA_MAX_POR_SYNC', '50')) AS origen (Clave, Valor)
ON destino.Clave = origen.Clave
WHEN NOT MATCHED BY TARGET THEN INSERT (Clave, Valor) VALUES (origen.Clave, origen.Valor);
GO

/* -----------------------------------------------------------------------------
   6. CONSULTAS DE APOYO PARA SOPORTE
   --------------------------------------------------------------------------
   Son el motivo por el que existe todo lo anterior. Guardarlas aqui evita que cada
   consulta se reinvente sobre la marcha durante una incidencia.
   -------------------------------------------------------------------------- */

-- Errores mas frecuentes de los ultimos 7 dias, agrupados por origen y version.
-- SELECT Origen, VersionApp, Nivel, COUNT(*) AS Veces, MAX(FechaError) AS Ultimo
-- FROM appEx_BitacoraErrores
-- WHERE FechaError >= DATEADD(DAY, -7, GETDATE())
-- GROUP BY Origen, VersionApp, Nivel
-- ORDER BY COUNT(*) DESC;

-- Todo lo que reporto un equipo concreto.
-- SELECT TOP 100 FechaError, Nivel, Origen, Mensaje, VersionApp
-- FROM appEx_BitacoraErrores
-- WHERE DispositivoID = 'PEGUE_AQUI_EL_TOKEN'
-- ORDER BY FechaError DESC;

-- Retencion: borrar lo anterior a 90 dias. Ejecutar como tarea programada.
-- DELETE FROM appEx_BitacoraErrores WHERE FechaRecepcion < DATEADD(DAY, -90, GETDATE());
GO

PRINT '=== Sprint 11 aplicado. Probar ahora una encuesta CON MATRIZ desde el dispositivo. ===';
GO
