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
 * Desvincular equivale a des-enrolar, así que usa `wipeData()` (no `logout()`): borra
 * también el enrolamiento y el gate de `App.tsx` cae a Enrollment.
 */
export const useUnenroll = () => {
  const wipeData = useAuthStore((state) => state.wipeData);

  const executeUnenroll = async (): Promise<void> => {
    // 1. Autorización server-side. Si falla, propaga el error SIN limpiar nada.
    await desvincularDispositivoApi();

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
