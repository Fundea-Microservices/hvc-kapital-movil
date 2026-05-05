import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * El modelo centraliza la estructura y las reglas lógicas para optimizar lecturas offline.
 */
export default class LocalEstructuraPregunta extends Model {
  static table = 'local_estructura_pregunta';

  @field('id_seccion') id_seccion!: string;
  @field('id_matriz_padre') id_matriz_padre!: string | null;
  @field('tipo_dato') tipo_dato!: string;
  @field('origen_datos_tipo') origen_datos_tipo!: string | null;
  @field('origen_datos_cmd') origen_datos_cmd!: string | null;
  @field('es_editable') es_editable!: number;
  @field('es_visible_default') es_visible_default!: number;
  @field('orden') orden!: number;
  @field('sintaxis_calculo') sintaxis_calculo!: string | null;
  @field('regla_visibilidad') regla_visibilidad!: string | null;
  @field('regla_validacion') regla_validacion!: string | null;
}