import { Model } from '@nozbe/watermelondb';
import { field, relation, text } from '@nozbe/watermelondb/decorators';

/**
 * Modelo Unificado: LocalEstructuraPregunta (Sprint 1.3)
 * Centraliza la definición visual y las reglas lógicas para el funcionamiento offline.
 */
export default class LocalEstructuraPregunta extends Model {
  static table = 'local_estructura_pregunta';

  // Relaciones
  static associations = {
    local_encuesta: { type: 'belongs_to', key: 'id_encuesta' },
  } as const;

  // Campos de Identidad (Sincronización)
  @field('id_encuesta') id_encuesta!: string; // Necesario para el filtro rápido en la App
  @field('id_seccion') id_seccion!: string;
  @field('id_matriz_padre') id_matriz_padre!: string | null;

  // Campos de Visualización (UI)
  @text('tipo_dato') tipo_dato!: string; // TEXTO, DECIMAL, ENTERO, FECHA, MATRIZ, etc.
  @text('etiqueta') etiqueta!: string; // Viene de 'Etiqueta' en SQL
  @field('origen_datos_tipo') origen_datos_tipo!: string | null; // MAESTRO, SERVICIO, etc.
  @field('origen_datos_cmd') origen_datos_cmd!: string | null; // Nombre del catálogo
  @text('opciones') opciones!: string | null; // NUEVO: Para guardar el JSON de Radio/Select
  
  // Reglas de Negocio (Sprint 2 y 3)
  @field('es_editable') es_editable!: number; // 1 = Editable, 0 = Solo lectura
  @field('es_visible_default') es_visible_default!: number;
  @field('es_obligatorio') es_obligatorio!: number;
  @field('orden') orden!: number;

  // Motor de Inteligencia (Sprint 3)
  @field('sintaxis_calculo') sintaxis_calculo!: string | null; // Ej: [Q1]+[Q2]
  @field('regla_visibilidad') regla_visibilidad!: string | null; // Lógica de saltos
  @field('regla_validacion') regla_validacion!: string | null; // Regex o máscaras
}