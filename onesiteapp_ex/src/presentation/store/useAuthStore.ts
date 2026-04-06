import { create } from 'zustand';

interface AuthState {
  isEnrolled: boolean;
  deviceToken: string | null;
  setEnrollment: (token: string) => void;
  checkLocalEnrollment: (isEnrolled: boolean, token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isEnrolled: false,
  deviceToken: null,
  
  // Se llama cuando el enrolamiento es exitoso
  setEnrollment: (token) => set({ isEnrolled: true, deviceToken: token }),
  
  // Se llama al iniciar la app para cargar datos desde SecureStore
  checkLocalEnrollment: (enrolled, token) => set({ isEnrolled: enrolled, deviceToken: token }),
}));