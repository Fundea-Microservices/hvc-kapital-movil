import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * El modelo representa el almacén de respuestas (Auto-Save) offline[cite: 42].
 */
export default class LocalCaptura extends Model {
  static table = 'local_captura';

  @field('id_pregunta') id_pregunta!: string;
  @field('valor') valor!: string | null;
  @field('uuid_instancia') uuid_instancia!: string | null;
  @field('estado_sincro') estado_sincro!: number;
}