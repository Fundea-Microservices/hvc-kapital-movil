/* =============================================================================
   SPRINT 14b - ENCABEZADO DE ENCUESTAS RECHAZADAS (deuda del Sprint 14)
   =============================================================================

   Script IDEMPOTENTE. Verificarlo ejecutandolo DOS VECES seguidas.

   QUE HACE
   1. Crea appEx_Encuestas_Rechazadas: el encabezado de toda gestion rechazada,
      de los DOS origenes (cartera precargada y creada en campo).
   2. Verificaciones que leen el estado REAL de sys.columns / sys.indexes.
   3. Sondeo de pre.Precarga: nombre/longitud de Comentario y CHECK sobre Estado.

   POR QUE
   El boton "Cancelar Gestion" escribia el motivo SOLO en el dispositivo: nunca
   viajaba, y se perdia al reinstalar la app o cambiar de equipo. Ahora el sync
   lo empuja a POST /surveys/encuestas-rechazadas, que:
     - inserta el encabezado del rechazo en esta tabla (los dos origenes), y
     - cuando la gestion venia de la cartera, espeja el motivo en
       pre.Precarga.Comentario y pasa esa fila a 'RECHAZADO'.

   POR QUE UNA TABLA PROPIA Y NO SOLO pre.Precarga
   Una gestion AD-HOC se crea en campo y NO EXISTE en pre.Precarga: no hay fila
   donde escribir su comentario. Se descarto insertarla alli porque esa tabla es
   de otro desarrollador y su semantica es "lo que BackOffice cargo desde Excel":
   filas sinteticas descuadrarian a todo lector que cuente cargas, su PK es
   Correlativo (no Id), y habria que rellenar sus NOT NULL del formato Excel
   (idEncuestador, encuestador, valores) con datos que una ad-hoc no tiene.
   Ademas un INSERT en tabla ajena tiene mas superficie de constraint que un
   UPDATE: es la misma clase de fallo que ya costo un sprint cuando un CHECK
   sobre Estado hizo que el UPDATE de 'FINALIZADO' revirtiera la captura entera.

   OJO CON EL TIPO DE IdPrecarga: se asume que pre.Precarga.Id es
   UNIQUEIDENTIFIER (los valores reales son GUID). Si en la base real fuese
   NVARCHAR, esta columna debe igualar ESE tipo. Los scripts de db/ NO son la
   fuente de verdad del esquema vigente: lo confirma el bloque 3.
   ============================================================================= */

-- 1. Encabezado de las gestiones rechazadas ----------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID('appEx_Encuestas_Rechazadas') AND type = 'U'
)
BEGIN
    CREATE TABLE appEx_Encuestas_Rechazadas (
        IdEncuestaRechazada BIGINT IDENTITY(1,1) PRIMARY KEY,

        -- uuid que genera el MOVIL al cancelar, NO el servidor. Es la clave de
        -- idempotencia: un 200 perdido por la red hace que el dispositivo reintente,
        -- y ese reintento choca contra el UNIQUE de abajo en vez de duplicar el
        -- encabezado. Sin esto la idempotencia dependeria del efecto colateral de
        -- que "WHERE Estado='CARGADO'" no encontrara fila la segunda vez.
        IdRechazo           NVARCHAR(64)  NOT NULL,

        Origen              NVARCHAR(10)  NOT NULL,  

        -- NULL en AD-HOC: esa gestion se creo en campo y no existe en pre.Precarga.
        IdPrecarga          UNIQUEIDENTIFIER NULL,

        -- IdEmpresa y DispositivoID los RESUELVE EL BACKEND del device token
        -- autenticado (Dispositivos_AppEx), nunca los envia el cliente: el equipo
        -- solo guarda company_name (el nombre, no el id) y un cliente manipulado no
        -- debe poder atribuir un rechazo a otra empresa ni a otro equipo.
        -- IdEmpresa admite NULL porque un equipo desenrolado la deja en NULL.
        IdEmpresa           INT           NULL,
        DispositivoID       VARCHAR(100)  NULL,       

        IdEncuesta          INT           NOT NULL,

        -- UNA sola columna de identidad: en este sistema el asesor logueado ES el
        -- encuestador (el movil manda su user_id como idEncuestador al servicio de
        -- precarga). Dos columnas con el mismo numero se interpretarian como
        -- distintas y alguien construiria un reporte equivocado sobre esa ilusion.
        IdUsuario           INT           NOT NULL,

        -- NVARCHAR(100) igual que appEx_Respuestas.UUID_Instancia, que admite la
        -- clave compuesta <uuid>_<uuid> de 73 caracteres de las preguntas matriz.
        UuidInstancia       NVARCHAR(100) NULL,

        -- A QUIEN se rechazo. En PRECARGA vienen todos; en AD-HOC solo el nombre
        -- deducido de las respuestas, que puede ser un marcador ("NUEVA ENCUESTA")
        -- si el asesor cancelo antes de contestar la pregunta del nombre.
        NombreCliente       NVARCHAR(200) NULL,
        Documento           NVARCHAR(50)  NULL,
        Cuenta              NVARCHAR(50)  NULL,
        Operacion           NVARCHAR(50)  NULL,
        Expediente          NVARCHAR(50)  NULL,

        -- Texto libre por decision de producto. El tope se replica en el DTO (Zod) y
        -- en el modal de la app: pasarse no da un error de validacion amable, da un
        -- fallo de truncamiento DENTRO de la transaccion, que revertiria el INSERT.
        Motivo              NVARCHAR(500) NOT NULL,

        -- DOS fechas a proposito: un movil con el reloj desajustado desordenaria el
        -- historico. Misma leccion que el cursor de sync y local_bitacora_error. El
        -- backend valida la del dispositivo por rango y, fuera de rango, usa la suya.
        FechaRechazoDisp    DATETIME      NULL,
        FechaRegistro       DATETIME      NOT NULL DEFAULT GETDATE(),

        -- Cuantas filas de pre.Precarga afecto el espejo (0 o 1). Un 0 significa que
        -- la precarga ya no estaba en CARGADO: se registra el hecho en vez de fingir
        -- que el rechazo cambio un estado que no cambio.
        AfectadasPrecarga   INT           NOT NULL DEFAULT 0,

        -- PREPARADO PARA EL FUTURO CERCANO: las respuestas parciales que el asesor
        
        RespuestasEnviadas  BIT           NOT NULL DEFAULT 0,

        CONSTRAINT CK_EncRech_Origen CHECK (Origen IN ('PRECARGA','AD-HOC')),

        -- Coherencia origen <-> IdPrecarga en la BD, no solo en el DTO: el endpoint
        -- no es el unico camino posible a esta tabla a lo largo de su vida.
        CONSTRAINT CK_EncRech_Coherencia CHECK (
            (Origen = 'PRECARGA' AND IdPrecarga IS NOT NULL)
         OR (Origen = 'AD-HOC'   AND IdPrecarga IS NULL)
        ),

        CONSTRAINT FK_EncRech_Encuesta FOREIGN KEY (IdEncuesta)
            REFERENCES appEx_Encuesta(IdEncuesta)
    );

    -- El UNIQUE es la idempotencia. Si este indice no existe, el endpoint duplica
    -- encabezados en cuanto una respuesta se pierda por la red.
    CREATE UNIQUE INDEX UX_EncRech_IdRechazo
        ON appEx_Encuestas_Rechazadas (IdRechazo);
    CREATE INDEX IX_EncRech_IdPrecarga
        ON appEx_Encuestas_Rechazadas (IdPrecarga);
    -- El reporte natural es "rechazos de mi empresa en un rango de fechas".
    CREATE INDEX IX_EncRech_Empresa_Fecha
        ON appEx_Encuestas_Rechazadas (IdEmpresa, FechaRegistro);

    PRINT 'Tabla appEx_Encuestas_Rechazadas creada.';
END
ELSE
    PRINT 'Tabla appEx_Encuestas_Rechazadas ya existia (no-op).';

-- Sin FK a pre.Precarga a proposito: es otro schema, su PK es Correlativo (no Id)
-- y las AD-HOC llevan NULL.
IF EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID('appEx_Encuestas_Rechazadas') AND type = 'U'
)
    PRINT 'OK: appEx_Encuestas_Rechazadas existe.';
ELSE
    RAISERROR('FALLO: no se pudo crear appEx_Encuestas_Rechazadas.', 16, 1);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_EncRech_IdRechazo')
    PRINT 'OK: indice UNIQUE de idempotencia presente.';
ELSE
    RAISERROR('FALLO: sin UNIQUE en IdRechazo la idempotencia NO existe y el endpoint duplicara encabezados.', 16, 1);

-- 3. Sondeo de pre.Precarga (NO la altera) -----------------------------------
-- Esta tabla es de otro desarrollador. 

PRINT '--- Sondeo de pre.Precarga (informativo) ---';
SELECT c.name AS Columna, t.name AS Tipo, c.max_length AS LongitudBytes, c.is_nullable
FROM sys.columns c
INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('pre.Precarga')
  AND c.name IN ('Id', 'Estado', 'Comentario', 'IdUsractualiza', 'Updated_At');

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('pre.Precarga') AND name = 'Comentario'
)
    RAISERROR('ATENCION: pre.Precarga no tiene columna Comentario. El espejo del motivo fallara; ajustar el nombre real en surveys.service.ts o agregar la columna con el dueno de esa tabla.', 16, 1);
ELSE
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.columns c
        INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID('pre.Precarga') AND c.name = 'Comentario'
          -- max_length = -1 es MAX (ilimitado): eso siempre cabe.
          AND c.max_length <> -1
          AND (CASE WHEN t.name LIKE 'n%' THEN c.max_length / 2 ELSE c.max_length END) < 500
    )
        RAISERROR('ATENCION: pre.Precarga.Comentario admite MENOS de 500 caracteres. Bajar MAX_LONGITUD_MOTIVO en la app y el tope del DTO a ese valor, o el UPDATE fallara por truncamiento DENTRO de la transaccion y revertira el encabezado.', 16, 1);
    ELSE
        PRINT 'OK: pre.Precarga.Comentario existe y admite el tope del motivo.';
END

-- Un CHECK sobre Estado que no admita 'RECHAZADO' haria fallar el espejo igual que
-- fallo con 'FINALIZADO', y al ir en la transaccion revertiria el encabezado.
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    INNER JOIN sys.columns c
        ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('pre.Precarga')
      AND c.name = 'Estado'
      AND cc.definition NOT LIKE '%RECHAZADO%'
)
    RAISERROR('ATENCION: pre.Precarga.Estado tiene un CHECK que NO admite RECHAZADO. El espejo del rechazo fallara y revertira el encabezado. Ajustar el constraint con el dueno de esa tabla.', 16, 1);
ELSE
    PRINT 'OK: pre.Precarga.Estado admite RECHAZADO (sin CHECK que lo impida).';

-- RECORDATORIO OPERATIVO: tras desplegar este script hay que reconstruir el
-- backend (npm run build) y reiniciarlo.