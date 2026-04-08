import { create } from 'zustand';

interface AuthState {
  // Fase 1: Enrolamiento
  isEnrolled: boolean;
  deviceToken: string | null;
  // Fase 2: Login
  isLoggedIn: boolean;
  sessionToken: string | null;
  userId: number | null;


  setEnrollment: (token: string) => void;
  setLogin: (sessionToken: string, userId: number) => void;
  checkLocalState: (
    enrolled: boolean, dToken: string | null, 
    loggedIn: boolean, sToken: string | null, uId: number | null
  ) => void;
  wipeData: () => void; // Regla 4.3: Interceptor
  //checkLocalEnrollment: (isEnrolled: boolean, token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isEnrolled: false,
  deviceToken: null,
  isLoggedIn: false,
  sessionToken: null,
  userId: null,
  
  // Se llama cuando el enrolamiento es exitoso
  setEnrollment: (token) => set({ isEnrolled: true, deviceToken: token }),

  setLogin: (token, id) => set({ isLoggedIn: true, sessionToken: token, userId: id }),

  checkLocalState: (enrolled, dToken, loggedIn, sToken, uId) => set({ 
    isEnrolled: enrolled, 
    deviceToken: dToken,
    isLoggedIn: loggedIn,
    sessionToken: sToken,
    userId: uId
  }),
  
  // Se llama al iniciar la app para cargar datos desde SecureStore
  //checkLocalEnrollment: (enrolled, token) => set({ isEnrolled: enrolled, deviceToken: token }),

  // Método drástico para cuando el dispositivo es bloqueado (403)
  wipeData: () => set({
    isEnrolled: false,
    deviceToken: null,
    isLoggedIn: false,
    sessionToken: null,
    userId: null
  }),

}));