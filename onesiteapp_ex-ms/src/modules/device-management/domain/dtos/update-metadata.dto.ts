import { z } from 'zod';

export const UpdateMetadataSchema = z.object({
  deviceToken: z.string().uuid("El token proporcionado no es válido"),
  modelo: z.string().min(1, "El modelo del equipo es requerido"),
  versionSO: z.string().min(1, "La versión de SO es requerida"),
});

export type UpdateMetadataDto = z.infer<typeof UpdateMetadataSchema>;