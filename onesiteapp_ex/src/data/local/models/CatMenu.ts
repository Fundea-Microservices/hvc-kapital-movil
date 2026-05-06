import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class CatMenu extends Model {
  static table = 'cat_menu_appex';

  @field('id_padre') id_padre!: string | null;
  @field('titulo') titulo!: string;
  @field('icono') icono!: string | null;
  @field('orden') orden!: number;
  @field('seccion') seccion!: string;
  @field('ruta_pantalla') ruta_pantalla!: string | null;
}