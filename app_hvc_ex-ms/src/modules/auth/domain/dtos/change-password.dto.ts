import { z } from 'zod';

/**
 * Política de contraseña segura para el cambio obligatorio de primer ingreso.
 *
 * Las cuatro reglas de complejidad se expresan como `regex` independientes en vez de
 * una sola expresión monolítica: así cada incumplimiento devuelve su propio mensaje y
 * el cliente móvil puede pintar un indicador por regla replicando estos mismos
 * criterios. El conjunto de caracteres especiales es EXACTO (`@#$%*!?&`); ampliarlo o
 * reducirlo aquí debe hacerse en paralelo con `politicaPassword.ts` de la app.
 */
export const CARACTERES_ESPECIALES = '@#$%*!?&';

export const ChangePasswordSchema = z
  .object({
    passwordActual: z.string().min(1, 'La contraseña actual es requerida'),
    passwordNueva: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .max(20, 'La contraseña no puede tener más de 20 caracteres')
      .regex(/[A-Z]/, 'Debe incluir al menos una letra mayúscula')
      .regex(/[a-z]/, 'Debe incluir al menos una letra minúscula')
      .regex(/[0-9]/, 'Debe incluir al menos un número')
      .regex(
        /[@#$%*!?&]/,
        'Debe incluir al menos un carácter especial (@#$%*!?&)',
      ),
    confirmarPassword: z.string().min(1, 'Debe confirmar la nueva contraseña'),
  })
  // La confirmación debe coincidir exactamente con la nueva contraseña.
  .refine((data) => data.passwordNueva === data.confirmarPassword, {
    message: 'La nueva contraseña y su confirmación no coinciden',
    path: ['confirmarPassword'],
  })
  // Regla de negocio: no se permite "cambiar" a la misma contraseña temporal.
  .refine((data) => data.passwordNueva !== data.passwordActual, {
    message: 'La nueva contraseña no puede ser igual a la actual',
    path: ['passwordNueva'],
  });

export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
