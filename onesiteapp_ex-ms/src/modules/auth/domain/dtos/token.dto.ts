import { z } from 'zod';

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(10, "El Refresh Token es requerido"),
});

export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;