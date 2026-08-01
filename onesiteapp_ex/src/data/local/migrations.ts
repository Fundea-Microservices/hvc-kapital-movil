import { schemaMigrations, addColumns, createTable } from '@nozbe/watermelondb/Schema/migrations';

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
  ],
});
