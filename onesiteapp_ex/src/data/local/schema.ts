import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 12, // v12: cola de salida del rechazo de gestión (columnas rechazo_*)
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
        // v11: mensajes parametrizables por el BackOffice.
        { name: 'mensaje_error', type: 'string', isOptional: true }, // Texto de error custom de la validación
        { name: 'mensaje_notificacion', type: 'string', isOptional: true }, // Recordatorio (modal al enfocar)
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

    /**
     * Agenda del asesor: los clientes que puede encuestar. La alimentan DOS escritores.
     *
     * POR QUÉ UNA SOLA TABLA Y NO DOS
     * Separar la cartera asignada por BackOffice de los clientes creados en campo
     * obligaría a la pantalla a fusionar dos observables y a duplicar el badge y la
     * cancelación, y dejaría al Dashboard cruzando dos fuentes. La convivencia es segura
     * porque `origen` reparte las filas en conjuntos DISJUNTOS:
     *
     *   origen = 'PRECARGA' -> las escribe el sync (sincronizarClientesAsignados)
     *   origen = 'AD-HOC'   -> las escribe persistirCapturas al capturar sin cita previa
     *
     * Ninguno purga ni actualiza las del otro, así que el ORDEN en que se invoquen deja
     * de importar. Es la misma invariante que separa a los dos escritores de
     * `local_catalogo_opciones` mediante el prefijo `API_`; romperla reproduce aquel
     * fallo en el que una función borraba en silencio lo que la otra acababa de traer.
     *
     * `estado_gestion` y `motivo_rechazo` son SIEMPRE del asesor: el sync no los pisa
     * con el valor del servidor, que viaja aparte en `estado_servidor`.
     *
     * `expediente`, `ubicacion` y `busqueda_normalizada` se DERIVAN de `valores_json`
     * al sincronizar, no al renderizar: `observeWithColumns` solo avisa de columnas
     * declaradas, y un valor calculado en tiempo de render no sería observable.
     */
    tableSchema({
      name: 'local_cliente_pendiente',
      columns: [
        { name: 'id_cliente', type: 'string', isIndexed: true },
        { name: 'nombre', type: 'string' },
        { name: 'codigo', type: 'string' },
        { name: 'id_encuesta', type: 'string', isIndexed: true },
        { name: 'estado_gestion', type: 'number', isIndexed: true },
        { name: 'motivo_rechazo', type: 'string', isOptional: true },
        // --- v10: cartera asignada por BackOffice (RF-CE-07) ---
        { name: 'origen', type: 'string', isIndexed: true }, // 'PRECARGA' | 'AD-HOC'
        { name: 'documento', type: 'string', isOptional: true, isIndexed: true },
        { name: 'cuenta', type: 'string', isOptional: true },
        // Sin tilde en local: el servidor la manda como `operación` y el adaptador
        // resuelve ese alias junto a las variantes camelCase y PascalCase.
        { name: 'operacion', type: 'string', isOptional: true },
        { name: 'expediente', type: 'string', isOptional: true },
        { name: 'ubicacion', type: 'string', isOptional: true },
        { name: 'busqueda_normalizada', type: 'string', isOptional: true },
        // JSON crudo [{ id_pregunta, etiqueta, valor }] que prellena el formulario.
        { name: 'valores_json', type: 'string', isOptional: true },
        // CARGADO | APLICADO | ANULADO | RECHAZADO, tal cual lo manda BackOffice.
        // SOLO la escribe el sync con lo que dice el servidor. NO se usa como marca de
        // "ya lo envié": esa confusión hacía imposible distinguir "el servidor lo dice"
        // de "yo lo mandé", y sellaba un RECHAZADO que el servidor podía no haber hecho.
        { name: 'estado_servidor', type: 'string', isOptional: true },
        // --- v12: cola de salida del rechazo de gestión ---
        // Estas columnas son de TRANSPORTE y su único escritor es
        // `empujarRechazosPendientes`. Viven aquí y no en una tabla aparte porque
        // `persistirCapturas` actualiza esta tabla campo por campo (no la destruye y
        // recrea, como sí hace con `local_captura`), así que el estado de envío
        // sobrevive al auto-save. No añaden un tercer escritor sobre los campos de
        // negocio: la invariante de conjuntos disjuntos por `origen` sigue intacta.
        //
        // Identidad de la INTENCIÓN de rechazar, no de la fila. Es la clave de
        // idempotencia que el servidor indexa como UNIQUE: sin ella, un 200 perdido por
        // la red duplicaría el encabezado en el siguiente ciclo. Se persiste ANTES del
        // POST, o un reintento generaría otro uuid y el duplicado volvería a colarse.
        { name: 'rechazo_uuid', type: 'string', isOptional: true },
        // 0 pendiente | 1 error reintentable | 2 enviado | 3 rechazado definitivamente.
        // Mismo vocabulario que `local_multimedia.estado_subida`, a propósito.
        { name: 'rechazo_envio_estado', type: 'number', isIndexed: true },
        { name: 'rechazo_intentos', type: 'number' },
        { name: 'rechazo_ultimo_error', type: 'string', isOptional: true },
        // Cuándo canceló el asesor (reloj del dispositivo) y cuándo lo confirmó el
        // servidor. Se guardan las dos: un móvil con el reloj desajustado desordenaría
        // el histórico, misma lección que el cursor de sync y la bitácora de errores.
        { name: 'rechazo_fecha', type: 'number', isOptional: true },
        { name: 'rechazo_fecha_envio', type: 'number', isOptional: true },
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