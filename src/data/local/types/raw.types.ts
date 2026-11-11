/**
 * Contratos de los registros crudos (`_raw`) de WatermelonDB.
 *
 * WatermelonDB no expone tipado para las columnas dinámicas de `Model._raw`, por lo
 * que el acceso directo obligaría a un casting a `any`. En su lugar se declara aquí
 * la forma exacta de cada tabla —extendiendo `Record<string, unknown>` para admitir
 * las columnas internas del motor (id, _status, _changed)— y se expone un helper
 * único de lectura. De esta manera el proyecto conserva el tipado estricto sin
 * renunciar a la reactividad del ORM.
 */

/** Base común: cualquier `_raw` incluye metadatos internos del motor. */
export interface RawBase extends Record<string, unknown> {
  id: string;
}

/** Fila de `local_estructura_pregunta` (estructura + reglas de la encuesta). */
export interface RawPregunta extends RawBase {
  id_encuesta: string | null;
  id_seccion: string | null;
  id_matriz_padre: string | null;
  etiqueta: string | null;
  tipo_dato: string | null;
  origen_datos_tipo: string | null;
  origen_datos_cmd: string | null;
  opciones: string | null;
  es_editable: number | null;
  es_visible_default: number | null;
  es_obligatorio: number | null;
  orden: number | null;
  sintaxis_calculo: string | null;
  regla_visibilidad: string | null;
  regla_validacion: string | null;
  mensaje_error: string | null;
  mensaje_notificacion: string | null;
}

/** Fila de `local_captura` (respuestas capturadas en el dispositivo). */
export interface RawCaptura extends RawBase {
  id_pregunta: string | null;
  id_encuesta: string | null;
  valor: string | null;
  uuid_instancia: string | null;
  estado_sincro: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

/** Fila de `local_catalogo_opciones` (catálogos maestros sincronizados). */
export interface RawCatalogoOpcion extends RawBase {
  id_remoto: string | null;
  nombre_catalogo: string | null;
  codigo_catalogo: string | null;
  codigo_opcion: string | null;
  valor_opcion: string | null;
  id_padre_opcion: string | null;
}

/** Fila de `metadata_sync` (control de fechas de sincronización por tabla). */
export interface RawMetadataSync extends RawBase {
  tabla_nombre: string | null;
  fecha_ultima_sinc: number | null;
}

/** Fila de `usuario_perfil` (perfil offline del colaborador). */
export interface RawUsuarioPerfil extends RawBase {
  id_usuario: number | null;
  usuario_guid: string | null;
  nombre: string | null;
  usuario: string | null;
  foto_url: string | null;
  rol: string | null;
  permisos_json: string | null;
  ultimo_login: number | null;
}

/**
 * Accede al `_raw` de un modelo de WatermelonDB con el contrato indicado.
 * Se recibe `unknown` porque el modelo no declara la propiedad, y se valida su
 * presencia antes de devolverlo; si el registro no la expone se devuelve el propio
 * objeto, que en la práctica comparte las mismas llaves por los decoradores.
 */
export const leerRaw = <T extends RawBase>(modelo: unknown): T => {
  if (typeof modelo === 'object' && modelo !== null && '_raw' in modelo) {
    const contenedor = modelo as { _raw: unknown };
    if (typeof contenedor._raw === 'object' && contenedor._raw !== null) {
      return contenedor._raw as T;
    }
  }
  return modelo as T;
};

/** Normaliza a texto un valor crudo de origen desconocido (null/number/string). */
export const comoTexto = (valor: unknown): string =>
  valor === null || valor === undefined ? '' : String(valor);
