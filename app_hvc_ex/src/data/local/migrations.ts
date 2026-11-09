import { schemaMigrations, addColumns, createTable, unsafeExecuteSql } from '@nozbe/watermelondb/Schema/migrations';

/**
 * Registro histórico de migraciones de la base local.
 */
const idempotente = (sql: string): string => sql.replace('create table "', 'create table if not exists "');

export const migrations = schemaMigrations({
  migrations: [
    {
      // Campos del motor de encuestas que se añadieron a la estructura de preguntas.
      toVersion: 2,
      steps: [
        addColumns({
          table: 'local_estructura_pregunta',
          columns: [
            { name: 'etiqueta', type: 'string' },
            { name: 'opciones', type: 'string', isOptional: true },
            { name: 'es_obligatorio', type: 'number' },
          ],
        }),
      ],
    },
    {
      // Catálogos de opciones: la tabla que realmente lee el motor de formularios.
      toVersion: 3,
      steps: [
        createTable({
          name: 'local_catalogo_opciones',
          columns: [
            { name: 'id_remoto', type: 'string' },
            { name: 'nombre_catalogo', type: 'string' },
            { name: 'codigo_catalogo', type: 'string' },
            { name: 'codigo_opcion', type: 'string' },
            { name: 'valor_opcion', type: 'string' },
            { name: 'id_padre_opcion', type: 'string', isOptional: true },
          ],
          unsafeSql: idempotente,
        }),
      ],
    },
    {
      // Agenda de clientes por encuesta.
      toVersion: 4,
      steps: [
        createTable({
          name: 'local_cliente_pendiente',
          columns: [
            { name: 'id_cliente', type: 'string' },
            { name: 'nombre', type: 'string' },
            { name: 'codigo', type: 'string' },
            { name: 'id_encuesta', type: 'string' },
            { name: 'estado_gestion', type: 'number' },
            { name: 'motivo_rechazo', type: 'string', isOptional: true },
          ],
          unsafeSql: idempotente,
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'local_captura',
          columns: [
            { name: 'fecha_inicio', type: 'string', isOptional: true },
            { name: 'fecha_fin', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        addColumns({
          table: 'cat_menu_appex',
          columns: [
            { name: 'id_permiso_requerido', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        unsafeExecuteSql(
          'drop table if exists "app_ex_encuesta";' +
          'drop table if exists "app_ex_pregunta";' +
          'drop table if exists "app_ex_respuesta";',
        ),
      ],
    },
    {
      // Cola local de archivos adjuntos. Va en el MISMO commit que la subida de
      // `version` a 8 en `schema.ts`: separarlos deja la app sin poder abrir la base.
      toVersion: 8,
      steps: [
        createTable({
          name: 'local_multimedia',
          columns: [
            { name: 'id_encuesta', type: 'string', isIndexed: true },
            { name: 'id_pregunta', type: 'string', isIndexed: true },
            { name: 'uuid_instancia', type: 'string' },
            { name: 'uuid_base', type: 'string', isIndexed: true },
            { name: 'tipo_medio', type: 'string' },
            { name: 'ruta_relativa', type: 'string' },
            { name: 'nombre_original', type: 'string', isOptional: true },
            { name: 'extension', type: 'string' },
            { name: 'mime_type', type: 'string', isOptional: true },
            { name: 'tamanio_bytes', type: 'number' },
            { name: 'secuencia', type: 'number' },
            { name: 'estado_subida', type: 'number', isIndexed: true },
            { name: 'intentos', type: 'number' },
            { name: 'ultimo_error', type: 'string', isOptional: true },
            { name: 'id_captura_servidor', type: 'string', isOptional: true },
            { name: 'fecha_captura', type: 'number' },
            { name: 'fecha_subida', type: 'number', isOptional: true },
          ],
          unsafeSql: idempotente,
        }),
      ],
    },
    {
      // Bitácora de errores. Va en el MISMO commit que la subida de `version` a 9.
      toVersion: 9,
      steps: [
        createTable({
          name: 'local_bitacora_error',
          columns: [
            { name: 'nivel', type: 'string' },
            { name: 'origen', type: 'string' },
            { name: 'mensaje', type: 'string' },
            { name: 'detalle', type: 'string', isOptional: true },
            { name: 'contexto_json', type: 'string', isOptional: true },
            { name: 'version_app', type: 'string' },
            { name: 'plataforma', type: 'string' },
            { name: 'epoch_ms', type: 'number', isIndexed: true },
            { name: 'estado_envio', type: 'number', isIndexed: true },
            { name: 'intentos', type: 'number' },
          ],
          unsafeSql: idempotente,
        }),
      ],
    },
    {
      toVersion: 10,
      steps: [
        addColumns({
          table: 'local_cliente_pendiente',
          columns: [
            { name: 'origen', type: 'string', isIndexed: true },
            { name: 'documento', type: 'string', isOptional: true, isIndexed: true },
            { name: 'cuenta', type: 'string', isOptional: true },
            { name: 'operacion', type: 'string', isOptional: true },
            { name: 'expediente', type: 'string', isOptional: true },
            { name: 'ubicacion', type: 'string', isOptional: true },
            { name: 'busqueda_normalizada', type: 'string', isOptional: true },
            { name: 'valores_json', type: 'string', isOptional: true },
            { name: 'estado_servidor', type: 'string', isOptional: true },
          ],
        }),
        unsafeExecuteSql(
          'create index if not exists "local_cliente_pendiente_id_cliente" on "local_cliente_pendiente" ("id_cliente");' +
          'create index if not exists "local_cliente_pendiente_id_encuesta" on "local_cliente_pendiente" ("id_encuesta");' +
          'create index if not exists "local_cliente_pendiente_estado_gestion" on "local_cliente_pendiente" ("estado_gestion");' +
          `update "local_cliente_pendiente" set "origen" = 'AD-HOC' where "origen" is null or "origen" = '';`,
        ),
      ],
    },
    {
      toVersion: 11,
      steps: [
        addColumns({
          table: 'local_estructura_pregunta',
          columns: [
            { name: 'mensaje_error', type: 'string', isOptional: true },
            { name: 'mensaje_notificacion', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 12,
      steps: [
        addColumns({
          table: 'local_cliente_pendiente',
          columns: [
            { name: 'rechazo_uuid', type: 'string', isOptional: true },
            { name: 'rechazo_envio_estado', type: 'number', isIndexed: true },
            { name: 'rechazo_intentos', type: 'number' },
            { name: 'rechazo_ultimo_error', type: 'string', isOptional: true },
            { name: 'rechazo_fecha', type: 'number', isOptional: true },
            { name: 'rechazo_fecha_envio', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
    {
      // Identidad que entrega el API de auth: GUID, handle y foto de perfil.
      toVersion: 13,
      steps: [
        addColumns({
          table: 'usuario_perfil',
          columns: [
            { name: 'usuario_guid', type: 'string', isOptional: true },
            { name: 'usuario', type: 'string', isOptional: true },
            { name: 'foto_url', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
  ],
});
