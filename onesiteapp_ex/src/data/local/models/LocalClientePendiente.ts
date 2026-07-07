import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class LocalClientePendiente extends Model {
  static table = 'local_cliente_pendiente';

  @field('id_cliente') id_cliente!: string;
  @field('nombre') nombre!: string;
  @field('codigo') codigo!: string;
  @field('id_encuesta') id_encuesta!: string;
  @field('estado_gestion') estado_gestion!: number; // 0: Pendiente, 1: Gestionado/Sincronizado, 2: Cancelado
  @field('motivo_rechazo') motivo_rechazo!: string | null;
}