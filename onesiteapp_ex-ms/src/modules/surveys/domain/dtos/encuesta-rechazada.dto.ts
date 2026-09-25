import { z } from 'zod';

/**
 * Contrato del rechazo de gestión que empuja la cola offline del móvil.
 *
 * El schema es la barrera REAL: valida aunque un cliente manipulado llame directo al
 * endpoint. La app replica algunos de estos topes (`domain/agenda/rechazo.ts`) para no
 * gastar viajes de red inútiles, pero eso es conveniencia de UX, no seguridad.
 *
 * QUÉ NO ESTÁ AQUÍ, Y POR QUÉ
 * `idEmpresa` y `dispositivoId` NO se aceptan del cliente: los resuelve el servicio
 * desde el device token autenticado. El equipo solo guarda `company_name` (el nombre de
 * la empresa, nunca el id), y aceptar un `idEmpresa` del body dejaría que un cliente
 * manipulado atribuyera rechazos a otra empresa. Mismo criterio que el `userId` del
 * cambio de contraseña, que sale del JWT verificado y jamás del payload.
 */

/**
 * Tope del motivo. Debe coincidir con `MAX_LONGITUD_MOTIVO` de la app y caber en
 * `appEx_Encuestas_Rechazadas.Motivo` **y** en `pre.Precarga.Comentario` (el script
 * `TablasyReglasSprint14b.sql` avisa si esa segunda columna es más corta). Pasarse no
 * produce un error de validación amable: produce un fallo de truncamiento de SQL Server
 * dentro de la transacción, que revierte el encabezado recién insertado.
 */
export const MAX_LONGITUD_MOTIVO = 500;

const ClienteRechazadoSchema = z.object({
  nombre: z.string().trim().max(200).nullish(),
  documento: z.string().trim().max(50).nullish(),
  cuenta: z.string().trim().max(50).nullish(),
  operacion: z.string().trim().max(50).nullish(),
  expediente: z.string().trim().max(50).nullish(),
});

export const EncuestaRechazadaSchema = z
  .object({
    /**
     * uuid generado por el MÓVIL al cancelar, no por el servidor. Es la clave de
     * idempotencia (índice UNIQUE): el mismo valor en todos los reintentos permite
     * reconocer el duplicado cuando una respuesta 200 se pierde por la red.
     */
    idRechazo: z.string().trim().min(1, 'idRechazo es requerido').max(64),

    origen: z.enum(['PRECARGA', 'AD-HOC']),

    /** GUID de la fila de `pre.Precarga`. Nulo en AD-HOC: esa gestión no existe allí. */
    idPrecarga: z.string().trim().min(1).max(64).nullish(),

    // Llega como texto desde el móvil (todo el schema local de la app es string) y se
    // coacciona: la columna es INT y el driver no convierte por su cuenta.
    idEncuesta: z.coerce.number().int().positive('idEncuesta inválido'),

    uuidInstancia: z.string().trim().max(100).nullish(),

    cliente: ClienteRechazadoSchema.optional(),

    motivo: z
      .string()
      .trim()
      .min(1, 'El motivo del rechazo es requerido')
      .max(
        MAX_LONGITUD_MOTIVO,
        `El motivo no puede exceder ${MAX_LONGITUD_MOTIVO} caracteres`,
      ),

    /** ISO-8601 del reloj del dispositivo. El servicio lo valida por rango. */
    fechaRechazo: z.string().trim().min(1).nullish(),

    /**
     * RESERVADO para el futuro cercano: las respuestas parciales capturadas antes de
     * cancelar. Se acepta desde el día uno —opcional y hoy ignorado— para que añadirlas
     * no obligue a versionar el endpoint ni a publicar una app que hable otro contrato.
     * Cuando se implementen, se persistirán en la tabla hija prevista en el script SQL y
     * `RespuestasEnviadas` pasará a 1.
     */
    respuestas: z.array(z.unknown()).optional(),
  })
  /**
   * Coherencia origen ↔ idPrecarga. La BD la repite como CHECK: el endpoint no será el
   * único camino a esa tabla durante toda su vida.
   */
  .refine((d) => (d.origen === 'PRECARGA' ? !!d.idPrecarga : !d.idPrecarga), {
    message:
      'Una gestión PRECARGA exige idPrecarga; una AD-HOC no existe en pre.Precarga y debe enviarlo nulo',
    path: ['idPrecarga'],
  });

export type EncuestaRechazadaDto = z.infer<typeof EncuestaRechazadaSchema>;
