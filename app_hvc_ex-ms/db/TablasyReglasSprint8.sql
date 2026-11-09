-- =============================================================================
-- SPRINT 8: Columna EsObligatorio en appEx_Pregunta (deuda técnica de campo)
-- Ningún script previo (Sprint1..7) crea esta columna en appEx_Pregunta —
-- CREATE TABLE appEx_Pregunta (TablasyReglasSprint5.sql) solo declara
-- EsEditable y EsVisibleDefault. El backend lee row.EsObligatorio esperando
-- que exista; si no existe (o el BackOffice la creó con otro nombre), la app
-- recibe es_obligatorio = 0 SIEMPRE, y en cascada: sin asterisco rojo, sin
-- borde rojo en campos vacíos, y "Finalizar Gestión" nunca bloquea por
-- obligatorios sin responder.
--
-- Este script es IDEMPOTENTE y solo agrega la columna si no existe con
-- NINGUNO de los alias que el backend ya sabe interpretar
-- (EsObligatorio, Obligatorio, EsRequerido, Requerido). Si el BackOffice ya
-- tiene la bandera bajo otro nombre distinto a estos, el backend NO la
-- encontrará: revisar el log de diagnóstico temporal en
-- surveys.service.ts (getSurveyStructure) para confirmar el nombre real.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('appEx_Pregunta')
    AND name IN ('EsObligatorio', 'Obligatorio', 'EsRequerido', 'Requerido')
)
BEGIN
  ALTER TABLE appEx_Pregunta ADD EsObligatorio BIT NOT NULL DEFAULT 0;
END;
GO
