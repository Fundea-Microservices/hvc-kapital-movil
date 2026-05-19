import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class CatalogoOpcion extends Model {
  // Debe coincidir exactamente con el nombre de la tabla en schema.ts
  static table = 'local_catalogo_opciones';

  @field('id_remoto') idRemoto!: string;
  @text('nombre_catalogo') nombreCatalogo!: string;
  @field('codigo_catalogo') codigoCatalogo!: string;
  @field('codigo_opcion') codigoOpcion!: string;
  @text('valor_opcion') valorOpcion!: string;
  @field('id_padre_opcion') idPadreOpcion?: string;
}