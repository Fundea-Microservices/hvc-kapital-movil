import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  isEnrolled: boolean;
  deviceToken: string | null;
  isLoggedIn: boolean;
  token: string | null;
  userId: string | null;
  nombreCompleto: string | null;
  /**
   * Primer ingreso: cuando es `true`, el gate de `App.tsx` intercepta la navegación
   * y muestra la pantalla de cambio de contraseña en vez del Dashboard. Persiste en
   * SecureStore (no solo aquí) para que sobreviva a un reinicio de la app antes de
   * completar el cambio; `App.tsx` lo rehidrata en el arranque vía `checkLocalState`.
   */
  debeCambiarPassword: boolean;

  // Acciones
  setEnrolled: (token: string) => void;
  setLoggedIn: (
    token: string,
    userId: string,
    nombreCompleto: string,
    debeCambiarPassword?: boolean
  ) => void;

  // Esta es la función que tu App.tsx necesita para arrancar:
  checkLocalState: (
    enrolled: boolean,
    dToken: string | null,
    loggedIn: boolean,
    uToken: string | null,
    uId: string | null,
    unombreCompleto: string | null,
    debeCambiarPassword?: boolean
  ) => void;

  /** Se invoca tras un cambio de contraseña exitoso para liberar el gate. */
  limpiarCambioPassword: () => void;

  logout: () => void;
  wipeData: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isEnrolled: false,
      deviceToken: null,
      isLoggedIn: false,
      token: null,
      userId: null,
      nombreCompleto: null,
      debeCambiarPassword: false,

      setEnrolled: (token) => set({
        isEnrolled: true,
        deviceToken: token
      }),

      setLoggedIn: (token, userId, nombreCompleto, debeCambiarPassword = false) => set({
        isLoggedIn: true,
        token: token,
        userId: userId,
        nombreCompleto: nombreCompleto || 'Colaborador',
        debeCambiarPassword,
      }),

      // Sincroniza el estado guardado con el estado de la app al iniciar
      checkLocalState: (enrolled, dToken, loggedIn, uToken, uId, unombreCompleto, debeCambiarPassword = false) => set({
        isEnrolled: enrolled,
        deviceToken: dToken,
        isLoggedIn: loggedIn,
        token: uToken,
        userId: uId,
        nombreCompleto: unombreCompleto,
        debeCambiarPassword,
      }),

      limpiarCambioPassword: () => set({ debeCambiarPassword: false }),

      logout: () => set({
        isLoggedIn: false,
        token: null,
        userId: null,
        nombreCompleto: null,
        debeCambiarPassword: false
      }),

      wipeData: () => set({
        isEnrolled: false,
        deviceToken: null,
        isLoggedIn: false,
        token: null,
        userId: null,
        nombreCompleto: null,
        debeCambiarPassword: false
      }),
    }),
    {
      name: 'fundea-auth-storage', 
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);