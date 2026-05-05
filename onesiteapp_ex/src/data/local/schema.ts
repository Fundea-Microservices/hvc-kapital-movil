import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 5, // Incrementa esto cada vez que cambies la estructura
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
      name: 'cat_parametros_appex',
      columns: [
        { name: 'clave', type: 'string', isIndexed: true },
        { name: 'valor', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'usuario_perfil',
      columns: [
        { name: 'id_usuario', type: 'number', isIndexed: true },
        { name: 'nombre', type: 'string' },
        { name: 'rol', type: 'string' },
        { name: 'permisos_json', type: 'string' }, // Guardamos el objeto como stringified JSON
        { name: 'ultimo_login', type: 'number' },
      ],
    }),

    // Tabla del Sprint 3
    tableSchema({
      name: 'cat_menu_appex',
      columns: [
        { name: 'id_padre', type: 'string', isOptional: true, isIndexed: true },
        { name: 'titulo', type: 'string' },
        { name: 'icono', type: 'string', isOptional: true },
        { name: 'orden', type: 'number' },
        { name: 'ruta_pantalla', type: 'string', isOptional: true },
      ],
    }),

    // S1.3: Tabla Local_Encuesta
    tableSchema({
      name: 'local_encuesta',
      columns: [
        { name: 'nombre', type: 'string' },
        { name: 'version_activa', type: 'number' },
        { name: 'orden', type: 'number' },
        { name: 'fecha_modificacion', type: 'string' },
      ],
    }),

    // S1.3: Tabla Local_Seccion
    tableSchema({
      name: 'local_seccion',
      columns: [
        { name: 'id_encuesta', type: 'string', isIndexed: true },
        { name: 'titulo', type: 'string' },
        { name: 'orden', type: 'number' },
        { name: 'es_visible_default', type: 'number' },
      ],
    }),

    // S1.3: Tabla Local_Estructura_Pregunta (Unificada)
    tableSchema({
      name: 'local_estructura_pregunta',
      columns: [
        { name: 'id_seccion', type: 'string', isIndexed: true },
        { name: 'id_matriz_padre', type: 'string', isOptional: true },
        { name: 'tipo_dato', type: 'string' },
        { name: 'origen_datos_tipo', type: 'string', isOptional: true },
        { name: 'origen_datos_cmd', type: 'string', isOptional: true },
        { name: 'es_editable', type: 'number' },
        { name: 'es_visible_default', type: 'number' },
        { name: 'orden', type: 'number' },
        { name: 'sintaxis_calculo', type: 'string', isOptional: true },
        { name: 'regla_visibilidad', type: 'string', isOptional: true },
        { name: 'regla_validacion', type: 'string', isOptional: true },
      ],
    }),

    // S1.4 y S1.5: Tablas para Catálogos y Capturas (se usarán en futuros sprints)
    tableSchema({
      name: 'local_captura',
      columns: [
        { name: 'id_pregunta', type: 'string', isIndexed: true },
        { name: 'valor', type: 'string', isOptional: true },
        { name: 'uuid_instancia', type: 'string', isOptional: true },
        { name: 'estado_sincro', type: 'number' },
      ],
    }),

    // S2.1: Tabla Local_Catalogos
    tableSchema({
      name: 'local_catalogos',
      columns: [
        { name: 'nombre_catalogo', type: 'string', isIndexed: true },
        { name: 'codigo_opcion', type: 'string' },
        { name: 'valor_opcion', type: 'string' },
        { name: 'id_padre_opcion', type: 'string', isOptional: true },
      ],
    }),
  ],
});