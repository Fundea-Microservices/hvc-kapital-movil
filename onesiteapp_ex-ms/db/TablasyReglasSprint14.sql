/* =============================================================================
   Sprint 14 — Cierre del ciclo de precarga: IdPrecarga + estado FINALIZADO
   =============================================================================

   Script IDEMPOTENTE. Verificarlo ejecutandolo DOS VECES seguidas.

   QUE HACE
   1. Anade appEx_Encabezado_Captura.IdPrecarga (traza captura -> pre.Precarga).
   2. Documenta el nuevo estado 'FINALIZADO' de pre.Precarga (no altera datos).
   3. Verificacion que lee el estado REAL de sys.columns.

   POR QUE
   Al finalizar una encuesta que salio de la precarga, el /submit ahora:
     - guarda en que fila de pre.Precarga se origino (IdPrecarga), y
     - marca esa fila como 'FINALIZADO' en la MISMA transaccion, con la guarda
       WHERE Estado = 'CARGADO' (para no pisar un ANULADO/RECHAZADO del BackOffice).
   La app, al descargar, solo pide estado 'CARGADO', asi que una fila FINALIZADO ya
   no vuelve a bajar como pendiente.

   pre.Precarga ya existe (la creo otro desarrollador en esta misma base). Este
   script NO la crea ni la toca: solo agrega la columna de traza en la tabla de
   capturas, que si es de este backend.

   OJO CON EL TIPO: se asume que pre.Precarga.Id es UNIQUEIDENTIFIER (los valores
   reales son GUID, p.ej. '92CEDD06-...'). Si en la base real fuese NVARCHAR, esta
   columna debe igualar ESE tipo. Los scripts de db/ NO son la fuente de verdad del
   esquema vigente: confirmar con
     SELECT c.name, t.name AS Tipo, c.max_length, c.is_nullable
     FROM sys.columns c INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
     WHERE c.object_id = OBJECT_ID('pre.Precarga') AND c.name = 'Id';
   ============================================================================= */

-- 1. Columna de traza en la tabla de capturas ---------------------------------
-- NULL para las capturas ad-hoc: esas NO salen de una precarga y no tienen origen.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('appEx_Encabezado_Captura') AND name = 'IdPrecarga'
)
BEGIN
    ALTER TABLE appEx_Encabezado_Captura ADD IdPrecarga UNIQUEIDENTIFIER NULL;
    PRINT 'Columna appEx_Encabezado_Captura.IdPrecarga agregada.';
END
ELSE
    PRINT 'Columna appEx_Encabezado_Captura.IdPrecarga ya existia (no-op).';

-- Sin FK a pre.Precarga a proposito: es otro schema, su PK es Correlativo (no Id),
-- y las capturas ad-hoc llevan NULL. La integridad de la traza se valida en la app.

-- 2. Verificacion que lee el estado REAL --------------------------------------
-- Un PRINT de exito NO prueba que el bloque anterior funcionara: tras un error de
-- nivel 16 el lote continua. Se comprueba contra sys.columns.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('appEx_Encabezado_Captura') AND name = 'IdPrecarga'
)
    PRINT 'OK: appEx_Encabezado_Captura.IdPrecarga existe.';
ELSE
    RAISERROR('FALLO: no se pudo crear appEx_Encabezado_Captura.IdPrecarga.', 16, 1);

-- 3. Estado 'FINALIZADO' de pre.Precarga --------------------------------------
-- No se altera el esquema de pre.Precarga (Estado es texto libre / enum logico).
-- Este bloque solo deja constancia y, si hubiera un CHECK constraint sobre Estado
-- que excluya 'FINALIZADO', lo delata en vez de fallar en runtime al primer submit.
IF EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    INNER JOIN sys.columns c
        ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
    WHERE cc.parent_object_id = OBJECT_ID('pre.Precarga')
      AND c.name = 'Estado'
      AND cc.definition NOT LIKE '%FINALIZADO%'
)
    RAISERROR('ATENCION: pre.Precarga.Estado tiene un CHECK que NO admite FINALIZADO. El /submit fallara al marcar la precarga. Ajustar el constraint con el dueno de esa tabla.', 16, 1);
ELSE
    PRINT 'OK: pre.Precarga.Estado admite FINALIZADO (sin CHECK que lo impida).';
