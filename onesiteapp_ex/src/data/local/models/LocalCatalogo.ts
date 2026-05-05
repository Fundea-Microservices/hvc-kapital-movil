import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * El modelo representa el almacén local de opciones para selects y combos.
 */
export default class LocalCatalogo extends Model {
  static table = 'local_catalogos';

  @field('nombre_catalogo') nombre_catalogo!: string;
  @field('codigo_opcion') codigo_opcion!: string;
  @field('valor_opcion') valor_opcion!: string;
  @field('id_padre_opcion') id_padre_opcion!: string | null;
}