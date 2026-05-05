import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * El modelo representa la tabla Local_Encuesta para persistencia inmutable.
 */
export default class LocalEncuesta extends Model {
  static table = 'local_encuesta';

  @field('nombre') nombre!: string;
  @field('version_activa') version_activa!: number;
  @field('orden') orden!: number;
  @field('fecha_modificacion') fecha_modificacion!: string;
}