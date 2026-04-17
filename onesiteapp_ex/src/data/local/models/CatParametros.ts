import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class CatParametros extends Model {
  static table = 'cat_parametros_appex';

  @field('clave') clave!: string;
  @field('valor') valor!: string;
}