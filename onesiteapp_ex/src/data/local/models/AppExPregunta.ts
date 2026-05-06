import { Model } from '@nozbe/watermelondb';
import { field, relation } from '@nozbe/watermelondb/decorators';

export default class AppExPregunta extends Model {
  static table = 'local_estructura_pregunta';
  static associations = { app_ex_encuesta: { type: 'belongs_to', key: 'encuesta_id' } } as const;

  @field('id_encuesta') id_encuesta!: string;
  @field('tipo_input') tipo_input!: string;
  @field('nombre_input') nombre_input!: string;
  @field('obligatorio') obligatorio!: boolean;
  @field('orden') orden!: number;
  @field('valor_defecto') valor_defecto!: string | null;
  @field('opciones') opciones!: string | null;
  @field('catalogo') catalogo!: string | null;
}