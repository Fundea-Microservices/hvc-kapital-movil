import { z } from 'zod';

//El DTO (Data Transfer Object) con validación Zod
export const EnrollDeviceSchema = z.object({
  codigoEnrolamiento: z.string().min(5, "El código es muy corto"),
  hardwareId: z.string().min(10, "HardwareID inválido"),
});

export type EnrollDeviceDto = z.infer<typeof EnrollDeviceSchema>;