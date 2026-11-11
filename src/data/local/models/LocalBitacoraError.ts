import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Un error ocurrido en el dispositivo, pendiente de enviar al servidor (schema v9).
 *
 * Cada `@field` tiene su columna en `schema.ts`. No es una formalidad: WatermelonDB
 * resuelve `schema.columns[nombre].type` en cada escritura y, si la columna no existe,
 * lanza un `TypeError` que **aborta la sincronización completa**. Por el mismo motivo
 * NO se declaran `created_at`/`updated_at`: no son implícitas, y su variante es la más
 * traicionera porque la primera sincronización pasa y solo revienta la segunda.
 *
 * El contenido llega ya saneado desde `domain/diagnostico/bitacora.ts`: aquí no se
 * vuelve a filtrar nada, para que exista un único punto responsable de eso.
 */
export default class LocalBitacoraError extends Model {
  static table = 'local_bitacora_error';

  /** ERROR | WARN */
  @field('nivel') nivel!: string;

  /** Punto del código que lo registró: `syncManager.FASE1`, `multimedia.subida`… */
  @field('origen') origen!: string;

  @field('mensaje') mensaje!: string;
  @field('detalle') detalle!: string | null;

  /** Contexto escalar serializado. Nunca contiene respuestas del encuestado. */
  @field('contexto_json') contexto_json!: string | null;

  /** Versión de la app en la que ocurrió: sin esto no se puede saber si un error
   *  ya está corregido en una versión posterior. */
  @field('version_app') version_app!: string;

  @field('plataforma') plataforma!: string;

  /** Epoch en milisegundos del momento del fallo, no del envío. */
  @field('epoch_ms') epoch_ms!: number;

  /** 0 pendiente | 2 enviado. */
  @field('estado_envio') estado_envio!: number;

  @field('intentos') intentos!: number;
}
