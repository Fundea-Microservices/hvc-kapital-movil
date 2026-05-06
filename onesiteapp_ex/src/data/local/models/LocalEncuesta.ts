import { Model } from '@nozbe/watermelondb';
import { field, children } from '@nozbe/watermelondb/decorators';

/**
 * Modelo único para la tabla local_encuesta.
 * Combina los campos del backend con los necesarios para la UI. [cite: 34]
 */
export default class LocalEncuesta extends Model {
  static table = 'local_encuesta';

  // Definimos la asociación con las preguntas usando el nombre REAL de la tabla [cite: 35, 36]
  static associations = {
    local_estructura_pregunta: { type: 'has_many', foreignKey: 'id_encuesta' },
  } as const;

  @field('nombre') nombre!: string;
  @field('version_activa') version_activa!: number;
  @field('estado') estado!: boolean; // Añadido para que coincida con tu SQL [cite: 20]
  @field('orden') orden!: number;
  @field('fecha_modificacion') fecha_modificacion!: string;

  // Esto permite que el motor dinámico acceda a las preguntas reactivamente 
  @children('local_estructura_pregunta') preguntas!: any;
}