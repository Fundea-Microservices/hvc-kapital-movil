import { Model } from '@nozbe/watermelondb';
import { field, children } from '@nozbe/watermelondb/decorators';

export default class AppExEncuesta extends Model {
  static table = 'local_encuesta';
  static associations = { app_ex_pregunta: { type: 'has_many', foreignKey: 'encuesta_id' } } as const;

  @field('nombre') nombre!: string;
  @field('estado') estado!: boolean;
  @children('app_ex_pregunta') preguntas!: any;
}