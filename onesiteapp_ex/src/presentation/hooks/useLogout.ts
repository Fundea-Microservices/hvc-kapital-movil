import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/useAuthStore';
import { logoutApi } from '../../data/remote/auth.api';
import { clearUserProfileLocal } from '../../data/local/services/user.service';

export const useLogout = () => {
  const wipeData = useAuthStore((state) => state.wipeData);

  const executeLogout = async () => {
    try {
      // 1. Obtener el refresh token para avisar al servidor
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      
      if (refreshToken) {
        // Notificar al backend (opcionalmente ignoramos el error si falla red)
        await logoutApi({ refreshToken }).catch(() => console.log("Servidor inaccesible para logout"));
      }

      // 2. Limpieza de Persistencia Local (WatermelonDB)
      await clearUserProfileLocal();

      // 3. Limpieza de Almacenamiento Seguro (Tokens)
      await SecureStore.deleteItemAsync('token_sesion');
      await SecureStore.deleteItemAsync('refresh_token');
      await SecureStore.deleteItemAsync('user_id');
      // NOTA: NO borramos 'deviceToken' ni 'isEnrolled' a menos que sea un bloqueo total.

      // 4. Reset del estado de la UI
      wipeData();

    } catch (error) {
      console.error("Error durante el proceso de logout:", error);
    }
  };

  return { executeLogout };
};