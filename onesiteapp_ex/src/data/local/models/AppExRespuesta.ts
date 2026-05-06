import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class AppExRespuesta extends Model {
  static table = 'app_ex_respuesta';
  
  @field('pregunta_id') pregunta_id!: string;
  @field('encuesta_id') encuesta_id!: string;
  @field('valor') valor!: string | null;
  @field('sync_status') sync_status!: 'PENDING' | 'SYNCED';
}