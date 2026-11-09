import { Model } from '@nozbe/watermelondb';
import { field, date } from '@nozbe/watermelondb/decorators';

export default class MetadataSync extends Model {
  static table = 'metadata_sync';

  @field('tabla_nombre') tabla_nombre!: string;
  @date('fecha_ultima_sinc') fecha_ultima_sinc!: Date;

  // OJO: NO declarar aquí `created_at` / `updated_at`. La tabla metadata_sync del
  // schema no tiene esas columnas, y WatermelonDB toca `updated_at` en CADA
  // prepareUpdate (`if ('updatedAt' in this) this._setRaw('updated_at', ...)`).
  // Al no existir la columna, `schema.columns['updated_at']` es undefined y revienta
  // con "TypeError: Cannot read property 'type' of undefined", abortando el sync
  // completo en la SEGUNDA corrida (la primera usa create(), que no las toca).
  // Mismo patrón que el bug de LocalEncuesta.estado. Nadie lee esas fechas, así que
  // se eliminan en vez de añadirlas al schema (evita bump de versión + migración).
}