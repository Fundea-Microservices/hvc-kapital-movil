import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  isEnrolled: boolean;
  deviceToken: string | null;
  isLoggedIn: boolean;
  token: string | null;
  userId: number | null;
  nombreCompleto: string | null;

  // Acciones
  setEnrolled: (token: string) => void;
  setLoggedIn: (token: string, userId: number, nombreCompleto: string) => void;
  
  // Esta es la función que tu App.tsx necesita para arrancar:
  checkLocalState: (
    enrolled: boolean, 
    dToken: string | null, 
    loggedIn: boolean, 
    uToken: string | null, 
    uId: number | null,
    unombreCompleto: string | null
  ) => void;  

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

      setEnrolled: (token) => set({ 
        isEnrolled: true, 
        deviceToken: token 
      }),

      setLoggedIn: (token, userId, nombreCompleto) => set({ 
        isLoggedIn: true, 
        token: token, 
        userId: userId,
        nombreCompleto: nombreCompleto || 'Usuario sin nombre',
      }),

      // Sincroniza el estado guardado con el estado de la app al iniciar
      checkLocalState: (enrolled, dToken, loggedIn, uToken, uId, unombreCompleto) => set({
        isEnrolled: enrolled,
        deviceToken: dToken,
        isLoggedIn: loggedIn,
        token: uToken,
        userId: uId,
        nombreCompleto: unombreCompleto
      }),

      logout: () => set({
        isLoggedIn: false,
        token: null,
        userId: null,
        nombreCompleto: null
      }),

      wipeData: () => set({
        isEnrolled: false,
        deviceToken: null,
        isLoggedIn: false,
        token: null,
        userId: null,
        nombreCompleto: null
      }),
    }),
    {
      name: 'fundea-auth-storage', 
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);