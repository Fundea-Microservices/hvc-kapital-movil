import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1, // Incrementa esto cada vez que cambies la estructura
  tables: [
    // Tabla para control de sincronización por tabla (Regla 4.4 y 4.5)
    tableSchema({
      name: 'metadata_sync',
      columns: [
        { name: 'tabla_nombre', type: 'string', isIndexed: true },
        { name: 'fecha_ultima_sinc', type: 'number' }, // Almacenamos como Timestamp (ms)
      ],
    }),
    // Tabla para parámetros de configuración local (Regla 1.5 - Persistencia local)
    tableSchema({
      name: 'cat_parametros',
      columns: [
        { name: 'clave', type: 'string', isIndexed: true },
        { name: 'valor', type: 'string' },
      ],
    }),
  ],
});