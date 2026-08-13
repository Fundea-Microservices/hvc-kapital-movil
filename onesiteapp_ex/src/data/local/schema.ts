import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 9, // v9: local_bitacora_error (diagnóstico de fallos en campo)
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
        { name: 'seccion', type: 'string', isOptional: true },
        { name: 'ruta_pantalla', type: 'string', isOptional: true },
        { name: 'id_permiso_requerido', type: 'string', isOptional: true },
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
        { name: 'id_encuesta', type: 'string', isIndexed: true },
        { name: 'id_seccion', type: 'string', isIndexed: true },
        { name: 'id_matriz_padre', type: 'string', isOptional: true },
        { name: 'etiqueta', type: 'string' },
        { name: 'tipo_dato', type: 'string' },
        { name: 'origen_datos_tipo', type: 'string', isOptional: true },
        { name: 'origen_datos_cmd', type: 'string', isOptional: true },
        { name: 'opciones', type: 'string', isOptional: true }, // Importante
        { name: 'es_editable', type: 'number' },
        { name: 'es_visible_default', type: 'number' },
        { name: 'es_obligatorio', type: 'number' },
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
        { name: 'id_encuesta', type: 'string', isIndexed: true },
        { name: 'valor', type: 'string', isOptional: true },
        { name: 'uuid_instancia', type: 'string', isOptional: true },
        { name: 'estado_sincro', type: 'number' },
        { name: 'fecha_inicio', type: 'string', isOptional: true },
        { name: 'fecha_fin', type: 'string', isOptional: true },
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

    // Las tablas app_ex_encuesta / app_ex_pregunta / app_ex_respuesta se eliminaron en
    // la versión 7: pertenecían a un motor de formularios abandonado. Sus modelos ni
    // siquiera estaban registrados en database.ts, pero dos de ellos apuntaban con
    // `static table` a tablas VIVAS y declaraban columnas inexistentes — la misma
    // clase de bomba que ya rompió el sync dos veces.

    tableSchema({
      name: 'local_catalogo_opciones',
      columns: [
        { name: 'id_remoto', type: 'string' },
        { name: 'nombre_catalogo', type: 'string' },
        { name: 'codigo_catalogo', type: 'string' },
        { name: 'codigo_opcion', type: 'string' },
        { name: 'valor_opcion', type: 'string' },
        { name: 'id_padre_opcion', type: 'string', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'local_cliente_pendiente',
      columns: [
        { name: 'id_cliente', type: 'string' },
        { name: 'nombre', type: 'string' },
        { name: 'codigo', type: 'string' },
        { name: 'id_encuesta', type: 'string' },
        { name: 'estado_gestion', type: 'number' },
        { name: 'motivo_rechazo', type: 'string', isOptional: true },
      ],
    }),

    /**
     * Archivos adjuntos pendientes de subir (v8).
     *
     * POR QUÉ NO VIVE EN `local_captura`
     * `persistirCapturas` destruye y recrea TODAS las filas de la instancia en cada
     * auto-save, que se dispara ~1,5 s después de cualquier tecla. Guardar aquí
     * `estado_subida`, `intentos` o `ruta_relativa` significaría perderlos cada vez
     * que el asesor escribe en cualquier otro campo del formulario. Además es la
     * trampa nº 2 del proyecto: dos escritores sobre la misma tabla deben poseer
     * conjuntos de filas disjuntos, y aquí no lo serían.
     *
     * El puente entre ambas tablas es `(uuid_instancia, id_pregunta)`, la única
     * clave estable que el dispositivo puede construir sin conocer el `IdCaptura`.
     *
     * TODAS las columnas que declare el modelo deben existir aquí — trampa nº 1: un
     * `@field` sin columna lanza `TypeError` y aborta la sincronización COMPLETA, no
     * solo esa fila. `created_at`/`updated_at` no son implícitas y por eso no se
     * declaran en el modelo.
     */
    tableSchema({
      name: 'local_multimedia',
      columns: [
        { name: 'id_encuesta', type: 'string', isIndexed: true },
        { name: 'id_pregunta', type: 'string', isIndexed: true },
        // Clave de la fila de matriz; cadena vacía para preguntas normales.
        { name: 'uuid_instancia', type: 'string' },
        // Instancia de captura a la que pertenece: permite purgar de golpe.
        { name: 'uuid_base', type: 'string', isIndexed: true },
        { name: 'tipo_medio', type: 'string' },
        // RELATIVA al directorio de documentos, NUNCA absoluta: en iOS el contenedor
        // lleva un UUID que cambia al actualizar la app y las rutas absolutas
        // guardadas dejarían de existir, perdiendo toda la cola pendiente.
        { name: 'ruta_relativa', type: 'string' },
        { name: 'nombre_original', type: 'string', isOptional: true },
        { name: 'extension', type: 'string' },
        { name: 'mime_type', type: 'string', isOptional: true },
        { name: 'tamanio_bytes', type: 'number' },
        { name: 'secuencia', type: 'number' },
        // 0 pendiente | 1 error reintentable | 2 subido | 3 rechazado definitivo
        { name: 'estado_subida', type: 'number', isIndexed: true },
        { name: 'intentos', type: 'number' },
        { name: 'ultimo_error', type: 'string', isOptional: true },
        // STRING y no NUMBER: es un BIGINT del servidor y convertirlo a número
        // podría superar Number.MAX_SAFE_INTEGER y redondearse en silencio, dejando
        // el archivo colgado de otra captura.
        { name: 'id_captura_servidor', type: 'string', isOptional: true },
        { name: 'fecha_captura', type: 'number' },
        { name: 'fecha_subida', type: 'number', isOptional: true },
      ],
    }),

    /**
     * Bitácora de errores pendientes de enviar (v9).
     *
     * Cuando la aplicación falla en campo —sin señal, a horas de la agencia— hoy no
     * queda ningún rastro. Esta tabla guarda el error en el dispositivo y una fase del
     * sync lo sube después. El saneado (credenciales, datos del encuestado) vive en
     * `domain/diagnostico/bitacora.ts`, que es puro y está probado.
     *
     * Como todas las tablas locales: cada columna que declare el modelo tiene que
     * existir aquí, y `created_at`/`updated_at` NO se declaran.
     */
    tableSchema({
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
        // 0 pendiente | 2 enviado. Se usan los mismos códigos que local_multimedia
        // para no obligar a recordar dos convenciones distintas.
        { name: 'estado_envio', type: 'number', isIndexed: true },
        { name: 'intentos', type: 'number' },
      ],
    }),

  ],
});