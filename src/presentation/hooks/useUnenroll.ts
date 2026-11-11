import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/useAuthStore';
import { desvincularDispositivoApi } from '../../data/remote/auth.api';
import { wipeLocalDatabase } from '../../data/local/services/database.service';

/**
 * Desvinculación del dispositivo desde la app (Login o Dashboard).
 *
 * NO autenticada: el backend la autoriza con el device token (lo envía el interceptor),
 * así que funciona también en Login sin sesión. El backend es AUTORITATIVO: si rechaza,
 * `desvincularDispositivoApi` lanza y NO se borra nada — el llamador muestra el error.
 * Solo tras el OK del servidor se ejecuta el wipe completo.
 *
 * ÚNICA EXCEPCIÓN: un 404 ("Dispositivo no encontrado") NO es un rechazo — es que el
 * servidor YA está en el estado que se le pide: este equipo no existe en su base. Si
 * eso impidiera el wipe, el equipo quedaría ATRAPADO: con el token guardado el gate
 * muestra Login en vez de Enrollment, el login responde 403 "Dispositivo no registrado"
 * y el único escape (Desvincular) también falla. Ocurre siempre que la app se repunta a
 * otro backend —o a otra base— con un enrolamiento previo vivo en SecureStore.
 *
 * Desvincular equivale a des-enrolar, así que usa `wipeData()` (no `logout()`): borra
 * también el enrolamiento y el gate de `App.tsx` cae a Enrollment.
 */
/**
 * ¿El fallo es "este servidor no conoce el dispositivo"? Se mira el status HTTP y no el
 * texto del mensaje: ese texto es copy del backend y cambiarlo no debe reactivar la
 * trampa descrita arriba.
 */
const esDispositivoDesconocido = (error: unknown): boolean =>
  (error as { response?: { status?: number } } | null)?.response?.status === 404;

export const useUnenroll = () => {
  const wipeData = useAuthStore((state) => state.wipeData);

  const executeUnenroll = async (): Promise<void> => {
    // 1. Autorización server-side. Si falla, propaga el error SIN limpiar nada, salvo
    //    el 404 descrito arriba (allá no existe el equipo: no hay nada que desvincular).
    try {
      await desvincularDispositivoApi();
    } catch (error) {
      if (!esDispositivoDesconocido(error)) throw error;
      console.warn(
        '[DESVINCULAR] El servidor no conoce este dispositivo (404); se limpia el equipo igualmente.',
      );
    }

    // 2. Wipe total: base local + TODAS las claves de SecureStore (equipo + usuario).
    await wipeLocalDatabase();

    // Claves del equipo (a diferencia del logout, aquí SÍ se borran).
    await SecureStore.deleteItemAsync('deviceToken');
    await SecureStore.deleteItemAsync('isEnrolled');
    await SecureStore.deleteItemAsync('company_name');
    // Claves de la sesión/usuario.
    await SecureStore.deleteItemAsync('token_sesion');
    await SecureStore.deleteItemAsync('refresh_token');
    await SecureStore.deleteItemAsync('user_id');
    await SecureStore.deleteItemAsync('user_name');
    await SecureStore.deleteItemAsync('nombre_completo');
    await SecureStore.deleteItemAsync('requiere_cambio_password');

    // 3. Reset del estado global → el gate cae a Enrollment.
    wipeData();
  };

  return { executeUnenroll };
};
