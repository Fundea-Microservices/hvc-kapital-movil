import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Archivo adjunto capturado en campo y pendiente de subir (schema v8).
 *
 * CADA `@field` DE AQUÍ TIENE SU COLUMNA EN `schema.ts`. No es una formalidad: en
 * cada escritura WatermelonDB resuelve `schema.columns[nombre].type`, y si la columna
 * no existe lanza `TypeError: Cannot read property 'type' of undefined` que **aborta
 * la sincronización completa**, no solo esa fila. Ese fallo ya rompió este proyecto
 * dos veces. Por el mismo motivo NO se declaran `created_at`/`updated_at`: no son
 * implícitas en WatermelonDB, y su variante es especialmente traicionera porque la
 * primera sincronización pasa y solo revienta la segunda.
 *
 * Esta tabla es la dueña exclusiva de las filas de archivos: `persistirCapturas`
 * nunca la toca. Ver el comentario de `local_multimedia` en `schema.ts`.
 */
export default class LocalMultimedia extends Model {
  static table = 'local_multimedia';

  /** Encuesta a la que pertenece la respuesta que lleva el adjunto. */
  @field('id_encuesta') id_encuesta!: string;

  /** Pregunta que capturó el archivo. */
  @field('id_pregunta') id_pregunta!: string;

  /** Fila de matriz; cadena vacía cuando la pregunta no está dentro de una. */
  @field('uuid_instancia') uuid_instancia!: string;

  /** Instancia de captura. Permite borrar todos los archivos de una encuesta. */
  @field('uuid_base') uuid_base!: string;

  /** FOTO | MULTIMEDIA | DOCUMENTO | FIRMA */
  @field('tipo_medio') tipo_medio!: string;

  /**
   * Ruta RELATIVA al directorio de documentos de la app. Nunca absoluta: en iOS el
   * contenedor lleva un UUID que cambia al actualizar la app, así que una ruta
   * absoluta persistida dejaría de resolver y se perdería toda la cola pendiente.
   */
  @field('ruta_relativa') ruta_relativa!: string;

  /** Nombre que traía el archivo en el dispositivo. Informativo, para la UI. */
  @field('nombre_original') nombre_original!: string | null;

  @field('extension') extension!: string;
  @field('mime_type') mime_type!: string | null;
  @field('tamanio_bytes') tamanio_bytes!: number;

  /** Permite varios archivos en la misma pregunta. 1 es el primero. */
  @field('secuencia') secuencia!: number;

  /** 0 pendiente | 1 error reintentable | 2 subido | 3 rechazado definitivo. */
  @field('estado_subida') estado_subida!: number;

  @field('intentos') intentos!: number;
  @field('ultimo_error') ultimo_error!: string | null;

  /**
   * `IdCaptura` que devolvió el `/submit`, como STRING.
   *
   * Es `BIGINT` en SQL Server: convertirlo a `number` podría superar
   * `Number.MAX_SAFE_INTEGER` y redondearse **sin ningún error**, subiendo el archivo
   * a la captura equivocada. Mientras sea `null` la fila es invisible para la cola:
   * no se puede subir un archivo sin saber a qué captura pertenece, y **nunca se
   * inventa un id** — un valor de reserva aquí ocultaría el problema en lugar de
   * mostrarlo.
   */
  @field('id_captura_servidor') id_captura_servidor!: string | null;

  /** Epoch en milisegundos del momento de la captura en el dispositivo. */
  @field('fecha_captura') fecha_captura!: number;

  @field('fecha_subida') fecha_subida!: number | null;
}
