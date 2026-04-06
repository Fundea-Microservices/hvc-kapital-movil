import { Model } from '@nozbe/watermelondb';
import { field, readonly, date } from '@nozbe/watermelondb/decorators';

export default class MetadataSync extends Model {
  static table = 'metadata_sync';

  @field('tabla_nombre') tabla_nombre!: string;
  @date('fecha_ultima_sinc') fecha_ultima_sinc!: Date;

  // Campos de auditoría interna de Watermelon
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}