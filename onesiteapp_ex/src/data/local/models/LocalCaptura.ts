import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Modelo Unificado: LocalCaptura (Sprint 1.5)
 * Representa el almacén de respuestas offline con soporte para matrices y sincronización[cite: 42, 43].
 */
export default class LocalCaptura extends Model {
  static table = 'local_captura';

  // Vincula la respuesta a una pregunta específica [cite: 43]
  @field('id_pregunta') id_pregunta!: string;

  // Vincula la respuesta a la encuesta (Necesario para el Backend appEx_Respuestas) 
  @field('id_encuesta') id_encuesta!: string;

  // El dato capturado por el usuario [cite: 43]
  @field('valor') valor!: string | null;

  // Identificador único para agrupar filas de una matriz (Sprint 4) 
  @field('uuid_instancia') uuid_instancia!: string | null;

  // Control de flujo: 0 = Pendiente, 1 = Enviado (Sprint 5) 
  @field('estado_sincro') estado_sincro!: number;

  // Telemetría de auditoría: fecha/hora de inicio de la captura de la encuesta
  @field('fecha_inicio') fecha_inicio!: string | null;

  // Telemetría de auditoría: fecha/hora de finalización/cierre de la encuesta
  @field('fecha_fin') fecha_fin!: string | null;
}