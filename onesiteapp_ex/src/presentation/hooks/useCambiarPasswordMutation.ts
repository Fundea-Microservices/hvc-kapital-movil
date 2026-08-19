import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import {
  cambiarPasswordApi,
  type CambiarPasswordPayload,
} from '../../data/remote/auth.api';

/**
 * Mutación del cambio obligatorio de contraseña (primer ingreso).
 *
 * A diferencia de `useSyncMutation`, NO se reintenta automáticamente: un fallo aquí
 * suele ser semántico (contraseña actual incorrecta, política incumplida) y reintentar
 * la misma petición volvería a fallar; además, reenviar credenciales sin intervención
 * del usuario no aporta. El token de sesión se pasa explícito porque esta pantalla
 * puede abrirse justo tras el login, antes de que el interceptor lo tenga en caché.
 */
export const useCambiarPasswordMutation = (
  token: string | null
): UseMutationResult<{ message: string }, Error, CambiarPasswordPayload> =>
  useMutation<{ message: string }, Error, CambiarPasswordPayload>({
    mutationKey: ['cambiar-password'],
    mutationFn: (payload) => cambiarPasswordApi(payload, token ?? ''),
    retry: false,
  });
