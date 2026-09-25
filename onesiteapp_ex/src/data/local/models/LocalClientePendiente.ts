import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Una fila de la agenda del asesor.
 *
 * TODA columna declarada aquí tiene que existir en `schema.ts`. WatermelonDB resuelve
 * `schema.columns[nombre].type` en cada escritura y, si falta, lanza
 * `TypeError: Cannot read property 'type' of undefined` que aborta la sincronización
 * COMPLETA, no solo esa fila. Por lo mismo NO se declaran `created_at`/`updated_at`:
 * no son implícitas en este ORM y su ausencia en el schema solo revienta en la SEGUNDA
 * corrida del sync, cuando `markLocalChangesAsSynced` pasa por `prepareUpdate`.
 */
export default class LocalClientePendiente extends Model {
  static table = 'local_cliente_pendiente';

  @field('id_cliente') id_cliente!: string;
  @field('nombre') nombre!: string;
  @field('codigo') codigo!: string;
  @field('id_encuesta') id_encuesta!: string;
  @field('estado_gestion') estado_gestion!: number; // 0: Pendiente, 1: Gestionado/Sincronizado, 2: Cancelado
  @field('motivo_rechazo') motivo_rechazo!: string | null;

  /**
   * Qué escritor es dueño de esta fila: `'PRECARGA'` (el sync) o `'AD-HOC'`
   * (`persistirCapturas`). Mantener los dos conjuntos disjuntos es lo que hace que el
   * orden de invocación sea irrelevante y que ninguno borre el trabajo del otro.
   */
  @field('origen') origen!: string;

  @field('documento') documento!: string | null;
  @field('cuenta') cuenta!: string | null;
  @field('operacion') operacion!: string | null;
  @field('expediente') expediente!: string | null;
  @field('ubicacion') ubicacion!: string | null;

  /** Concatenación sin acentos ni mayúsculas de los campos buscables, ya calculada. */
  @field('busqueda_normalizada') busqueda_normalizada!: string | null;

  /** JSON crudo `[{ id_pregunta, etiqueta, valor }]` que prellena el formulario. */
  @field('valores_json') valores_json!: string | null;

  /**
   * Estado según BackOffice (CARGADO/APLICADO/ANULADO/RECHAZADO). Vive aparte de
   * `estado_gestion` a propósito: ese es del asesor y el sync no lo pisa.
   *
   * SOLO lo escribe el sync con lo que responde el servidor. NO es la marca de "ya
   * envié el rechazo" — para eso están las columnas `rechazo_*`.
   */
  @field('estado_servidor') estado_servidor!: string | null;

  // --- v12: cola de salida del rechazo de gestión ---------------------------
  // Columnas de TRANSPORTE, con un único escritor: `empujarRechazosPendientes`.

  /** uuid de la INTENCIÓN de rechazar. Clave de idempotencia del servidor. */
  @field('rechazo_uuid') rechazo_uuid!: string | null;

  /** 0 pendiente | 1 error reintentable | 2 enviado | 3 rechazado definitivamente. */
  @field('rechazo_envio_estado') rechazo_envio_estado!: number;

  @field('rechazo_intentos') rechazo_intentos!: number;
  @field('rechazo_ultimo_error') rechazo_ultimo_error!: string | null;

  /** Cuándo canceló el asesor, según el reloj del dispositivo (ms). */
  @field('rechazo_fecha') rechazo_fecha!: number | null;

  /** Cuándo lo confirmó el servidor (ms). */
  @field('rechazo_fecha_envio') rechazo_fecha_envio!: number | null;
}
