import { schemaMigrations, addColumns, createTable, unsafeExecuteSql } from '@nozbe/watermelondb/Schema/migrations';

/**
 * Registro histórico de migraciones de la base local.
 *
 * POR QUÉ EXISTEN LOS PASOS 2, 3 Y 4
 * WatermelonDB calcula `minVersion` como (toVersion de la migración más antigua - 1).
 * Con solo los pasos 5 y 6, `minVersion` era 4: cualquier dispositivo con la base en
 * v1, v2 o v3 quedaba FUERA del rango migrable y WatermelonDB **borraba la base entera
 * en silencio** (`stepsForMigration` devuelve null → `_setUpWithSchema` →
 * `unsafeDestroyEverything`). Es un `logger.warn`, no un error: `onSetUpError` ni se
 * dispara y el usuario no ve nada. Se perdían las capturas pausadas
 * (`estado_sincro = -1`), que por diseño nunca se suben al servidor y solo viven aquí.
 *
 * Con la cadena completa 2→3→4→5→6, `minVersion` baja a 1 y esos equipos migran de
 * verdad en vez de perder los datos.
 *
 * OJO AL AÑADIR UNA TABLA NUEVA AL SCHEMA: hay que escribir su `createTable` aquí en el
 * MISMO commit. Una instalación limpia crea el esquema íntegro y por eso el fallo no se
 * nota en desarrollo — solo aparece al actualizar un equipo que ya tenía la app.
 *
 * La versión del schema NO cambia por añadir estos pasos: solo se cubren versiones por
 * debajo de la actual (6), el contenido del esquema es el mismo.
 */

/**
 * `createTable` emite `create table "x"` SIN `if not exists` y aborta la migración si la
 * tabla ya existe. En este repo los números de versión se reutilizaron (un commit
 * reinició la versión de 5 a 1), así que un mismo entero pudo corresponder a esquemas
 * distintos y no se puede garantizar qué tablas hay realmente. Hacerlo idempotente evita
 * que una migración falle y deje la app sin abrir — un fallo peor que el borrado, porque
 * la migración corre en una transacción y su rechazo tumba el arranque completo.
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
      // Se eliminan las tablas del motor de formularios abandonado. WatermelonDB no
      // ofrece un paso `destroyTable` (está documentado como NO implementado), así que
      // se usa SQL directo. `if exists` lo hace idempotente y tolera los dispositivos
      // que nunca llegaron a tener esas tablas.
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
  ],
});
