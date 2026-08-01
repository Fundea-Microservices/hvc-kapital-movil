/**
 * Contratos del motor de encuestas.
 *
 * El dominio declara **lo que necesita**, no lo que la base de datos ofrece: estas
 * interfaces no importan WatermelonDB ni React, y por eso todo el motor se puede
 * probar con Node plano. La pantalla aplana sus modelos a estas formas en el borde
 * (ver `aplanarPregunta` en la capa de presentación).
 *
 * Los campos son `string | null` y no `?: string` a propósito: el esquema local
 * persiste NULL, y declararlos opcionales fue la causa de un bug real en el pasado.
 */

/** Pregunta tal como la necesita el motor, ya aplanada desde el modelo local. */
export interface PreguntaEncuesta {
  id: string;
  id_seccion: string;
  id_matriz_padre: string | null;
  etiqueta: string;
  tipo_dato: string;
  opciones: string | null;
  origen_datos_tipo: string | null;
  origen_datos_cmd: string | null;
  es_obligatorio: number;
  orden: number;
  sintaxis_calculo: string | null;
  regla_visibilidad: string | null;
  regla_validacion: string | null;
}

/** Opción de catálogo ya aplanada. */
export interface OpcionCatalogo {
  id_remoto: string | null;
  nombre_catalogo: string | null;
  codigo_catalogo: string | null;
  codigo_opcion: string | null;
  valor_opcion: string | null;
  id_padre_opcion: string | null;
}

/** Nodo del árbol de opciones que consume el SELECT con drill-down. */
export interface NodoOpcion {
  valor: string;
  hijos: NodoOpcion[];
}

/**
 * Mapa de respuestas. La clave es el id de la pregunta, o `"<id>_<uuidFila>"` cuando
 * la pregunta vive dentro de una fila de matriz.
 */
export type MapaRespuestas = Record<string, string>;

/** Filas activas por matriz: idPregunta de la matriz -> uuids de sus filas. */
export type InstanciasMatriz = Record<string, string[]>;

/** Clave de respuesta para una pregunta, acotada a su fila de matriz si aplica. */
export const claveRespuesta = (idPregunta: string, uuidFila?: string | null): string =>
  uuidFila ? `${idPregunta}_${uuidFila}` : String(idPregunta);

/** Normalización usada en TODAS las comparaciones de tipo del motor. */
export const normalizarTipo = (tipo: string | null | undefined): string =>
  (tipo || '').trim().toUpperCase();

/**
 * Comparación tolerante para valores mostrados al usuario: sin acentos, sin
 * mayúsculas y sin espacios en los bordes, de forma que "Sí" = "SI" = "si".
 */
export const normalizarComparacion = (valor: unknown): string =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/**
 * Normalización de nombres de catálogo: además de quitar acentos y mayúsculas,
 * elimina el prefijo `cat_` que el BackOffice usa de forma inconsistente.
 */
export const normalizarNombreCatalogo = (valor: unknown): string =>
  normalizarComparacion(valor).replace('cat_', '');

export const esTipoCalculo = (tipo: string | null | undefined): boolean =>
  normalizarTipo(tipo) === 'CALCULO';

export const esTipoMatriz = (tipo: string | null | undefined): boolean =>
  normalizarTipo(tipo) === 'MATRIZ';

/**
 * Tipos puramente informativos: muestran un texto y no capturan nada. Deben
 * excluirse de la validación de obligatorios, del semáforo de sección y de la
 * persistencia.
 */
export const esTipoLabel = (tipo: string | null | undefined): boolean =>
  ['LABEL', 'ETIQUETA', 'TEXTO_INFORMATIVO', 'INFORMATIVO'].includes(normalizarTipo(tipo));

/** Origen de datos servido por una API externa vía proxy del backend. */
export const esOrigenApi = (pregunta: PreguntaEncuesta): boolean =>
  normalizarTipo(pregunta.origen_datos_tipo) === 'API';
