import { z } from 'zod';

// La app enviará un objeto con las tablas y la última fecha que sincronizó
export const SyncDeltasSchema = z.object({
lastSyncDates: z.record(
    z.string(), // La llave siempre será un string (ej. 'cat_menu')
    z.string().datetime().nullable() // El valor será una fecha ISO o null
  ),
});

export type SyncDeltasDto = z.infer<typeof SyncDeltasSchema>;

// DTO para el ACK (ConfirmarSinc)
export const AckSyncSchema = z.object({
  tablaNombre: z.string(),
  exitoso: z.boolean(),
});

export type AckSyncDto = z.infer<typeof AckSyncSchema>;