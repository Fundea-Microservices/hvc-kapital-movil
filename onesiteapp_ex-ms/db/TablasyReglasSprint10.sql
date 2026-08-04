/* =============================================================================
   Sprint 10 — Captura de archivos multimedia
   =============================================================================

   Script IDEMPOTENTE: se puede ejecutar varias veces sin efectos adversos.
   Verificar precisamente eso ejecutándolo DOS VECES seguidas.

   QUE HACE
   1. Tabla appEx_Multimedia + su índice único de idempotencia.
   2. CAST -> TRY_CAST en trg_AplanarRespuestas (corrige un fallo preexistente).
   3. Vista de apoyo para el BackOffice.
   4. Parámetros nuevos en Cat_Parametros_AppEx.
   5. Diagnóstico (solo lectura) de la deuda de UUID_Instancia.

   POR QUE EL ARCHIVO NO SE GUARDA EN LA BASE DE DATOS
   El binario vive en el disco del servidor, bajo la raíz que declara la variable
   MULTIMEDIA_RUTA_RAIZ del .env; aquí solo se guarda la RUTA RELATIVA. Así el
   respaldo de la base no crece con fotos de varios MB, y mover el almacenamiento a
   otro disco es cambiar una variable de entorno en vez de migrar datos.

   POR QUE EL NOMBRE DEL ARCHIVO LO DECIDE EL SERVIDOR
   El nombre pedido es IdEncuesta-IdCaptura-IdPregunta.ext (por ejemplo 1-1-20.jpg),
   pero IdCaptura es un BIGINT IDENTITY que este motor genera durante el /submit — y
   la foto se toma en campo, sin señal, potencialmente días antes de sincronizar. El
   dispositivo no puede conocerlo. Por eso sube el binario DESPUES del /submit y el
   backend construye el nombre con enteros que él mismo controla. Efecto colateral
   deseable: como el nombre no contiene nada que venga del cliente, el path traversal
   es imposible por construcción, no algo que haya que filtrar.
   ============================================================================= */

SET NOCOUNT ON;
GO

/* -----------------------------------------------------------------------------
   1. Tabla appEx_Multimedia
   -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'appEx_Multimedia')
BEGIN
    CREATE TABLE appEx_Multimedia (
        IdMultimedia    BIGINT IDENTITY(1,1) NOT NULL,
        IdCaptura       BIGINT       NOT NULL,
        IdEncuesta      INT          NOT NULL,
        IdPregunta      INT          NOT NULL,

        /* VARCHAR(80) y NO UNIQUEIDENTIFIER, deliberadamente. La app identifica las
           filas hijas de una matriz con '<uuid>_<uuid>', que NO es un GUID válido.
           appEx_Respuestas sí declaró esa columna como UNIQUEIDENTIFIER y por eso
           hoy falla al recibir matrices (ver el bloque 5 de diagnóstico). Esta tabla
           no hereda el problema. Cadena vacía = pregunta fuera de matriz; se usa ''
           en vez de NULL para que el índice único de abajo funcione, porque en SQL
           Server dos NULL no se consideran duplicados. */
        ClaveInstancia  VARCHAR(80)  NOT NULL CONSTRAINT DF_Multimedia_ClaveInstancia DEFAULT (''),

        /* Permite varios archivos en una misma pregunta. 1 es el primero. */
        Secuencia       INT          NOT NULL CONSTRAINT DF_Multimedia_Secuencia DEFAULT (1),

        TipoMedio       VARCHAR(20)  NOT NULL,   -- FOTO | MULTIMEDIA | DOCUMENTO | FIRMA
        RutaRelativa    VARCHAR(400) NOT NULL,   -- relativa a MULTIMEDIA_RUTA_RAIZ
        NombreArchivo   VARCHAR(200) NOT NULL,   -- lo genera el servidor

        /* El nombre que traía el archivo en el dispositivo se conserva como DATO,
           para que soporte pueda reconocerlo. Nunca se usa como parte de una ruta. */
        NombreOriginal  NVARCHAR(260) NULL,

        Extension       VARCHAR(10)  NOT NULL,
        MimeType        VARCHAR(120) NULL,
        TamanioBytes    BIGINT       NOT NULL,

        /* Huella del contenido. Permite responder "este archivo ya llegó" ante un
           reintento, y detectar corrupción en tránsito. */
        HashSha256      VARCHAR(64)  NULL,

        IdUsuario       INT          NULL,
        DispositivoID   VARCHAR(100) NULL,
        FechaCaptura    DATETIME     NULL,       -- cuándo se tomó en el dispositivo
        FechaSubida     DATETIME     NOT NULL CONSTRAINT DF_Multimedia_FechaSubida DEFAULT (GETDATE()),
        Estado          BIT          NOT NULL CONSTRAINT DF_Multimedia_Estado DEFAULT (1),

        CONSTRAINT PK_appEx_Multimedia PRIMARY KEY CLUSTERED (IdMultimedia),
        CONSTRAINT FK_Multimedia_Encabezado FOREIGN KEY (IdCaptura)
            REFERENCES appEx_Encabezado_Captura (IdCaptura)
    );
    PRINT 'appEx_Multimedia: tabla creada.';
END
ELSE
    PRINT 'appEx_Multimedia: la tabla ya existia.';
GO

/* -----------------------------------------------------------------------------
   1.b Índice único: la garantía DURA contra duplicados
   --------------------------------------------------------------------------
   La app lleva su propio estado de subida y el endpoint responde de forma
   idempotente, pero ninguna de las dos cosas sobrevive a un dispositivo que se
   reinstala o a dos sincronizaciones solapadas. Esta restricción sí. Sin ella, un
   asesor con mala señal acumula copias del mismo archivo en disco, cada una con su
   fila, y el BackOffice muestra la evidencia repetida.
   -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Multimedia_Captura_Pregunta')
BEGIN
    CREATE UNIQUE INDEX UX_Multimedia_Captura_Pregunta
        ON appEx_Multimedia (IdCaptura, IdPregunta, ClaveInstancia, Secuencia);
    PRINT 'appEx_Multimedia: indice unico creado.';
END
ELSE
    PRINT 'appEx_Multimedia: el indice unico ya existia.';
GO

/* Índice de consulta: el BackOffice lista los adjuntos de una captura. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Multimedia_Captura')
BEGIN
    CREATE INDEX IX_Multimedia_Captura ON appEx_Multimedia (IdCaptura) INCLUDE (TipoMedio, RutaRelativa);
    PRINT 'appEx_Multimedia: indice de consulta creado.';
END
GO

/* -----------------------------------------------------------------------------
   2. CAST -> TRY_CAST en trg_AplanarRespuestas
   --------------------------------------------------------------------------
   FALLO PREEXISTENTE, no introducido por multimedia.

   El trigger decide qué columna de la tabla plana llenar comparando la ETIQUETA de
   la pregunta ('Sueldo Base%'...), y castea el valor a DECIMAL. Si una pregunta se
   llama "Sueldo Base" pero el asesor escribió "no aplica", o el número llegó como
   "1,234.50", el CAST lanza — y como el trigger corre dentro de la transacción del
   /submit, se pierde la ENCUESTA COMPLETA, no solo esa respuesta. El asesor ve
   "no se pudo sincronizar" y vuelve a intentarlo indefinidamente.

   TRY_CAST devuelve NULL en lugar de lanzar: la columna analítica queda vacía y la
   captura se guarda. Un dato de reportería incompleto es infinitamente preferible a
   perder el trabajo de campo. Con multimedia esto es además obligatorio: el token
   MEDIA::... es texto y podría caer en una pregunta con etiqueta numérica.
   -------------------------------------------------------------------------- */
/* 2.a PRIMERO: Valor TEXT -> VARCHAR(MAX)
   --------------------------------------------------------------------------
   HALLAZGO AL EJECUTAR ESTE SCRIPT: appEx_Respuestas.Valor se declaro como TEXT
   en el Sprint 5. TEXT es un tipo OBSOLETO desde SQL Server 2005 y, sobre todo,
   NO PUEDE LEERSE desde las tablas 'inserted'/'deleted' de un trigger:

       Msg 311: Cannot use text, ntext, or image columns in the 'inserted' and
                'deleted' tables.

   Es decir, trg_AplanarRespuestas NUNCA ha podido compilarse desde que se
   escribio en el Sprint 6: la tabla analitica stats_SGRAS_Plana lleva vacia
   desde entonces. No es una regresion de este sprint; el script solo lo saco a
   la luz al intentar recompilar el trigger.

   VARCHAR(MAX) admite el mismo tamano, conserva los datos existentes y si es
   legible desde 'inserted'.

   ATENCION ANTES DE EJECUTAR EN PRODUCCION: este ALTER reescribe la tabla. Si
   appEx_Respuestas ya tiene muchas filas, conviene una ventana de mantenimiento
   y un respaldo previo. Consultar el volumen con:
       SELECT COUNT(*) FROM appEx_Respuestas;
   -------------------------------------------------------------------------- */
IF EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID('appEx_Respuestas')
      AND c.name = 'Valor'
      AND t.name IN ('text', 'ntext')
)
BEGIN
    ALTER TABLE appEx_Respuestas ALTER COLUMN Valor VARCHAR(MAX) NULL;
    PRINT 'appEx_Respuestas.Valor: migrado de TEXT a VARCHAR(MAX).';
END
ELSE
    PRINT 'appEx_Respuestas.Valor: ya no es TEXT, no se migra.';
GO

IF OBJECT_ID('trg_AplanarRespuestas', 'TR') IS NOT NULL
BEGIN
    EXEC('
    ALTER TRIGGER trg_AplanarRespuestas
    ON appEx_Respuestas
    AFTER INSERT
    AS
    BEGIN
        SET NOCOUNT ON;

        INSERT INTO stats_SGRAS_Plana (IdCaptura, IdEncuesta)
        SELECT DISTINCT i.IdCaptura, i.IdEncuesta
        FROM inserted i
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
    PRINT 'trg_AplanarRespuestas: actualizado a TRY_CAST.';
END
ELSE
    PRINT 'trg_AplanarRespuestas: NO EXISTE. Ejecutar antes TablasyReglasSprint6.sql.';
GO

/* Verificacion REAL de que el trigger quedo con TRY_CAST.
   El PRINT de arriba NO es prueba de nada: si el EXEC() falla, el lote continua y
   el PRINT se ejecuta igual. Esta consulta lee la definicion efectiva del objeto,
   que es la unica fuente de verdad. */
IF OBJECT_ID('trg_AplanarRespuestas', 'TR') IS NOT NULL
BEGIN
    IF OBJECT_DEFINITION(OBJECT_ID('trg_AplanarRespuestas')) LIKE '%TRY_CAST%'
        PRINT 'VERIFICADO: trg_AplanarRespuestas contiene TRY_CAST.';
    ELSE
        PRINT '*** FALLO: trg_AplanarRespuestas SIGUE CON CAST. Revisar los errores de arriba. ***';
END
GO

/* -----------------------------------------------------------------------------
   3. Vista de apoyo para el BackOffice
   --------------------------------------------------------------------------
   LEFT JOIN a propósito: lo valioso no es ver los archivos que llegaron, sino los
   que FALTAN. Una respuesta cuyo Valor empieza por 'MEDIA::' declara que hay un
   adjunto; si IdMultimedia sale NULL, el binario no ha subido todavía.
   -------------------------------------------------------------------------- */
IF OBJECT_ID('vw_appEx_RespuestasMultimedia', 'V') IS NOT NULL
    DROP VIEW vw_appEx_RespuestasMultimedia;
GO
CREATE VIEW vw_appEx_RespuestasMultimedia
AS
SELECT
    r.IdCaptura,
    r.IdEncuesta,
    r.IdPregunta,
    r.UUID_Instancia,
    r.Valor                AS TokenRespuesta,
    m.IdMultimedia,
    m.TipoMedio,
    m.NombreArchivo,
    m.NombreOriginal,
    m.RutaRelativa,
    m.TamanioBytes,
    m.FechaSubida,
    CASE WHEN m.IdMultimedia IS NULL THEN 1 ELSE 0 END AS BinarioPendiente
FROM appEx_Respuestas r
LEFT JOIN appEx_Multimedia m
       ON m.IdCaptura  = r.IdCaptura
      AND m.IdPregunta = r.IdPregunta
      AND m.Estado     = 1
WHERE r.Valor LIKE 'MEDIA::%';
GO
PRINT 'vw_appEx_RespuestasMultimedia: vista creada.';
GO

/* -----------------------------------------------------------------------------
   4. Parámetros nuevos
   --------------------------------------------------------------------------
   Se insertan SOLO si no existen. Nunca se actualizan los ya presentes: el
   BackOffice pudo haberlos ajustado para la operación real, y reejecutar este script
   no debe pisar esa decisión.

   Estos parámetros llegan a la app por /sync/deltas, así que ajustarlos NO requiere
   publicar una versión nueva en la tienda.
   -------------------------------------------------------------------------- */
/* La tabla solo tiene (Clave, Valor, FechaModificacion): NO existe una columna
   Descripcion. El significado de cada parametro se documenta aqui en comentario y
   en .env.example, no en la base. */
MERGE Cat_Parametros_AppEx AS destino
USING (VALUES
    -- Tamano maximo por archivo en KB. El servidor revalida con su propio limite.
    ('MULTIMEDIA_PESO_MAXIMO_KB',       '5120'),
    ('MULTIMEDIA_CALIDAD_FOTO',         '0.7'),
    ('MULTIMEDIA_TIMEOUT_MS',           '120000'),
    ('MULTIMEDIA_MAX_POR_SYNC',         '20'),
    ('MULTIMEDIA_MAX_INTENTOS',         '5'),
    ('MULTIMEDIA_DIAS_RETENCION',       '7'),
    ('MULTIMEDIA_PERMITE_VIDEO',        '1'),
    ('MULTIMEDIA_EXTENSIONES_DOCUMENTO','pdf,doc,docx,xls,xlsx,csv,txt')
) AS origen (Clave, Valor)
ON destino.Clave = origen.Clave
WHEN NOT MATCHED BY TARGET THEN
    INSERT (Clave, Valor) VALUES (origen.Clave, origen.Valor);
GO

/* Verificacion REAL: cuenta las claves que quedaron. Deben ser 8. */
DECLARE @sembrados INT = (
    SELECT COUNT(*) FROM Cat_Parametros_AppEx WHERE Clave LIKE 'MULTIMEDIA[_]%'
);
IF @sembrados = 8
    PRINT 'VERIFICADO: 8 parametros de multimedia presentes.';
ELSE
    PRINT '*** FALLO: se esperaban 8 parametros MULTIMEDIA_ y hay ' + CAST(@sembrados AS VARCHAR(10)) + '. ***';
GO

/* El trigger de parámetros marca la tabla como modificada, pero si este script se
   ejecuta antes que el del Sprint 9 la fila de control podría no existir. */
IF EXISTS (SELECT 1 FROM Control_Versiones_AppEx WHERE TablaNombre = 'Cat_Parametros_AppEx')
    UPDATE Control_Versiones_AppEx SET UltimaModificacion = GETDATE() WHERE TablaNombre = 'Cat_Parametros_AppEx';
ELSE
    PRINT 'AVISO: falta la fila de control Cat_Parametros_AppEx. Ejecutar TablasyReglasSprint9.sql.';
GO

/* -----------------------------------------------------------------------------
   5. DIAGNOSTICO (solo lectura) — deuda de UUID_Instancia
   --------------------------------------------------------------------------
   Este bloque NO modifica nada. Documenta un fallo preexistente que se detectó al
   explorar para multimedia:

   appEx_Respuestas.UUID_Instancia es UNIQUEIDENTIFIER, pero la app envía
   '<uuid>_<uuid>' para las filas hijas de una matriz. SQL Server no puede convertir
   ese texto, de modo que CUALQUIER /submit con una matriz rellena falla por completo.

   Que la consulta de abajo devuelva 0 filas es la señal de que ninguna encuesta con
   matriz ha llegado nunca a guardarse — es decir, el fallo existe pero aún no ha
   destruido datos.

   NO se corrige aquí porque la decisión tiene dos caminos válidos y corresponde al
   equipo: (a) ensanchar la columna a VARCHAR(80), como esta tabla nueva, o (b)
   separarla en UUID_Instancia + UUID_Fila. La opción (a) es un ALTER sobre una tabla
   que ya puede tener millones de filas: conviene planificar la ventana.
   -------------------------------------------------------------------------- */
SELECT
    t.name                                    AS Tabla,
    c.name                                    AS Columna,
    ty.name                                   AS TipoActual,
    (SELECT COUNT(*) FROM appEx_Respuestas WHERE UUID_Instancia IS NOT NULL) AS RespuestasDeMatrizGuardadas
FROM sys.columns c
INNER JOIN sys.tables t  ON t.object_id = c.object_id
INNER JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE t.name = 'appEx_Respuestas' AND c.name = 'UUID_Instancia';
GO

PRINT '=== Sprint 10 aplicado. Recordatorio: definir MULTIMEDIA_RUTA_RAIZ en el .env del servidor (sin ella el backend NO arranca, a proposito). ===';
GO
