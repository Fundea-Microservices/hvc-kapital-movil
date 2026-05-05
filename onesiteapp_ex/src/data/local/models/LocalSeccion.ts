import { Model } from '@nozbe/watermelondb';
import { field, relation } from '@nozbe/watermelondb/decorators';

/**
 * El modelo representa las secciones visuales que alimentarán el Acordeón Inteligente.
 */
export default class LocalSeccion extends Model {
  static table = 'local_seccion';

  @field('id_encuesta') id_encuesta!: string;
  @field('titulo') titulo!: string;
  @field('orden') orden!: number;
  @field('es_visible_default') es_visible_default!: number;
}