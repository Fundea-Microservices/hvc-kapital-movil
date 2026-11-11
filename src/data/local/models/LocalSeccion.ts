import { Model } from '@nozbe/watermelondb';
import { field, relation, text } from '@nozbe/watermelondb/decorators';

/**
 * El modelo representa las secciones visuales que alimentarán el Acordeón Inteligente.
 */
export default class LocalSeccion extends Model {
  static table = 'local_seccion';

  @text('id_encuesta') id_encuesta!: string;
  @text('titulo') nombre!: string;;
  @field('orden') orden!: number;
  @field('es_visible_default') es_visible_default!: number;
}