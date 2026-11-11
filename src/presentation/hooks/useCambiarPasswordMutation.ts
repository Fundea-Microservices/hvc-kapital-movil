import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import {
  cambiarPasswordApi,
  marcarPasswordCambiadaApi,
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
  token: string | null,
  usuarioId: string | null
): UseMutationResult<{ message: string }, Error, CambiarPasswordPayload> =>
  useMutation<{ message: string }, Error, CambiarPasswordPayload>({
    mutationKey: ['cambiar-password'],
    mutationFn: async (payload) => {
      const resultado = await cambiarPasswordApi(payload, token ?? '', usuarioId ?? '');
      // Apagar la bandera es best-effort: la contraseña YA cambió y fallar aquí no
      // debe mostrarse como error. El costo de un fallo es que la pantalla reaparezca.
      try {
        await marcarPasswordCambiadaApi(token ?? '');
      } catch (e) {
        console.warn('[PASSWORD] No se pudo apagar RequiereCambioPassword:', e);
      }
      return resultado;
    },
    retry: false,
  });
