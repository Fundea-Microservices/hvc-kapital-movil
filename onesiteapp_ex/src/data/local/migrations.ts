import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

/**
 * Registro histórico de migraciones para la base de datos de WatermelonDB.
 * Se implementa la transición estructurada a la versión 5 para dar soporte a la telemetría.
 */
export const migrations = schemaMigrations({
  migrations: [
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