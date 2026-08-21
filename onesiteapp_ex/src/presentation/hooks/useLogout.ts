import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/useAuthStore';
import { logoutApi } from '../../data/remote/auth.api';
import { clearUserProfileLocal } from '../../data/local/services/user.service';

export const useLogout = () => {
  // Cerrar sesión resetea SOLO la sesión del usuario y CONSERVA el enrolamiento
  // (isEnrolled/deviceToken). Por eso se usa `logout` y NO `wipeData`: este último
  // des-enrola el equipo y está reservado al wipe destructivo por 403 'Device Blocked'
  // en apiClient. Con logout el gate cae a Login; con wipeData caería a Enrollment.
  const logout = useAuthStore((state) => state.logout);

  const executeLogout = async () => {
    try {
      // 1. Obtener el refresh token ANTES de borrar SecureStore, para avisar al servidor.
      const refreshToken = await SecureStore.getItemAsync('refresh_token');

      if (refreshToken) {
        // Notificar al backend en segundo plano (best-effort): NO se espera. Sin red, la
        // llamada tardaría hasta el timeout y retrasaría la vuelta a Login; el usuario
        // debe salir al instante. El backend invalida el refresh token cuando pueda.
        void logoutApi({ refreshToken }).catch(() => { });
      }

      // 2. Limpieza de Persistencia Local (WatermelonDB)
      await clearUserProfileLocal();

      // 3. Limpieza de Almacenamiento Seguro (Tokens + identidad del usuario, Regla 2.5).
      // ESTO es lo que impide que App.tsx re-loguee al reabrir: sin `token_sesion`,
      // `initializeApp` decide isLoggedIn=false.
      await SecureStore.deleteItemAsync('token_sesion');
      await SecureStore.deleteItemAsync('refresh_token');
      await SecureStore.deleteItemAsync('user_id');
      await SecureStore.deleteItemAsync('user_name');
      await SecureStore.deleteItemAsync('nombre_completo');
      // Bandera de primer ingreso: es per-usuario, se limpia con el resto de su identidad.
      await SecureStore.deleteItemAsync('requiere_cambio_password');
      // NOTA: NO borramos 'deviceToken', 'isEnrolled' ni 'company_name' (son del equipo, no del usuario).

      // 4. Reset del estado de la UI (sesión, no enrolamiento).
      logout();

    } catch (error) {
      console.error("Error durante el proceso de logout:", error);
    }
  };

  return { executeLogout };
};